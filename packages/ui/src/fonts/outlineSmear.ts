import type { DeckerFont } from "./font";
import { carryAdvances, getGlyphPixel, getGlyphWidth } from "./font";

/** 1px on every side of the core. */
export const OUTLINE_PAD = 1;

const RING: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Hollow 1px ring around each glyph. The cell grows 2px in both axes so the
 * ring is inside the advance, unlike Font Manager outline (smear right/down
 * + XOR), which does not reserve the left/top pixels.
 */
export function outlineDeckerFont(font: DeckerFont, name: string): DeckerFont {
  const pad = OUTLINE_PAD;
  const maxWidth = font.maxWidth + pad * 2;
  const glyphHeight = font.glyphHeight + pad * 2;
  const above = font.inkAbove ?? 0;
  const below = font.inkBelow ?? 0;
  const glyphStride = Math.ceil(maxWidth / 8) * (above + glyphHeight + below);
  const glyphWidths = new Uint8Array(256);
  const glyphData = new Uint8Array(256 * glyphStride);
  const byteWidth = Math.ceil(maxWidth / 8);

  for (let glyphIndex = 0; glyphIndex < 256; glyphIndex++) {
    const width = getGlyphWidth(font, glyphIndex);
    if (width < 1) continue;
    const nextWidth = width + pad * 2;
    glyphWidths[glyphIndex] = nextWidth;
    const dest = glyphIndex * glyphStride;
    for (let y = -above; y < glyphHeight + below; y++) {
      for (let x = 0; x < nextWidth; x++) {
        const ox = x - pad;
        const oy = y - pad;
        if (getGlyphPixel(font, glyphIndex, ox, oy)) continue;
        let ring = false;
        for (const [dx, dy] of RING) {
          if (!getGlyphPixel(font, glyphIndex, ox + dx, oy + dy)) continue;
          ring = true;
          break;
        }
        if (!ring) continue;
        glyphData[dest + (y + above) * byteWidth + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }

  return {
    name,
    size: font.size,
    maxWidth,
    glyphHeight,
    spacing: font.spacing,
    glyphStride,
    glyphWidths,
    glyphData,
    ...carryAdvances(font, glyphWidths),
    sourceFormat: "FNT1",
    outlinePad: pad,
    shadowPad: font.shadowPad,
  };
}

/** 1px south-east drop. Empty column on the right and row on the bottom. */
export const SHADOW_PAD = 1;

export function padDeckerShadow(font: DeckerFont, name: string): DeckerFont {
  const pad = SHADOW_PAD;
  const maxWidth = font.maxWidth + pad;
  const glyphHeight = font.glyphHeight + pad;
  const above = font.inkAbove ?? 0;
  const below = font.inkBelow ?? 0;
  const glyphStride = Math.ceil(maxWidth / 8) * (above + glyphHeight + below);
  const glyphWidths = new Uint8Array(256);
  const glyphData = new Uint8Array(256 * glyphStride);
  const byteWidth = Math.ceil(maxWidth / 8);

  for (let glyphIndex = 0; glyphIndex < 256; glyphIndex++) {
    const width = getGlyphWidth(font, glyphIndex);
    if (width < 1) continue;
    const nextWidth = width + pad;
    glyphWidths[glyphIndex] = nextWidth;
    const dest = glyphIndex * glyphStride;
    for (let y = -above; y < font.glyphHeight + below; y++) {
      for (let x = 0; x < width; x++) {
        if (!getGlyphPixel(font, glyphIndex, x, y)) continue;
        glyphData[dest + (y + above) * byteWidth + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }

  return {
    name,
    size: font.size,
    maxWidth,
    glyphHeight,
    spacing: font.spacing,
    glyphStride,
    glyphWidths,
    glyphData,
    ...carryAdvances(font, glyphWidths),
    sourceFormat: "FNT1",
    outlinePad: font.outlinePad,
    shadowPad: (font.shadowPad ?? 0) + pad,
  };
}
