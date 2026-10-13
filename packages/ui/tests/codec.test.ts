import { describe, it, expect } from "vitest";
import { decodeFont, encodeFont } from "../src/fonts/codec";
import { MISSING_SLOT, slotForCodePoint } from "../src/fonts/charmap";
import { locateGlyph } from "../src/fonts/font";
import { legacyCodePoint } from "../src/fonts/legacy";
import { getGlyphPixel, type BitmapFace } from "../src/fonts/font";
import { requireFont, initBuiltinFonts } from "../src/fonts/registry";

initBuiltinFonts();

function tinyFont(): BitmapFace {
  const maxWidth = 8;
  const glyphHeight = 2;
  const glyphStride = glyphHeight;
  const glyphWidths = new Uint8Array(256);
  const glyphData = new Uint8Array(256 * glyphStride);
  glyphWidths[65] = 3;
  // Row 0: ##.     Row 1: #.#
  glyphData[65 * glyphStride] = 0b1100_0000;
  glyphData[65 * glyphStride + 1] = 0b1010_0000;
  return {
    name: "tiny",
    maxWidth,
    glyphHeight,
    spacing: 1,
    glyphStride,
    glyphWidths,
    glyphData,
  };
}

describe("font codec", () => {
  it("round-trips a sparse font as %%MFN1", () => {
    const encoded = encodeFont(tinyFont());
    expect(encoded.startsWith("%%MFN1")).toBe(true);
    const decoded = decodeFont(encoded, "tiny");
    // Packed to its widest glyph.
    expect(decoded.maxWidth).toBe(3);
    expect(decoded.glyphHeight).toBe(2);
    expect(decoded.spacing).toBe(1);
    expect(decoded.glyphWidths[65]).toBe(3);
    expect(getGlyphPixel(decoded, 65, 0, 0)).toBe(true);
    expect(getGlyphPixel(decoded, 65, 1, 0)).toBe(true);
    expect(getGlyphPixel(decoded, 65, 2, 0)).toBe(false);
    expect(getGlyphPixel(decoded, 65, 0, 1)).toBe(true);
    expect(getGlyphPixel(decoded, 65, 1, 1)).toBe(false);
    expect(getGlyphPixel(decoded, 65, 2, 1)).toBe(true);
  });

  it("round-trips the built-in body face pixels and widths", () => {
    const body = requireFont("body");
    const again = decodeFont(encodeFont(body), "body");
    expect(again.maxWidth).toBe(body.maxWidth);
    expect(again.glyphHeight).toBe(body.glyphHeight);
    expect(again.spacing).toBe(body.spacing);
    expect(Array.from(again.glyphWidths)).toEqual(Array.from(body.glyphWidths));
    expect(Array.from(again.glyphData)).toEqual(Array.from(body.glyphData));
    expect(again.inkAbove).toBe(body.inkAbove);
    expect([...(again.pages?.keys() ?? [])]).toEqual([...(body.pages?.keys() ?? [])]);
  });

  it("reads a Decker %%FNT1 record into Mac OS Roman slots and pages", () => {
    // Decker ordinals: 65 A, 127 …, 242 ✓ and Ł (a Central European extra).
    const stride = 1;
    const bytes = [8, 1, 1];
    let lslash = 127;
    while (legacyCodePoint(lslash) !== 0x0141) lslash++;
    for (const ordinal of [65, 127, 242, lslash]) bytes.push(ordinal, 2, 0b1100_0000);
    const record = "%%FNT1" + btoa(String.fromCharCode(...bytes));
    const font = decodeFont(record, "legacy");
    expect(font.glyphStride).toBe(stride);
    expect(font.glyphWidths[65]).toBe(2);
    expect(font.glyphWidths[slotForCodePoint(0x2026)]).toBe(2);
    expect(slotForCodePoint(0x2026)).toBe(0xc9);
    expect(font.glyphWidths[slotForCodePoint(0x2713)]).toBe(2);
    const hit = locateGlyph(font, 0x0141);
    expect(hit?.font).toBe(font.pages?.get(2));
    expect(hit?.ordinal).toBe(0x41);
  });

  it("keeps the missing-character glyph and glyphs past page 0", () => {
    const font = tinyFont();
    font.glyphWidths[MISSING_SLOT] = 2;
    font.glyphData[MISSING_SLOT * font.glyphStride] = 0b1100_0000;
    const page = { ...tinyFont(), glyphWidths: new Uint8Array(256), glyphData: new Uint8Array(256 * 2) };
    page.glyphWidths[0x41] = 1;
    page.glyphData[0x41 * 2] = 0b1000_0000;
    font.pages = new Map([[2, page]]);
    const again = decodeFont(encodeFont(font), "tiny");
    expect(again.glyphWidths[MISSING_SLOT]).toBe(2);
    expect(locateGlyph(again, 0x0141)?.ordinal).toBe(0x41);
    expect(getGlyphPixel(again.pages!.get(2)!, 0x41, 0, 0)).toBe(true);
  });
});
