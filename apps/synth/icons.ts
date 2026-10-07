import { fromGrid, type Sprite } from "@mockintosh/sdk";
import { createFrame, frameRect, plot, rect } from "./pixels";

const SIZE = 32;

/** A little desktop synth: a scope window with a sine, three knobs, and a keyboard. */
function synthesizer(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);

  // Body with a drop shadow, corners knocked off.
  rect(mask, 1, 6, 31, 23, 1);
  frameRect(art, 1, 6, 30, 22, 1);
  rect(art, 2, 28, 30, 1, 1);
  rect(art, 31, 7, 1, 22, 1);
  for (const [x, y] of [[1, 6], [30, 6], [1, 27]] as const) {
    art.pixels[y * SIZE + x] = 0;
    mask.pixels[y * SIZE + x] = 0;
  }
  mask.pixels[6 * SIZE + 31] = 0;
  mask.pixels[28 * SIZE + 1] = 0;

  // The scope, black glass with a white sine.
  rect(art, 3, 8, 13, 8, 1);
  for (let x = 4; x <= 14; x++) plot(art, x, 11.5 - 2.4 * Math.sin(((x - 4) / 10) * Math.PI * 2), 0);

  // Three knobs with pointers.
  const knob = (cx: number, cy: number, px: number, py: number) => {
    rect(art, cx - 1, cy - 2, 3, 5, 1);
    rect(art, cx - 2, cy - 1, 5, 3, 1);
    plot(art, cx + px, cy + py, 0);
  };
  knob(19, 11, -1, -1);
  knob(24, 11, 0, -1);
  knob(28, 11, 1, -1);

  // Keyboard: nine white keys, black keys between.
  rect(art, 2, 17, 28, 1, 1);
  for (let k = 0; k <= 9; k++) rect(art, 2 + 3 * k, 18, 1, 9, 1);
  for (const k of [1, 2, 4, 5, 6, 8]) rect(art, 1 + 3 * k, 18, 3, 5, 1);

  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

/** The 16×16 for the application menu: the cabinet with its scope sine, one knob and the keyboard. */
export const SYNTH_16: Sprite = fromGrid(16, 16, [
  "................",
  "................",
  "###############.",
  "#ooooooooooooo##",
  "#o#######ooooo##",
  "#o##oo###o#o#o##",
  "#o#o##o##o###o##",
  "#o#####o#o###o##",
  "#o#######ooooo##",
  "#ooooooooooooo##",
  "################",
  "#oo###o###oo#o##",
  "#oo###o###oo#o##",
  "#ooo#ooo#ooo#o##",
  "################",
  ".###############",
]);

export const sprites: Record<string, Sprite> = {
  "synth/icon": synthesizer(),
  "synth/icon-16x16": SYNTH_16,
};
