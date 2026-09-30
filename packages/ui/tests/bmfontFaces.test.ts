import { describe, expect, it } from "vitest";
import { initBuiltinFonts, listFontFamilies, listFontSizes, requireFont } from "../src/fonts/registry";
import { charAdvance, ordinalForCharCode, getGlyphIndexForChar, getGlyphPixel, getGlyphWidth, glyphAdvance, glyphOriginX } from "../src/fonts/font";
import { faceMetrics } from "../src/fonts/metrics";

initBuiltinFonts();

function ink(name: string, size: number, ch: string): number {
  const font = requireFont(name, size);
  const ord = getGlyphIndexForChar(font, ch);
  expect(ord, `${name} ${size} has its own ${ch}`).toBe(ordinalForCharCode(ch.charCodeAt(0)));
  let n = 0;
  for (let y = 0; y < font.glyphHeight; y++)
    for (let x = 0; x < getGlyphWidth(font, ord); x++) if (getGlyphPixel(font, ord, x, y)) n++;
  return n;
}

describe("Redaction and Jiskan (BMFont imports)", () => {
  it("are built-in families at their native sizes", () => {
    expect(listFontSizes("redaction")).toEqual([20, 35]);
    expect(listFontSizes("jiskan")).toEqual([16]);
    const names = listFontFamilies().map((f) => [f.name, f.displayName, f.builtIn]);
    expect(names).toContainEqual(["redaction", "Redaction", true]);
    expect(names).toContainEqual(["jiskan", "Jiskan", true]);
  });

  it("draw Latin letters and Decker's accented extras", () => {
    for (const [name, size] of [["redaction", 20], ["redaction", 35], ["jiskan", 16]] as const) {
      for (const ch of "AgÅé€") expect(ink(name, size, ch), `${name} ${size} ${ch}`).toBeGreaterThan(0);
      expect(charAdvance(requireFont(name, size), " "), `${name} ${size} space`).toBeGreaterThan(0);
    }
  });

  it("keep the source advance where ink overhangs it", () => {
    const font = requireFont("redaction", 35);
    const f = "f".charCodeAt(0);
    expect(glyphAdvance(font, f)).toBe(9);
    expect(getGlyphWidth(font, f)).toBeGreaterThan(9);
    const j = "j".charCodeAt(0);
    expect(glyphOriginX(font, j)).toBe(2);
    expect(charAdvance(font, "j")).toBe(8);
  });

  it("use the source line metrics for alignment", () => {
    expect(faceMetrics(requireFont("jiskan", 16))).toMatchObject({ ascent: 14, descent: 3, leading: 0 });
    expect(faceMetrics(requireFont("redaction", 20))).toMatchObject({ ascent: 19, descent: 5 });
  });
});
