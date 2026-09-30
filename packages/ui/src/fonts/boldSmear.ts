import type { DeckerFont } from "./font";
import { carryAdvances, getGlyphPixel, getGlyphWidth } from "./font";

/**
 * Font Manager bold (`DrawText.a` smear): each pixel ORs onto its right
 * neighbor and the advance grows 1px. Apple never shipped an intrinsic
 * Geneva Bold strike; this is what Bold on Geneva 9 actually painted.
 */
export function smearDeckerFontBold(font: DeckerFont, name: string): DeckerFont {
  const maxWidth = font.maxWidth + 1;
  const glyphHeight = font.glyphHeight;
  const above = font.inkAbove ?? 0;
  const below = font.inkBelow ?? 0;
  const glyphStride = Math.ceil(maxWidth / 8) * (above + glyphHeight + below);
  const glyphWidths = new Uint8Array(256);
  const glyphData = new Uint8Array(256 * glyphStride);
  const byteWidth = Math.ceil(maxWidth / 8);

  for (let glyphIndex = 0; glyphIndex < 256; glyphIndex++) {
    const width = getGlyphWidth(font, glyphIndex);
    if (width < 1) continue;
    const nextWidth = width + 1;
    glyphWidths[glyphIndex] = nextWidth;
    const base = glyphIndex * glyphStride;
    for (let y = -above; y < glyphHeight + below; y++) {
      for (let x = 0; x < nextWidth; x++) {
        const ink = getGlyphPixel(font, glyphIndex, x, y) || getGlyphPixel(font, glyphIndex, x - 1, y);
        if (!ink) continue;
        glyphData[base + (y + above) * byteWidth + (x >> 3)] |= 1 << (7 - (x & 7));
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
    shadowPad: font.shadowPad,
  };
}
