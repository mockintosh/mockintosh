/**
 * Draw pipeline — walks the CanvasNode tree and issues QuickDraw calls.
 *
 * Order:
 *   1. computeLayout(root, w, h, measureFunc) populates node.layout
 *   2. eraseAll() clears the pixel buffer to white
 *   3. drawTree(root, port) renders every node (offsets, no layout mutation)
 *   4. collectHitRects(root) extracts HitRect[] for tests / host fallbacks
 */

import {
  type GrafPort,
  type BitMap,
  type RgnHandle,
  type Rect,
  SetPort,
  GetClip,
  SetClip,
  NewRgn,
  RectRgn,
  SectRgn,
  OpenRgn,
  CloseRgn,
  PtInRgn,
  CopyBits,
  ForeColor,
  PaintRect,
  PaintRoundRect,
  EraseRect,
  EraseRoundRect,
  FrameRect,
  FrameRoundRect,
  FillRect,
  FillRoundRect,
  globals,
  blackColor,
  whiteColor,
  patCopy,
  patBic,
  patXor,
  srcCopy,
  srcOr,
  srcBic,
  TextFace,
  TextFont,
  TextMode,
  TextSize,
  PenPat,
  PenMode,
  PenNormal,
  PenSize,
} from "@mockintosh/quickdraw";
import {
  makeRect,
  cloneRect,
  bitMapFromPixels,
  bitMapWidth,
  bitMapHeight,
  setBit,
} from "@mockintosh/quickdraw/bits";
import {
  hasMouseHandlers,
  collectNodeText,
  resolveBorderWidth,
  shadowRaise,
  type CanvasNode,
  type HitRect,
  type HitMask,
  type Fill,
  type DitherGradientFill,
  isDitherGradientFill,
  textWraps,
  type Ink,
  type PatternBits,
  type PatternName,
  type RasterPaintFn,
  type RasterPaintRect,
  type RasterSurface,
  type TextAlign,
  type TextVerticalAlign,
} from "./nodes";
import type { FocusManager } from "./focus";
import type { Sprite } from "./sprite";
import { layoutNodeText, lineBoxHeight, lineLeft } from "./fonts/textLayout";
import { textAdvance } from "./fonts/font";
import { faceMetrics, middleCellTop } from "./fonts/metrics";
import { fontFromProps, fontNameFromProps, fontStyleFromProps, textFace } from "./fonts/style";
import { drawUnderline } from "./fonts/underline";
import { layoutNodeRuns, runFont, runLineLeft, runStyle } from "./fonts/runLayout";
import { nodeRuns, runFaceOf } from "./textRuns";
import { drawUiText, fontFamilyId } from "./fonts/strike";
import { drawStyledLine } from "./fonts/bridge";
import { textSelectionOf } from "./selectable";
import { scrollPaintOffset, scrollTrack } from "./scroll";
import { rasterizeDitherGradient } from "./ditherGradient";

// -------------------------------------------------------------------------
// Pattern data — 8x8 bitmaps for dither fills
// -------------------------------------------------------------------------

const PATTERNS: Record<PatternName, Uint8Array> = {
  checker:    new Uint8Array([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]),
  gray50:     new Uint8Array([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]),
  gray75:     new Uint8Array([0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd]),
  gray25:     new Uint8Array([0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22]),
  hstripe:    new Uint8Array([0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00]),
  vstripe:    new Uint8Array([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]),
  dstripe:    new Uint8Array([0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01]),
  crosshatch: new Uint8Array([0xff, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]),
  darkCheckers: new Uint8Array([0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa]),
};

/**
 * The 8×8 QuickDraw pattern for a named fill, for hosts that paint outside
 * the node tree (e.g. the shell's XOR zoom animation) and want to match the
 * tree's `background` / `penMode="xor"` appearance exactly.
 */
export function patternBits(name: PatternName): Uint8Array {
  return PATTERNS[name] ?? PATTERNS.checker;
}

// -------------------------------------------------------------------------
// Port helpers
// -------------------------------------------------------------------------

export interface DrawContext {
  port: GrafPort;
  focusManager: FocusManager | null;
  width: number;
  height: number;
}

function snapshotClip(port: GrafPort): RgnHandle {
  SetPort(port);
  const rgn = NewRgn();
  GetClip(rgn);
  return rgn;
}

function restoreClip(port: GrafPort, rgn: RgnHandle): void {
  SetPort(port);
  SetClip(rgn);
}

/**
 * Intersect the port clip with `next` so a child cannot reopen a parent.
 * Uses `SectRgn` so a rounded overflow clip survives nested rect clips.
 */
function intersectClip(port: GrafPort, next: Rect): void {
  SetPort(port);
  const extra = NewRgn();
  RectRgn(extra, next);
  SectRgn(port.clipRgn, extra, port.clipRgn);
}

function boxOvalSize(node: CanvasNode): number {
  const radius = (node.props["borderRadius"] as number | undefined) ?? 0;
  return radius > 0 ? radius * 2 : 0;
}

/** Restrict the clip to the filled round-rect of `r` (same oval as `drawBox`). */
function intersectClipRoundRect(port: GrafPort, r: Rect, ovSize: number): void {
  SetPort(port);
  const shaped = NewRgn();
  OpenRgn();
  FrameRoundRect(r, ovSize, ovSize);
  CloseRgn(shaped);
  SectRgn(port.clipRgn, shaped, port.clipRgn);
}

/** Inline equivalent of the private `makeRegion` in grafport.ts */
function _makeRgn(r: Rect): RgnHandle {
  return { rgn: { rgnSize: 10, rgnBBox: cloneRect(r), data: new Int16Array(0) } };
}

export function createDrawContext(screen: BitMap): DrawContext {
  const width = bitMapWidth(screen);
  const height = bitMapHeight(screen);
  const bounds = cloneRect(screen.bounds);
  const port: GrafPort = {
    device: 0,
    portBits: screen,
    portRect: cloneRect(bounds),
    visRgn: _makeRgn(cloneRect(bounds)),
    clipRgn: _makeRgn(makeRect(-32767, -32767, 32767, 32767)),
    bkPat: new Uint8Array(8),
    fillPat: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    pnLoc: { v: 0, h: 0 },
    pnSize: { v: 1, h: 1 },
    pnMode: patCopy,
    pnPat: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    pnVis: 0,
    txFont: 0,
    txFace: 0,
    txMode: 1,
    txSize: 0,
    spExtra: 0,
    fgColor: blackColor,
    bkColor: whiteColor,
    colrBit: 0,
    patStretch: 0,
    picSave: null,
    rgnSave: false,
    polySave: false,
    grafProcs: null,
  };
  SetPort(port);
  return { port, focusManager: null, width, height };
}

/** Point an existing draw context at a new framebuffer. Keeps focusManager. */
export function resizeDrawContext(ctx: DrawContext, screen: BitMap): void {
  const width = bitMapWidth(screen);
  const height = bitMapHeight(screen);
  const bounds = cloneRect(screen.bounds);
  ctx.width = width;
  ctx.height = height;
  ctx.port.portBits = screen;
  ctx.port.portRect = cloneRect(bounds);
  ctx.port.visRgn = _makeRgn(cloneRect(bounds));
  SetPort(ctx.port);
}

function applyPenMode(_port: GrafPort, penMode: "copy" | "xor" | "bic" | undefined): void {
  if (penMode === "xor") PenMode(patXor);
  else if (penMode === "bic") PenMode(patBic);
  else PenNormal();
}

function resolvePattern(background: PatternName | PatternBits): Uint8Array {
  if (background instanceof Uint8Array) {
    return background.length === 8 ? background : PATTERNS.checker;
  }
  return PATTERNS[background] ?? PATTERNS.checker;
}

function fillBackground(
  port: GrafPort,
  r: ReturnType<typeof makeRect>,
  background: Fill,
  penMode: "copy" | "xor" | "bic" | undefined,
  ovSize = 0
): void {
  applyPenMode(port, penMode);
  const rounded = ovSize > 0;
  if (isDitherGradientFill(background)) {
    fillDitherGradient(port, r, background, ovSize);
    PenNormal();
    return;
  }
  if (typeof background === "number") {
    if (background === 0 && penMode !== "xor") {
      if (rounded) EraseRoundRect(r, ovSize, ovSize);
      else EraseRect(r);
    } else {
      PenNormal();
      if (penMode === "xor") PenMode(patXor);
      if (background === 0) PenPat(globals.white);
      if (rounded) PaintRoundRect(r, ovSize, ovSize);
      else PaintRect(r);
      PenNormal();
    }
  } else {
    const pat = resolvePattern(background);
    if (penMode === "xor" || penMode === "bic") {
      PenPat(pat);
      if (rounded) PaintRoundRect(r, ovSize, ovSize);
      else PaintRect(r);
    } else if (rounded) FillRoundRect(r, ovSize, ovSize, pat);
    else FillRect(r, pat);
  }
  PenNormal();
}

function fillDitherGradient(
  port: GrafPort,
  r: ReturnType<typeof makeRect>,
  fill: DitherGradientFill,
  ovSize: number,
): void {
  const width = r.right - r.left;
  const height = r.bottom - r.top;
  if (width < 1 || height < 1) return;
  const bits = rasterizeDitherGradient(width, height, fill);
  const saved = snapshotClip(port);
  intersectClip(port, r);
  if (ovSize > 0) intersectClipRoundRect(port, r, ovSize);
  createRasterSurface(port, { x: r.left, y: r.top, width, height }).blitPixels(bits, width, height);
  restoreClip(port, saved);
}

// -------------------------------------------------------------------------
// Draw
// -------------------------------------------------------------------------

export function drawTree(root: CanvasNode, ctx: DrawContext): void {
  SetPort(ctx.port);
  EraseRect(makeRect(0, 0, ctx.height, ctx.width));
  PenNormal();
  ForeColor(blackColor);
  drawNode(root, ctx, 0, 0, 0);
}

function viewBox(port: GrafPort): Rect {
  const clip = port.clipRgn.rgn.rgnBBox;
  const vis = port.visRgn.rgn.rgnBBox;
  const pr = port.portRect;
  return makeRect(
    Math.max(clip.top, vis.top, pr.top),
    Math.max(clip.left, vis.left, pr.left),
    Math.min(clip.bottom, vis.bottom, pr.bottom),
    Math.min(clip.right, vis.right, pr.right),
  );
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function drawNode(
  node: CanvasNode,
  ctx: DrawContext,
  zIndex: number,
  ox: number,
  oy: number
): void {
  if (node.type === "_text_content") return;

  if (node.type === "_root") {
    for (const child of node.children) drawNode(child, ctx, zIndex, ox, oy);
    return;
  }

  const raise = shadowRaise(node);
  const x = node.layout.x + ox - raise;
  const y = node.layout.y + oy - raise;
  const { width, height } = node.layout;
  const port = ctx.port;
  const r = makeRect(y, x, y + height, x + width);
  const overflow = node.style.overflow;
  const clips = overflow === "hidden" || overflow === "scroll";
  const childOx = ox - raise;
  const childOy = (overflow === "scroll" ? oy - scrollPaintOffset(node) : oy) - raise;
  const inView = rectsOverlap(
    makeRect(y, x, y + height + raise, x + width + raise),
    viewBox(port),
  );

  if (!inView) {
    // Without a clip, children (absolute or overflowing) can paint outside
    // this box, so each decides its own visibility.
    if (clips) return;
    for (const child of node.children) drawNode(child, ctx, zIndex + 1, childOx, childOy);
    return;
  }

  if (node.type === "box") drawBox(node, ctx, r, x, y, width, height);
  else if (node.type === "text") drawText(node, ctx, x, y, width, height);
  else if (node.type === "image") drawImage(node, ctx, x, y, width, height);
  else if (node.type === "raster") drawRaster(node, ctx, x, y, width, height);
  else if (node.type === "bitmap") drawBitmap(node, ctx, x, y, width, height);

  if (clips) {
    const savedClip = snapshotClip(port);
    // Clip to the padding box so children can never paint over the border.
    const bw = resolveBorderWidth(node);
    intersectClip(port, makeRect(y + bw, x + bw, y + height - bw, x + width - bw));
    const ovSize = boxOvalSize(node);
    if (ovSize > 0) intersectClipRoundRect(port, r, ovSize);
    for (const child of node.children) drawNode(child, ctx, zIndex + 1, childOx, childOy);
    if (overflow === "scroll") paintOverflowScrollTrack(node, x, y, width, height);
    restoreClip(port, savedClip);
    return;
  }

  for (const child of node.children) drawNode(child, ctx, zIndex + 1, childOx, childOy);
}

function drawBox(
  node: CanvasNode,
  ctx: DrawContext,
  r: ReturnType<typeof makeRect>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const { background, borderColor, borderStyle, shadow, penMode } =
    node.props as {
      background?: Fill;
      borderColor?: Ink;
      borderStyle?: "solid" | "dotted" | "dashed";
      shadow?: boolean;
      penMode?: "copy" | "xor" | "bic";
    };

  // QuickDraw `ovWd`/`ovHt` are corner-oval *diameters* (`RRects.a`).
  // `borderRadius` is a CSS-style radius, so the oval size is 2×.
  const ovSize = boxOvalSize(node);

  // Offset copy first so a rounded face punches the overlap and leaves a
  // curved L. Square faces still get the two 1px bars (no fill-through).
  if (shadow) paintBoxShadow(x, y, width, height, ovSize);

  if (background !== undefined) {
    fillBackground(ctx.port, r, background, penMode, ovSize);
  } else if (shadow && ovSize > 0) {
    EraseRoundRect(r, ovSize, ovSize);
  }

  const bw = resolveBorderWidth(node);
  if (borderColor !== undefined && bw > 0) {
    applyPenMode(ctx.port, penMode);

    if (borderColor === 0) {
      PenPat(globals.white);
    } else {
      PenNormal();
      if (penMode === "xor") PenMode(patXor);
    }

    if (borderStyle === "dotted" || borderStyle === "dashed") {
      drawDashedBorder({ x, y, width, height }, borderStyle, bw);
    } else {
      // One Frame* with the pen size — the Control Manager default-ring
      // sequence — not concentric 1px frames. PenSize hangs inside the rect
      // (`FrRect` / hollow `DrawArc`), so the stroke stays in the border box.
      if (bw > 1) PenSize(bw, bw);
      if (ovSize > 0) FrameRoundRect(r, ovSize, ovSize);
      else FrameRect(r);
    }
    PenNormal();
  }
}

function paintOverflowScrollTrack(
  node: CanvasNode,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const track = scrollTrack(node, x, y, width, height);
  if (!track) return;
  PenNormal();
  FillRect(
    makeRect(track.thumbY, track.x, track.thumbY + track.thumbHeight, track.x + track.width),
    PATTERNS.checker,
  );
  PenNormal();
}

function paintBoxShadow(
  x: number,
  y: number,
  width: number,
  height: number,
  ovSize: number,
): void {
  PenNormal();
  ForeColor(blackColor);
  if (ovSize > 0) {
    PaintRoundRect(
      makeRect(y + 1, x + 1, y + height + 1, x + width + 1),
      ovSize,
      ovSize,
    );
    return;
  }
  PaintRect(makeRect(y + height, x + 1, y + height + 1, x + width + 1));
  PaintRect(makeRect(y + 1, x + width, y + height + 1, x + width + 1));
}

function drawDashedBorder(
  layout: { x: number; y: number; width: number; height: number },
  style: "dotted" | "dashed",
  bw: number
): void {
  const { x, y, width, height } = layout;
  const step = style === "dotted" ? 2 : 6;
  const on = style === "dotted" ? 1 : 3;

  for (let e = 0; e < 4; e++) {
    let px = 0, py = 0, len = 0;
    if (e === 0) { px = x; py = y; len = width; }
    else if (e === 1) { px = x + width - bw; py = y; len = height; }
    else if (e === 2) { px = x; py = y + height - bw; len = width; }
    else { px = x; py = y; len = height; }

    let pos = 0;
    const horizontal = e === 0 || e === 2;
    while (pos < len) {
      const segEnd = Math.min(pos + on, len);
      const r = horizontal
        ? makeRect(py, px + pos, py + bw, px + segEnd)
        : makeRect(py + pos, px, py + segEnd, px + bw);
      PaintRect(r);
      pos += step;
    }
  }
}

function drawText(
  node: CanvasNode,
  ctx: DrawContext,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const fontName = fontNameFromProps(node.props);
  const style = fontStyleFromProps(node.props);
  const color = (node.props["color"] as Ink | undefined) ?? 1;
  const align = (node.props["align"] as TextAlign | undefined) ?? "left";
  const verticalAlign =
    (node.props["verticalAlign"] as TextVerticalAlign | undefined) ?? "top";
  const wrap = textWraps(node.props);
  const background = node.props["background"] as Ink | undefined;
  const stipple = (node.props["stipple"] as boolean | undefined) ?? false;

  if (background !== undefined) {
    const bgRect = makeRect(y, x, y + height, x + width);
    if (background === 0) EraseRect(bgRect);
    else {
      PenNormal();
      PaintRect(bgRect);
    }
  }

  const font = fontFromProps(node.props);
  TextFont(fontFamilyId(fontName));
  TextSize(font.size ?? 0);
  TextFace(textFace(style));
  if (color) {
    ForeColor(blackColor);
    TextMode(srcOr);
  } else {
    ForeColor(whiteColor);
    TextMode(srcBic);
  }

  const runs = nodeRuns(node);
  const text = runs ? "" : collectNodeText(node);
  if (!runs && !text) return;

  const s = node.style;
  const padLeft = s.paddingLeft ?? s.padding ?? 0;
  const padRight = s.paddingRight ?? s.padding ?? 0;
  const padTop = s.paddingTop ?? s.padding ?? 0;
  const padBottom = s.paddingBottom ?? s.padding ?? 0;
  const innerX = x + padLeft;
  const innerY = y + padTop;
  const innerW = Math.max(0, width - padLeft - padRight);
  const innerH = Math.max(0, height - padTop - padBottom);

  if (runs) {
    const face = runFaceOf(node);
    const block = layoutNodeRuns(node, face, runs, wrap ? innerW : undefined);
    let lineY = innerY;
    if (verticalAlign === "middle") lineY = innerY + Math.floor((innerH - block.height) / 2);
    else if (verticalAlign === "bottom") lineY = innerY + innerH - block.height;
    for (const line of block.lines) {
      const lineX = innerX + runLineLeft(line, align, innerW);
      for (const fragment of line.fragments) {
        const run = runs[fragment.run]!;
        const runFace = runFont(face, run);
        const runStyleValue = runStyle(face.style, run);
        TextFace(textFace(runStyleValue));
        drawUiText(runFace, fragment.text, lineX + fragment.x, lineY + runFace.glyphHeight);
        if (runStyleValue.underline) drawUnderline(runFace, fragment.text, lineX + fragment.x, lineY, color);
      }
      lineY += block.lineHeight;
    }
    if (stipple) stippleRect(x, y, width, height);
    return;
  }

  // Same line breaking as the measure pass, so drawn geometry matches layout.
  const block = layoutNodeText(node, font, text, wrap ? innerW : undefined);
  // Strike ascent = cell height (baseline at the Decker cell bottom).
  // Outlined strikes are 2px taller; baseline is the padded cell bottom.
  const strikeAscent = font.glyphHeight;
  const face = faceMetrics(font);
  const singleMiddle = verticalAlign === "middle" && block.lines.length === 1;

  let lineY = innerY;
  if (singleMiddle) lineY = middleCellTop(innerY, innerH, face);
  else if (verticalAlign === "middle") lineY = innerY + Math.floor((innerH - block.height) / 2);
  else if (verticalAlign === "bottom") lineY = innerY + innerH - block.height;

  const selection = textSelectionOf(node);

  for (let i = 0; i < block.lines.length; i++) {
    const line = block.lines[i]!;
    const lineX = innerX + lineLeft(line, align, innerW);
    if (line.text) {
      if (style.outline || style.shadow) {
        drawStyledLine(line.text, lineX, lineY, fontName, style, color, font.size);
      } else {
        drawUiText(font, line.text, lineX, lineY + strikeAscent);
        if (style.underline) drawUnderline(font, line.text, lineX, lineY, color);
      }
    }
    if (selection && line.text) {
      const a = Math.max(selection.lo, line.start);
      const b = Math.min(selection.hi, line.start + line.text.length);
      if (a < b) {
        const localA = a - line.start;
        const localB = b - line.start;
        const slice = line.text.slice(localA, localB);
        const left = lineX + textAdvance(font, line.text.slice(0, localA));
        const sliceW = textAdvance(font, slice);
        PaintRect(makeRect(lineY, left, lineY + lineBoxHeight(block, i), left + sliceW));
        ForeColor(whiteColor);
        TextMode(srcBic);
        if (style.outline || style.shadow) {
          drawStyledLine(slice, left, lineY, fontName, style, 0, font.size);
        } else {
          drawUiText(font, slice, left, lineY + strikeAscent);
          if (style.underline) drawUnderline(font, slice, left, lineY, 0);
        }
        if (color) {
          ForeColor(blackColor);
          TextMode(srcOr);
        }
      }
    }
    lineY += block.lineHeight;
  }

  if (stipple) stippleRect(x, y, width, height);
}

/** Classic grayed text: knock every other pixel out of the node's rect. */
function stippleRect(x: number, y: number, width: number, height: number): void {
  PenPat(globals.gray);
  PenMode(patBic);
  PaintRect(makeRect(y, x, y + height, x + width));
  PenNormal();
}


// -------------------------------------------------------------------------
// Sprites → packed BitMaps
//
// `Sprite` keeps 1 byte per pixel (it is the asset format); the framebuffer
// is packed. Pack once per sprite and reuse across frames.
// -------------------------------------------------------------------------

interface PackedImage {
  pixels: BitMap;
  mask: BitMap | null;
  inverted?: BitMap;
  outline?: BitMap;
}

const packedImages = new WeakMap<Sprite, PackedImage>();

function packedImage(src: Sprite): PackedImage {
  let entry = packedImages.get(src);
  if (!entry) {
    entry = {
      pixels: bitMapFromPixels(src.data, src.width, src.height),
      mask: src.mask ? bitMapFromPixels(src.mask, src.width, src.height) : null,
    };
    packedImages.set(src, entry);
  }
  return entry;
}

function outlineImage(src: Sprite): BitMap {
  const entry = packedImage(src);
  if (entry.outline) return entry.outline;
  const buf = new Uint8Array(src.width * src.height);
  const d = src.data;
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const si = sy * src.width + sx;
      if (src.mask && !src.mask[si]) continue;
      if (!d[si]) continue;
      const isEdge =
        sx === 0 || !d[si - 1] ||
        sx === src.width - 1 || !d[si + 1] ||
        sy === 0 || !d[si - src.width] ||
        sy === src.height - 1 || !d[si + src.width];
      if (isEdge) buf[si] = 1;
    }
  }
  entry.outline = bitMapFromPixels(buf, src.width, src.height);
  return entry.outline;
}

function invertedImage(src: Sprite): BitMap {
  const entry = packedImage(src);
  if (entry.inverted) return entry.inverted;
  const buf = new Uint8Array(src.width * src.height);
  for (let i = 0; i < src.data.length; i++) {
    if (src.mask ? src.mask[i] : 1) buf[i] = src.data[i] ^ 1;
  }
  entry.inverted = bitMapFromPixels(buf, src.width, src.height);
  return entry.inverted;
}

function drawImage(
  node: CanvasNode,
  ctx: DrawContext,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const src = node.props["src"] as Sprite | undefined;
  const mode = (node.props["mode"] as string | undefined) ?? "normal";
  if (!src) return;

  const pw = Math.min(src.width, width);
  const ph = Math.min(src.height, height);
  const srcRect = makeRect(0, 0, ph, pw);
  const dstRect = makeRect(y, x, y + ph, x + pw);

  const pixelBM =
    mode === "outline" ? outlineImage(src)
    : mode === "inverted" ? invertedImage(src)
    : packedImage(src).pixels;
  const maskBM = packedImage(src).mask;

  const port = ctx.port;
  if (maskBM) {
    CopyBits(maskBM, port.portBits, srcRect, dstRect, srcBic, null);
    CopyBits(pixelBM, port.portBits, srcRect, dstRect, srcOr, null);
  } else {
    CopyBits(pixelBM, port.portBits, srcRect, dstRect, srcCopy, null);
  }
}

/**
 * Build the surface handed to `<raster onPaint>`. Direct pixel writes clip
 * to the raster box ∩ the port's visible/clip rects ∩ the bitmap bounds so a
 * raster in a partly off-screen window cannot scribble outside it.
 */
function createRasterSurface(port: GrafPort, rect: RasterPaintRect): RasterSurface {
  const bits = port.portBits;
  const vis = port.visRgn.rgn.rgnBBox;
  const clipRgn = port.clipRgn;
  const clip = clipRgn.rgn.rgnBBox;
  const shaped = clipRgn.rgn.rgnSize !== 10;
  const left = Math.max(rect.x, bits.bounds.left, port.portRect.left, vis.left, clip.left);
  const top = Math.max(rect.y, bits.bounds.top, port.portRect.top, vis.top, clip.top);
  const right = Math.min(rect.x + rect.width, bits.bounds.right, port.portRect.right, vis.right, clip.right);
  const bottom = Math.min(rect.y + rect.height, bits.bounds.bottom, port.portRect.bottom, vis.bottom, clip.bottom);
  const inside = (gx: number, gy: number): boolean =>
    !shaped || PtInRgn({ h: gx, v: gy }, clipRgn);

  return {
    port,
    rect,
    setPixel(x, y, ink) {
      const gx = rect.x + x;
      const gy = rect.y + y;
      if (gx < left || gx >= right || gy < top || gy >= bottom || !inside(gx, gy)) return;
      setBit(bits, gx, gy, ink);
    },
    blitPixels(pixels, width, height, x = 0, y = 0) {
      const x0 = Math.max(left, rect.x + x);
      const y0 = Math.max(top, rect.y + y);
      const x1 = Math.min(right, rect.x + x + width);
      const y1 = Math.min(bottom, rect.y + y + height);
      for (let gy = y0; gy < y1; gy++) {
        const srcRow = (gy - rect.y - y) * width - (rect.x + x);
        for (let gx = x0; gx < x1; gx++) {
          if (inside(gx, gy)) setBit(bits, gx, gy, pixels[srcRow + gx]);
        }
      }
    },
    fill(ink) {
      for (let gy = top; gy < bottom; gy++)
        for (let gx = left; gx < right; gx++) {
          if (inside(gx, gy)) setBit(bits, gx, gy, ink);
        }
    },
  };
}

function drawRaster(
  node: CanvasNode,
  ctx: DrawContext,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const onPaint = node.props["onPaint"] as RasterPaintFn | undefined;
  if (!onPaint) return;
  SetPort(ctx.port);
  const savedClip = snapshotClip(ctx.port);
  intersectClip(ctx.port, makeRect(y, x, y + height, x + width));
  onPaint(createRasterSurface(ctx.port, { x, y, width, height }));
  restoreClip(ctx.port, savedClip);
}

function numericSize(value: number | `${number}%` | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/**
 * Blit a retained unpacked buffer. Stride is the node's numeric `width`
 * (the buffer width); the layout rect is only the clip. A short buffer
 * paints as many full rows as it has.
 */
function drawBitmap(
  node: CanvasNode,
  ctx: DrawContext,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const pixels = node.props["pixels"];
  if (!(pixels instanceof Uint8Array)) return;
  const bufW = numericSize(node.style.width, width);
  const bufH = numericSize(node.style.height, height);
  if (bufW <= 0 || bufH <= 0) return;
  const rows = Math.min(bufH, Math.floor(pixels.length / bufW));
  if (rows <= 0) return;
  SetPort(ctx.port);
  const savedClip = snapshotClip(ctx.port);
  intersectClip(ctx.port, makeRect(y, x, y + height, x + width));
  createRasterSurface(ctx.port, { x, y, width, height }).blitPixels(pixels, bufW, rows);
  restoreClip(ctx.port, savedClip);
}

// -------------------------------------------------------------------------
// Hit rect extraction (tests / optional host fallback)
// -------------------------------------------------------------------------

export function collectHitRects(root: CanvasNode): HitRect[] {
  const rects: HitRect[] = [];
  collectHitRectsNode(root, rects, 0, 0, 0);
  return rects;
}

function collectHitRectsNode(
  node: CanvasNode,
  out: HitRect[],
  zIndex: number,
  extraX: number,
  extraY: number
): void {
  if (node.type === "_text_content") return;
  if (node.props["inert"] === true) return;

  const handlers = node._eventHandlers;
  if (hasMouseHandlers(handlers) && node.type !== "_root") {
    const hitMask = node.props["hitMask"] as HitMask | undefined;
    const raise = shadowRaise(node);
    out.push({
      rect: {
        x: node.layout.x + extraX - raise,
        y: node.layout.y + extraY - raise,
        width: node.layout.width,
        height: node.layout.height,
      },
      handlers,
      nodeId: node.id,
      zIndex,
      hitMask,
    });
  }

  const raise = shadowRaise(node);
  const childExtraX = extraX - raise;
  const childExtraY =
    extraY - (node.style.overflow === "scroll" ? scrollPaintOffset(node) : 0) - raise;

  for (const child of node.children) {
    collectHitRectsNode(child, out, zIndex + 1, childExtraX, childExtraY);
  }
}
