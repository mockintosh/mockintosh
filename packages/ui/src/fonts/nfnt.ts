/**
 * Placing a Decker strike's glyphs as a Mac font's offset/width table does.
 *
 * A `%%FNT1` strike draws each glyph's cell at the pen and advances by the
 * cell plus a uniform `spacing`. A Mac FONT/NFNT draws each image `offset`
 * pixels right of the pen and advances by its own `width`, so most Chicago
 * glyphs sit one pixel in and a few (T, r, f, 1, I, …) are narrower or wider.
 * `applyNfntMetrics` moves each glyph's ink to its offset inside the cell and
 * gives it its real advance, keeping `spacing` as the face's nominal gap: a
 * re-spaced copy (`~sN`) still changes every gap by the same amount.
 */
import type { DeckerFont } from "./font";

/** [image width, offset, advance] per ordinal, spacing included in the advance. */
export type NfntMetrics = Readonly<Record<number, readonly [number, number, number]>>;

/** Columns of `glyph` that hold ink, as [first, last], or null for a blank glyph. */
function inkColumns(font: DeckerFont, glyph: number, byteWidth: number, rows: number): [number, number] | null {
  let first = -1;
  let last = -1;
  const base = glyph * font.glyphStride;
  for (let x = 0; x < font.glyphWidths[glyph]!; x++) {
    for (let y = 0; y < rows; y++) {
      if (font.glyphData[base + y * byteWidth + (x >> 3)]! & (0x80 >> (x & 7))) {
        if (first < 0) first = x;
        last = x;
        break;
      }
    }
  }
  return first < 0 ? null : [first, last];
}

/**
 * Re-lay `font`'s glyphs: those in `metrics` at their offset with their
 * advance; every other inked glyph `defaultOffset` pixels in with as much
 * after it; blank ones advance as before.
 * Returns ordinals whose ink width disagrees with `metrics` (left untouched).
 */
export function applyNfntMetrics(font: DeckerFont, metrics: NfntMetrics, defaultOffset: number): number[] {
  const byteWidth = Math.ceil(font.maxWidth / 8);
  const rows = font.glyphHeight + (font.inkAbove ?? 0) + (font.inkBelow ?? 0);
  const advances = font.advances ?? font.glyphWidths.slice();
  const mismatched: number[] = [];
  let maxWidth = font.maxWidth;
  const placed: { glyph: number; from: number; to: number; ink: number }[] = [];

  for (let glyph = 0; glyph < 256; glyph++) {
    const cell = font.glyphWidths[glyph]!;
    if (cell < 1) continue;
    const ink = inkColumns(font, glyph, byteWidth, rows);
    const inkWidth = ink ? ink[1] - ink[0] + 1 : 0;
    const real = metrics[glyph];
    if (real && real[0] !== inkWidth) {
      mismatched.push(glyph);
      continue;
    }
    const offset = real ? real[1] : ink ? defaultOffset : 0;
    // Unlisted glyphs follow the font's own rule: `defaultOffset` on either side of the ink.
    const advance = real ? real[2] - font.spacing : ink ? 2 * defaultOffset + inkWidth - font.spacing : advances[glyph]!;
    const width = Math.max(1, offset + inkWidth);
    maxWidth = Math.max(maxWidth, width);
    advances[glyph] = Math.max(0, advance);
    placed.push({ glyph, from: ink?.[0] ?? 0, to: offset, ink: inkWidth });
    font.glyphWidths[glyph] = width;
  }

  if (maxWidth !== font.maxWidth) throw new Error(`NFNT metrics need a ${maxWidth}px cell; the strike's is ${font.maxWidth}`);
  const data = font.glyphData;
  const moved = new Uint8Array(data.length);
  moved.set(data);
  for (const { glyph, from, to, ink } of placed) {
    const base = glyph * font.glyphStride;
    for (let y = 0; y < rows; y++) {
      const row = base + y * byteWidth;
      for (let b = 0; b < byteWidth; b++) moved[row + b] = 0;
      for (let x = 0; x < ink; x++) {
        const sx = from + x;
        if (data[row + (sx >> 3)]! & (0x80 >> (sx & 7))) moved[row + ((to + x) >> 3)]! |= 0x80 >> ((to + x) & 7);
      }
    }
  }
  font.glyphData = moved;
  font.advances = advances;
  return mismatched;
}
