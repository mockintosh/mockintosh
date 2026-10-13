import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getRealFace, initBuiltinFonts, listFontFamilies, listFontSizes, requireFont, unregisterFamily } from "../src/fonts/registry";
import { charAdvance, getGlyphPixel, getGlyphWidth, glyphAdvance, glyphOriginX, locateGlyph } from "../src/fonts/font";
import { measureText } from "../src/fonts/bridge";
import { faceMetrics } from "../src/fonts/metrics";
import { decodeSuitcase, installSuitcase } from "../src/fonts/suitcase";

const LIBRARY = resolve(__dirname, "../../../public/fonts/library");

interface Catalog {
  fonts: { family: string; file: string; sizes: number[]; styles: string[]; bytes: number }[];
}

const catalog = JSON.parse(readFileSync(resolve(LIBRARY, "index.json"), "utf8")) as Catalog;

function install(file: string): string {
  return installSuitcase(decodeSuitcase(readFileSync(resolve(LIBRARY, file), "utf8")));
}

function ink(name: string, size: number, ch: string): number {
  const hit = locateGlyph(requireFont(name, size), ch.codePointAt(0)!);
  expect(hit, `${name} ${size} has its own ${ch}`).toBeDefined();
  const { font, ordinal } = hit!;
  let n = 0;
  for (let y = -(font.inkAbove ?? 0); y < font.glyphHeight + (font.inkBelow ?? 0); y++)
    for (let x = 0; x < getGlyphWidth(font, ordinal); x++) if (getGlyphPixel(font, ordinal, x, y)) n++;
  return n;
}

initBuiltinFonts();

describe("the font library", () => {
  it("isn't built in", () => {
    const names = listFontFamilies().map((f) => f.name);
    for (const name of ["redaction", "geistpixel", "lisa", "jiskan", "pixel"]) expect(names).not.toContain(name);
  });

  it("lists every suitcase with the sizes and styles it holds", () => {
    expect(catalog.fonts.map((f) => f.family)).toEqual(["Redaction", "Geist Pixel", "Lisa", "Jiskan"]);
    for (const entry of catalog.fonts) {
      const bytes = readFileSync(resolve(LIBRARY, entry.file));
      expect(entry.bytes, entry.file).toBe(bytes.length);
      const suitcase = decodeSuitcase(bytes.toString("utf8"));
      expect(suitcase.family).toBe(entry.family);
      expect([...new Set(suitcase.strikes.map((s) => s.size))].sort((a, b) => a - b)).toEqual(entry.sizes);
      for (const strike of suitcase.strikes) {
        expect(strike.data.startsWith("%%MFN1"), `${entry.family} ${strike.size}`).toBe(true);
        expect(strike.info, `${entry.family} ${strike.size}`).toBeDefined();
      }
    }
  });
});

describe("installed library fonts", () => {
  beforeAll(() => {
    for (const entry of catalog.fonts) install(entry.file);
  });

  it("join the font menus under their own names", () => {
    const families = listFontFamilies().map((f) => [f.name, f.displayName, f.builtIn]);
    expect(families).toContainEqual(["redaction", "Redaction", false]);
    expect(families).toContainEqual(["geistpixel", "Geist Pixel", false]);
    expect(families).toContainEqual(["lisa", "Lisa", false]);
    expect(families).toContainEqual(["jiskan", "Jiskan", false]);
    expect(listFontSizes("redaction")).toEqual([10, 14, 20, 29, 50, 100]);
    expect(listFontFamilies().find((f) => f.name === "redaction")?.defaultSize).toBe(20);
  });

  it("draw every character their sources have, beyond Mac OS Roman", () => {
    for (const size of [10, 14, 20, 29, 50, 100]) {
      for (const ch of "AgÅé€ŁŞĞőž™") expect(ink("redaction", size, ch), `redaction ${size} ${ch}`).toBeGreaterThan(0);
    }
    for (const ch of "AgÅé€Łő™→√") expect(ink("geistpixel", 24, ch), ch).toBeGreaterThan(0);
    for (const ch of "AgÅé€ŁőĜ") expect(ink("jiskan", 16, ch), ch).toBeGreaterThan(0);
    for (const ch of "AaGgWw0$?.") expect(ink("lisa", 12, ch), ch).toBeGreaterThan(0);
    expect(charAdvance(requireFont("redaction", 20), " ")).toBeGreaterThan(0);
  });

  it("have real Bold and Italic Redaction at every size", () => {
    for (const size of [10, 14, 20, 29, 50, 100]) {
      const plain = requireFont("redaction", size);
      for (const bits of [1, 2]) {
        const real = getRealFace("redaction", bits, size)!;
        expect(real.covered, `${size} ${bits}`).toBe(bits);
        expect(real.font.glyphData).not.toEqual(plain.glyphData);
      }
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
    const italic = getRealFace("redaction", 2, 29)!.font;
    expect(getGlyphWidth(italic, f)).toBeGreaterThan(glyphAdvance(italic, f));
  });

  it("keep their native advances", () => {
    expect(measureText("IA", "geistpixel")).toBe(6 + 16);
    expect(measureText("IA", "lisa")).toBe(8 + 8);
  });

  it("use the line metrics they have always had", () => {
    expect(faceMetrics(requireFont("jiskan", 16))).toMatchObject({ ascent: 14, descent: 3, leading: 0 });
    expect(faceMetrics(requireFont("redaction", 20))).toMatchObject({ ascent: 19, descent: 6 });
    expect(faceMetrics(requireFont("redaction", 100))).toMatchObject({ ascent: 95, descent: 30 });
    expect(faceMetrics(requireFont("lisa"))).toMatchObject({ ascent: 10, descent: 2, cellHeight: 12, capHeight: 8 });
    expect(faceMetrics(requireFont("geistpixel")).capHeight).toBe(19);
  });

  it("leave the menus when uninstalled", () => {
    unregisterFamily("geistpixel");
    const families = listFontFamilies().map((f) => f.name);
    expect(families).not.toContain("geistpixel");
    install("geist-pixel.suit");
  });
});
