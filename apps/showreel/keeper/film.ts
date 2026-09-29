/**
 * What the print picked up on its way through the projector: grain, dust,
 * scratches, a hair in the gate, the lens's vignette — and the iris the
 * cameraman opens and closes the picture with.
 */
import { hash } from "../ease";
import { STAGE_H, STAGE_W, type Frame, type PixelRect, type Stage } from "../painter";
import { grain } from "./noise";

export interface FilmOptions {
  exposure: number;
  /** Iris radius in stage units; `Infinity` for fully open. */
  iris: number;
  /** Engrave a vignette over the picture (the world shader does its own). */
  vignette: boolean;
}

export function filmPass(frame: Frame, stage: Stage, rect: PixelRect, options: FilmOptions): void {
  const { exposure: e } = options;
  const px = frame.pixels;
  const W = frame.width;
  const inv = 1 / stage.scale;
  const cx = stage.x + (STAGE_W / 2) * stage.scale;
  const cy = stage.y + (STAGE_H / 2) * stage.scale;
  const irisR = options.iris * stage.scale;
  // The iris edge is feathered with engraved rings rather than cut clean.
  const feather = 9 * stage.scale;
  const period = 3.4;

  for (let y = rect.y0; y < rect.y1; y++) {
    const row = y * W;
    const dy = y + 0.5 - cy;
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = row + x;
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > irisR + feather) {
        px[i] = 1;
        continue;
      }
      if (d > irisR) {
        const f = (d - irisR) / feather;
        const g = d / period;
        if (Math.abs(g - Math.floor(g) - 0.5) < f * 0.5 + 0.05) px[i] = 1;
      }
      if (options.vignette) {
        const vx = (dx * inv) / 175;
        const vy = (dy * inv) / 118;
        const v = (vx * vx + vy * vy - 0.55) * 0.9;
        if (v > 0) {
          const g = (x + y) / period;
          if (Math.abs(g - Math.floor(g) - 0.5) < v * 0.5) px[i] = 1;
        }
      }
      const n = grain(x, y, e);
      if (n < 0.0022) px[i] ^= 1;
    }
  }

  const s = stage.scale;
  // Dust: a few specks per exposure, mostly dark, sometimes a pinhole of light.
  const specks = Math.floor(hash(e, 1) * 4);
  for (let k = 0; k < specks; k++) {
    const x = rect.x0 + hash(e, 10 + k) * (rect.x1 - rect.x0);
    const y = rect.y0 + hash(e, 20 + k) * (rect.y1 - rect.y0);
    const r = (0.5 + hash(e, 30 + k) * 1.4) * s;
    const ink = hash(e, 40 + k) < 0.75 ? 1 : 0;
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
      if (yy < rect.y0 || yy >= rect.y1) continue;
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        if (xx < rect.x0 || xx >= rect.x1) continue;
        if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 < r * r) px[yy * W + xx] = ink;
      }
    }
  }

  // A scratch down the print, wandering and broken, held for a few exposures.
  const run = Math.floor(e / 5);
  if (hash(run, 2) < 0.45) {
    const x0 = rect.x0 + hash(run, 3) * (rect.x1 - rect.x0);
    const ink = hash(run, 4) < 0.5 ? 1 : 0;
    for (let y = rect.y0; y < rect.y1; y++) {
      if (hash((y >> 3) + run * 97, 5) < 0.18) continue;
      const x = Math.round(x0 + Math.sin(y * 0.02 + run) * 3 * s);
      if (x >= rect.x0 && x < rect.x1) px[y * W + x] = ink;
    }
  }

  // Now and then a hair caught in the gate.
  if (hash(Math.floor(e / 9), 6) < 0.3) {
    const hx = rect.x0 + (0.1 + hash(Math.floor(e / 9), 7) * 0.8) * (rect.x1 - rect.x0);
    const hy = rect.y0 + (0.15 + hash(Math.floor(e / 9), 8) * 0.7) * (rect.y1 - rect.y0);
    for (let k = 0; k < 90; k++) {
      const a = k * 0.07;
      const x = Math.round(hx + (Math.cos(a * 1.3) * 10 + k * 0.25) * s);
      const y = Math.round(hy + (Math.sin(a) * 7 - k * 0.12) * s);
      if (x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1) px[y * W + x] = 1;
    }
  }
}
