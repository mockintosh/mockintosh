/**
 * System file `PAT#` 0 — the 38 classic 8×8 QuickDraw patterns MacPaint used.
 * Bytes match `systemPatterns()` in the 7.5.3 resource catalog.
 */
export const PATTERN_HEX: readonly string[] = [
  "ffffffffffffffff",
  "ddff77ffddff77ff",
  "dd77dd77dd77dd77",
  "aa55aa55aa55aa55",
  "55ff55ff55ff55ff",
  "aaaaaaaaaaaaaaaa",
  "eeddbb77eeddbb77",
  "8888888888888888",
  "b130031bd8c00c8d",
  "8010022001084004",
  "ff888888ff888888",
  "ff808080ff080808",
  "8000000000000000",
  "8040200002040800",
  "8244394482010101",
  "f87422478f172271",
  "55a04040550a0404",
  "2050888888880502",
  "bf00bfbfb0b0b0b0",
  "0000000000000000",
  "8000080080000800",
  "8800220088002200",
  "8822882288228822",
  "aa00aa00aa00aa00",
  "ff00ff00ff00ff00",
  "1122448811224488",
  "ff000000ff000000",
  "0102040810204080",
  "aa00800088008000",
  "ff80808080808080",
  "081c22c180010204",
  "881422418800aa00",
  "40a00000040a0000",
  "038448300c020101",
  "8080413e080814e3",
  "102054aaff020408",
  "77898f8f7798f8f8",
  "0008142a552a1408",
];

/** 8-byte QuickDraw `Pattern` (one row per byte, MSB leftmost). */
export type Pattern = Uint8Array;

const cache: Pattern[] = PATTERN_HEX.map((hex) => {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
});

export const PAINT_PATTERNS: readonly Pattern[] = cache;

