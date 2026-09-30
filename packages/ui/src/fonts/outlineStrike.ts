/**
 * Outline-scaled strikes: what the Font Manager hands QuickDraw when a
 * family has an outline (`'sfnt'`) but no bitmap strike at the requested size.
 *
 * Like the System 7 scaler, glyphs are rendered only when first drawn or
 * measured for ink; widths come straight from the font's metrics, so
 * layout never waits on rasterizing. Page 0 holds Decker's 256 ordinals
 * (ASCII, `DROM_CHARS`, Mockintosh symbols); every other character lives on
 * a page strike keyed by `codePoint >> 8`, created on demand.
 */

import { deckerOrdinalForCharCode } from "./drom";
import { extraOrdinalForCharCode } from "./extraGlyphs";
import { charForOrdinal, getGlyphWidth, type DeckerFont, type OutlineGlyphSource } from "./font";
import type { OutlineFace, ScalerOptions } from "./truetype/scaler";

/** Per-family scaler switches (a suitcase's options block). */
export interface FamilyScalerSettings extends ScalerOptions {
  /** Apply the font's pair kerning in UI text. */
  kerning: boolean;
  /** `SetOutlinePreferred`: use the outline even where a bitmap strike exists. */
  preferOutline: boolean;
}

/** Separates a family from its page number in a `TextFont` name. */
const PAGE_MARK = "\u0001p";

export function pageFaceKey(family: string, page: number): string {
  return page === 0 ? family : `${family}${PAGE_MARK}${page}`;
}

export function parsePageFaceKey(name: string): { family: string; page: number } {
  const at = name.indexOf(PAGE_MARK);
  if (at < 0) return { family: name, page: 0 };
  return { family: name.slice(0, at), page: Number(name.slice(at + PAGE_MARK.length)) || 0 };
}

/** Page strike holding a code point outside Decker's ordinals. */
function pageOfCodePoint(codePoint: number): number {
  return (codePoint >> 8) + 1;
}

function codePointForSlot(page: number, ordinal: number): number | undefined {
  if (page > 0) return ((page - 1) << 8) | ordinal;
  const ch = charForOrdinal(ordinal);
  return ch === undefined ? undefined : ch.codePointAt(0);
}

function deckerOrdinal(codePoint: number): number {
  if (codePoint > 0xffff) return 255;
  const ord = deckerOrdinalForCharCode(codePoint);
  if (ord !== 255) return ord;
  return extraOrdinalForCharCode(codePoint) ?? 255;
}

export interface OutlineStrikeRequest {
  family: string;
  face: OutlineFace;
  ppem: number;
  page: number;
  settings: FamilyScalerSettings;
  /** Sibling page strike of the same face and size (the registry's cache). */
  pageStrike(page: number): DeckerFont | null;
}

export function createOutlineStrike(req: OutlineStrikeRequest): DeckerFont {
  const { face, ppem, page, settings } = req;
  const metrics = face.metrics(ppem);
  const gids = new Int32Array(256);
  const glyphWidths = new Uint8Array(256);
  const advances = new Uint8Array(256);
  const originX = new Uint8Array(256);
  let maxWidth = 1;
  for (let ord = 0; ord < 256; ord++) {
    const cp = codePointForSlot(page, ord);
    if (cp === undefined || cp === 10) continue;
    const gid = face.font.glyphId(cp);
    if (!gid && cp !== 32) continue;
    const cell = face.cell(gid, metrics);
    const width = Math.min(255, cp === 32 ? Math.max(1, cell.width) : cell.width);
    if (width < 1) continue;
    gids[ord] = gid;
    glyphWidths[ord] = width;
    advances[ord] = Math.min(255, cell.advance);
    originX[ord] = Math.min(255, cell.padL);
    maxWidth = Math.max(maxWidth, width);
  }
  const glyphHeight = Math.max(1, metrics.cellHeight);
  // PreserveGlyph: rows outside the line box for ink that leaves it (Å, Ç).
  const room = settings.preserveGlyph ? face.inkRoom(gids, metrics) : { above: 0, below: 0 };
  const rows = room.above + glyphHeight + room.below;
  const byteWidth = Math.ceil(maxWidth / 8);
  const glyphStride = byteWidth * rows;
  const glyphData = new Uint8Array(256 * glyphStride);
  const filled = new Uint8Array(256);
  for (let ord = 0; ord < 256; ord++) if (glyphWidths[ord] === 0) filled[ord] = 1;

  const font: DeckerFont = {
    name: pageFaceKey(req.family, page),
    size: ppem,
    maxWidth,
    glyphHeight,
    spacing: 0,
    glyphStride,
    glyphWidths,
    glyphData,
    advances,
    originX,
    ...(room.above ? { inkAbove: room.above } : {}),
    ...(room.below ? { inkBelow: room.below } : {}),
    sourceFormat: "FNT1",
    fontInfo: { ascent: metrics.ascent, descent: metrics.descent, leading: metrics.leading },
  };

  const source: OutlineGlyphSource = {
    filled,
    faceKey: font.name,
    fill(ord) {
      if (filled[ord]) return;
      filled[ord] = 1;
      const width = glyphWidths[ord]!;
      const glyph = face.render(gids[ord]!, metrics, settings, room);
      const w = Math.min(width, glyph.width);
      const base = ord * glyphStride;
      for (let y = 0; y < rows && y < glyph.height; y++) {
        const src = y * glyph.width;
        const row = base + y * byteWidth;
        for (let x = 0; x < w; x++) {
          if (glyph.pixels[src + x]) glyphData[row + (x >> 3)] |= 1 << (7 - (x & 7));
        }
      }
    },
    locate(codePoint) {
      const ord = deckerOrdinal(codePoint);
      if (ord !== 255) {
        if (page === 0) return getGlyphWidth(font, ord) > 0 ? { font, ordinal: ord } : undefined;
        const home = req.pageStrike(0);
        return home?.outline?.locate(codePoint);
      }
      if (!face.font.glyphId(codePoint)) return undefined;
      const target = pageOfCodePoint(codePoint);
      const strike = target === page ? font : req.pageStrike(target);
      const slot = codePoint & 0xff;
      return strike && getGlyphWidth(strike, slot) > 0 ? { font: strike, ordinal: slot } : undefined;
    },
    kern(left, right) {
      if (!settings.kerning || !face.font.hasKerning) return 0;
      return face.kerning(face.font.glyphId(left), face.font.glyphId(right), metrics);
    },
  };
  font.outline = source;
  return font;
}
