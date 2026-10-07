/**
 * How bright the ground is in full sun, 0 (black) to 1 (white): NASA's
 * Blue Marble, the cloud-free mosaic Google Earth's globe began with, in
 * eight shades (`imagery.generated.ts`). Deserts come out pale, forests
 * dark, ice near white.
 *
 * The map is about 40 km a pixel, read back smoothly. The shore stays sharp
 * because land and sea are told apart per pixel elsewhere; here the sea's
 * own pixels are left out of the blend, so coasts don't darken.
 */
import { IMAGERY, IMAGERY_H, IMAGERY_LEVELS, IMAGERY_W } from "./imagery.generated";
import { decode } from "./packing";

/** Open sea: dark, as Google Earth's deep blue comes out in one bit. */
export const SEA = 0.12;

/** The darkest and brightest land, as drawn. */
const LAND_LOW = 0.24;
const LAND_HIGH = 0.97;

let levels: Uint8Array | null = null;

/** The map's levels, unpacked the first time it is read. */
function imagery(): Uint8Array {
  if (levels) return levels;
  levels = new Uint8Array(IMAGERY_W * IMAGERY_H);
  let at = 0;
  for (const run of decode(IMAGERY)) {
    const level = run % IMAGERY_LEVELS;
    const length = (run - level) / IMAGERY_LEVELS + 1;
    levels.fill(level, at, at + length);
    at += length;
  }
  return levels;
}

/** Land at (lat, lon) radians. */
export function landTone(lat: number, lon: number): number {
  const map = imagery();
  const u = ((lon + Math.PI) / (2 * Math.PI)) * IMAGERY_W - 0.5;
  const v = Math.max(0, Math.min(IMAGERY_H - 1.001, ((Math.PI / 2 - lat) / Math.PI) * IMAGERY_H - 0.5));
  const u0 = Math.floor(u);
  const v0 = Math.floor(v);
  const fu = u - u0;
  const fv = v - v0;
  const left = ((u0 % IMAGERY_W) + IMAGERY_W) % IMAGERY_W;
  const right = (left + 1) % IMAGERY_W;
  const top = v0 * IMAGERY_W;
  const bottom = top + IMAGERY_W;
  // Blend the four nearest, leaving out the sea's (level 0) where land is among them.
  let sum = 0;
  let weight = 0;
  const take = (level: number, w: number) => {
    if (level === 0 || w === 0) return;
    sum += level * w;
    weight += w;
  };
  take(map[top + left]!, (1 - fu) * (1 - fv));
  take(map[top + right]!, fu * (1 - fv));
  take(map[bottom + left]!, (1 - fu) * fv);
  take(map[bottom + right]!, fu * fv);
  const level = weight > 0 ? sum / weight : 0;
  return LAND_LOW + (LAND_HIGH - LAND_LOW) * (level / (IMAGERY_LEVELS - 1));
}
