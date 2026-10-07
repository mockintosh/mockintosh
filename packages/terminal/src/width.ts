/**
 * How many cells a character takes: 0 for combining marks and other
 * zero-width characters, 2 for East Asian wide characters and emoji, 1
 * otherwise. The same answer xterm's Unicode 6 table gives for the
 * characters shells deal in; it only has to agree with the screen about
 * where a line editor's cursor is.
 */

const ZERO: readonly [number, number][] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f],
  [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xe0100, 0xe01ef],
];

const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

function inRanges(cp: number, ranges: readonly [number, number][]): boolean {
  for (const [a, b] of ranges) if (cp >= a && cp <= b) return true;
  return false;
}

export function charWidth(cp: number): 0 | 1 | 2 {
  if (cp === 0 || cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (inRanges(cp, ZERO)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

/** Cells `text` takes, ignoring escape sequences. */
export function stringWidth(text: string): number {
  let width = 0;
  for (const ch of stripEscapes(text)) width += charWidth(ch.codePointAt(0)!);
  return width;
}

/** `text` without CSI, OSC and two-byte escape sequences. */
export function stripEscapes(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g, "");
}
