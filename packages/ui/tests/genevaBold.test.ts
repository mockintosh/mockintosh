import { describe, it, expect } from "vitest";
import { smearBitmapFaceBold } from "../src/fonts/boldSmear";
import { decodeFont } from "../src/fonts/codec";
import { getGlyphPixel, getGlyphWidth } from "../src/fonts/font";
import { initBuiltinFonts, listFonts, requireFont } from "../src/fonts/registry";
import { measureText } from "../src/fonts/bridge";
import { faceMetrics } from "../src/fonts/metrics";
import { SYSTEM_FONT_GENEVA_9 } from "../src/fonts/faces/system/geneva_9";

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

describe("bodyBold (Geneva 9 Font Manager smear)", () => {
  it("is a built-in face one pixel wider than body", () => {
    const bold = requireFont("bodyBold");
    const body = requireFont("body");
    expect(bold.name).toBe("bodyBold");
    expect(bold.glyphHeight).toBe(body.glyphHeight);
    expect(bold.maxWidth).toBe(body.maxWidth + 1);
    expect(getGlyphWidth(bold, "A".charCodeAt(0))).toBe(getGlyphWidth(body, "A".charCodeAt(0)) + 1);
  });

  it("draws ink for letters and is wider than plain Geneva", () => {
    expect(glyphHasInk("bodyBold", "A")).toBe(true);
    expect(measureText("A", "bodyBold")).toBeGreaterThan(measureText("A", "body"));
  });

  it("keeps Geneva 9 line metrics", () => {
    const m = faceMetrics(requireFont("bodyBold"));
    expect(m.ascent).toBe(10);
    expect(m.descent).toBe(2);
    expect(m.lineHeight).toBe(12);
  });

  it("matches a fresh smear of System 7.5.3 Geneva 9", () => {
    const expected = smearBitmapFaceBold(decodeFont(SYSTEM_FONT_GENEVA_9, "geneva"), "bodyBold");
    const actual = requireFont("bodyBold");
    expect(actual.maxWidth).toBe(expected.maxWidth);
    expect(getGlyphWidth(actual, "W".charCodeAt(0))).toBe(getGlyphWidth(expected, "W".charCodeAt(0)));
  });
});
