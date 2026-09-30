import { describe, expect, it } from "vitest";
import { DEFAULT_SCALER_OPTIONS, OutlineFace, type RenderedGlyph } from "../../src/fonts/truetype/scaler";
import { TEST_GLYPHS, testFontBytes } from "./testFont";

function inkColumns(g: RenderedGlyph): number[] {
  const cols: number[] = [];
  for (let x = 0; x < g.width; x++) {
    for (let y = 0; y < g.height; y++) {
      if (g.pixels[y * g.width + x]) {
        cols.push(x);
        break;
      }
    }
  }
  return cols;
}

function runsOf(cols: number[]): number[] {
  const runs: number[] = [];
  let len = 0;
  for (let i = 0; i < cols.length; i++) {
    len++;
    if (i === cols.length - 1 || cols[i + 1] !== cols[i]! + 1) {
      runs.push(len);
      len = 0;
    }
  }
  return runs;
}

function topInkRow(g: RenderedGlyph): number {
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) if (g.pixels[y * g.width + x]) return y;
  }
  return -1;
}

function render(face: OutlineFace, ch: string, ppem: number, opts: Partial<typeof DEFAULT_SCALER_OPTIONS> = {}) {
  const options = { ...DEFAULT_SCALER_OPTIONS, ...opts };
  return face.render(face.font.glyphId(ch.codePointAt(0)!), face.metrics(ppem, options), options);
}

describe("sfnt reader", () => {
  it("reads names, metrics, a format-12 cmap and kerning", () => {
    const face = new OutlineFace(testFontBytes());
    expect(face.familyName).toBe("Test Sans");
    expect(face.font.unitsPerEm).toBe(1000);
    expect(face.font.glyphId("H".codePointAt(0)!)).toBeGreaterThan(0);
    expect(face.font.glyphId(0x1f600)).toBeGreaterThan(0);
    expect(face.font.glyphId("Q".codePointAt(0)!)).toBe(0);
    const a = face.font.glyphId(65);
    const v = face.font.glyphId(86);
    expect(face.font.kerning(a, v)).toBe(-80);
    expect(face.kerning(a, v, face.metrics(10))).toBe(-1);
    expect(face.kerning(a, v, face.metrics(30))).toBe(-2);
  });

  it("reads bold / italic from OS/2", () => {
    const face = new OutlineFace(testFontBytes({ subfamily: "Bold Italic", weightClass: 700, italic: true }));
    expect(face.font.bold).toBe(true);
    expect(face.font.italic).toBe(true);
  });
});

describe("autohinter", () => {
  it("measures blue zones and stems from the design", () => {
    const g = new OutlineFace(testFontBytes()).globals();
    const zone = (name: string) => g.blues.find((z) => z.name === name);
    expect(zone("xheight")?.ref).toBe(500);
    expect(zone("xheight")?.overshoot).toBe(520);
    expect(zone("baseline")?.ref).toBe(0);
    expect(zone("baseline")?.overshoot).toBe(-20);
    expect(g.stemV).toBe(140);
  });

  it("gives equal stems equal pixel widths wherever they fall", () => {
    const face = new OutlineFace(testFontBytes());
    for (const ppem of [9, 10, 11, 12, 13, 14]) {
      const widths = runsOf(inkColumns(render(face, "m", ppem)));
      expect(widths, `ppem ${ppem}`).toHaveLength(3);
      expect(new Set(widths).size, `ppem ${ppem}: ${widths}`).toBe(1);
    }
    // Without hinting the same glyph comes out uneven at 10 ppem.
    expect(new Set(runsOf(inkColumns(render(face, "m", 10, { hint: false })))).size).toBeGreaterThan(1);
  });

  it("puts x and o on one x-height row at small sizes", () => {
    const face = new OutlineFace(testFontBytes());
    for (const ppem of [10, 11, 12]) {
      expect(topInkRow(render(face, "o", ppem)), `ppem ${ppem}`).toBe(topInkRow(render(face, "x", ppem)));
    }
  });

  it("collapses overshoot at 10 ppem but keeps it at 30", () => {
    const face = new OutlineFace(testFontBytes());
    expect(topInkRow(render(face, "o", 10))).toBe(topInkRow(render(face, "x", 10)));
    expect(topInkRow(render(face, "o", 30))).toBe(topInkRow(render(face, "x", 30)) - 1);
  });
});

describe("scan converter", () => {
  it("keeps a sub-pixel stem with dropout control", () => {
    const face = new OutlineFace(testFontBytes());
    const without = render(face, "!", 10, { hint: false, dropout: false });
    const withDropout = render(face, "!", 10, { hint: false, dropout: true });
    expect(without.pixels.some((p) => p === 1)).toBe(false);
    expect(withDropout.pixels.filter((p) => p === 1).length).toBeGreaterThanOrEqual(5);
  });

  it("sizes the line box from the font's line spacing, putting accent room on top", () => {
    // Adobe's convention: ascender + descender = one em, accents live in the line gap.
    const face = new OutlineFace(testFontBytes({ ascender: 703, descender: -297, lineGap: 300 }));
    const m = face.metrics(20);
    expect(m.cellHeight).toBe(26); // (703 + 297 + 300) × 20 / 1000: the font's own spacing
    expect(m.ascent).toBe(19); // Å's top, 950 units, not the 703 ascender
    expect(m.descent).toBe(7); // the rest of the gap goes below
    expect(m.leading).toBe(0);
    const aring = face.font.glyphId(0xc5);
    expect(face.inkRoom([aring], m)).toEqual({ above: 0, below: 0 });
    expect(topInkRow(face.render(aring, m))).toBeGreaterThanOrEqual(0);

    // No line gap: accents beyond the ascender grow the line; the descender stays.
    const tight = new OutlineFace(testFontBytes()).metrics(20);
    expect(tight.ascent).toBe(19);
    expect(tight.descent).toBe(4);
  });

  it("lets ink beyond the line box leave it, or squeezes it when PreserveGlyph is off", () => {
    const face = new OutlineFace(testFontBytes());
    const metrics = face.metrics(20);
    const tall = face.font.glyphId(0x1fa);
    const room = face.inkRoom([tall], metrics);
    expect(room.above).toBeGreaterThan(0);

    const kept = face.render(tall, metrics, DEFAULT_SCALER_OPTIONS, room);
    expect(kept.height).toBe(room.above + metrics.cellHeight);
    expect(topInkRow(kept)).toBeLessThan(room.above);

    const squeezed = render(face, "\u01fa", 20, { preserveGlyph: false });
    expect(squeezed.height).toBe(metrics.cellHeight);
    expect(topInkRow(squeezed)).toBeGreaterThanOrEqual(0);
  });

  it("renders every size from 4 to 127 without throwing", () => {
    const face = new OutlineFace(testFontBytes());
    for (const ppem of [4, 9, 24, 72, 127]) {
      for (const ch of Object.keys(TEST_GLYPHS)) {
        const g = render(face, ch, ppem);
        expect(g.pixels.length).toBe(g.width * g.height);
      }
    }
  });
});
