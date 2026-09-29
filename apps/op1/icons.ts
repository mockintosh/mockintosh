import type { Sprite } from "@mockintosh/sdk";
import { GRAY, LIGHT, createFrame, frameRect, plot, rect } from "../synth/pixels";

const SIZE = 32;

/** A long, thin synthesizer: the black display, four encoders, and two rows of keys. */
function op1(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);

  rect(mask, 0, 8, 32, 17, 1);
  frameRect(art, 0, 8, 31, 16, 1);
  rect(art, 1, 24, 31, 1, 1);
  rect(art, 31, 9, 1, 16, 1);
  for (const [x, y] of [[0, 8], [30, 8], [0, 23], [30, 23]] as const) {
    art.pixels[y * SIZE + x] = 0;
    mask.pixels[y * SIZE + x] = 0;
  }
  mask.pixels[8 * SIZE + 31] = 0;
  mask.pixels[24 * SIZE + 0] = 0;

  // Speaker holes, the display with a waveform, four encoders.
  for (const [x, y] of [[2, 10], [4, 10], [3, 12], [2, 14], [4, 14]] as const) plot(art, x, y, 1);
  rect(art, 6, 10, 10, 6, 1);
  for (const [x, y] of [[7, 13], [8, 12], [9, 12], [10, 13], [11, 14], [12, 14], [13, 13], [14, 12]] as const) plot(art, x, y, 0);
  const fills = [1, GRAY, 0, LIGHT] as const;
  fills.forEach((fill, k) => {
    const x = 17 + k * 3;
    rect(art, x, 11, 3, 3, fill);
    frameRect(art, x, 11, 3, 3, 1);
  });

  // Black keys above, white keys below.
  for (const x of [3, 6, 9, 15, 18, 24, 27]) rect(art, x, 17, 2, 2, 1);
  for (let x = 2; x < 30; x += 3) frameRect(art, x, 20, 2, 2, 1);

  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

export const sprites: Record<string, Sprite> = {
  "op1/icon": op1(),
};
