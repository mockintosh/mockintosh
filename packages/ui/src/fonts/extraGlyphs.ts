/**
 * Mockintosh-specific symbol glyphs that the vendored Decker fonts lack.
 *
 * The fonts in `data.ts` are regenerated from Decker and must never be hand-edited, so
 * extra glyphs are described here as readable pixel art and patched into each decoded
 * font at registration time (see `registry.ts`).
 *
 * Ordinals: Decker uses 10, 32–126 and 127 + index into `DROM_CHARS` (currently up to
 * 240); 255 means "missing". Mockintosh symbols live in the free range above Decker's,
 * starting at `EXTRA_ORDINAL_BASE`, so vendored fonts stay compatible.
 */
import type { DeckerFont } from "./font";

/** First ordinal reserved for Mockintosh symbols (must stay above Decker's `DROM_CHARS`). */
export const EXTRA_ORDINAL_BASE = 241;
/** Ordinal 255 is Decker's "missing glyph" marker and must never be assigned. */
const MAX_ASSIGNABLE_ORDINAL = 254;

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

/**
 * The single source of truth for Mockintosh symbols. Order matters: the ordinal is
 * `EXTRA_ORDINAL_BASE + index`, so only append to this list.
 */
export const EXTRA_GLYPHS: readonly ExtraGlyphDefinition[] = [
  {
    char: COMMAND_KEY,
    name: "command key",
    perFont: {
      // Chicago 12: 2px strokes, caps on rows 1–9. The loops are 1px so the symbol
      // stays open at 10px; it sits one row above cap height like the original.
      menu: {
        top: 0,
        rows: [
          ".##....##.",
          "#..#..#..#",
          "#..#..#..#",
          ".########.",
          "..#....#..",
          "..#....#..",
          ".########.",
          "#..#..#..#",
          "#..#..#..#",
          ".##....##.",
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
      geneva12: {
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
      geneva12Bold: {
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
      menu: {
        top: 1,
        rows: [
          ".........#",
          "........##",
          ".......##.",
          "......##..",
          ".....##...",
          "##..##....",
          ".##.##....",
          "..###.....",
          "...#......",
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
      geneva12: {
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
      geneva12Bold: {
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
      geneva12: {
        top: 5,
        rows: [
          ".##.",
          "####",
          "####",
          ".##.",
        ],
      },
      geneva12Bold: {
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

if (EXTRA_ORDINAL_BASE + EXTRA_GLYPHS.length - 1 > MAX_ASSIGNABLE_ORDINAL) {
  throw new Error("Too many extra glyphs: ordinals would reach Decker's missing-glyph marker");
}

const extraOrdinalByCodeUnit = new Map<number, number>();
EXTRA_GLYPHS.forEach((def, index) => {
  if (def.char.length !== 1) {
    throw new Error(`Extra glyph "${def.name}" must be a single UTF-16 code unit`);
  }
  extraOrdinalByCodeUnit.set(def.char.charCodeAt(0), EXTRA_ORDINAL_BASE + index);
});

/** The symbol at a Mockintosh ordinal, or `undefined` outside the extra range. */
export function extraCharForOrdinal(ordinal: number): string | undefined {
  return EXTRA_GLYPHS[ordinal - EXTRA_ORDINAL_BASE]?.char;
}

/** Ordinal for a Mockintosh symbol, or `undefined` if the code unit isn't one. */
export function extraOrdinalForCharCode(codeUnit: number): number | undefined {
  return extraOrdinalByCodeUnit.get(codeUnit);
}

/** Whether a drawing fits inside the font's glyph cell without widening `maxWidth`. */
export function pixelGlyphFitsFont(font: DeckerFont, glyph: PixelGlyph): boolean {
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
export function writePixelGlyph(font: DeckerFont, ordinal: number, glyph: PixelGlyph): void {
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
    const rowOffset = base + (glyph.top + r) * byteWidth;
    for (let x = 0; x < width; x++) {
      if (row[x] === "#") {
        font.glyphData[rowOffset + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  });
  font.glyphWidths[ordinal] = width;
}

/**
 * Patch every extra glyph that has a drawing for `font.name` into the font.
 * Symbols without a drawing for this font — or whose drawing doesn't fit the cell, which can
 * happen when a custom font is registered under a built-in name with a smaller cell — are
 * left empty, so `font.ts` falls back to `?`. `extraGlyphs.test.ts` asserts every built-in
 * font actually receives every symbol.
 */
const EXTRA_FACE_ALIASES: Readonly<Record<string, string>> = {
  "geneva/9": "body",
  "chicago/12": "menu",
  "monaco/9": "mono",
  "geneva/12": "geneva12",
};

function extraGlyphLookupKeys(font: DeckerFont): string[] {
  const keys = [font.name];
  if (font.size != null) {
    const sized = `${font.name}/${font.size}`;
    keys.push(sized);
    const alias = EXTRA_FACE_ALIASES[sized];
    if (alias) keys.push(alias);
  }
  return keys;
}

export function applyExtraGlyphs(font: DeckerFont): DeckerFont {
  const keys = extraGlyphLookupKeys(font);
  EXTRA_GLYPHS.forEach((def, index) => {
    const glyph = keys.map((key) => def.perFont[key]).find((drawing) => drawing != null);
    if (glyph && pixelGlyphFitsFont(font, glyph)) {
      writePixelGlyph(font, EXTRA_ORDINAL_BASE + index, glyph);
    }
  });
  return font;
}
