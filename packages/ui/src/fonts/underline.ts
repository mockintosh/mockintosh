/**
 * Underlines on the face's own baseline.
 *
 * The strike puts QuickDraw's baseline at the Decker cell bottom, below the
 * descenders, so DrawText's underline would run under the whole cell and
 * touch the next line. The UI draws it instead, one row below the cap
 * baseline (`capAscent`), with DrawText's 1-px halo around descender ink
 * (`DrawText.a:720-775`: rows baseline, +1 and +2, smeared a pixel each way).
 */

import { EraseRect, PaintRect } from "@mockintosh/quickdraw";
import { makeRect } from "@mockintosh/quickdraw/bits";
import { charAdvance, getGlyphIndexForChar, getGlyphPixel, getGlyphWidth, textAdvance, type DeckerFont } from "./font";
import { faceMetrics } from "./metrics";

/** Pixels `[left, right)` of an underline, measured from the pen. */
export interface UnderlineSpan {
  left: number;
  right: number;
}

/** Cell row the underline is drawn on. */
export function underlineRow(font: DeckerFont): number {
  return faceMetrics(font).capAscent + 1;
}

/** Where `text`'s underline is drawn: its advance, minus the halo around ink that crosses it. */
export function underlineSpans(font: DeckerFont, text: string): UnderlineSpan[] {
  const width = textAdvance(font, text);
  if (width <= 0) return [];
  const row = underlineRow(font);
  const rows = faceMetrics(font).descent > 2 ? [row - 1, row, row + 1] : [row - 1, row];
  const ink = new Uint8Array(width + 2);
  let pen = 0;
  for (const ch of text) {
    const glyph = getGlyphIndexForChar(font, ch);
    if (glyph >= 0) {
      const glyphWidth = getGlyphWidth(font, glyph);
      for (let x = 0; x < glyphWidth && pen + x < width; x++) {
        if (rows.some((y) => getGlyphPixel(font, glyph, x, y))) ink[pen + x + 1] = 1;
      }
    }
    pen += charAdvance(font, ch);
  }
  const spans: UnderlineSpan[] = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const clear = x < width && !ink[x] && !ink[x + 1] && !ink[x + 2];
    if (clear && start < 0) start = x;
    if (!clear && start >= 0) {
      spans.push({ left: start, right: x });
      start = -1;
    }
  }
  return spans;
}

/** Paint `text`'s underline for a line whose cell top-left is `(x, cellTop)`, in black or white. */
export function drawUnderline(font: DeckerFont, text: string, x: number, cellTop: number, color: number): void {
  const y = cellTop + underlineRow(font);
  for (const span of underlineSpans(font, text)) {
    const rect = makeRect(y, x + span.left, y + 1, x + span.right);
    if (color) PaintRect(rect);
    else EraseRect(rect);
  }
}
