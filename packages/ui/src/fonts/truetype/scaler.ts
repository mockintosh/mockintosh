/**
 * The outline scaler: one `OutlineFace` per font file, rendering one glyph
 * at a time into 1-bit cells the Decker strike format can hold.
 *
 * Cell layout matches Foundry's baked strikes: the cell is
 * `ascent + descent` rows with the baseline at row `ascent`; a glyph's
 * cell width is its rounded advance, widened only when ink overhangs it.
 */

import { computeHintGlobals, placeGlyph, type HintGlobals } from "./autohint";
import { downsample, scanConvert } from "./raster";
import { parseSfnt, type SfntFont } from "./sfnt";
import { charForOrdinal } from "../font";

export interface ScalerOptions {
  /** Grid-fit with the autohinter at or below `hintMaxPpem`. */
  hint: boolean;
  hintMaxPpem: number;
  /** Keep stems thinner than a pixel (SCANTYPE 1 dropout control). */
  dropout: boolean;
  /**
   * `SetPreserveGlyph`. True keeps a tall glyph's shape and lets its ink
   * leave the line box (Å's ring draws above the line; line height is
   * unchanged). False, the System 7 compatibility default, squeezes it to fit.
   */
  preserveGlyph: boolean;
  /** Render at N× and box-filter down (Foundry's x2 / x3); 1 = direct. */
  oversample: number;
  /** 0–255 coverage threshold, used only when `oversample > 1`. */
  threshold: number;
}

export const DEFAULT_SCALER_OPTIONS: Readonly<ScalerOptions> = {
  hint: true,
  hintMaxPpem: 40,
  dropout: true,
  preserveGlyph: true,
  oversample: 1,
  threshold: 96,
};

export interface StrikeMetrics {
  ppem: number;
  scale: number;
  ascent: number;
  descent: number;
  leading: number;
  cellHeight: number;
}

export interface GlyphCell {
  /** Rounded advance in pixels. */
  advance: number;
  /** Columns added left of the origin for ink with a negative side bearing. */
  padL: number;
  /** Cell width: `max(advance, ink right) + padL`. */
  width: number;
}

/** Rows a render reserves outside the cell, for ink that leaves the line box. */
export interface InkRoom {
  above: number;
  below: number;
}

export interface RenderedGlyph extends GlyphCell {
  height: number;
  /** Row-major 0/1, `width × height`. */
  pixels: Uint8Array;
}

let nextFaceId = 1;

export class OutlineFace {
  readonly id = nextFaceId++;
  readonly font: SfntFont;
  private hintGlobals: HintGlobals | undefined;

  constructor(readonly bytes: Uint8Array) {
    this.font = parseSfnt(bytes);
  }

  get familyName(): string {
    return this.font.familyName;
  }

  globals(): HintGlobals {
    return (this.hintGlobals ??= computeHintGlobals(this.font));
  }

  /**
   * The line box at `ppem`. Its height is the font's own line spacing
   * (`hhea` ascender − descender + line gap), so the gap is inside the line
   * rather than FontInfo leading. The ascent covers the tallest character a
   * strike holds (accented capitals), paid for from the line gap first: fonts
   * that split one em between ascender and descender (Adobe's convention)
   * keep their accent room there. Descent takes the rest, and at least the
   * font's descender and its deepest glyph, so accents beyond the gap grow the line. Ink outside this box is only characters beyond Decker's
   * 256 (see {@link inkRoom}).
   */
  metrics(ppem: number): StrikeMetrics {
    const f = this.font;
    const scale = ppem / f.unitsPerEm;
    const extent = this.romanExtent();
    const line = Math.round((f.ascender - f.descender + Math.max(0, f.lineGap)) * scale);
    const ascent = Math.max(1, Math.round(f.ascender * scale), Math.ceil(extent.top * scale));
    const descent = Math.max(0, line - ascent, Math.round(-f.descender * scale), Math.ceil(-extent.bottom * scale));
    return { ppem, scale, ascent, descent, leading: 0, cellHeight: ascent + descent };
  }

  private extent: { top: number; bottom: number } | undefined;

  /** Highest and lowest ink, in font units, among the characters a page-0 strike holds. */
  private romanExtent(): { top: number; bottom: number } {
    if (this.extent) return this.extent;
    let top = 0;
    let bottom = 0;
    for (let ord = 32; ord < 256; ord++) {
      const ch = charForOrdinal(ord);
      const gid = ch ? this.font.glyphId(ch.codePointAt(0)!) : 0;
      if (!gid) continue;
      const b = this.font.bounds(gid);
      if (b.yMax <= b.yMin) continue;
      top = Math.max(top, b.yMax);
      bottom = Math.min(bottom, b.yMin);
    }
    return (this.extent = { top, bottom });
  }

  cell(gid: number, metrics: StrikeMetrics): GlyphCell {
    const f = this.font;
    const advance = Math.max(0, Math.round(f.advance(gid) * metrics.scale));
    const b = f.bounds(gid);
    if (b.xMax <= b.xMin) return { advance, padL: 0, width: advance };
    const inkL = Math.floor(b.xMin * metrics.scale);
    const inkR = Math.ceil(b.xMax * metrics.scale);
    const padL = Math.max(0, -inkL);
    return { advance, padL, width: Math.max(advance, inkR) + padL };
  }

  /**
   * Rows `gids` need outside the cell to keep their shape (from bounding
   * boxes, plus one for grid-fitting), capped at one cell each way.
   */
  inkRoom(gids: Iterable<number>, metrics: StrikeMetrics): InkRoom {
    let above = 0;
    let below = 0;
    for (const gid of gids) {
      if (!gid) continue;
      const b = this.font.bounds(gid);
      if (b.yMax <= b.yMin) continue;
      const top = Math.ceil(b.yMax * metrics.scale);
      const bottom = Math.ceil(-b.yMin * metrics.scale);
      if (top > metrics.ascent) above = Math.max(above, top - metrics.ascent + 1);
      if (bottom > metrics.descent) below = Math.max(below, bottom - metrics.descent + 1);
    }
    const cap = metrics.cellHeight;
    return { above: Math.min(above, cap), below: Math.min(below, cap) };
  }

  /** Pair kerning in whole pixels at this size. */
  kerning(left: number, right: number, metrics: StrikeMetrics): number {
    if (!this.font.hasKerning) return 0;
    return Math.round(this.font.kerning(left, right) * metrics.scale);
  }

  /**
   * One glyph as rows `-room.above … cellHeight + room.below` of its cell.
   * With PreserveGlyph on, ink beyond that room is clipped; off, it is squeezed in.
   */
  render(
    gid: number,
    metrics: StrikeMetrics,
    options: ScalerOptions = DEFAULT_SCALER_OPTIONS,
    room: InkRoom = { above: 0, below: 0 },
  ): RenderedGlyph {
    const cell = this.cell(gid, metrics);
    const height = room.above + metrics.cellHeight + room.below;
    const glyph = this.font.glyph(gid);
    if (glyph.contours.length === 0 || cell.width === 0) {
      return { ...cell, height, pixels: new Uint8Array(cell.width * height) };
    }
    const factor = Math.max(1, Math.round(options.oversample));
    const ppem = metrics.ppem * factor;
    const scale = metrics.scale * factor;
    let yScale = 1;
    if (!options.preserveGlyph) {
      const top = glyph.yMax * metrics.scale;
      const bottom = -glyph.yMin * metrics.scale;
      if (top > metrics.ascent + 0.5 && top > 0) yScale = Math.min(yScale, metrics.ascent / top);
      if (bottom > metrics.descent + 0.5 && bottom > 0) yScale = Math.min(yScale, Math.max(metrics.descent, 0.5) / bottom);
    }
    const hinted = options.hint && metrics.ppem <= options.hintMaxPpem && factor === 1;
    const contours = placeGlyph(glyph, scale, yScale, ppem, hinted ? this.globals() : undefined);
    const bigW = cell.width * factor;
    const bigH = height * factor;
    const bits = scanConvert(
      contours,
      { width: bigW, height: bigH, originX: cell.padL * factor, baseline: (room.above + metrics.ascent) * factor },
      { dropout: options.dropout && factor === 1 },
    );
    if (factor === 1) return { ...cell, height, pixels: bits };
    const down = downsample(bits, bigW, bigH, factor, options.threshold);
    return { ...cell, height, pixels: down.pixels };
  }
}

/** Parse a TTF / OTF / TTC once; throws with a user-facing message on failure. */
export function openOutlineFace(bytes: Uint8Array): OutlineFace {
  return new OutlineFace(bytes);
}
