/**
 * Mockintosh font records (`%%MFN1`): one bitmap strike, its glyphs keyed by
 * Unicode code point, so a strike can hold any number of characters.
 *
 * Layout after the prefix (base64): glyphHeight, inkAbove, inkBelow,
 * spacing (u8 each), glyph count (u16), then per glyph: code point (u24,
 * `MISSING_CODE` for the missing-character glyph), cell width, advance,
 * originX (u8 each), and `inkAbove + glyphHeight + inkBelow` rows of
 * `ceil(width / 8)` bytes.
 *
 * Decoding builds page 0 (`charmap.ts`) plus a page strike for each other
 * 256-character block the font draws. Decker `%%FNT0` / `%%FNT1` records
 * still decode, through `legacy.ts`.
 */

import { decodeBase64, encodeBase64 } from "../base64";
import { MISSING_SLOT, codePointForSlot, codePointOnPage, placeCodePoint } from "./charmap";
import type { DeckerFont } from "./font";
import { decodeLegacyRecord, isLegacyRecord } from "./legacy";

const PREFIX = "%%MFN1";
/** Code point a record stores for the missing-character glyph. */
const MISSING_CODE = 0xffffff;

/** One glyph before packing: `pixels` is 0/1, `width` × all rows (ink above, cell, ink below). */
export interface FaceGlyph {
  /** Unicode code point, or `"missing"` for the missing-character glyph. */
  codePoint: number | "missing";
  /** Cell width (image columns from `originX` left of the pen). */
  width: number;
  /** Pen movement before `spacing`. */
  advance: number;
  /** Image columns left of the pen. */
  originX: number;
  pixels: Uint8Array;
}

export interface FaceLayout {
  /** The line box rows (baseline at its bottom, less the descent). */
  glyphHeight: number;
  /** Rows of ink above / below the line box (accents on capitals). */
  inkAbove: number;
  inkBelow: number;
  spacing: number;
}

export interface FaceRecord extends FaceLayout {
  glyphs: FaceGlyph[];
}

export function isFontRecord(data: string): boolean {
  return data.startsWith(PREFIX) || isLegacyRecord(data);
}

export interface DecodeOptions {
  size?: number;
  /** Decker records only: ordinal → [advance, originX] for overhanging glyphs. */
  overhangs?: Readonly<Record<number, readonly [number, number]>>;
}

/** Read any font record into its glyphs. */
export function decodeFaceRecord(data: string, options: DecodeOptions = {}): FaceRecord {
  if (isLegacyRecord(data)) {
    const legacy = decodeLegacyRecord(data, options.overhangs);
    const byteWidth = Math.ceil(legacy.maxWidth / 8);
    return {
      glyphHeight: legacy.glyphHeight,
      inkAbove: 0,
      inkBelow: 0,
      spacing: legacy.spacing,
      glyphs: legacy.glyphs.map((g) => {
        const pixels = new Uint8Array(g.width * legacy.glyphHeight);
        for (let y = 0; y < legacy.glyphHeight; y++) {
          for (let x = 0; x < g.width; x++) {
            if (g.rows[y * byteWidth + (x >> 3)]! & (1 << (7 - (x & 7)))) pixels[y * g.width + x] = 1;
          }
        }
        return { codePoint: g.codePoint, width: g.width, advance: g.advance, originX: g.originX, pixels };
      }),
    };
  }
  if (!data.startsWith(PREFIX)) throw new Error("Expected a %%MFN1 font record");
  const bytes = decodeBase64(data.slice(PREFIX.length));
  if (bytes.length < 6) throw new Error("Font record is too short");
  const glyphHeight = Math.max(1, bytes[0]!);
  const inkAbove = bytes[1]!;
  const inkBelow = bytes[2]!;
  const spacing = bytes[3]!;
  const count = (bytes[4]! << 8) | bytes[5]!;
  const rows = inkAbove + glyphHeight + inkBelow;
  const glyphs: FaceGlyph[] = [];
  let p = 6;
  for (let i = 0; i < count && p + 6 <= bytes.length; i++) {
    const code = (bytes[p]! << 16) | (bytes[p + 1]! << 8) | bytes[p + 2]!;
    const width = bytes[p + 3]!;
    const advance = bytes[p + 4]!;
    const originX = bytes[p + 5]!;
    p += 6;
    const byteWidth = Math.ceil(width / 8);
    const pixels = new Uint8Array(width * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        if (bytes[p + y * byteWidth + (x >> 3)]! & (1 << (7 - (x & 7)))) pixels[y * width + x] = 1;
      }
    }
    p += byteWidth * rows;
    glyphs.push({ codePoint: code === MISSING_CODE ? "missing" : code, width, advance, originX, pixels });
  }
  return { glyphHeight, inkAbove, inkBelow, spacing, glyphs };
}

export function encodeFaceRecord(record: FaceRecord): string {
  const rows = record.inkAbove + record.glyphHeight + record.inkBelow;
  const out: number[] = [record.glyphHeight, record.inkAbove, record.inkBelow, record.spacing];
  const glyphs = record.glyphs.filter((g) => g.width >= 1 && g.width <= 255);
  out.push((glyphs.length >> 8) & 0xff, glyphs.length & 0xff);
  for (const g of glyphs) {
    const code = g.codePoint === "missing" ? MISSING_CODE : g.codePoint;
    out.push((code >> 16) & 0xff, (code >> 8) & 0xff, code & 0xff, g.width, g.advance & 0xff, g.originX & 0xff);
    const byteWidth = Math.ceil(g.width / 8);
    for (let y = 0; y < rows; y++) {
      for (let b = 0; b < byteWidth; b++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = b * 8 + bit;
          if (x < g.width && g.pixels[y * g.width + x]) byte |= 1 << (7 - bit);
        }
        out.push(byte);
      }
    }
  }
  return PREFIX + encodeBase64(Uint8Array.from(out));
}

/** Pack one 256-slot strike of a face. */
function packStrike(name: string, layout: FaceLayout, slots: readonly (FaceGlyph | undefined)[]): DeckerFont {
  let maxWidth = 1;
  for (let slot = 0; slot < 256; slot++) maxWidth = Math.max(maxWidth, slots[slot]?.width ?? 0);
  const rows = layout.inkAbove + layout.glyphHeight + layout.inkBelow;
  const byteWidth = Math.ceil(maxWidth / 8);
  const glyphStride = byteWidth * rows;
  const glyphWidths = new Uint8Array(256);
  const glyphData = new Uint8Array(256 * glyphStride);
  const advances = new Uint8Array(256);
  const originX = new Uint8Array(256);
  let plain = true;
  for (let slot = 0; slot < 256; slot++) {
    const g = slots[slot];
    if (!g) continue;
    glyphWidths[slot] = g.width;
    advances[slot] = g.advance;
    originX[slot] = g.originX;
    if (g.advance !== g.width || g.originX !== 0) plain = false;
    const base = slot * glyphStride;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < g.width; x++) {
        if (g.pixels[y * g.width + x]) glyphData[base + y * byteWidth + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }
  return {
    name,
    maxWidth,
    glyphHeight: layout.glyphHeight,
    spacing: layout.spacing,
    glyphStride,
    glyphWidths,
    glyphData,
    ...(plain ? {} : { advances, originX }),
    ...(layout.inkAbove ? { inkAbove: layout.inkAbove } : {}),
    ...(layout.inkBelow ? { inkBelow: layout.inkBelow } : {}),
  };
}

/** Build a face's page-0 strike, with its other pages attached. */
export function buildFace(name: string, record: FaceRecord, size?: number): DeckerFont {
  const pages = new Map<number, (FaceGlyph | undefined)[]>();
  const slotsOf = (page: number) => {
    let slots = pages.get(page);
    if (!slots) pages.set(page, (slots = new Array(256)));
    return slots;
  };
  slotsOf(0);
  for (const glyph of record.glyphs) {
    if (glyph.width < 1) continue;
    if (glyph.codePoint === "missing") {
      slotsOf(0)[MISSING_SLOT] = glyph;
      continue;
    }
    const { page, slot } = placeCodePoint(glyph.codePoint);
    slotsOf(page)[slot] = glyph;
  }
  const font = packStrike(name, record, pages.get(0)!);
  if (size !== undefined) font.size = size;
  if (pages.size > 1) {
    const strikes = new Map<number, DeckerFont>();
    for (const [page, slots] of pages) {
      if (page === 0) continue;
      const strike = packStrike(name, record, slots);
      if (size !== undefined) strike.size = size;
      strikes.set(page, strike);
    }
    font.pages = strikes;
  }
  return font;
}

/** Decode any font record (`%%MFN1`, or Decker's `%%FNT0` / `%%FNT1`) into a face. */
export function decodeFont(data: string, name: string = "unnamed", options: DecodeOptions = {}): DeckerFont {
  return buildFace(name, decodeFaceRecord(data, options), options.size);
}

/** The glyphs of a face (page 0 and its pages), ready to encode. */
export function faceRecordOf(font: DeckerFont): FaceRecord {
  const glyphs: FaceGlyph[] = [];
  const rowsAbove = font.inkAbove ?? 0;
  const rowsBelow = font.inkBelow ?? 0;
  const rows = rowsAbove + font.glyphHeight + rowsBelow;
  const collect = (strike: DeckerFont, codePointAt: (slot: number) => number | "missing" | undefined) => {
    const byteWidth = Math.ceil(strike.maxWidth / 8);
    for (let slot = 0; slot < 256; slot++) {
      const width = strike.glyphWidths[slot] ?? 0;
      const codePoint = codePointAt(slot);
      if (width < 1 || codePoint === undefined) continue;
      const pixels = new Uint8Array(width * rows);
      const base = slot * strike.glyphStride;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < width; x++) {
          if (strike.glyphData[base + y * byteWidth + (x >> 3)]! & (1 << (7 - (x & 7)))) pixels[y * width + x] = 1;
        }
      }
      glyphs.push({
        codePoint,
        width,
        advance: strike.advances ? strike.advances[slot]! : width,
        originX: strike.originX?.[slot] ?? 0,
        pixels,
      });
    }
  };
  collect(font, (slot) => (slot === MISSING_SLOT ? "missing" : codePointForSlot(slot)));
  for (const [page, strike] of font.pages ?? []) collect(strike, (slot) => codePointOnPage(page, slot));
  return { glyphHeight: font.glyphHeight, inkAbove: rowsAbove, inkBelow: rowsBelow, spacing: font.spacing, glyphs };
}

/** Pack a face back into a `%%MFN1` record. */
export function encodeFont(font: DeckerFont): string {
  return encodeFaceRecord(faceRecordOf(font));
}
