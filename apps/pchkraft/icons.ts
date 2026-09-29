import type { Sprite } from "@mockintosh/sdk";
import { createFrame, frameRect, plot, rect } from "../synth/pixels";

const SIZE = 32;

/** A cassette: two reels, a tape window, and four keys along the bottom. */
function cassette(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);

  rect(mask, 1, 4, 31, 25, 1);
  frameRect(art, 1, 4, 30, 25, 1);
  rect(art, 2, 28, 30, 1, 1);
  rect(art, 31, 5, 1, 24, 1);
  for (const [x, y] of [
    [1, 4],
    [30, 4],
    [1, 28],
    [30, 28],
  ] as const) {
    art.pixels[y * SIZE + x] = 0;
    mask.pixels[y * SIZE + x] = 0;
  }

  // Corner screws.
  for (const [x, y] of [
    [3, 6],
    [27, 6],
    [3, 25],
    [27, 25],
  ] as const) {
    plot(art, x, y, 1);
    plot(art, x + 1, y, 1);
  }

  const reel = (cx: number, cy: number) => {
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      plot(art, cx + Math.cos(t) * 4.2, cy + Math.sin(t) * 4.2, 1);
    }
    plot(art, cx, cy, 1);
    plot(art, cx - 2, cy, 1);
    plot(art, cx + 2, cy, 1);
    plot(art, cx, cy - 2, 1);
    plot(art, cx, cy + 2, 1);
  };
  reel(9, 13);
  reel(22, 13);

  // The tape window.
  rect(art, 13, 10, 6, 7, 1);
  rect(art, 14, 12, 4, 1, 0);
  rect(art, 14, 14, 4, 1, 0);

  // Four keys.
  for (let k = 0; k < 4; k++) rect(art, 6 + k * 5, 20, 4, 5, 1);

  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

export const sprites: Record<string, Sprite> = {
  "pchkraft/icon": cassette(),
};
