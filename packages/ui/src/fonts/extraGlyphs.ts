/**
 * Symbol glyphs Mockintosh draws into fonts that lack them: ⌘ and ✓ where
 * Apple's own strike has none, ⇧ and ⌥ which System 7 fonts never had.
 *
 * The generated faces must never be hand-edited, so the drawings live here
 * as readable pixel art and are patched into each decoded font at
 * registration time (see `registry.ts`), each at its character's slot
 * (`charmap.ts`). A glyph the font already draws is left alone.
 */
import { MISSING_SLOT, slotForCodePoint } from "./charmap";
import type { BitmapFace } from "./font";

/**
 * A glyph as pixel art: one string per row, `#` = ink, anything else = paper.
 * `top` is the row of the font cell the first string lands on; rows above/below are blank.
 * All rows must have the same length, which becomes the glyph's advance width.
 */
export interface PixelGlyph {
  top: number;
  rows: readonly string[];
}

/** A symbol with one pixel-art rendering per built-in font it should appear in. */
export interface ExtraGlyphDefinition {
  /** The character this glyph renders (a single UTF-16 code unit). */
  char: string;
  /** Human-readable name, for diagnostics. */
  name: string;
  /** Per-font drawings keyed by registered font name (`body`, `menu`, `mono`, …). */
  perFont: Readonly<Record<string, PixelGlyph>>;
}

export const COMMAND_KEY = "\u2318";
export const CHECK_MARK = "\u2713";
export const BULLET = "\u2022";
export const SHIFT_KEY = "\u21E7";
export const OPTION_KEY = "\u2325";

/** The single source of truth for Mockintosh symbols. */
export const EXTRA_GLYPHS: readonly ExtraGlyphDefinition[] = [
  {
    char: COMMAND_KEY,
    name: "command key",
    perFont: {
      // Chicago 12: Apple's own glyph (System 6/7 Chicago 12, character 17),
      // caps-high on rows 1–9.
      menu: {
        top: 1,
        rows: [
          ".##...##.",
          "#..#.#..#",
          "#..#.#..#",
          ".#######.",
          "...#.#...",
          ".#######.",
          "#..#.#..#",
          "#..#.#..#",
          ".##...##.",
        ],
      },
      // Geneva 9: 1px strokes, caps on rows 1–7.
      body: {
        top: 0,
        rows: [
          ".#....#.",
          "#.#..#.#",
          ".######.",
          "..#..#..",
          "..#..#..",
          ".######.",
          "#.#..#.#",
          ".#....#.",
        ],
      },
      // Font Manager smear of the Geneva 9 drawing.
      bodyBold: {
        top: 0,
        rows: [
          ".##...##.",
          "####.####",
          ".#######.",
          "..##.##..",
          "..##.##..",
          ".#######.",
          "####.####",
          ".##...##.",
        ],
      },
      // Geneva 12: 1px strokes, caps on rows 1–9.
      genova12: {
        top: 1,
        rows: [
          ".#.....#.",
          "#.#...#.#",
          "#.#...#.#",
          ".#######.",
          "..#...#..",
          "..#...#..",
          ".#######.",
          "#.#...#.#",
          ".#.....#.",
        ],
      },
      genova12Bold: {
        top: 1,
        rows: [
          ".##....##.",
          "####..####",
          "####..####",
          ".########.",
          "..##..##..",
          "..##..##..",
          ".########.",
          "####..####",
          ".##....##.",
        ],
      },
      // 5px monospace: caps on rows 2–8; a compact square centred on the cap band.
      mono: {
        top: 3,
        rows: [
          "#...#",
          "#####",
          ".#.#.",
          "#####",
          "#...#",
        ],
      },
    },
  },
  {
    char: CHECK_MARK,
    name: "check mark",
    perFont: {
      // Chicago 12: Apple's own glyph (character 18).
      menu: {
        top: 2,
        rows: [
          "........#",
          ".......##",
          "......##.",
          ".....##..",
          "#...##...",
          "##.##....",
          ".###.....",
          "..#......",
        ],
      },
      body: {
        top: 2,
        rows: [
          "......#",
          ".....#.",
          "....#..",
          "#..#...",
          ".#.#...",
          "..#....",
        ],
      },
      bodyBold: {
        top: 2,
        rows: [
          "......##",
          ".....##.",
          "....##..",
          "##.##...",
          ".####...",
          "..##....",
        ],
      },
      genova12: {
        top: 2,
        rows: [
          ".......#",
          "......#.",
          ".....#..",
          "....#...",
          "#..#....",
          ".#.#....",
          "..#.....",
        ],
      },
      genova12Bold: {
        top: 2,
        rows: [
          ".......##",
          "......##.",
          ".....##..",
          "....##...",
          "##.##....",
          ".####....",
          "..##.....",
        ],
      },
      mono: {
        top: 3,
        rows: [
          "....#",
          "....#",
          "...#.",
          "#..#.",
          ".#.#.",
          "..#..",
        ],
      },
    },
  },
  {
    char: BULLET,
    name: "bullet",
    perFont: {
      // Centred on the x-height band (rows 3–9 in menu, 3–7 in body, 4–8 in mono).
      menu: {
        top: 4,
        rows: [
          ".###.",
          "#####",
          "#####",
          "#####",
          ".###.",
        ],
      },
      body: {
        top: 3,
        rows: [
          ".##.",
          "####",
          "####",
          ".##.",
        ],
      },
      bodyBold: {
        top: 3,
        rows: [
          ".###.",
          "#####",
          "#####",
          ".###.",
        ],
      },
      genova12: {
        top: 5,
        rows: [
          ".##.",
          "####",
          "####",
          ".##.",
        ],
      },
      genova12Bold: {
        top: 5,
        rows: [
          ".###.",
          "#####",
          "#####",
          ".###.",
        ],
      },
      mono: {
        top: 5,
        rows: [
          "###",
          "###",
          "###",
        ],
      },
    },
  },
  {
    char: SHIFT_KEY,
    name: "shift key",
    perFont: {
      // Chicago 12, beside ⌘ in a menu's ⇧⌘S: a hollow arrow on cap height.
      menu: {
        top: 1,
        rows: [
          "....#....",
          "...#.#...",
          "..#...#..",
          ".#.....#.",
          "###...###",
          "..#...#..",
          "..#...#..",
          "..#...#..",
          "..#####..",
        ],
      },
    },
  },
  {
    char: OPTION_KEY,
    name: "option key",
    perFont: {
      // Chicago 12, beside ⌘ in a menu's ⌥⌘S: on the x-height, like the original.
      menu: {
        top: 3,
        rows: [
          "###..####",
          "...#.....",
          "...#.....",
          "....#....",
          "....#....",
          ".....#...",
          ".....####",
        ],
      },
    },
  },
];

for (const def of EXTRA_GLYPHS) {
  if (def.char.length !== 1 || slotForCodePoint(def.char.charCodeAt(0)) < 0) {
    throw new Error(`Extra glyph "${def.name}" needs a page-0 slot in charmap.ts`);
  }
}

/** Page-0 slot of a Mockintosh symbol. */
export function extraGlyphSlot(def: ExtraGlyphDefinition): number {
  return slotForCodePoint(def.char.charCodeAt(0));
}

/** Whether a drawing fits inside the font's glyph cell without widening `maxWidth`. */
export function pixelGlyphFitsFont(font: BitmapFace, glyph: PixelGlyph): boolean {
  const width = glyph.rows[0]?.length ?? 0;
  return (
    width >= 1 &&
    width <= font.maxWidth &&
    glyph.top >= 0 &&
    glyph.top + glyph.rows.length <= font.glyphHeight
  );
}

/**
 * Write a pixel-art glyph into a decoded font's glyph table at `ordinal`.
 * Throws if the drawing doesn't fit the font cell — a glyph that needs more room must be
 * redesigned, never accommodated by widening the font.
 */
export function writePixelGlyph(font: BitmapFace, ordinal: number, glyph: PixelGlyph): void {
  const width = glyph.rows[0]?.length ?? 0;
  if (!pixelGlyphFitsFont(font, glyph)) {
    throw new Error(
      `Glyph ${ordinal} for font "${font.name}" (${width}px wide, rows ${glyph.top}..${glyph.top + glyph.rows.length - 1}) ` +
        `does not fit a ${font.maxWidth}x${font.glyphHeight} cell`
    );
  }
  const byteWidth = Math.ceil(font.maxWidth / 8);
  const base = ordinal * font.glyphStride;
  font.glyphData.fill(0, base, base + font.glyphStride);
  glyph.rows.forEach((row, r) => {
    if (row.length !== width) {
      throw new Error(`Glyph ${ordinal} for font "${font.name}": row ${r} has ragged width`);
    }
    const rowOffset = base + (glyph.top + r + (font.inkAbove ?? 0)) * byteWidth;
    for (let x = 0; x < width; x++) {
      if (row[x] === "#") {
        font.glyphData[rowOffset + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  });
  font.glyphWidths[ordinal] = width;
  if (font.advances) font.advances[ordinal] = width;
  if (font.originX) font.originX[ordinal] = 0;
}

/**
 * Patch every extra glyph that has a drawing for `font.name` into the font,
 * where the font doesn't already draw that character. Symbols without a
 * drawing — or whose drawing doesn't fit the cell, which can happen when a
 * custom font is registered under a built-in name with a smaller cell —
 * are left empty, so `font.ts` falls back to the missing-character box.
 * `extraGlyphs.test.ts` asserts every built-in font draws every symbol.
 */
const EXTRA_FACE_ALIASES: Readonly<Record<string, string>> = {
  "genova/9": "body",
  "chicane/12": "menu",
  "monoco/9": "mono",
  "genova/12": "genova12",
};

function extraGlyphLookupKeys(font: BitmapFace): string[] {
  const keys = [font.name];
  if (font.size != null) {
    const sized = `${font.name}/${font.size}`;
    keys.push(sized);
    const alias = EXTRA_FACE_ALIASES[sized];
    if (alias) keys.push(alias);
  }
  return keys;
}

export function applyExtraGlyphs(font: BitmapFace): BitmapFace {
  const keys = extraGlyphLookupKeys(font);
  for (const def of EXTRA_GLYPHS) {
    const slot = extraGlyphSlot(def);
    if (font.glyphWidths[slot]) continue;
    const glyph = keys.map((key) => def.perFont[key]).find((drawing) => drawing != null);
    if (glyph && pixelGlyphFitsFont(font, glyph)) writePixelGlyph(font, slot, glyph);
  }
  return font;
}

/**
 * Give a face a missing-character box when it has none, sized like Apple's
 * (Geneva 9's is 5×7 on the baseline): what QuickDraw draws for a
 * character the font lacks. `descent` places the baseline in the cell.
 */
export function ensureMissingGlyph(font: BitmapFace, descent: number): BitmapFace {
  if (font.glyphWidths[MISSING_SLOT]) return font;
  const baseline = font.glyphHeight - Math.max(0, Math.min(descent, font.glyphHeight - 1));
  const height = Math.max(3, Math.min(baseline, Math.round(baseline * 0.7)));
  const inkWidth = Math.max(3, Math.round(height * 0.7));
  const width = Math.min(font.maxWidth, inkWidth + (font.spacing > 0 ? 0 : 1));
  if (width < 3) return font;
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    const edge = r === 0 || r === height - 1;
    let row = "";
    for (let x = 0; x < width; x++) {
      const ink = x < inkWidth && (edge ? true : x === 0 || x === inkWidth - 1);
      row += ink ? "#" : ".";
    }
    rows.push(row);
  }
  writePixelGlyph(font, MISSING_SLOT, { top: baseline - height, rows });
  return font;
}
