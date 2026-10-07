import { fromGrid, type Sprite } from "@mockintosh/sdk";
import { createFrame, frameRect, plot, rect } from "../synth/pixels";

const SIZE = 32;

/** A little monitor on a stand, its dark screen full of spectrum bars with falling caps. */
function visualizer(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);

  // Cabinet with rounded corners and a drop shadow.
  rect(mask, 2, 2, 29, 23, 1);
  frameRect(art, 2, 2, 28, 22, 1);
  rect(art, 3, 24, 28, 1, 1);
  rect(art, 30, 3, 1, 22, 1);
  for (const [x, y] of [[2, 2], [29, 2], [2, 23]] as const) {
    art.pixels[y * SIZE + x] = 0;
    mask.pixels[y * SIZE + x] = 0;
  }
  mask.pixels[2 * SIZE + 30] = 0;
  mask.pixels[24 * SIZE + 2] = 0;

  // The screen: black glass, white bars.
  rect(art, 4, 4, 24, 16, 1);
  const bars = [4, 7, 11, 9, 13, 10, 6, 8, 12, 7, 5];
  bars.forEach((h, k) => {
    const x = 5 + k * 2;
    rect(art, x, 19 - h, 1, h, 0);
    plot(art, x, 17 - h, 0);
  });
  // Power lamp and a slot under the screen.
  plot(art, 26, 22, 1);
  rect(art, 6, 22, 8, 1, 1);

  // Neck and foot.
  rect(mask, 12, 25, 9, 6, 1);
  rect(art, 14, 25, 5, 2, 1);
  frameRect(art, 11, 27, 11, 3, 1);
  rect(art, 12, 30, 11, 1, 1);
  rect(mask, 11, 27, 12, 4, 1);

  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

/** The 16×16 for the application menu: the monitor on its stand, four bars on the dark screen. */
const ICON_16: Sprite = fromGrid(16, 16, [
  "................",
  ".#############..",
  ".#ooooooooooo##.",
  ".#o#########o##.",
  ".#o###o#####o##.",
  ".#o###o#o###o##.",
  ".#o#o#o#o###o##.",
  ".#o#o#o#o#o#o##.",
  ".#o#o#o#o#o#o##.",
  ".#o#########o##.",
  ".#ooooooooooo##.",
  ".#oo####ooooo##.",
  ".#ooooooooooo##.",
  ".##############.",
  "......####......",
  "....########....",
]);

export const sprites: Record<string, Sprite> = {
  "visualizer/icon": visualizer(),
  "visualizer/icon-16x16": ICON_16,
};
