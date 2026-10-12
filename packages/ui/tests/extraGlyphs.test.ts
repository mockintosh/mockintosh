/**
 * Extra symbol glyphs (⌘ ✓ •) patched into fonts that lack them at registration time.
 */

import { describe, it, expect } from "vitest";
import {
  BULLET,
  CHECK_MARK,
  COMMAND_KEY,
  EXTRA_GLYPHS,
  applyExtraGlyphs,
  extraGlyphSlot,
  writePixelGlyph,
} from "../src/fonts/extraGlyphs";
import { MISSING_SLOT, slotForCodePoint } from "../src/fonts/charmap";
import {
  getGlyphIndexForChar,
  getGlyphPixel,
  getGlyphWidth,
  glyphAdvance,
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
  };
}

describe("page-0 slots", () => {
  it("puts the menu symbols where Chicago keeps them and • at Mac OS Roman 0xA5", () => {
    expect(slotForCodePoint(COMMAND_KEY.charCodeAt(0))).toBe(0x11);
    expect(slotForCodePoint(CHECK_MARK.charCodeAt(0))).toBe(0x12);
    expect(slotForCodePoint(BULLET.charCodeAt(0))).toBe(0xa5);
    for (const def of EXTRA_GLYPHS) expect(extraGlyphSlot(def)).toBe(slotForCodePoint(def.char.charCodeAt(0)));
  });

  it("gives every symbol a distinct slot, none of them the missing glyph's", () => {
    const slots = EXTRA_GLYPHS.map(extraGlyphSlot);
    expect(new Set(slots).size).toBe(EXTRA_GLYPHS.length);
    expect(slots).not.toContain(MISSING_SLOT);
  });

  it("maps ASCII to itself and Mac OS Roman's upper half to its bytes", () => {
    expect(ordinalForCharCode("A".charCodeAt(0))).toBe(65);
    expect(ordinalForCharCode("\u2122".charCodeAt(0))).toBe(0xaa);
    expect(ordinalForCharCode("\u2026".charCodeAt(0))).toBe(0xc9);
    expect(ordinalForCharCode("\u2603".charCodeAt(0))).toBe(-1);
    expect(ordinalForCharCode("\u02c7".charCodeAt(0))).toBe(0xff);
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
    expect(measureText(`${COMMAND_KEY}R`, "menu")).toBeGreaterThan(measureText("R", "menu"));
    // Chicago's ⌘ is 9/1/11 in Apple's font: one pixel in, the image, one pixel after.
    expect(measureText(COMMAND_KEY, "menu")).toBe(11);
    expect(measureText(`${COMMAND_KEY}R`, "menu")).toBe(measureText("R", "menu") + 11);
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

  it("skips symbols with no drawing for the font name, leaving them to the missing glyph", () => {
    const font = syntheticFont("custom", 8, 10);
    font.glyphWidths["?".charCodeAt(0)] = 3;
    applyExtraGlyphs(font);
    for (const ch of [COMMAND_KEY, CHECK_MARK]) expect(getGlyphIndexForChar(font, ch)).toBe("?".charCodeAt(0));
    font.glyphWidths[MISSING_SLOT] = 4;
    for (const ch of [COMMAND_KEY, CHECK_MARK]) expect(getGlyphIndexForChar(font, ch)).toBe(MISSING_SLOT);
  });

  it("leaves a glyph the font already draws alone", () => {
    const font = syntheticFont("menu", 16, 13);
    writePixelGlyph(font, 0x11, { top: 0, rows: ["#"] });
    applyExtraGlyphs(font);
    expect(getGlyphWidth(font, 0x11)).toBe(1);
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
  it("draws Apple's own curly quotes and dashes in the system fonts", () => {
    for (const name of BUILTIN_FONTS) {
      const font = requireFont(name);
      for (const ch of "‘’“”–—") {
        const idx = getGlyphIndexForChar(font, ch);
        expect(idx).toBe(slotForCodePoint(ch.charCodeAt(0)));
        expect(glyphHasInk(font, idx)).toBe(true);
      }
    }
  });

  it("falls back to ASCII look-alikes where a font lacks the glyph", () => {
    const font = syntheticFont("lookalikes", 6, 10);
    for (const ch of `'"-`) {
      const slot = slotForCodePoint(ch.charCodeAt(0));
      font.glyphWidths[slot] = 4;
    }
    expect(Array.from("’“—", (ch) => getGlyphIndexForChar(font, ch))).toEqual(
      Array.from(`'"-`, (ch) => getGlyphIndexForChar(font, ch)),
    );
  });

  it("draws odd spaces and the middle dot like their plain forms", () => {
    for (const name of BUILTIN_FONTS) {
      const font = requireFont(name);
      expect(measureText("a\u00a0b", name).width).toBe(measureText("a b", name).width);
      expect(getGlyphIndexForChar(font, "·")).toBe(getGlyphIndexForChar(font, BULLET));
    }
  });
});
