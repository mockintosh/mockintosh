/**
 * The OP-1 keyboard: two octaves from F, every key the same size. White keys
 * sit in the lower row; black keys sit in the upper row, centred on the gap
 * between their neighbours.
 */

export const KEY_COUNT = 24;
/** MIDI note of the leftmost key at octave 0: F3. */
export const LOW_NOTE = 53;
export const WHITE_KEYS = 14;

/** Semitones above F of the white keys in one octave. */
const WHITES = [0, 2, 4, 6, 7, 9, 11] as const;

export interface KeySlot {
  black: boolean;
  /** Left edge, in white-key widths from the left of the keyboard. */
  x: number;
}

export function keySlot(key: number): KeySlot {
  const octave = Math.floor(key / 12);
  const semitone = key % 12;
  const white = WHITES.indexOf(semitone as (typeof WHITES)[number]);
  if (white >= 0) return { black: false, x: octave * 7 + white };
  const below = WHITES.indexOf((semitone - 1) as (typeof WHITES)[number]);
  return { black: true, x: octave * 7 + below + 0.5 };
}

export const KEY_SLOTS: readonly KeySlot[] = Array.from({ length: KEY_COUNT }, (_, key) => keySlot(key));

/**
 * The computer keyboard as the OP-1's: the home row is the white keys from
 * the low F, the row above the black keys between them.
 */
export const COMPUTER_KEYS: Readonly<Record<string, number>> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, r: 5, f: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};
