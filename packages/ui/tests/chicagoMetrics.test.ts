import { describe, expect, it } from "vitest";
import { getGlyphIndexForChar, getGlyphPixel, getGlyphWidth } from "../src/fonts/font";
import { initBuiltinFonts, requireFont } from "../src/fonts/registry";
import { measureText } from "../src/fonts/bridge";
import { CHICAGO_12_NFNT } from "../src/fonts/faces/chicago12Metrics";

initBuiltinFonts();

/** First and last ink columns of `ch`'s cell, relative to the pen. */
function ink(ch: string): [number, number] {
  const font = requireFont("menu");
  const glyph = getGlyphIndexForChar(font, ch);
  const cols: number[] = [];
  for (let x = 0; x < getGlyphWidth(font, glyph); x++) {
    for (let y = 0; y < font.glyphHeight; y++) if (getGlyphPixel(font, glyph, x, y)) { cols.push(x); break; }
  }
  return [cols[0]!, cols[cols.length - 1]!];
}

describe("Chicago 12 placed by Apple's offset/width table", () => {
  it("advances every printable ASCII character as Apple's font does", () => {
    for (let code = 32; code < 127; code++) {
      expect(measureText(String.fromCharCode(code), "menu"), String.fromCharCode(code)).toBe(CHICAGO_12_NFNT[code]![2]);
    }
  });

  it("draws each image its offset right of the pen", () => {
    for (let code = 33; code < 127; code++) {
      const [, offset, ] = CHICAGO_12_NFNT[code]!;
      expect(ink(String.fromCharCode(code))[0], String.fromCharCode(code)).toBe(offset);
    }
  });

  it("measures the Standard File labels as Apple's screenshot spaces them", () => {
    expect(measureText("Tropical", "menu")).toBe(51);
    expect(measureText("Desktop", "menu")).toBe(53);
    expect(measureText("Cancel", "menu")).toBe(43);
    expect(measureText("Open", "menu")).toBe(32);
  });

  it("keeps re-spaced Chicago one pixel tighter per glyph", () => {
    expect(measureText("Open", "menu~s1")).toBe(32 - 4);
  });
});
