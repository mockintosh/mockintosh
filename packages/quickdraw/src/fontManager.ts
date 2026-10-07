/**
 * Font Manager seam — the only contact between QuickDraw and fonts.
 *
 * Original: `_SwapFont` / `FMSwapFont` (`Text.a:599-643`, `GrafTypes.a:372-375`).
 * QuickDraw fills an {@link FMInput} and receives an {@link FMOutput} plus a
 * 256-entry Fixed width table. Decker→strike conversion, family numbering,
 * size fallback, and style synthesis live in `packages/ui`.
 */

import type { Point, Style } from "./types";

/** 256 Fixed (16.16) character advances — Font Manager `WidthPtr`. */
export type WidthTable = Int32Array;

/**
 * Kerned strike (`FONT` / `DrawText.a:28-40`). Tables are indexed from
 * `firstChar`; `locTable` / `owTable` have `lastChar - firstChar + 3` entries
 * (the extra slots are the missing-symbol and its right edge).
 */
export interface FontStrike {
  fontType: number;
  firstChar: number;
  lastChar: number;
  widMax: number;
  /** Typically negative; added to the pen before placing glyphs (`FBBOX`). */
  kernMax: number;
  nDescent: number;
  fRectWidth: number;
  fRectHeight: number;
  ascent: number;
  descent: number;
  leading: number;
  rowWords: number;
  bitImage: Uint8Array;
  locTable: Int16Array;
  owTable: Int16Array;
  /** Optional; present when `fontType` bit 0 is set. High=top, low=height. */
  heightTable?: Int16Array;
  /**
   * Host hook, not in the Mac record: an outline-scaled strike renders
   * glyphs on first use, so `DrText` asks it to fill these characters
   * into `bitImage` before blitting.
   */
  prepare?: (chars: readonly number[], count: number) => void;
}

/** Packed `FMInput` (`Text.a:614-622`). */
export interface FMInput {
  family: number;
  size: number;
  face: Style;
  needBits: boolean;
  device: number;
  numer: Point;
  denom: Point;
}

/**
 * Packed `FMOutput` (`Text.a:626-643`) plus the Font Manager width table
 * that the original left in the `WidthPtr` global.
 */
export interface FMOutput {
  errNum: number;
  fontHandle: FontStrike | null;
  bold: number;
  italic: number;
  ulOffset: number;
  ulShadow: number;
  ulThick: number;
  shadow: number;
  /** Signed. Added to `widMax` by {@link GetFontInfo}. */
  extra: number;
  ascent: number;
  descent: number;
  widMax: number;
  /** Signed. */
  leading: number;
  unused: number;
  numer: Point;
  denom: Point;
  widthTable: WidthTable;
}

export type SwapFont = (inRec: FMInput) => FMOutput;

const EMPTY_STRIKE: FontStrike = {
  fontType: 0,
  firstChar: 0,
  lastChar: 255,
  widMax: 6,
  kernMax: 0,
  nDescent: 0,
  fRectWidth: 0,
  fRectHeight: 0,
  ascent: 0,
  descent: 0,
  leading: 0,
  rowWords: 0,
  bitImage: new Uint8Array(0),
  locTable: new Int16Array(258),
  owTable: new Int16Array(258).fill(0x8000),
};

function fallbackWidths(): Int32Array {
  const w = new Int32Array(256);
  w.fill(6 << 16);
  return w;
}

/** 6 px/char empty strike so non-UI tests still measure; drawing is a no-op. */
export function fallbackFMOutput(inRec: FMInput): FMOutput {
  return {
    errNum: 0,
    fontHandle: EMPTY_STRIKE,
    bold: 0,
    italic: 0,
    ulOffset: 0,
    ulShadow: 0,
    ulThick: 0,
    shadow: 0,
    extra: 0,
    ascent: 0,
    descent: 0,
    widMax: 6,
    leading: 0,
    unused: 0,
    numer: { h: inRec.numer.h, v: inRec.numer.v },
    denom: { h: inRec.denom.h, v: inRec.denom.v },
    widthTable: fallbackWidths(),
  };
}

let swapFont: SwapFont | null = null;

/**
 * Install `_SwapFont`.
 */
export function installFontManager(fn: SwapFont): void {
  swapFont = fn;
}

/** The installed swap, or the 6 px empty-strike fallback. */
export function currentSwapFont(): SwapFont {
  return swapFont ?? fallbackFMOutput;
}

