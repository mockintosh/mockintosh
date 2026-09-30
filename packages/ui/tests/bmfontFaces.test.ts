import { beforeAll, describe, expect, it } from "vitest";
import {
  fetchFont,
  getRealFace,
  initBuiltinFonts,
  listFontFamilies,
  listFontSizes,
  onFontsChanged,
  requireFont,
} from "../src/fonts/registry";
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

// Runs first: the large Redaction strikes are still unfetched.
describe("lazy built-in strikes", () => {
  it("draw with the nearest size in memory until the strike lands", async () => {
    expect(requireFont("redaction", 100).size).toBe(29);
    const changed = new Promise<void>((resolve) => {
      const off = onFontsChanged(() => {
        off();
        resolve();
      });
    });
    await changed;
    expect(requireFont("redaction", 100).size).toBe(100);
    expect((await fetchFont("redaction", 50))?.size).toBe(50);
  });

  it("synthesize a styled face until its strike lands", async () => {
    expect(getRealFace("redaction", 1, 20)?.covered).toBe(0);
    const bold = await fetchFont("redaction", 20, 1);
    expect(getRealFace("redaction", 1, 20)).toEqual({ font: bold, covered: 1 });
  });
});

describe("Redaction Bold and Italic", () => {
  beforeAll(async () => {
    for (const size of listFontSizes("redaction")) {
      await fetchFont("redaction", size, 1);
      await fetchFont("redaction", size, 2);
    }
  });

  it("are real faces at every size, with their own line metrics", () => {
    for (const size of [10, 14, 20, 29, 50, 100]) {
      const plain = requireFont("redaction", size);
      for (const bits of [1, 2]) {
        const real = getRealFace("redaction", bits, size)!;
        expect(real.covered, `${size} ${bits}`).toBe(bits);
        expect(real.font.name).toBe("redaction");
        expect(real.font.size).toBe(size);
        expect(real.font.glyphData).not.toEqual(plain.glyphData);
        expect(faceMetrics(real.font).ascent).toBeGreaterThan(0);
      }
    }
    // Bold italic has no face of its own; italic weighs more.
    expect(getRealFace("redaction", 3, 20)?.covered).toBe(2);
  });

  it("keep italic ink that overhangs the advance", () => {
    const italic = getRealFace("redaction", 2, 29)!.font;
    const f = "f".charCodeAt(0);
    expect(getGlyphWidth(italic, f)).toBeGreaterThan(glyphAdvance(italic, f));
  });
});

describe("Redaction and Jiskan", () => {
  beforeAll(async () => {
    for (const size of listFontSizes("redaction")) await fetchFont("redaction", size);
  });

  it("are built-in families at their native sizes", () => {
    expect(listFontSizes("redaction")).toEqual([10, 14, 20, 29, 50, 100]);
    expect(listFontSizes("jiskan")).toEqual([16]);
    const names = listFontFamilies().map((f) => [f.name, f.displayName, f.builtIn]);
    expect(names).toContainEqual(["redaction", "Redaction", true]);
    expect(names).toContainEqual(["jiskan", "Jiskan", true]);
  });

  it("draw Latin letters and Decker's accented extras", () => {
    for (const [name, size] of [
      ...[10, 14, 20, 29, 50, 100].map((size) => ["redaction", size] as const),
      ["jiskan", 16] as const,
    ]) {
      for (const ch of "AgÅé€") expect(ink(name, size, ch), `${name} ${size} ${ch}`).toBeGreaterThan(0);
      expect(charAdvance(requireFont(name, size), " "), `${name} ${size} space`).toBeGreaterThan(0);
    }
  });

  it("keep the source advance where ink overhangs it", () => {
    const font = requireFont("redaction", 29);
    const f = "f".charCodeAt(0);
    expect(glyphAdvance(font, f)).toBe(9);
    expect(getGlyphWidth(font, f)).toBeGreaterThan(9);
    const j = "j".charCodeAt(0);
    expect(glyphOriginX(font, j)).toBe(2);
    expect(charAdvance(font, "j")).toBe(8);
  });

  it("use the source line metrics for alignment", () => {
    expect(faceMetrics(requireFont("jiskan", 16))).toMatchObject({ ascent: 14, descent: 3, leading: 0 });
    expect(faceMetrics(requireFont("redaction", 20))).toMatchObject({ ascent: 19, descent: 6 });
    expect(faceMetrics(requireFont("redaction", 100))).toMatchObject({ ascent: 95, descent: 30 });
  });
});
