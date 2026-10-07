/**
 * What goes on top of the map — search results' lettered badges, the pin,
 * the step picked from a route, and the routes' time bubbles — drawn with
 * QuickDraw: true QuickDraw ovals, rects and text, on the window's port
 * over the map picture, or on a port of an offscreen bitmap for a picture
 * to save or print. The renderer (`view.ts`) lays them out, keeping labels
 * clear of them, and hands them over as `Mark`s; it draws none of them.
 */
import {
  DrawString,
  EraseOval,
  EraseRect,
  FrameOval,
  FramePoly,
  FrameRect,
  GetPenState,
  GetPort,
  ClosePoly,
  InvertOval,
  KillPoly,
  LineTo,
  MoveTo,
  OpenPoly,
  OpenPort,
  PaintOval,
  PaintPoly,
  PaintRect,
  PenMode,
  PenNormal,
  PenPat,
  RectRgn,
  SetPenState,
  SetPort,
  StringWidth,
  TextFont,
  TextMode,
  TextSize,
  patBic,
  patOr,
  srcBic,
  srcOr,
  type BitMap,
  type GrafPort,
  type Pattern,
  type PenState,
  type Rect,
} from "@mockintosh/quickdraw";

import { fontFamilyId } from "@mockintosh/ui";
import type { Bitmap } from "./bitmap";

/** Something drawn over the map, in the map's pixels. */
export type Mark =
  /**
   * Search result `index`'s lettered badge, centred on the corner between
   * pixel (x, y) and the one up and left of it: it's an even number of pixels across.
   * `highlighted` rings it, for the result picked in the list; `inverted`
   * draws it in reverse, for the list's own highlighted row.
   */
  | { type: "badge"; x: number; y: number; index: number; highlighted: boolean; inverted?: boolean }
  /** The pin, its point on pixel (x, y). */
  | { type: "pin"; x: number; y: number }
  /** The step picked from a route's list: a dot centred on pixel (x, y). */
  | { type: "step"; x: number; y: number }
  /** A route's time, in a box of `width × height` whose notch points down at pixel (x, y). */
  | { type: "callout"; x: number; y: number; text: string; selected: boolean; width: number; height: number };

/**
 * A result badge's disc: 18 pixels across, an even number, so a capital
 * of Chicago's (6 wide) sits exactly in its middle across.
 */
const BADGE_DISC = 18;
/** The white ring that keeps a badge apart from what it's over. */
const BADGE_RING = 2;
/** A result badge's width and height, ring and all. */
export const BADGE_SIZE = BADGE_DISC + 2 * BADGE_RING;
/** Half a badge: from its centre to its edge. */
export const BADGE_HALF = BADGE_SIZE / 2;
/** A highlighted badge's ring, 2 pixels black past a pixel of white, and a pixel of white outside to keep it apart from the map. */
const HIGHLIGHT_GAP = 1;
const HIGHLIGHT_RING = 2;
const HIGHLIGHT_HALF = BADGE_DISC / 2 + HIGHLIGHT_GAP + HIGHLIGHT_RING + 1;

/** The step's dot: its radius, and its white ring's. */
export const STEP_RADIUS = 4;

/** The pin: its head's width and height, and its needle's length below the head. */
const PIN_W = 13;
const PIN_HEAD_H = 12;
const PIN_NEEDLE = 6;
/** From the pin's point across to its head's edge, and up to its top. */
export const PIN_HALF = PIN_W >> 1;
export const PIN_HEIGHT = PIN_HEAD_H + PIN_NEEDLE;
/** From the pin's point up to the middle of its head: where its name sits. */
export const PIN_HEAD = PIN_NEEDLE + (PIN_HEAD_H >> 1);

/** Below a callout's box, its notch: this many rows down to the point. */
export const CALLOUT_NOTCH = 3;

/** A search result's letter: A for the first. */
export function resultLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Where a mark is drawn, `[left, top, right, bottom)` in the map's pixels: what labels keep clear of and clicks land on. */
export function markBox(mark: Mark): readonly [number, number, number, number] {
  switch (mark.type) {
    case "badge": {
      const half = mark.highlighted ? HIGHLIGHT_HALF : BADGE_HALF;
      return [mark.x - half, mark.y - half, mark.x + half, mark.y + half];
    }
    case "pin":
      return [mark.x - PIN_HALF, mark.y - PIN_HEIGHT + 1, mark.x + PIN_HALF + 1, mark.y + 1];
    case "step":
      return [mark.x - STEP_RADIUS - 1, mark.y - STEP_RADIUS - 1, mark.x + STEP_RADIUS + 2, mark.y + STEP_RADIUS + 2];
    case "callout": {
      const left = mark.x - (mark.width >> 1);
      const top = mark.y - mark.height - CALLOUT_NOTCH - 1;
      // With its shadow, a pixel right and below.
      return [left, top, left + mark.width + 1, mark.y + 1];
    }
  }
}

/**
 * Draw `marks`, in order, on `port`, the map's pixel (0, 0) at port point
 * (`left`, `top`). The current port, its pen and its text are left as they were.
 */
export function drawMarks(port: GrafPort, marks: readonly Mark[], left: number, top: number): void {
  if (marks.length === 0) return;
  const saved = GetPort();
  SetPort(port);
  const pen = {} as PenState;
  GetPenState(pen);
  const text = { font: port.txFont, size: port.txSize, mode: port.txMode, face: port.txFace };
  PenNormal();
  TextFont(fontFamilyId("menu"));
  TextSize(0);
  for (const mark of marks) {
    const x = mark.x + left;
    const y = mark.y + top;
    switch (mark.type) {
      case "badge":
        drawBadge(x, y, mark.index, mark.highlighted);
        if (mark.inverted) InvertOval(around(x, y, BADGE_HALF));
        break;
      case "pin":
        drawPin(x, y);
        break;
      case "step":
        EraseOval(square(x, y, STEP_RADIUS + 1));
        PaintOval(square(x, y, STEP_RADIUS));
        break;
      case "callout":
        drawCallout(x, y, mark);
        break;
    }
  }
  SetPenState(pen);
  port.txFont = text.font;
  port.txSize = text.size;
  port.txMode = text.mode;
  port.txFace = text.face;
  if (saved) SetPort(saved);
}

// A few packed-bitmap helpers of our own: an app built in the OS can
// import \`@mockintosh/quickdraw\`, but not its \`/bits\` helpers.

function makeRect(top: number, left: number, bottom: number, right: number): Rect {
  return { top, left, bottom, right };
}

/** A white `width × height` bitmap, its rows padded to whole words as QuickDraw wants. */
function newBits(width: number, height: number): BitMap {
  const rowBytes = ((width + 15) >> 4) << 1;
  return { baseAddr: new Uint8Array(rowBytes * height), rowBytes, bounds: makeRect(0, 0, height, width) };
}

function bitAt(bits: BitMap, x: number, y: number): number {
  return (bits.baseAddr[y * bits.rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
}

/** `frame`'s ink as a packed bitmap. */
function packed(frame: Bitmap): BitMap {
  const bits = newBits(frame.width, frame.height);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (frame.pixels[y * frame.width + x]) bits.baseAddr[y * bits.rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return bits;
}

/** QuickDraw's gray, for dimming what can't be used. */
const GRAY = new Uint8Array([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]) as Pattern;

/**
 * `text` in the system font with its ink centred in `rect` (port
 * coordinates); an odd pixel left over is the right margin's, or the
 * bottom's. `inverse` letters it white, for a black box; `dimmed` grays it
 * as a disabled control's is, erasing every other pixel. The current port,
 * its pen and its text are left as they were.
 */
export function drawCentred(port: GrafPort, text: string, rect: { x: number; y: number; width: number; height: number }, inverse = false, dimmed = false): void {
  const saved = GetPort();
  SetPort(port);
  const pen = {} as PenState;
  GetPenState(pen);
  const font = { font: port.txFont, size: port.txSize, mode: port.txMode, face: port.txFace };
  TextFont(fontFamilyId("menu"));
  TextSize(0);
  // A minus sign isn't in the Mac's character set, so it's the plus's bar alone, where the plus would be.
  const minus = text === "\u2212";
  const ink = inkOf(minus ? "+" : text);
  const left = rect.x + ((rect.width - (ink.right - ink.left)) >> 1);
  const top = rect.y + ((rect.height - (ink.bottom - ink.top)) >> 1);
  if (minus) {
    const middle = top + ((ink.bottom - ink.top) >> 1);
    PenNormal();
    PenMode(inverse ? patBic : patOr);
    PaintRect(makeRect(middle, left, middle + 1, left + ink.right - ink.left));
  } else {
    TextMode(inverse ? srcBic : srcOr);
    MoveTo(left - ink.left, top - ink.top);
    DrawString(text);
  }
  if (dimmed) {
    PenNormal();
    PenPat(GRAY);
    // Every other pixel of the letters back to the box's own colour.
    PenMode(inverse ? patOr : patBic);
    PaintRect(makeRect(top, left, top + ink.bottom - ink.top, left + ink.right - ink.left));
  }
  SetPenState(pen);
  port.txFont = font.font;
  port.txSize = font.size;
  port.txMode = font.mode;
  port.txFace = font.face;
  if (saved) SetPort(saved);
}

/**
 * The compass, `size` pixels across with its top left at port point
 * (`left`, `top`): a ring, and a needle whose black half points north on
 * the screen, the view having turned `bearing` radians clockwise. Only the
 * dial is drawn: outside its ring, what's under it shows.
 */
export function drawCompass(port: GrafPort, left: number, top: number, size: number, bearing: number): void {
  const saved = GetPort();
  SetPort(port);
  const pen = {} as PenState;
  GetPenState(pen);
  PenNormal();
  const dial = makeRect(top, left, top + size, left + size);
  EraseOval(dial);
  FrameOval(dial);
  // From the middle pixel, as QuickDraw's pen draws below and right of a point.
  const c = (size - 1) / 2;
  const nx = -Math.sin(bearing);
  const ny = -Math.cos(bearing);
  const reach = c - 2;
  const half = 3;
  const at = (x: number, y: number) => [Math.round(left + c + x), Math.round(top + c + y)] as const;
  const tip = at(nx * reach, ny * reach);
  const tail = at(-nx * reach, -ny * reach);
  const side = at(-ny * half, nx * half);
  const other = at(ny * half, -nx * half);
  // The north half, solid; the south half, its outline.
  const north = OpenPoly();
  MoveTo(...tip);
  LineTo(...side);
  LineTo(...other);
  LineTo(...tip);
  ClosePoly();
  PaintPoly(north);
  FramePoly(north);
  KillPoly(north);
  MoveTo(...side);
  LineTo(...tail);
  LineTo(...other);
  SetPenState(pen);
  if (saved) SetPort(saved);
}

/** Draw `marks` into `frame` (ink, not fills), through a port of its own over a copy of its pixels. */
export function drawMarksInto(frame: Bitmap, marks: readonly Mark[]): void {
  if (marks.length === 0) return;
  const bits = packed(frame);
  const saved = GetPort();
  const port = {} as GrafPort;
  OpenPort(port);
  port.portBits = bits;
  port.portRect = { ...bits.bounds };
  RectRgn(port.visRgn, bits.bounds);
  RectRgn(port.clipRgn, bits.bounds);
  drawMarks(port, marks, 0, 0);
  if (saved) SetPort(saved);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) frame.pixels[y * frame.width + x] = bitAt(bits, x, y);
  }
}

/** The square of pixels `radius` either side of pixel (x, y): an oval in it is a circle centred there. */
function square(x: number, y: number, radius: number): Rect {
  return makeRect(y - radius, x - radius, y + radius + 1, x + radius + 1);
}

/** The square `2 × half` pixels across centred on the corner at (x, y), up and left of pixel (x, y). */
function around(x: number, y: number, half: number): Rect {
  return makeRect(y - half, x - half, y + half, x + half);
}

/**
 * A badge: its letter white in a black disc ringed in white; highlighted,
 * ringed again in black past a pixel of white.
 */
function drawBadge(x: number, y: number, index: number, highlighted: boolean): void {
  if (highlighted) {
    EraseOval(around(x, y, HIGHLIGHT_HALF));
    PaintOval(around(x, y, HIGHLIGHT_HALF - 1));
    EraseOval(around(x, y, BADGE_DISC / 2 + HIGHLIGHT_GAP));
  } else {
    EraseOval(around(x, y, BADGE_HALF));
  }
  PaintOval(around(x, y, BADGE_DISC / 2));
  // The letter's own ink, not its advance, in the disc's middle; with an
  // odd number of rows (9 for a capital) on its 18, a row nearer the top.
  const letter = resultLetter(index);
  const ink = inkOf(letter);
  TextMode(srcBic);
  MoveTo(x - Math.ceil((ink.right - ink.left) / 2) - ink.left, y - Math.ceil((ink.bottom - ink.top) / 2) - ink.top);
  DrawString(letter);
}

/** Where a letter's ink lies, from the pen: `[left, right)` across and `[top, bottom)` down. */
interface Ink {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const inks = new Map<string, Ink>();
const INKS_KEPT = 64;

/**
 * The ink of `text` in the current port's font, found by drawing it once
 * on a scratch bitmap of its own; kept a while, as it never changes.
 */
function inkOf(text: string): Ink {
  const known = inks.get(text);
  if (known) return known;
  const current = GetPort()!;
  const origin = 16;
  const width = StringWidth(text) + 2 * origin;
  const size = 48;
  const bits = newBits(width, size);
  const port = {} as GrafPort;
  OpenPort(port);
  port.portBits = bits;
  port.portRect = { ...bits.bounds };
  RectRgn(port.visRgn, bits.bounds);
  RectRgn(port.clipRgn, bits.bounds);
  TextFont(current.txFont);
  TextSize(current.txSize);
  TextMode(srcOr);
  MoveTo(origin, size - origin);
  DrawString(text);
  SetPort(current);
  const ink = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < width; x++) {
      if (!bitAt(bits, x, y)) continue;
      ink.left = Math.min(ink.left, x - origin);
      ink.right = Math.max(ink.right, x - origin + 1);
      ink.top = Math.min(ink.top, y - (size - origin));
      ink.bottom = Math.max(ink.bottom, y - (size - origin) + 1);
    }
  }
  if (ink.left === Infinity) Object.assign(ink, { left: 0, top: 0, right: 0, bottom: 0 });
  // A route's time comes and goes; the letters stay.
  if (inks.size >= INKS_KEPT) inks.clear();
  inks.set(text, ink);
  return ink;
}

/** A push-pin, its point on (x, y): a round black head, lit at its top left, on a needle. */
function drawPin(x: number, y: number): void {
  const headTop = y - PIN_HEIGHT + 1;
  const head = makeRect(headTop, x - PIN_HALF, headTop + PIN_HEAD_H, x + PIN_HALF + 1);
  EraseOval(head);
  PaintOval(makeRect(head.top + 1, head.left + 1, head.bottom - 1, head.right - 1));
  // The glint.
  EraseOval(makeRect(head.top + 3, head.left + 3, head.top + 6, head.left + 6));
  // The needle, outlined in white so it shows over black.
  EraseRect(makeRect(head.bottom - 1, x - 1, y - 1, x + 2));
  MoveTo(x, head.bottom - 1);
  LineTo(x, y);
}

/** A route's time: in a box with a shadow, white or (selected) black, its notch pointing down at (x, y). */
function drawCallout(x: number, y: number, mark: Extract<Mark, { type: "callout" }>): void {
  const left = x - (mark.width >> 1);
  const top = y - mark.height - CALLOUT_NOTCH - 1;
  const box = makeRect(top, left, top + mark.height, left + mark.width);
  if (mark.selected) PaintRect(box);
  else EraseRect(box);
  FrameRect(box);
  // The shadow, a pixel down and right.
  MoveTo(box.left + 1, box.bottom);
  LineTo(box.right, box.bottom);
  LineTo(box.right, box.top + 1);
  // The notch, three rows narrowing to the point.
  for (let row = 0; row < CALLOUT_NOTCH; row++) {
    PaintRect(makeRect(box.bottom + row, x - 2 + row, box.bottom + row + 1, x + 3 - row));
  }
  // The time's own ink in the middle of the box inside its frame; an odd
  // pixel left over is the right margin's, or the bottom's.
  TextMode(mark.selected ? srcBic : srcOr);
  const ink = inkOf(mark.text);
  const insideW = mark.width - 2;
  const insideH = mark.height - 2;
  MoveTo(left + 1 + ((insideW - (ink.right - ink.left)) >> 1) - ink.left, top + 1 + ((insideH - (ink.bottom - ink.top)) >> 1) - ink.top);
  DrawString(mark.text);
}
