/**
 * A 3 × 5 pixel face for captions and timecode: the one place the reel draws
 * on the device grid instead of in stage units, so small text stays crisp
 * at any window size.
 */
import type { Painter } from "./painter";

/** Five rows of three cells, top to bottom. */
const ROWS: Record<string, string> = {
  A: ".#. #.# ### #.# #.#",
  B: "##. #.# ##. #.# ##.",
  C: ".## #.. #.. #.. .##",
  D: "##. #.# #.# #.# ##.",
  E: "### #.. ##. #.. ###",
  F: "### #.. ##. #.. #..",
  G: ".## #.. #.# #.# .##",
  H: "#.# #.# ### #.# #.#",
  I: "### .#. .#. .#. ###",
  J: "..# ..# ..# #.# .#.",
  K: "#.# #.# ##. #.# #.#",
  L: "#.. #.. #.. #.. ###",
  M: "#.# ### ### #.# #.#",
  N: "##. #.# #.# #.# #.#",
  O: ".#. #.# #.# #.# .#.",
  P: "##. #.# ##. #.. #..",
  Q: ".#. #.# #.# ##. .##",
  R: "##. #.# ##. #.# #.#",
  S: ".## #.. .#. ..# ##.",
  T: "### .#. .#. .#. .#.",
  U: "#.# #.# #.# #.# ###",
  V: "#.# #.# #.# #.# .#.",
  W: "#.# #.# ### ### #.#",
  X: "#.# #.# .#. #.# #.#",
  Y: "#.# #.# .#. .#. .#.",
  Z: "### ..# .#. #.. ###",
  "0": "### #.# #.# #.# ###",
  "1": ".#. ##. .#. .#. ###",
  "2": "##. ..# .#. #.. ###",
  "3": "##. ..# .#. ..# ##.",
  "4": "#.# #.# ### ..# ..#",
  "5": "### #.. ##. ..# ##.",
  "6": ".## #.. ### #.# ###",
  "7": "### ..# .#. .#. .#.",
  "8": "### #.# ### #.# ###",
  "9": "### #.# ### ..# ##.",
  ":": "... .#. ... .#. ...",
  ".": "... ... ... ... .#.",
  ",": "... ... ... .#. #..",
  "-": "... ... ### ... ...",
  _: "... ... ... ... ###",
  "/": "..# ..# .#. #.. #..",
  "+": "... .#. ### .#. ...",
  "*": "... ... .#. ... ...",
  ">": "#.. .#. ..# .#. #..",
  "'": ".#. .#. ... ... ...",
  "#": "#.# ### #.# ### #.#",
  " ": "... ... ... ... ...",
};

const GLYPHS: Record<string, Uint8Array> = Object.fromEntries(
  Object.entries(ROWS).map(([ch, rows]) => [ch, Uint8Array.from(rows.replaceAll(" ", ""), (c) => (c === "#" ? 1 : 0))]),
);

const MICRO_ADVANCE = 4;
export const MICRO_HEIGHT = 5;

/** Device width of `text` at pixel scale `k`. */
export function microWidth(text: string, k = 1): number {
  return Math.max(0, text.length * MICRO_ADVANCE - 1) * k;
}

/** Draw `text` with its top-left at device `(x, y)`, each cell `k` pixels. */
export function drawMicro(painter: Painter, text: string, x: number, y: number, k = 1): void {
  let cx = Math.round(x);
  const top = Math.round(y);
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] ?? GLYPHS["*"]!;
    for (let row = 0; row < MICRO_HEIGHT; row++) {
      for (let col = 0; col < 3; col++) {
        if (!glyph[row * 3 + col]) continue;
        for (let dy = 0; dy < k; dy++) painter.span(top + row * k + dy, cx + col * k, cx + (col + 1) * k);
      }
    }
    cx += MICRO_ADVANCE * k;
  }
}
