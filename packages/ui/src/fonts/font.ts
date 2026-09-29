import { deckerOrdinalForCharCode } from "./drom";
import { extraOrdinalForCharCode } from "./extraGlyphs";

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

export function hasGlyph(font: DeckerFont, glyphIndex: number): boolean {
  return getGlyphWidth(font, glyphIndex) > 0;
}

export function getGlyphDataOffset(font: DeckerFont, glyphIndex: number): number {
  return glyphIndex * font.glyphStride;
}

export function getGlyphPixel(
  font: DeckerFont,
  glyphIndex: number,
  x: number,
  y: number
): boolean {
  const glyphWidth = getGlyphWidth(font, glyphIndex);
  if (glyphWidth < 1) return false;
  if (x < 0 || x >= glyphWidth || y < 0 || y >= font.glyphHeight) return false;

  const byteWidth = Math.ceil(font.maxWidth / 8);
  const offset = getGlyphDataOffset(font, glyphIndex) + y * byteWidth + Math.floor(x / 8);
  const byte = font.glyphData[offset];
  const bit = 1 << (7 - (x % 8));
  return (byte & bit) !== 0;
}

/** Advance of one character, including trailing `spacing` (matches the FM width table). */
export function charAdvance(font: DeckerFont, ch: string): number {
  const glyphIndex = getGlyphIndexForChar(font, ch);
  if (glyphIndex < 0) return 0;
  return getGlyphWidth(font, glyphIndex) + font.spacing;
}

/** Sum of {@link charAdvance} over `text` (no newline handling). */
export function textAdvance(font: DeckerFont, text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += charAdvance(font, text[i]!);
  return w;
}

export function measureDeckerText(font: DeckerFont, text: string): DeckerTextSize {
  let cursorX = 0;
  let maxWidth = 0;
  let height = font.glyphHeight;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      maxWidth = Math.max(maxWidth, cursorX);
      cursorX = 0;
      height += font.glyphHeight;
      continue;
    }
    const glyphIndex = getGlyphIndexForChar(font, ch);
    cursorX += getGlyphWidth(font, glyphIndex) + font.spacing;
    maxWidth = Math.max(maxWidth, cursorX);
  }

  return { width: maxWidth, height };
}
