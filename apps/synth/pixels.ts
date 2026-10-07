/**
 * A few 1-bit drawing routines over a byte-per-pixel buffer — the
 * `blitPixels` contract (`0` = white, `1` = black). The synth's knobs, scope,
 * step grid and keyboard are drawn with these and blitted into rasters.
 */

export type Ink = 0 | 1;

export interface Frame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function createFrame(width: number, height: number): Frame {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return { width: w, height: h, pixels: new Uint8Array(w * h) };
}

/** A frame of this size, reusing `frame` when it already fits. */
export function ensureFrame(frame: Frame | null, width: number, height: number): Frame {
  if (frame && frame.width === Math.max(1, Math.floor(width)) && frame.height === Math.max(1, Math.floor(height))) {
    return frame;
  }
  return createFrame(width, height);
}

export function plot(frame: Frame, x: number, y: number, ink: Ink): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) return;
  frame.pixels[py * frame.width + px] = ink;
}

export function invert(frame: Frame, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const i = y * frame.width + x;
  frame.pixels[i] = frame.pixels[i] ? 0 : 1;
}

/** Filled rectangle, clipped. `ink` may be a pattern function of (x, y). */
export function rect(frame: Frame, x: number, y: number, w: number, h: number, ink: Ink | ((x: number, y: number) => Ink)): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(frame.width, Math.floor(x + w));
  const y1 = Math.min(frame.height, Math.floor(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      frame.pixels[py * frame.width + px] = typeof ink === "function" ? ink(px, py) : ink;
    }
  }
}

export function invertRect(frame: Frame, x: number, y: number, w: number, h: number): void {
  for (let py = Math.max(0, y); py < Math.min(frame.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(frame.width, x + w); px++) invert(frame, px, py);
  }
}

/** 1px outline. */
export function frameRect(frame: Frame, x: number, y: number, w: number, h: number, ink: Ink): void {
  rect(frame, x, y, w, 1, ink);
  rect(frame, x, y + h - 1, w, 1, ink);
  rect(frame, x, y, 1, h, ink);
  rect(frame, x + w - 1, y, 1, h, ink);
}

/** Bresenham line between pixel centres. */
export function line(frame: Frame, x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(frame, ax, ay, ink);
    if (ax === bx && ay === by) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

export function vline(frame: Frame, x: number, y0: number, y1: number, ink: Ink): void {
  const top = Math.round(Math.min(y0, y1));
  const bottom = Math.round(Math.max(y0, y1));
  rect(frame, x, top, 1, bottom - top + 1, ink);
}

/** 50% gray. */
export const GRAY: (x: number, y: number) => Ink = (x, y) => ((x + y) & 1 ? 1 : 0);
/** 25% gray, sparse. */
export const LIGHT: (x: number, y: number) => Ink = (x, y) => (x % 2 === 0 && y % 2 === 0 ? 1 : 0);
