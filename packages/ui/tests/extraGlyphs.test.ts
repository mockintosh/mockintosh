/**
 * Extra symbol glyphs (⌘ ✓ •) patched into the vendored Decker fonts at registration time.
 */

import { describe, it, expect } from "vitest";
import {
  BULLET,
  CHECK_MARK,
  COMMAND_KEY,
  EXTRA_GLYPHS,
  EXTRA_ORDINAL_BASE,
  applyExtraGlyphs,
  extraOrdinalForCharCode,
  writePixelGlyph,
} from "../src/fonts/extraGlyphs";
import { deckerOrdinalForCharCode } from "../src/fonts/drom";
import {
  getGlyphIndexForChar,
  getGlyphPixel,
  getGlyphWidth,
  ordinalForCharCode,
  type DeckerFont,
} from "../src/fonts/font";
import { requireFont } from "../src/fonts/registry";
import { measureText } from "../src/fonts/bridge";

const BUILTIN_FONTS = ["body", "menu", "mono", "bodyBold", "geneva12", "geneva12Bold"] as const;
const SYMBOLS = [COMMAND_KEY, CHECK_MARK, BULLET];

function glyphHasInk(font: DeckerFont, ordinal: number): boolean {
  const width = getGlyphWidth(font, ordinal);
  for (let y = 0; y < font.glyphHeight; y++) {
    for (let x = 0; x < width; x++) {
      if (getGlyphPixel(font, ordinal, x, y)) return true;
    }
  }
  return false;
}

function syntheticFont(name: string, maxWidth: number, glyphHeight: number): DeckerFont {
  const glyphStride = Math.ceil(maxWidth / 8) * glyphHeight;
  return {
    name,
    maxWidth,
    glyphHeight,
    spacing: 1,
    glyphStride,
    glyphWidths: new Uint8Array(256),
    glyphData: new Uint8Array(256 * glyphStride),
    sourceFormat: "FNT1",
  };
}

describe("extra glyph ordinal mapping", () => {
  it("assigns each symbol a non-fallback ordinal above Decker's range and below 255", () => {
    for (const ch of SYMBOLS) {
      const cu = ch.charCodeAt(0);
      expect(deckerOrdinalForCharCode(cu)).toBe(255);
      const ord = ordinalForCharCode(cu);
      expect(ord).not.toBe(255);
      expect(ord).toBeGreaterThanOrEqual(EXTRA_ORDINAL_BASE);
      expect(ord).toBeLessThanOrEqual(254);
      expect(extraOrdinalForCharCode(cu)).toBe(ord);
    }
  });

  it("does not collide with Decker's DROM_CHARS ordinals", () => {
    // Highest Decker ordinal: 127 + index of the last DROM char (currently '°').
    const highestDecker = deckerOrdinalForCharCode("\u00b0".charCodeAt(0));
    expect(highestDecker).not.toBe(255);
    expect(EXTRA_ORDINAL_BASE).toBeGreaterThan(highestDecker);
  });

  it("gives every symbol a distinct ordinal", () => {
    const ords = EXTRA_GLYPHS.map((g) => extraOrdinalForCharCode(g.char.charCodeAt(0)));
    expect(new Set(ords).size).toBe(EXTRA_GLYPHS.length);
  });

  it("leaves Decker's ASCII and extended mapping untouched", () => {
    expect(ordinalForCharCode("A".charCodeAt(0))).toBe(65);
    expect(ordinalForCharCode("\u2026".charCodeAt(0))).toBe(127);
    expect(ordinalForCharCode("\u2603".charCodeAt(0))).toBe(255);
  });
});

describe("extra glyphs in the built-in fonts", () => {
  it.each(BUILTIN_FONTS)("%s: every symbol resolves to a real glyph with ink", (fontName) => {
    const font = requireFont(fontName);
    for (const ch of SYMBOLS) {
      const idx = getGlyphIndexForChar(font, ch);
      expect(idx).toBe(ordinalForCharCode(ch.charCodeAt(0)));
      expect(idx).not.toBe("?".charCodeAt(0));
      expect(getGlyphWidth(font, idx)).toBeGreaterThan(0);
      expect(getGlyphWidth(font, idx)).toBeLessThanOrEqual(font.maxWidth);
      expect(glyphHasInk(font, idx)).toBe(true);
    }
  });

  it("measures ⌘R wider than R in the menu font by the glyph's advance", () => {
    const font = requireFont("menu");
    const cmdWidth = getGlyphWidth(font, getGlyphIndexForChar(font, COMMAND_KEY));
    expect(measureText(`${COMMAND_KEY}R`, "menu")).toBeGreaterThan(measureText("R", "menu"));
    expect(measureText(`${COMMAND_KEY}R`, "menu")).toBe(
      measureText("R", "menu") + cmdWidth + font.spacing
    );
  });

  it("renders symbols distinctly from the '?' fallback", () => {
    const font = requireFont("menu");
    const fallback = "?".charCodeAt(0);
    for (const ch of SYMBOLS) {
      const idx = getGlyphIndexForChar(font, ch);
      let identical = getGlyphWidth(font, idx) === getGlyphWidth(font, fallback);
      for (let y = 0; identical && y < font.glyphHeight; y++) {
        for (let x = 0; x < font.maxWidth; x++) {
          if (getGlyphPixel(font, idx, x, y) !== getGlyphPixel(font, fallback, x, y)) {
            identical = false;
            break;
          }
        }
      }
      expect(identical).toBe(false);
    }
  });
});

describe("writePixelGlyph / applyExtraGlyphs", () => {
  it("writes rows MSB-first at the requested top offset and sets the advance width", () => {
    const font = syntheticFont("test", 16, 4);
    writePixelGlyph(font, 200, { top: 1, rows: ["#........#", ".#......#."] });
    expect(getGlyphWidth(font, 200)).toBe(10);
    expect(getGlyphPixel(font, 200, 0, 1)).toBe(true);
    expect(getGlyphPixel(font, 200, 9, 1)).toBe(true);
    expect(getGlyphPixel(font, 200, 1, 2)).toBe(true);
    expect(getGlyphPixel(font, 200, 8, 2)).toBe(true);
    expect(getGlyphPixel(font, 200, 0, 0)).toBe(false);
    expect(getGlyphPixel(font, 200, 0, 2)).toBe(false);
  });

  it("refuses drawings wider than maxWidth or taller than the cell", () => {
    const font = syntheticFont("test", 8, 4);
    expect(() => writePixelGlyph(font, 200, { top: 0, rows: ["#########"] })).toThrow();
    expect(() => writePixelGlyph(font, 200, { top: 3, rows: ["#", "#"] })).toThrow();
    expect(() => writePixelGlyph(font, 200, { top: 0, rows: ["##", "#"] })).toThrow();
  });

  it("skips symbols with no drawing for the font name, leaving them to the '?' fallback", () => {
    const font = syntheticFont("custom", 8, 10);
    font.glyphWidths["?".charCodeAt(0)] = 3;
    applyExtraGlyphs(font);
    for (const ch of SYMBOLS) {
      expect(getGlyphIndexForChar(font, ch)).toBe("?".charCodeAt(0));
    }
  });

  it("applies drawings to a custom font registered under a built-in name when they fit", () => {
    const font = syntheticFont("menu", 16, 13);
    applyExtraGlyphs(font);
    for (const ch of SYMBOLS) expect(glyphHasInk(font, ordinalForCharCode(ch.charCodeAt(0)))).toBe(true);

    const narrow = syntheticFont("menu", 4, 13);
    applyExtraGlyphs(narrow);
    expect(getGlyphWidth(narrow, ordinalForCharCode(COMMAND_KEY.charCodeAt(0)))).toBe(0);
  });
});

describe("typographic look-alikes", () => {
  it("draws curly quotes, dashes and odd spaces as their ASCII look-alikes rather than '?'", () => {
    for (const name of BUILTIN_FONTS) {
      const font = requireFont(name);
      expect(Array.from("it’s “fine” — really", (ch) => getGlyphIndexForChar(font, ch))).toEqual(
        Array.from(`it's "fine" - really`, (ch) => getGlyphIndexForChar(font, ch)),
      );
      expect(measureText("a\u00a0b", name).width).toBe(measureText("a b", name).width);
      expect(getGlyphIndexForChar(font, "·")).toBe(getGlyphIndexForChar(font, BULLET));
    }
  });
});
