/**
 * Bake a whole strike from an outline, the way ATM pre-rendered bitmaps:
 * every page-0 slot the font can draw, packed as a `FontStrikeDraft`
 * that Foundry edits and saves as `%%MFN1`.
 */

import { macRomanCharset, slotForCodePoint } from "../charmap";
import type { FontStrikeDraft, FontStrikeGlyph } from "../draft";
import { familyKey } from "../registry";
import { DEFAULT_SCALER_OPTIONS, OutlineFace, type ScalerOptions } from "./scaler";

export interface BakeOptions extends Partial<ScalerOptions> {
  size: number;
  /** Extra columns after every glyph (`spacing`). */
  spacing?: number;
  /** Characters to bake; defaults to Mac OS Roman. */
  chars?: string;
}

export const MIN_BAKE_SIZE = 4;
export const MAX_BAKE_SIZE = 127;

export function clampBakeSize(size: number): number {
  return Math.max(MIN_BAKE_SIZE, Math.min(MAX_BAKE_SIZE, Math.round(size)));
}

export function bakeOutlineStrike(source: Uint8Array | OutlineFace, options: BakeOptions): FontStrikeDraft {
  const face = source instanceof OutlineFace ? source : new OutlineFace(source);
  const scaler: ScalerOptions = { ...DEFAULT_SCALER_OPTIONS, ...options };
  const size = clampBakeSize(options.size);
  const metrics = face.metrics(size);
  const wanted: { cp: number; ordinal: number; gid: number }[] = [];
  for (const ch of options.chars ?? macRomanCharset()) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || cp > 0xffff) continue;
    const ordinal = slotForCodePoint(cp);
    if (ordinal < 0) continue;
    const gid = face.font.glyphId(cp);
    if (gid || cp === 32) wanted.push({ cp, ordinal, gid });
  }
  // A draft has no rows outside its cell, so PreserveGlyph grows the cell instead.
  const room = scaler.preserveGlyph ? face.inkRoom(wanted.map((w) => w.gid), metrics) : { above: 0, below: 0 };
  const glyphs: FontStrikeGlyph[] = [];
  let maxWidth = 1;
  for (const { cp, ordinal, gid } of wanted) {
    const glyph = face.render(gid, metrics, scaler, room);
    const width = Math.min(255, Math.max(cp === 32 ? 1 : 0, glyph.width));
    if (width < 1) continue;
    const pixels = width === glyph.width ? glyph.pixels : resizeRows(glyph.pixels, glyph.width, width, glyph.height);
    maxWidth = Math.max(maxWidth, width);
    glyphs.push({ ordinal, width, pixels });
  }
  return {
    family: familyKey(face.familyName),
    size,
    maxWidth,
    glyphHeight: room.above + metrics.cellHeight + room.below,
    spacing: Math.max(0, Math.round(options.spacing ?? 0)),
    glyphs,
  };
}

function resizeRows(src: Uint8Array, srcW: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const w = Math.min(srcW, width);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * srcW, y * srcW + w), y * width);
  return out;
}
