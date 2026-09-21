import { describe, expect, it } from "vitest";
import type { FontStrikeDraft } from "@mockintosh/sdk";
import {
  blitDraftLines,
  cellsPerRow,
  glyphOf,
  scaleGlyphToThumb,
  stripCellSize,
  stripGlyphs,
  stripInnerWidth,
  STRIP_GAP,
  STRIP_INK,
  toggleDraftPixel,
  uniqueDesktopName,
} from "./strike";

function boxDraft(): FontStrikeDraft {
  return {
    family: "tiny",
    size: 8,
    maxWidth: 3,
    glyphHeight: 2,
    spacing: 1,
    glyphs: [
      { ordinal: 65, width: 3, pixels: new Uint8Array([1, 0, 1, 0, 1, 0]) },
      { ordinal: 32, width: 1, pixels: new Uint8Array([0, 0]) },
    ],
  };
}

describe("foundry strike helpers", () => {
  it("toggles one pixel on the selected glyph", () => {
    const next = toggleDraftPixel(boxDraft(), 65, 1, 0);
    expect([...glyphOf(next, 65)!.pixels]).toEqual([1, 1, 1, 0, 1, 0]);
    expect([...glyphOf(next, 32)!.pixels]).toEqual([0, 0]);
  });

  it("blits preview lines with tracking", () => {
    const bits = blitDraftLines(boxDraft(), ["A A"], 0);
    expect(bits.height).toBe(2);
    expect(bits.width).toBe(3 + 1 + 1 + 1 + 3 + 1);
    expect(bits.pixels[0]).toBe(1);
    expect(bits.pixels[1]).toBe(0);
  });

  it("uniqueDesktopName suffixes before the extension", () => {
    expect(uniqueDesktopName(["tiny-36.fnt"], "tiny-36.fnt")).toBe("tiny-36 2.fnt");
    expect(uniqueDesktopName(["tiny-36.fnt", "tiny-36 2.fnt"], "tiny-36.fnt")).toBe("tiny-36 3.fnt");
  });

  it("packs the glyph strip so a row never exceeds the pane", () => {
    const cell = stripCellSize(STRIP_INK, STRIP_INK);
    const inner = stripInnerWidth(403);
    const n = cellsPerRow(inner, cell.width);
    const rowWidth = n * cell.width + (n - 1) * STRIP_GAP;
    expect(n).toBeGreaterThan(1);
    expect(rowWidth).toBeLessThanOrEqual(inner);
    // The old 12px/count math overflowed a 420-outer / grow-box pane.
    const naive = Math.floor((420 - 16) / 12);
    expect(naive * 12 + (naive - 1) * STRIP_GAP).toBeGreaterThan(inner);
  });

  it("lists every draft glyph, not only ASCII", () => {
    const draft: FontStrikeDraft = {
      ...boxDraft(),
      glyphs: [
        { ordinal: 65, width: 1, pixels: new Uint8Array([1, 0]) },
        { ordinal: 128, width: 1, pixels: new Uint8Array([0, 1]) },
        { ordinal: 33, width: 1, pixels: new Uint8Array([1, 1]) },
      ],
    };
    expect(stripGlyphs(draft).map((g) => g.ordinal)).toEqual([33, 65, 128]);
  });

  it("fits a tall strike into the strip thumbnail without clipping the dest", () => {
    const srcW = 8;
    const srcH = 20;
    const src = new Uint8Array(srcW * srcH);
    src[0] = 1;
    src[srcW * srcH - 1] = 1;
    const dest = scaleGlyphToThumb(src, srcW, srcH, STRIP_INK, STRIP_INK);
    expect(dest.length).toBe(STRIP_INK * STRIP_INK);
    expect(dest.some((p) => p === 1)).toBe(true);
  });
});
