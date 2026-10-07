import { fromGrid, type Sprite } from "@mockintosh/sdk";
import { createFrame, frameRect, plot, rect } from "../synth/pixels";

const SIZE = 32;

/** A pocket chord instrument: a display, a joystick, a speaker grille, and seven chord buttons. */
function pocketChord(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);

  // Body with a drop shadow, corners knocked off.
  rect(mask, 1, 5, 31, 24, 1);
  frameRect(art, 1, 5, 30, 23, 1);
  rect(art, 2, 28, 30, 1, 1);
  rect(art, 31, 6, 1, 23, 1);
  for (const [x, y] of [[1, 5], [30, 5], [1, 27], [30, 27]] as const) {
    art.pixels[y * SIZE + x] = 0;
    mask.pixels[y * SIZE + x] = 0;
  }
  mask.pixels[5 * SIZE + 31] = 0;
  mask.pixels[28 * SIZE + 1] = 0;

  // The display: black glass with a rising chord.
  rect(art, 3, 7, 12, 8, 1);
  for (const [x, y] of [[5, 12], [8, 10], [11, 9]] as const) rect(art, x, y, 2, 1, 0);
  rect(art, 5, 13, 2, 1, 0);
  rect(art, 8, 11, 2, 1, 0);

  // The joystick: a gate with the stick in it.
  const cx = 19.5;
  const cy = 10.5;
  for (let a = 0; a < 32; a++) {
    const t = (a / 32) * Math.PI * 2;
    plot(art, cx + Math.cos(t) * 3.2, cy + Math.sin(t) * 3.2, 1);
  }
  rect(art, 19, 10, 2, 2, 1);

  // Speaker grille.
  for (let y = 7; y <= 13; y += 2) for (let x = 25; x <= 29; x += 2) plot(art, x, y, 1);

  // Seven chord buttons, the third one pressed.
  for (let k = 0; k < 7; k++) {
    const x = 3 + k * 4;
    if (k === 2) frameRect(art, x, 18, 3, 7, 1);
    else rect(art, x, 18, 3, 7, 1);
  }

  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

/** The pocket chord for the application menu: the black display, the joystick gate, a row of keys with the third pressed. */
const POCKET_CHORD_16: Sprite = fromGrid(16, 16, [
  "................",
  "................",
  ".#############..",
  "#ooooooooooooo##",
  "#o######oo##oo##",
  "#o######o####o##",
  "#o######o####o##",
  "#o######oo##oo##",
  "#ooooooooooooo##",
  "#o#o#ooo#o#o#o##",
  "#o#o#o#o#o#o#o##",
  "#o#o#o#o#o#o#o##",
  "#ooooooooooooo##",
  ".#############.#",
  "..##############",
  "................",
]);

export const sprites: Record<string, Sprite> = {
  "chord/icon": pocketChord(),
  "chord/icon-16x16": POCKET_CHORD_16,
};
