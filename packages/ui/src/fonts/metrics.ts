/**
 * Host-font face metrics — FontInfo for `<text>` alignment, distinct from
 * the QuickDraw strike.
 *
 * `verticalAlign="middle"` is the Control Manager rule: center
 * `ascent + descent + leading` in the box, then `MoveTo` the baseline.
 * Built-in faces use the System 6 FONT headers. Custom fonts fall
 * back to an ink-derived split of the cell.
 *
 * Cap ink (`capAscent`) only maps that baseline onto the cell.
 * Strike packing still uses `uiFontMetrics` (`ascent = glyphHeight`).
 */

import {
  getGlyphPixel,
  getGlyphWidth,
  hasGlyph,
  type BitmapFace,
} from "./font";
import { lookupFontInfo, requireFont } from "./registry";

/** `GetFontInfo` integers — what the CDEF / WDEF / MDEF actually read. */
export interface FontInfo {
  ascent: number;
  descent: number;
  leading: number;
}

/**
 * System 6 `'FONT'` / `'NFNT'` headers for the shipped faces. Chicago 12 is
 * System 6.0.8's FONT 12 (System 7's NFNT 5478 is the same): 12/3/1, a
 * 16px line. Pixel-checked against `public/ok-button-map.txt` (20px face →
 * baseline 14 → caps on rows 5–13).
 */
const SYSTEM_FONT_INFO: Readonly<Record<string, FontInfo>> = {
  menu: { ascent: 12, descent: 3, leading: 1 }, // Chicago 12
  body: { ascent: 10, descent: 2, leading: 0 }, // Geneva 9
  bodyBold: { ascent: 10, descent: 2, leading: 0 }, // Geneva 9 Bold (FM smear)
  geneva12: { ascent: 12, descent: 3, leading: 1 }, // FONT 396
  geneva12Bold: { ascent: 12, descent: 3, leading: 1 }, // FONT 396 Bold (FM smear)
  mono: { ascent: 9, descent: 2, leading: 0 }, // Monaco 9
  lisa: { ascent: 10, descent: 2, leading: 0 }, // LisaTerminal Paper Raw
};

export interface FontFaceMetrics extends FontInfo {
  /** Cell height — QuickDraw line box and wrapped-text advance. */
  cellHeight: number;
  /** Cell top → scanline just below typical A–Z. Maps FontInfo baseline → cell. */
  capAscent: number;
  /** First ink row of typical A–Z (median; ignores Q tails). */
  capTop: number;
  /** Typical A–Z ink height. */
  capHeight: number;
  /** `ascent + descent + leading` — the CDEF line box. */
  lineHeight: number;
}

const cache = new WeakMap<BitmapFace, FontFaceMetrics>();

export function faceMetrics(font: BitmapFace): FontFaceMetrics {
  const cached = cache.get(font);
  if (cached) return cached;
  const computed = computeFaceMetrics(font);
  cache.set(font, computed);
  return computed;
}

export function faceMetricsByName(fontName: string = "body", size?: number): FontFaceMetrics {
  return faceMetrics(requireFont(fontName, size));
}

/**
 * Height of the box `<text>` measure and `verticalAlign` share.
 * `blockHeight` is the trimmed block (`layoutText`). Single-line `middle`
 * still uses the FontInfo line box so a CDEF face can center the full
 * ascent + descent + leading.
 */
export function alignmentHeight(
  font: BitmapFace,
  lineCount: number,
  blockHeight: number,
  verticalAlign: "top" | "middle" | "bottom" = "top"
): number {
  if (verticalAlign === "middle" && lineCount === 1) {
    return faceMetrics(font).lineHeight;
  }
  return blockHeight;
}

/**
 * CDEF 0's baseline in a box (System 6.0.8 / 7.0.1, the same code):
 * `v = bottom − ((h − (ascent+descent+leading)) asr 1) − leading − descent`.
 * The line is centred with the odd pixel above it.
 */
export function cdefBaseline(top: number, height: number, m: FontFaceMetrics): number {
  return top + height - ((height - m.lineHeight) >> 1) - m.leading - m.descent;
}

/** Cell top so caps sit on {@link cdefBaseline}. */
export function middleCellTop(top: number, height: number, m: FontFaceMetrics): number {
  return cdefBaseline(top, height, m) - m.capAscent;
}

function computeFaceMetrics(font: BitmapFace): FontFaceMetrics {
  const cellHeight = font.glyphHeight;
  const caps = scanTypicalCapInk(font);
  const capTop = caps?.minY ?? 0;
  const capHeight = caps ? caps.maxY - caps.minY + 1 : cellHeight;
  const capAscent = caps ? Math.min(cellHeight, caps.maxY + 1) : cellHeight;
  const header = lookupFontInfo(font) ?? SYSTEM_FONT_INFO[font.name];
  const info: FontInfo = header ?? {
    ascent: capAscent,
    descent: cellHeight - capAscent,
    leading: 0,
  };
  const pad = font.outlinePad ?? 0;
  const drop = font.shadowPad ?? 0;
  const ascent = info.ascent + pad;
  const descent = info.descent + pad + drop;
  return {
    cellHeight,
    ascent,
    descent,
    leading: info.leading,
    capAscent,
    capTop,
    capHeight,
    lineHeight: ascent + descent + info.leading,
  };
}

/**
 * Typical A–Z ink, not the union. `Q`'s tail is a one-off descender and
 * must not pull the cap baseline down a row.
 */
function scanTypicalCapInk(font: BitmapFace): { minY: number; maxY: number } | null {
  const minYs: number[] = [];
  const maxYs: number[] = [];
  for (let ord = 65; ord <= 90; ord++) {
    if (!hasGlyph(font, ord)) continue;
    const range = glyphInkY(font, ord);
    if (!range) continue;
    minYs.push(range.minY);
    maxYs.push(range.maxY);
  }
  if (maxYs.length === 0) return null;
  return { minY: median(minYs), maxY: median(maxYs) };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : sorted[mid - 1]!;
}

function glyphInkY(
  font: BitmapFace,
  glyphIndex: number
): { minY: number; maxY: number } | null {
  const width = getGlyphWidth(font, glyphIndex);
  if (width <= 0) return null;
  let minY = font.glyphHeight;
  let maxY = -1;
  for (let y = 0; y < font.glyphHeight; y++) {
    for (let x = 0; x < width; x++) {
      if (getGlyphPixel(font, glyphIndex, x, y)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        break;
      }
    }
  }
  return maxY < 0 ? null : { minY, maxY };
}
