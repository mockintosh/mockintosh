import { describe, it, expect } from "vitest";
import { initBuiltinFonts, requireFont } from "../src/fonts/registry";
import { alignmentHeight, cdefBaseline, faceMetrics } from "../src/fonts/metrics";
import type { BitmapFace } from "../src/fonts/font";

initBuiltinFonts();

function emptyFont(glyphHeight: number): BitmapFace {
  return {
    name: "empty",
    maxWidth: 8,
    glyphHeight,
    spacing: 1,
    glyphStride: glyphHeight,
    glyphWidths: new Uint8Array(256),
    glyphData: new Uint8Array(256 * glyphHeight),
  };
}

describe("faceMetrics", () => {
  it("uses Chicago 12 FontInfo for menu and keeps Decker cap mapping", () => {
    const m = faceMetrics(requireFont("menu"));
    expect(m.cellHeight).toBe(13);
    expect(m.ascent).toBe(12);
    expect(m.descent).toBe(3);
    expect(m.leading).toBe(1);
    expect(m.lineHeight).toBe(16);
    expect(m.capTop).toBe(1);
    expect(m.capHeight).toBe(9);
    expect(m.capAscent).toBe(10);
  });

  it("uses Geneva 9 FontInfo for body", () => {
    const m = faceMetrics(requireFont("body"));
    expect(m.cellHeight).toBe(10);
    expect(m.ascent).toBe(10);
    expect(m.descent).toBe(2);
    expect(m.lineHeight).toBe(12);
    expect(m.capTop).toBe(1);
    expect(m.capHeight).toBe(7);
    expect(m.capAscent).toBe(8);
  });

  it("uses FONT 396 FontInfo for genova12", () => {
    const m = faceMetrics(requireFont("genova12"));
    expect(m.cellHeight).toBe(13);
    expect(m.ascent).toBe(12);
    expect(m.descent).toBe(3);
    expect(m.leading).toBe(1);
    expect(m.lineHeight).toBe(16);
    expect(m.capTop).toBe(1);
    expect(m.capHeight).toBe(9);
    expect(m.capAscent).toBe(10);
  });

  it("uses Monaco 9 FontInfo for mono", () => {
    const m = faceMetrics(requireFont("mono"));
    expect(m.cellHeight).toBe(11);
    expect(m.ascent).toBe(9);
    expect(m.descent).toBe(2);
    expect(m.lineHeight).toBe(11);
    expect(m.capTop).toBe(2);
    expect(m.capHeight).toBe(7);
    expect(m.capAscent).toBe(9);
  });

  it("falls back to the cell split when A–Z have no ink and no System header", () => {
    const m = faceMetrics(emptyFont(12));
    expect(m.ascent).toBe(12);
    expect(m.descent).toBe(0);
    expect(m.lineHeight).toBe(12);
    expect(m.capAscent).toBe(12);
  });
});

describe("CDEF baseline", () => {
  const menu = faceMetrics(requireFont("menu"));

  it("places Chicago 12 on baseline 14 in a 20px control rect", () => {
    expect(cdefBaseline(0, 20, menu)).toBe(14);
  });

  it("uses the FontInfo line box for single-line middle", () => {
    expect(alignmentHeight(requireFont("menu"), 1, 13, "middle")).toBe(16);
  });

  it("keeps the cell block for top, bottom, and wrapped middle", () => {
    const menuFont = requireFont("menu");
    expect(alignmentHeight(menuFont, 1, 13, "top")).toBe(13);
    expect(alignmentHeight(menuFont, 1, 13, "bottom")).toBe(13);
    expect(alignmentHeight(menuFont, 3, 39, "middle")).toBe(39);
  });
});
