import { fromGrid, type Sprite } from "@mockintosh/sdk";
import { GRAY, createFrame, frameRect, line, plot, rect, type Frame } from "../synth/pixels";

const SIZE = 32;

function disc(frame: Frame, cx: number, cy: number, r: number, ink: 0 | 1 | ((x: number, y: number) => 0 | 1)): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (Math.hypot(x - cx, y - cy) <= r) plot(frame, x, y, typeof ink === "function" ? ink(x, y) : ink);
    }
  }
}

/** The recorder face-on: the display, the reel, and the three keys down its side. */
function recorder(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);

  rect(mask, 0, 6, 29, 21, 1);
  frameRect(art, 0, 6, 28, 20, 1);
  rect(art, 1, 26, 28, 1, 1);
  rect(art, 28, 7, 1, 20, 1);
  for (const [x, y] of [[0, 6], [27, 6], [0, 25], [27, 25]] as const) {
    art.pixels[y * SIZE + x] = 0;
    mask.pixels[y * SIZE + x] = 0;
  }

  // The display with a waveform, the grille below it.
  rect(art, 3, 9, 10, 6, 1);
  for (const [x, h] of [[4, 1], [5, 2], [6, 1], [7, 2], [8, 0], [9, 1], [10, 2], [11, 1]] as const) {
    line(art, x, 12 - h, x, 12 + Math.min(h, 1), 0);
  }
  for (let y = 18; y <= 23; y += 2) for (let x = 3 + ((y / 2) % 2); x <= 12; x += 2) plot(art, x, y, 1);

  // The reel: the ring, the gray platter, a window and the hub.
  disc(art, 20, 16, 6.6, 1);
  disc(art, 20, 16, 5.6, 0);
  disc(art, 20, 16, 4.6, GRAY);
  disc(art, 20, 16, 1.6, 0);
  plot(art, 20, 16, 1);
  line(art, 21, 12, 23, 13, 0);

  // Three side keys standing proud of the right edge.
  for (const y of [8, 14, 20]) {
    rect(mask, 29, y, 3, 5, 1);
    frameRect(art, 29, y, 3, 5, 1);
  }
  rect(art, 30, 9, 1, 3, 1);

  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

/** A document with a dog-ear and a waveform across it: a memo file. */
function memo(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);
  const left = 5;
  const right = 26;
  const top = 1;
  const bottom = 30;
  const ear = 7;

  for (let y = top; y <= bottom; y++) {
    const x1 = y < top + ear ? right - ear + (y - top) : right;
    rect(mask, left, y, x1 - left + 1, 1, 1);
  }
  line(art, left, top, right - ear, top, 1);
  line(art, left, top, left, bottom, 1);
  line(art, left, bottom, right, bottom, 1);
  line(art, right, top + ear, right, bottom, 1);
  line(art, right - ear, top, right, top + ear, 1);
  line(art, right - ear, top, right - ear, top + ear, 1);
  line(art, right - ear, top + ear, right, top + ear, 1);

  const heights = [1, 3, 5, 2, 7, 4, 6, 3, 1, 4, 2, 5, 3, 1, 2];
  heights.forEach((h, i) => line(art, left + 3 + i, 18 - h, left + 3 + i, 18 + h, 1));
  for (let x = left + 3; x <= right - 3; x += 2) plot(art, x, 27, 1);

  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

/** The TP-7 for the application menu: the display, the big reel, speaker dots, the side buttons. */
const RECORDER_16: Sprite = fromGrid(16, 16, [
  "................",
  "................",
  ".#############..",
  "#ooooooooooooo#.",
  "#o####oo####oo##",
  "#o#oo#o##oo##o##",
  "#o#oo#o#oooo#o##",
  "#o####o#oooo#o##",
  "#oooooo##oo##o##",
  "#ooooooo####oo#.",
  "#o#####ooooooo##",
  "#ooooooooooooo##",
  "#o#####ooooooo##",
  "#ooooooooooooo#.",
  ".#############..",
  "................",
]);

export const sprites: Record<string, Sprite> = {
  "tp7/icon": recorder(),
  "tp7/icon-16x16": RECORDER_16,
  "tp7/memo": memo(),
};
