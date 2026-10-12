import { describe, it, expect } from "vitest";
import { smearDeckerFontBold } from "../src/fonts/boldSmear";
import { decodeFont } from "../src/fonts/codec";
import { getGlyphPixel, getGlyphWidth, hasGlyph } from "../src/fonts/font";
import { initBuiltinFonts, listFontSizes, requireFont } from "../src/fonts/registry";
import { measureText } from "../src/fonts/bridge";
import { faceMetrics } from "../src/fonts/metrics";
import { BUILTIN_FONT_GENEVA_12 } from "../src/fonts/faces/geneva12";

initBuiltinFonts();

function glyphHasInk(name: string, ch: string): boolean {
  const font = requireFont(name);
  const ord = ch.charCodeAt(0);
  const width = getGlyphWidth(font, ord);
  for (let y = 0; y < font.glyphHeight; y++) {
    for (let x = 0; x < width; x++) {
      if (getGlyphPixel(font, ord, x, y)) return true;
    }
  }
  return false;
}

describe("geneva12 (System 7.5.3 FONT 396)", () => {
  it("is a built-in 12-point Geneva face", () => {
    expect(listFontSizes("geneva")).toContain(12);
    const font = requireFont("geneva", 12);
    expect(font.name).toBe("geneva");
    expect(font.size).toBe(12);
    expect(requireFont("geneva12")).toBe(font);
    expect(font.spacing).toBe(0);
    expect(font.maxWidth).toBe(15);
    expect(font.glyphHeight).toBe(13);
    expect(getGlyphWidth(font, " ".charCodeAt(0))).toBe(4);
    expect(getGlyphWidth(font, "A".charCodeAt(0))).toBe(9);
    expect(getGlyphWidth(font, "W".charCodeAt(0))).toBe(11);
    expect(hasGlyph(font, "0".charCodeAt(0))).toBe(true);
  });

  it("draws ink for letters, digits, and punctuation", () => {
    for (const ch of "AaGgWw0$?.") {
      expect(glyphHasInk("geneva12", ch)).toBe(true);
    }
    expect(glyphHasInk("geneva12", " ")).toBe(false);
  });

  it("uses the FONT 396 header for line metrics", () => {
    const m = faceMetrics(requireFont("geneva12"));
    expect(m.ascent).toBe(12);
    expect(m.descent).toBe(3);
    expect(m.leading).toBe(1);
    expect(m.cellHeight).toBe(13);
    expect(m.lineHeight).toBe(16);
    expect(m.capTop).toBe(1);
    expect(m.capHeight).toBe(9);
  });

  it("is wider and taller than Geneva 9", () => {
    expect(measureText("A", "geneva12")).toBeGreaterThan(measureText("A", "body"));
    expect(requireFont("geneva12").glyphHeight).toBeGreaterThan(requireFont("body").glyphHeight);
  });
});

describe("geneva12Bold (FONT 396 Font Manager smear)", () => {
  it("is a built-in face one pixel wider than geneva12", () => {
    const bold = requireFont("geneva12Bold");
    const plain = requireFont("geneva", 12);
    expect(bold.name).toBe("geneva12Bold");
    expect(bold.glyphHeight).toBe(plain.glyphHeight);
    expect(bold.maxWidth).toBe(plain.maxWidth + 1);
    expect(getGlyphWidth(bold, "A".charCodeAt(0))).toBe(getGlyphWidth(plain, "A".charCodeAt(0)) + 1);
  });

  it("draws ink for letters and is wider than plain Geneva 12", () => {
    expect(glyphHasInk("geneva12Bold", "A")).toBe(true);
    expect(measureText("A", "geneva12Bold")).toBeGreaterThan(measureText("A", "geneva12"));
  });

  it("keeps Geneva 12 line metrics", () => {
    const m = faceMetrics(requireFont("geneva12Bold"));
    expect(m.ascent).toBe(12);
    expect(m.descent).toBe(3);
    expect(m.leading).toBe(1);
    expect(m.lineHeight).toBe(16);
  });

  it("matches a fresh smear of the vendored geneva12 face", () => {
    const expected = smearDeckerFontBold(
      decodeFont(BUILTIN_FONT_GENEVA_12, "geneva12"),
      "geneva12Bold",
    );
    const actual = requireFont("geneva12Bold");
    expect(actual.maxWidth).toBe(expected.maxWidth);
    expect(getGlyphWidth(actual, "W".charCodeAt(0))).toBe(getGlyphWidth(expected, "W".charCodeAt(0)));
  });
});
