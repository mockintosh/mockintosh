/**
 * Drawing terminal cells into a 1-byte-per-pixel buffer, row by row. A row
 * is drawn again only when what it shows changes (its text and styles, the
 * selection over it, the cursor on it), so a blinking cursor redraws one
 * row and streaming output the rows it touched.
 */
import { getFont, getGlyphIndexForChar, getGlyphPixel, getGlyphWidth, type DeckerFont } from "@mockintosh/ui";
import { CELL_HEIGHT, CELL_WIDTH, proceduralGlyph } from "../glyphs";
import type { TerminalFrame, TerminalRow } from "../screen";
import type { CellStyle } from "../style";

export const PAD_X = 2;
export const PAD_Y = 1;
const UNDERLINE_ROW = 9;
const STRIKE_ROW = 5;

export type CursorShape = "block" | "hollow" | "none";

export interface RowOverlay {
  /** Selected columns [from, to) on this row. */
  selection?: [number, number];
  cursor?: { col: number; width: 1 | 2; shape: CursorShape };
}

export function gridSize(width: number, height: number): { cols: number; rows: number } {
  return {
    cols: Math.max(2, Math.floor((width - PAD_X * 2) / CELL_WIDTH)),
    rows: Math.max(1, Math.floor((height - PAD_Y * 2) / CELL_HEIGHT)),
  };
}

const glyphCache = new Map<string, Uint8Array>();
let cachedFont: DeckerFont | null = null;

function monoFont(): DeckerFont | null {
  if (!cachedFont) cachedFont = getFont("mono");
  return cachedFont;
}

/** A hollow box: the font's own sign for a character it doesn't have. */
function missingGlyph(width: 1 | 2): Uint8Array {
  const w = CELL_WIDTH * width;
  const p = new Uint8Array(w * CELL_HEIGHT);
  for (let y = 2; y <= 8; y++)
    for (let x = 0; x < w - 1; x++) if (y === 2 || y === 8 || x === 0 || x === w - 2) p[y * w + x] = 1;
  return p;
}

function fontGlyph(font: DeckerFont, ch: string): Uint8Array | null {
  const index = getGlyphIndexForChar(font, ch);
  if (index < 0 || (index === 63 && ch !== "?")) return null;
  const p = new Uint8Array(CELL_WIDTH * CELL_HEIGHT);
  const w = Math.min(CELL_WIDTH, getGlyphWidth(font, index));
  for (let y = 0; y < CELL_HEIGHT; y++)
    for (let x = 0; x < w; x++) if (getGlyphPixel(font, index, x, y)) p[y * CELL_WIDTH + x] = 1;
  return p;
}

/** The pixels for one cell's character: procedural, from Monaco, by its compatibility form, or the missing box. */
export function glyphFor(text: string, width: 1 | 2, ox: number, oy: number): Uint8Array | null {
  if (!text || text === " ") return null;
  const cp = text.codePointAt(0)!;
  const procedural = proceduralGlyph(cp, ox, oy);
  if (procedural) return width === 2 ? widen(procedural) : procedural;
  const key = `${text}\u0000${width}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const font = monoFont();
  let glyph: Uint8Array | null = null;
  if (font && width === 1) {
    glyph = fontGlyph(font, String.fromCodePoint(cp));
    if (!glyph) {
      // 𝒇 is f, ﬁ is fi (first letter will do), ① is 1.
      const plain = String.fromCodePoint(cp).normalize("NFKC");
      if (plain && plain.codePointAt(0)! < 0x2000) glyph = fontGlyph(font, plain[0]!);
    }
  }
  glyph ??= missingGlyph(width);
  glyphCache.set(key, glyph);
  return glyph;
}

function widen(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(CELL_WIDTH * 2 * CELL_HEIGHT);
  for (let y = 0; y < CELL_HEIGHT; y++)
    for (let x = 0; x < CELL_WIDTH * 2; x++) out[y * CELL_WIDTH * 2 + x] = p[y * CELL_WIDTH + (x >> 1)]!;
  return out;
}

function paperInk(style: CellStyle, ax: number, ay: number): 0 | 1 {
  switch (style.paper) {
    case "white": return 0;
    case "black": return 1;
    case "light": return ax % 2 === 0 && ay % 2 === 0 ? 1 : 0;
  }
}

/**
 * Draw `row` at grid row `y` into `pix` (`stride` bytes per pixel row).
 */
export function drawRow(pix: Uint8Array, stride: number, y: number, row: TerminalRow, overlay: RowOverlay): void {
  const top = PAD_Y + y * CELL_HEIGHT;
  const cols = row.cells.length;
  for (let x = 0; x < cols; x++) {
    const cell = row.cells[x]!;
    if (cell.width === 0) continue;
    const width = (cell.width === 2 ? 2 : 1) as 1 | 2;
    const left = PAD_X + x * CELL_WIDTH;
    const w = CELL_WIDTH * width;
    if (left + w > stride) break;
    const style = cell.style;
    const glyph = style.invisible ? null : glyphFor(cell.text, width, left, top);
    const glyphStride = glyph && glyph.length === CELL_WIDTH * 2 * CELL_HEIGHT ? CELL_WIDTH * 2 : CELL_WIDTH;
    const ink = style.ink === "black" ? 1 : 0;
    for (let gy = 0; gy < CELL_HEIGHT; gy++) {
      const ay = top + gy;
      const base = ay * stride;
      for (let gx = 0; gx < w; gx++) {
        const ax = left + gx;
        let on = false;
        if (glyph && gx < glyphStride) {
          on = glyph[gy * glyphStride + gx] === 1;
          // Bold: QuickDraw's smear, one pixel to the right, kept in the cell.
          if (!on && style.bold && gx > 0) on = glyph[gy * glyphStride + gx - 1] === 1;
        }
        if ((style.underline && gy === UNDERLINE_ROW) || (style.strikethrough && gy === STRIKE_ROW)) on = true;
        // `style.dim` draws in plain ink: any pattern knocked out of Monaco 9's
        // one-pixel strokes breaks letters (see CellStyle.dim).
        pix[base + ax] = on ? ink : paperInk(style, ax, ay);
      }
    }
  }
  // Columns past the last cell (a wide character's right half was skipped above) keep their paper.
  if (overlay.selection) invertCells(pix, stride, y, overlay.selection[0], overlay.selection[1]);
  const cursor = overlay.cursor;
  if (cursor && cursor.shape !== "none") {
    if (cursor.shape === "block") invertCells(pix, stride, y, cursor.col, cursor.col + cursor.width);
    else outlineCells(pix, stride, y, cursor.col, cursor.col + cursor.width);
  }
}

function invertCells(pix: Uint8Array, stride: number, y: number, from: number, to: number): void {
  const top = PAD_Y + y * CELL_HEIGHT;
  const x0 = PAD_X + from * CELL_WIDTH, x1 = PAD_X + to * CELL_WIDTH;
  for (let ay = top; ay < top + CELL_HEIGHT; ay++) {
    const base = ay * stride;
    for (let ax = x0; ax < x1; ax++) pix[base + ax] = pix[base + ax] ? 0 : 1;
  }
}

function outlineCells(pix: Uint8Array, stride: number, y: number, from: number, to: number): void {
  const top = PAD_Y + y * CELL_HEIGHT, bottom = top + CELL_HEIGHT - 1;
  const x0 = PAD_X + from * CELL_WIDTH, x1 = PAD_X + to * CELL_WIDTH - 1;
  for (let ax = x0; ax <= x1; ax++) {
    pix[top * stride + ax] = 1;
    pix[bottom * stride + ax] = 1;
  }
  for (let ay = top; ay <= bottom; ay++) {
    pix[ay * stride + x0] = 1;
    pix[ay * stride + x1] = 1;
  }
}

/** A frame's rows drawn into a pixel buffer that survives between paints. */
export class GridPainter {
  pixels: Uint8Array;
  private keys: string[] = [];

  constructor(public width: number, public height: number) {
    this.pixels = new Uint8Array(width * height);
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
    this.keys = [];
  }

  /** Draw the rows whose content or overlay changed. Returns how many were drawn. */
  paint(frame: TerminalFrame, overlays: (y: number) => RowOverlay): number {
    let drawn = 0;
    const rows = Math.min(frame.rows.length, Math.floor((this.height - PAD_Y * 2) / CELL_HEIGHT));
    for (let y = 0; y < rows; y++) {
      const row = frame.rows[y]!;
      const overlay = overlays(y);
      const key = `${row.key}\u0002${overlay.selection?.join(",") ?? ""}\u0002${overlay.cursor ? `${overlay.cursor.col}${overlay.cursor.shape}${overlay.cursor.width}` : ""}`;
      if (this.keys[y] === key) continue;
      this.keys[y] = key;
      drawRow(this.pixels, this.width, y, row, overlay);
      drawn++;
    }
    return drawn;
  }

  /** Force every row to draw again (fonts changed, a flash ended). */
  invalidate(): void {
    this.keys = [];
  }
}
