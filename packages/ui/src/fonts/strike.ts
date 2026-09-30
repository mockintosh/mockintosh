/**
 * Decker → `FontStrike` and the host `_SwapFont`.
 *
 * Family numbering, size fallback, baseline (ascent = glyph cell height),
 * and style synthesis live here — not in `@mockintosh/quickdraw`.
 * UI FontInfo alignment uses `faceMetrics` in `metrics.ts`; do not point
 * this seam at those numbers or every QuickDraw glyph shifts.
 */

import type { FMInput, FMOutput, FontStrike } from "@mockintosh/quickdraw";
import {
  DrawText,
  MoveTo,
  TextFont,
  bold,
  italic,
  outline,
  shadow,
  underline,
  globals,
} from "@mockintosh/quickdraw";
import { rowBytesFor, setBit } from "@mockintosh/quickdraw/bits";
import {
  getGlyphIndexForChar,
  getGlyphPixel,
  getGlyphWidth,
  glyphAdvance,
  glyphOriginX,
  hasGlyph,
  ordinalForCharCode,
  type DeckerFont,
} from "./font";
import { getFontForScaling, getRealFace, requireFont } from "./registry";
import { resolveFont } from "./style";

/** `txFont` ids. 0 is the system font (`body`), matching InitPort. */
export const UI_FONT_FAMILY = {
  body: 0,
  menu: 1,
  mono: 2,
} as const;

const FAMILY_NAMES = ["body", "menu", "mono"] as const;
let extraFamilies: Map<string, number> | undefined;
let nextFamilyId = 3;
function extraFamilyMap(): Map<string, number> {
  return (extraFamilies ??= new Map());
}

/** Extra scanlines below the baseline so `DrText` underline (descent ≥ 2) can paint. */
export const STRIKE_DESCENT = 2;

/**
 * `DrawText.a` shears `italic/16` px per row from the bottom. `ascent >> 3`
 * is 1 on Geneva 9 / Chicago 12, so a 12–15px strike never accumulates a
 * whole pixel. Bump the slope so the top of the strike moves at least
 * `minSlantPx` (Pixel still uses `ascent >> 3` when that is steeper).
 */
export function italicShearUnits(
  ascent: number,
  descent: number,
  minSlantPx: number = 2
): number {
  const rows = Math.max(1, ascent + descent - 2);
  const visible = Math.ceil((minSlantPx << 4) / rows);
  return Math.max(1, ascent >> 3, visible);
}

export interface UiFontMetrics {
  ascent: number;
  descent: number;
  leading: number;
  widMax: number;
  nativeSize: number;
}

export function fontFamilyId(name: string): number {
  if (name === "menu") return UI_FONT_FAMILY.menu;
  if (name === "mono") return UI_FONT_FAMILY.mono;
  if (name === "body" || !name) return UI_FONT_FAMILY.body;
  let id = extraFamilyMap().get(name);
  if (id === undefined) {
    id = nextFamilyId++;
    extraFamilyMap().set(name, id);
  }
  return id;
}

export function fontFamilyName(id: number): string {
  if (id >= 0 && id < FAMILY_NAMES.length) return FAMILY_NAMES[id]!;
  for (const [name, fid] of extraFamilyMap()) if (fid === id) return name;
  return "body";
}

/** QuickDraw strike metrics. Baseline is the bottom of the Decker cell. */
export function uiFontMetrics(font: DeckerFont): UiFontMetrics {
  return {
    ascent: font.glyphHeight,
    descent: STRIKE_DESCENT,
    leading: 0,
    widMax: font.maxWidth + font.spacing,
    nativeSize: font.size ?? font.glyphHeight,
  };
}

export function fontAscent(fontName: string, size?: number): number {
  return uiFontMetrics(requireFont(fontName, size)).ascent;
}

/**
 * One `DrawText` call's worth of a line: the strike (by `TextFont` name),
 * its ordinals, and where it starts relative to the line's left edge.
 */
export interface UiTextRun {
  faceKey: string;
  font: DeckerFont;
  bytes: number[];
  x: number;
}

/**
 * Split a line into runs for an outline-scaled strike: a new run starts
 * where a character lives on another page strike or where pair kerning
 * moves the pen. Bitmap strikes come back as one run.
 */
export function uiTextRuns(font: DeckerFont, text: string): UiTextRun[] {
  const src = font.outline;
  if (!src) return [{ faceKey: font.name, font, bytes: encodeUiText(font, text), x: 0 }];
  const runs: UiTextRun[] = [];
  let run: UiTextRun | undefined;
  let pen = 0;
  let prev = -1;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    const wide = cp > 0xffff;
    const ch = wide ? text.slice(i, i + 2) : text[i]!;
    if (wide) i++;
    const kern = prev >= 0 ? src.kern(prev, cp) : 0;
    prev = cp;
    pen += kern;
    const hit = src.locate(cp);
    const target = hit?.font ?? font;
    const ordinal = hit?.ordinal ?? Math.max(0, getGlyphIndexForChar(font, ch));
    const key = target.outline?.faceKey ?? src.faceKey;
    if (!run || run.faceKey !== key || kern !== 0) {
      run = { faceKey: key, font: target, bytes: [], x: pen };
      runs.push(run);
    }
    run.bytes.push(ordinal);
    pen += glyphAdvance(target, ordinal) + font.spacing;
  }
  return runs;
}

/**
 * `MoveTo` + `DrawText` for one line at `baseline` (the cell bottom).
 * Outline strikes switch `TextFont` per page run, then restore it.
 */
export function drawUiText(font: DeckerFont, text: string, x: number, baseline: number): void {
  if (!font.outline) {
    const bytes = encodeUiText(font, text);
    MoveTo(x, baseline);
    DrawText(bytes, 0, bytes.length);
    return;
  }
  const saved = globals.thePort?.txFont;
  for (const run of uiTextRuns(font, text)) {
    TextFont(fontFamilyId(run.faceKey));
    MoveTo(x + run.x, baseline);
    DrawText(run.bytes, 0, run.bytes.length);
  }
  if (saved !== undefined) TextFont(saved);
}

/** Map a JS string to Decker/MacRoman ordinals for `DrawText`. */
export function encodeUiText(font: DeckerFont, text: string): number[] {
  const out: number[] = new Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const idx = getGlyphIndexForChar(font, text[i]!);
    out[i] = idx < 0 ? 0 : idx;
  }
  return out;
}

const strikeCache = new WeakMap<DeckerFont, FontStrike>();

function ordinalAdvance(font: DeckerFont, ord: number): number {
  const idx = hasGlyph(font, ord) ? ord : hasGlyph(font, 63) ? 63 : -1;
  if (idx < 0) return 0;
  return glyphAdvance(font, idx) + font.spacing;
}

/**
 * Pack every Decker glyph into a Macintosh kerned strike.
 * Baseline is the bottom of the Decker cell (`ascent = glyphHeight`).
 */
export function deckerToStrike(font: DeckerFont): FontStrike {
  const cached = strikeCache.get(font);
  if (cached) return cached;

  const metrics = uiFontMetrics(font);
  const firstChar = 0;
  const lastChar = 255;
  const slots = lastChar - firstChar + 3;
  const locTable = new Int16Array(slots);
  const owTable = new Int16Array(slots);
  const columns: number[] = new Array(256);
  // NFNT offset/width: image drawn at pen + kernMax + offset, pen moves by width.
  let overhang = 0;
  for (let ch = 0; ch < 256; ch++) if (hasGlyph(font, ch)) overhang = Math.max(overhang, glyphOriginX(font, ch));
  const ow = (ch: number) => (((overhang - glyphOriginX(font, ch)) & 0xff) << 8) | (glyphAdvance(font, ch) & 0xff);
  let col = 0;
  for (let ch = 0; ch < 256; ch++) {
    const gw = hasGlyph(font, ch) ? getGlyphWidth(font, ch) : 0;
    locTable[ch] = col;
    columns[ch] = col;
    if (gw > 0) {
      owTable[ch] = ow(ch);
      col += gw;
    } else {
      owTable[ch] = 0x8000;
    }
  }
  const qCol = hasGlyph(font, 63) ? columns[63]! : col;
  const qW = hasGlyph(font, 63) ? getGlyphWidth(font, 63) : 0;
  locTable[256] = qCol;
  locTable[257] = qCol + qW;
  owTable[256] = qW > 0 ? ow(63) : 0x8000;
  owTable[257] = 0x8000;

  const fRectWidth = Math.max(1, col);
  // Ink that leaves the line box (PreserveGlyph) gets its own rows in the
  // font rectangle; FontInfo (`uiFontMetrics`) still reports the line box.
  const above = font.inkAbove ?? 0;
  const strikeAscent = metrics.ascent + above;
  const strikeDescent = Math.max(metrics.descent, font.inkBelow ?? 0);
  const fRectHeight = strikeAscent + strikeDescent;
  const rowBytes = rowBytesFor(fRectWidth);
  const rowWords = rowBytes >> 1;
  const bitImage = new Uint8Array(rowBytes * fRectHeight);
  const scratch = {
    baseAddr: bitImage,
    rowBytes,
    bounds: { top: 0, left: 0, bottom: fRectHeight, right: rowWords * 16 },
  };

  const pack = (ch: number) => {
    const gw = hasGlyph(font, ch) ? getGlyphWidth(font, ch) : 0;
    if (gw <= 0) return;
    const x0 = columns[ch]!;
    for (let y = -above; y < font.glyphHeight + (font.inkBelow ?? 0); y++) {
      for (let x = 0; x < gw; x++) {
        if (getGlyphPixel(font, ch, x, y)) setBit(scratch, x0 + x, y + above, 1);
      }
    }
  };
  // Outline-scaled strikes pack only what is already rendered; `prepare`
  // renders and packs the rest as `DrText` meets them.
  const lazy = font.outline;
  const packed = new Uint8Array(256);
  for (let ch = 0; ch < 256; ch++) {
    if (lazy && !lazy.filled[ch]) continue;
    pack(ch);
    packed[ch] = 1;
  }

  const strike: FontStrike = {
    fontType: 0,
    firstChar,
    lastChar,
    widMax: metrics.widMax,
    kernMax: -overhang,
    nDescent: -strikeDescent,
    fRectWidth,
    fRectHeight,
    ascent: strikeAscent,
    descent: strikeDescent,
    leading: metrics.leading,
    rowWords,
    bitImage,
    locTable,
    owTable,
  };
  if (lazy) {
    strike.prepare = (chars, count) => {
      for (let i = 0; i < count; i++) {
        const ch = chars[i]! & 0xff;
        if (packed[ch]) continue;
        packed[ch] = 1;
        pack(ch);
      }
      if (!packed[63]) {
        packed[63] = 1;
        pack(63);
      }
    };
  }
  strikeCache.set(font, strike);
  return strike;
}

function synthesis(face: number, ascent: number): {
  bold: number;
  italic: number;
  ulOffset: number;
  ulShadow: number;
  ulThick: number;
  shadow: number;
  extra: number;
} {
  let boldPx = 0;
  let extra = 0;
  let italicPx = 0;
  let ulOffset = 0;
  let ulShadow = 0;
  let ulThick = 0;
  let shadowPx = 0;
  if (face & outline) {
    // Strike is already a hollow ring (`outlineDeckerFont`), including any
    // bold smear. Do not also run DrawText's outline/bold extras.
    italicPx = face & italic ? italicShearUnits(ascent, STRIKE_DESCENT) : 0;
  } else {
    if (face & bold) {
      boldPx += 1;
      extra += 1;
    }
    if (face & italic) {
      italicPx = italicShearUnits(ascent, STRIKE_DESCENT);
      extra += 1;
    }
    if (face & shadow) {
      boldPx += 1;
      extra += 1;
      shadowPx = 1;
    }
  }
  if (face & underline) {
    ulOffset = 1;
    ulShadow = 1;
    ulThick = 1;
  }
  return {
    bold: boldPx,
    italic: italicPx,
    ulOffset,
    ulShadow,
    ulThick,
    shadow: shadowPx,
    extra,
  };
}

const WIDTH_TABLE_CACHE_SIZE = 12;
const widthTables = new Map<string, Int32Array>();
const widthTableFontIds = new WeakMap<DeckerFont, number>();
let nextWidthTableFontId = 1;

/**
 * The Font Manager kept the last 12 width tables so a `TextFont` /
 * `TextFace` round trip didn't rebuild one. Keyed by strike, style extra,
 * and the port's `spExtra`; treat the result as read-only.
 */
function cachedWidthTable(font: DeckerFont, extra: number, spExtra: number): Int32Array {
  let id = widthTableFontIds.get(font);
  if (id === undefined) {
    id = nextWidthTableFontId++;
    widthTableFontIds.set(font, id);
  }
  const key = `${id}|${extra}|${spExtra}`;
  const hit = widthTables.get(key);
  if (hit) {
    widthTables.delete(key);
    widthTables.set(key, hit);
    return hit;
  }
  const table = new Int32Array(256);
  const extraFixed = extra << 16;
  for (let ch = 0; ch < 256; ch++) table[ch] = ((ordinalAdvance(font, ch) << 16) + extraFixed) | 0;
  // Font Manager folds `thePort^.spExtra` into the space slot (`Text.a` / plan §3.7).
  table[32] = (table[32]! + spExtra) | 0;
  widthTables.set(key, table);
  if (widthTables.size > WIDTH_TABLE_CACHE_SIZE) widthTables.delete(widthTables.keys().next().value!);
  return table;
}

/**
 * Host `_SwapFont`: map family/size/face onto a cached Decker strike.
 * `spExtra` is folded into `widthTable[32]` as the original Font Manager did.
 */
export function hostSwapFont(inRec: FMInput): FMOutput {
  const name = fontFamilyName(inRec.family);
  const requested = inRec.size | 0;
  const size = requested > 0 ? requested : undefined;
  // Style matching: a real Bold / Italic face covers those bits; only the
  // rest is synthesized below.
  const wanted = (inRec.face & bold ? 1 : 0) | (inRec.face & italic ? 2 : 0);
  const real = wanted ? getRealFace(name, wanted, size) : null;
  const covered = real?.covered ? (real.covered & 1 ? bold : 0) | (real.covered & 2 ? italic : 0) : 0;
  const face = inRec.face & ~covered;
  const font =
    face & outline
      ? resolveFont(name, {
          bold: Boolean(inRec.face & bold),
          italic: Boolean(inRec.face & italic),
          outline: true,
        }, size)
      : real?.covered
        ? real.font
        : getFontForScaling(name, size) ?? requireFont("body");
  const metrics = uiFontMetrics(font);
  const strike = deckerToStrike(font);
  const syn = synthesis(face, metrics.ascent);

  let numer = { h: inRec.numer.h, v: inRec.numer.v };
  let denom = { h: inRec.denom.h, v: inRec.denom.v };
  const native = font.size ?? metrics.nativeSize;
  if (requested > 0 && requested !== native) {
    numer = { h: (inRec.numer.h * requested) | 0, v: (inRec.numer.v * requested) | 0 };
    denom = { h: (inRec.denom.h * native) | 0, v: (inRec.denom.v * native) | 0 };
  }

  const widthTable = cachedWidthTable(font, syn.extra | 0, globals.thePort ? globals.thePort.spExtra | 0 : 0);

  return {
    errNum: 0,
    fontHandle: strike,
    bold: syn.bold,
    italic: syn.italic,
    ulOffset: syn.ulOffset,
    ulShadow: syn.ulShadow,
    ulThick: syn.ulThick,
    shadow: syn.shadow,
    extra: syn.extra,
    ascent: metrics.ascent & 0xff,
    descent: metrics.descent & 0xff,
    widMax: metrics.widMax & 0xff,
    leading: metrics.leading,
    unused: 0,
    numer,
    denom,
    widthTable,
  };
}
