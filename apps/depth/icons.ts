import { fromGrid, type Sprite } from "@mockintosh/sdk";
import { createFrame } from "../synth/pixels";

const SIZE = 32;

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** A lit sphere over its shadow, shaded and dithered the way the app draws. */
function depth(): Sprite {
  const art = createFrame(SIZE, SIZE);
  const mask = createFrame(SIZE, SIZE);
  const cx = 15.5;
  const cy = 13.5;
  const radius = 11.5;
  const light = [-0.55, -0.6, 0.58];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const dx = (x + 0.5 - cx) / radius;
      const dy = (y + 0.5 - cy) / radius;
      const r2 = dx * dx + dy * dy;
      if (r2 <= 1) {
        const dz = Math.sqrt(1 - r2);
        const lambert = Math.max(0, dx * light[0]! + dy * light[1]! + dz * light[2]!);
        const shine = Math.pow(lambert, 24) * 0.6;
        const level = Math.min(1, 0.08 + 0.85 * lambert + shine);
        mask.pixels[i] = 1;
        // Outline the silhouette so it reads on any desktop pattern.
        art.pixels[i] = r2 > 0.86 || level * 16 <= BAYER[y & 3]![x & 3]! ? 1 : 0;
        continue;
      }
      // The shadow: a flat ellipse on the floor, dotted.
      const sx = (x + 0.5 - 18) / 12;
      const sy = (y + 0.5 - 28.5) / 2.6;
      if (sx * sx + sy * sy <= 1) {
        mask.pixels[i] = 1;
        art.pixels[i] = (x + y) % 2 === 0 ? 1 : 0;
      }
    }
  }
  return { width: SIZE, height: SIZE, data: art.pixels, mask: mask.pixels };
}

/** The 16×16 for the application menu: the lit sphere, its shadow side solid ink, over a solid shadow. */
const ICON_16: Sprite = fromGrid(16, 16, [
  "................",
  ".....######.....",
  "...##oooooo##...",
  "...#ooooooo##...",
  "..#oooooooo###..",
  "..#oooooooo###..",
  "..#oooooooo###..",
  "..#ooooooo####..",
  "..#oooooo#####..",
  "..#ooooo######..",
  "...#oo#######...",
  "...##########...",
  ".....######.....",
  "................",
  "...###########..",
  ".....#######....",
]);

export const sprites: Record<string, Sprite> = {
  "depth/icon": depth(),
  "depth/icon-16x16": ICON_16,
};
