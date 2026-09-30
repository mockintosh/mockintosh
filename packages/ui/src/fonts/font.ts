import { DROM_CHARS, deckerOrdinalForCharCode } from "./drom";
import { extraCharForOrdinal, extraOrdinalForCharCode } from "./extraGlyphs";

export interface DeckerFont {
  name: string;
  /** Native bitmap point size. Role aliases share the family name (geneva, not body). */
  size?: number;
  maxWidth: number;
  glyphHeight: number;
  spacing: number;
  glyphStride: number;
  glyphWidths: Uint8Array;
  glyphData: Uint8Array;
  sourceFormat: "FNT0" | "FNT1";
  /** 1px inset reserved so Font Manager outline sits inside the cell. */
  outlinePad?: number;
  /** Extra 1px right/bottom so a south-east drop shadow stays in the cell. */
  shadowPad?: number;
  /**
   * Per-ordinal advance when it differs from the image width (NFNT's
   * offset/width table): an italic's ink may overhang its advance.
   */
  advances?: Uint8Array;
  /** Per-ordinal columns of image left of the pen (negative left side bearing). */
  originX?: Uint8Array;
  /**
   * Image rows above the cell top / below its bottom, for ink that leaves the
   * line box (an outline's Å with PreserveGlyph on). The cell (`glyphHeight`)
   * stays the line box; glyph rows run from `-inkAbove` to
   * `glyphHeight + inkBelow`, and `glyphStride` covers them all.
   */
  inkAbove?: number;
  inkBelow?: number;
  /** `GetFontInfo` numbers carried by the strike itself (outline-scaled strikes). */
  fontInfo?: { ascent: number; descent: number; leading: number };
  /** Set on strikes the outline scaler fills one glyph at a time (`outlineStrike.ts`). */
  outline?: OutlineGlyphSource;
}

/**
 * An outline-scaled strike: glyph cells are sized up front from the font's
 * metrics, pixels arrive on first use. Characters outside Decker's 256
 * ordinals live on sibling "page" strikes of the same face and size.
 */
export interface OutlineGlyphSource {
  /** 1 once an ordinal's pixels are in `glyphData`. */
  readonly filled: Uint8Array;
  fill(ordinal: number): void;
  /** Name `TextFont` resolves back to this strike (family, plus a page suffix). */
  readonly faceKey: string;
  /** Which strike and ordinal draw `codePoint`; undefined when the face lacks it. */
  locate(codePoint: number): { font: DeckerFont; ordinal: number } | undefined;
  /** Pair kerning in whole pixels (0 when the family turns kerning off). */
  kern(left: number, right: number): number;
}

export interface DeckerTextSize {
  width: number;
  height: number;
}

/** Horizontal ellipsis — ordinal 127 in Decker's extended range. */
export const DECKER_ELLIPSIS = "\u2026";

const FALLBACK_GLYPH_INDEX = "?".charCodeAt(0);

/**
 * Glyph ordinal for a UTF-16 code unit: Decker's mapping first, then Mockintosh's extra
 * symbols (`extraGlyphs.ts`); 255 if neither knows the character.
 */
export function ordinalForCharCode(codeUnit: number): number {
  const deckerOrd = deckerOrdinalForCharCode(codeUnit);
  if (deckerOrd !== 255) return deckerOrd;
  return extraOrdinalForCharCode(codeUnit) ?? 255;
}

/**
 * Stand-ins for typographic characters a font may not draw: curly quotes,
 * dashes, the wider or non-breaking spaces. Used before `?`.
 */
const LOOKALIKES: ReadonlyMap<number, string> = new Map([
  ...[0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x02bc].map((code) => [code, "'"] as const),
  ...[0x201c, 0x201d, 0x201e, 0x201f, 0x2033].map((code) => [code, '"'] as const),
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((code) => [code, "-"] as const),
  ...[0x00a0, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f].map((code) => [code, " "] as const),
  [0x2039, "<"],
  [0x203a, ">"],
  [0x00b7, "\u2022"],
  [0x2219, "\u2022"],
  [0x00d7, "x"],
]);

export function getGlyphIndexForChar(font: DeckerFont, ch: string): number {
  if (!ch) return -1;
  const code = ch.charCodeAt(0);
  const ord = ordinalForCharCode(code);
  if (ord !== 255 && hasGlyph(font, ord)) return ord;
  const lookalike = LOOKALIKES.get(code);
  const lookalikeOrd = lookalike === undefined ? 255 : ordinalForCharCode(lookalike.charCodeAt(0));
  if (lookalikeOrd !== 255 && hasGlyph(font, lookalikeOrd)) return lookalikeOrd;
  return font.glyphWidths[FALLBACK_GLYPH_INDEX] > 0 ? FALLBACK_GLYPH_INDEX : -1;
}

export function getGlyphWidth(font: DeckerFont, glyphIndex: number): number {
  if (glyphIndex < 0 || glyphIndex > 255) return 0;
  return font.glyphWidths[glyphIndex] ?? 0;
}

/** How far the pen moves after a glyph (before `spacing`). */
export function glyphAdvance(font: DeckerFont, glyphIndex: number): number {
  if (glyphIndex < 0 || glyphIndex > 255) return 0;
  return font.advances ? font.advances[glyphIndex]! : (font.glyphWidths[glyphIndex] ?? 0);
}

/** Columns of a glyph's image that sit left of the pen. */
export function glyphOriginX(font: DeckerFont, glyphIndex: number): number {
  return font.originX?.[glyphIndex] ?? 0;
}

/**
 * Advances, overhangs and overflow rows for a restyled copy of `base` (bold smear, outline
 * ring, …) whose cells grew from `base.glyphWidths` to `glyphWidths`.
 */
export function carryAdvances(
  base: DeckerFont,
  glyphWidths: Uint8Array,
): Pick<DeckerFont, "advances" | "originX" | "inkAbove" | "inkBelow"> {
  const overflow = base.inkAbove || base.inkBelow ? { inkAbove: base.inkAbove, inkBelow: base.inkBelow } : {};
  if (!base.advances) return overflow;
  const advances = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (glyphWidths[i]) advances[i] = Math.max(0, base.advances[i]! + glyphWidths[i]! - base.glyphWidths[i]!);
  }
  return { advances, originX: base.originX, ...overflow };
}

export function hasGlyph(font: DeckerFont, glyphIndex: number): boolean {
  return getGlyphWidth(font, glyphIndex) > 0;
}

export function getGlyphDataOffset(font: DeckerFont, glyphIndex: number): number {
  return glyphIndex * font.glyphStride;
}

/** Stored rows per glyph: the cell plus any overflow above and below it. */
export function glyphRows(font: DeckerFont): number {
  return (font.inkAbove ?? 0) + font.glyphHeight + (font.inkBelow ?? 0);
}

export function getGlyphPixel(
  font: DeckerFont,
  glyphIndex: number,
  x: number,
  y: number
): boolean {
  const glyphWidth = getGlyphWidth(font, glyphIndex);
  if (glyphWidth < 1) return false;
  if (font.outline && !font.outline.filled[glyphIndex]) font.outline.fill(glyphIndex);
  const above = font.inkAbove ?? 0;
  if (x < 0 || x >= glyphWidth || y < -above || y >= font.glyphHeight + (font.inkBelow ?? 0)) return false;

  const byteWidth = Math.ceil(font.maxWidth / 8);
  const offset = getGlyphDataOffset(font, glyphIndex) + (y + above) * byteWidth + Math.floor(x / 8);
  const byte = font.glyphData[offset];
  const bit = 1 << (7 - (x % 8));
  return (byte & bit) !== 0;
}

/** Advance of one character, including trailing `spacing` (matches the FM width table). */
export function charAdvance(font: DeckerFont, ch: string): number {
  if (font.outline && ch) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xdc00 && cp <= 0xdfff) return 0;
    const hit = font.outline.locate(cp);
    if (hit) return glyphAdvance(hit.font, hit.ordinal) + font.spacing;
  }
  const glyphIndex = getGlyphIndexForChar(font, ch);
  if (glyphIndex < 0) return 0;
  return glyphAdvance(font, glyphIndex) + font.spacing;
}

/** Sum of {@link charAdvance} over `text` plus pair kerning (no newline handling). */
export function textAdvance(font: DeckerFont, text: string): number {
  let w = 0;
  if (!font.outline) {
    for (let i = 0; i < text.length; i++) w += charAdvance(font, text[i]!);
    return w;
  }
  let prev = -1;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    const ch = cp > 0xffff ? text.slice(i, i + 2) : text[i]!;
    if (cp > 0xffff) i++;
    if (prev >= 0) w += font.outline.kern(prev, cp);
    w += charAdvance(font, ch);
    prev = cp;
  }
  return w;
}

/**
 * The Mac Roman-ish character a Decker ordinal stands for: ASCII, then
 * `DROM_CHARS`, then Mockintosh's extra symbols. Undefined for empty slots.
 */
export function charForOrdinal(ordinal: number): string | undefined {
  if (ordinal >= 32 && ordinal <= 126) return String.fromCharCode(ordinal);
  if (ordinal >= 127 && ordinal < 127 + DROM_CHARS.length) return DROM_CHARS[ordinal - 127];
  return extraCharForOrdinal(ordinal);
}

export function measureDeckerText(font: DeckerFont, text: string): DeckerTextSize {
  const lines = text.split("\n");
  let width = 0;
  for (const line of lines) width = Math.max(width, textAdvance(font, line));
  return { width, height: font.glyphHeight * lines.length };
}
