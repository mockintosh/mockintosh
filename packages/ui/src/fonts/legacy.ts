/**
 * Reading Decker `%%FNT0` / `%%FNT1` records.
 *
 * Mockintosh started on Decker's font records. They index glyphs by
 * Decker's own ordinals (ASCII, then `LEGACY_CHARS` from 127, then
 * Mockintosh's symbols from 241), not by Mac OS Roman, so a record is
 * decoded here and every glyph moved to where `charmap.ts` puts its
 * character. New strikes are written as `%%MFN1` (`codec.ts`).
 */

import { decodeBase64 } from "../base64";
import { placeCodePoint } from "./charmap";

/** Decker's `drom_chars`: ordinal 127 + index. */
const LEGACY_CHARS =
  "…ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĒēĘęĪīıŁłŃńŌōŐőŒœŚśŠšŪūŰűŸŹźŻżŽžȘșȚțẞ¡¿«»€°";

/** Mockintosh's symbols as Decker records numbered them: ⌘ ✓ • ⇧ ⌥ from 241. */
const LEGACY_SYMBOLS = "⌘✓•⇧⌥";

/** The character a Decker ordinal stood for, or undefined. */
export function legacyCodePoint(ordinal: number): number | undefined {
  if (ordinal === 10 || (ordinal >= 32 && ordinal <= 126)) return ordinal;
  if (ordinal >= 127 && ordinal < 127 + LEGACY_CHARS.length) return LEGACY_CHARS.charCodeAt(ordinal - 127);
  if (ordinal >= 241 && ordinal < 241 + LEGACY_SYMBOLS.length) return LEGACY_SYMBOLS.charCodeAt(ordinal - 241);
  return undefined;
}

/** One glyph read out of a record, in its own cell. */
export interface LegacyGlyph {
  codePoint: number;
  /** Cell width (Decker's glyph width). */
  width: number;
  advance: number;
  originX: number;
  /** `glyphHeight` rows of `ceil(maxWidth / 8)` bytes. */
  rows: Uint8Array;
}

export interface LegacyRecord {
  maxWidth: number;
  glyphHeight: number;
  spacing: number;
  glyphs: LegacyGlyph[];
}

export function isLegacyRecord(data: string): boolean {
  return data.startsWith("%%FNT0") || data.startsWith("%%FNT1");
}

/**
 * Decode a Decker record. `overhangs` (ordinal → [advance, originX]) are the
 * glyphs whose ink overhangs their advance, keyed by Decker ordinal.
 */
export function decodeLegacyRecord(
  data: string,
  overhangs?: Readonly<Record<number, readonly [number, number]>>,
): LegacyRecord {
  if (!isLegacyRecord(data)) throw new Error("Expected a %%FNT0 or %%FNT1 font record");
  const fnt0 = data.startsWith("%%FNT0");
  const bytes = decodeBase64(data.slice(6));
  if (bytes.length < 3) throw new Error("Font record is too short");
  const maxWidth = Math.max(1, bytes[0]!);
  const glyphHeight = Math.max(1, bytes[1]!);
  const spacing = bytes[2]!;
  const stride = Math.ceil(maxWidth / 8) * glyphHeight;
  const glyphs: LegacyGlyph[] = [];
  const take = (ordinal: number, width: number, offset: number) => {
    const codePoint = legacyCodePoint(ordinal);
    if (codePoint === undefined || width < 1) return;
    const [advance, originX] = overhangs?.[ordinal] ?? [width, 0];
    glyphs.push({ codePoint, width, advance, originX, rows: bytes.slice(offset, offset + stride) });
  };
  let offset = 3;
  if (fnt0) {
    for (let ordinal = 32; ordinal < 128 && offset + 1 + stride <= bytes.length; ordinal++) {
      const width = bytes[offset++]!;
      take(ordinal, width, offset);
      offset += stride;
    }
  } else {
    while (offset + 2 + stride <= bytes.length) {
      const ordinal = bytes[offset++]!;
      const width = bytes[offset++]!;
      take(ordinal, width, offset);
      offset += stride;
    }
  }
  return { maxWidth, glyphHeight, spacing, glyphs };
}

/** Where each glyph of a decoded record lands now. */
export function placeLegacyGlyphs(record: LegacyRecord): { page: number; slot: number; glyph: LegacyGlyph }[] {
  return record.glyphs.map((glyph) => ({ ...placeCodePoint(glyph.codePoint), glyph }));
}
