import type { DeckerFont } from "./font";
import { getGlyphPixel } from "./font";

/** One glyph in an unpacked 1-bit strike draft. `pixels` is row-major, 0/1. */
export interface FontStrikeGlyph {
  ordinal: number;
  width: number;
  pixels: Uint8Array;
}

/** Working strike before `%%MFN1` packing. */
export interface FontStrikeDraft {
  family: string;
  size: number;
  maxWidth: number;
  glyphHeight: number;
  spacing: number;
  glyphs: FontStrikeGlyph[];
}

export function deckerFontFromDraft(draft: FontStrikeDraft): DeckerFont {
  const maxWidth = Math.max(1, draft.maxWidth, ...draft.glyphs.map((g) => g.width));
  const glyphHeight = Math.max(1, draft.glyphHeight);
  const glyphStride = Math.ceil(maxWidth / 8) * glyphHeight;
  const glyphWidths = new Uint8Array(256);
  const glyphData = new Uint8Array(256 * glyphStride);
  const byteWidth = Math.ceil(maxWidth / 8);
  for (const glyph of draft.glyphs) {
    if (glyph.ordinal < 0 || glyph.ordinal > 255) continue;
    glyphWidths[glyph.ordinal] = glyph.width;
    const base = glyph.ordinal * glyphStride;
    for (let y = 0; y < glyphHeight; y++) {
      for (let x = 0; x < glyph.width; x++) {
        if (!glyph.pixels[y * glyph.width + x]) continue;
        glyphData[base + y * byteWidth + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }
  return {
    name: draft.family,
    size: draft.size,
    maxWidth,
    glyphHeight,
    spacing: draft.spacing,
    glyphStride,
    glyphWidths,
    glyphData,
  };
}

export function draftFromDeckerFont(font: DeckerFont, family = font.name, size = font.size ?? font.glyphHeight): FontStrikeDraft {
  const glyphs: FontStrikeGlyph[] = [];
  for (let ordinal = 0; ordinal < 256; ordinal++) {
    const width = font.glyphWidths[ordinal] ?? 0;
    if (width < 1) continue;
    const pixels = new Uint8Array(width * font.glyphHeight);
    for (let y = 0; y < font.glyphHeight; y++) {
      for (let x = 0; x < width; x++) {
        if (getGlyphPixel(font, ordinal, x, y)) pixels[y * width + x] = 1;
      }
    }
    glyphs.push({ ordinal, width, pixels });
  }
  return {
    family,
    size,
    maxWidth: font.maxWidth,
    glyphHeight: font.glyphHeight,
    spacing: font.spacing,
    glyphs,
  };
}
