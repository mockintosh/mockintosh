/**
 * Timing vocabulary for the reel: progress through a window of time, the
 * easing curves a motion designer reaches for, and a deterministic hash so
 * every frame is a pure function of `t` (scrubbing backwards just works).
 */

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** Progress of `t` through `[start, end]`, clamped to `[0, 1]`. */
export function seg(t: number, start: number, end: number): number {
  return clamp01((t - start) / (end - start));
}

export function easeInCubic(k: number): number {
  return k * k * k;
}

export function easeOutCubic(k: number): number {
  const x = 1 - k;
  return 1 - x * x * x;
}

export function easeInOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

export function easeInOutQuart(k: number): number {
  return k < 0.5 ? 8 * k ** 4 : 1 - Math.pow(-2 * k + 2, 4) / 2;
}

export function easeInExpo(k: number): number {
  return k <= 0 ? 0 : Math.pow(2, 10 * k - 10);
}

export function easeOutExpo(k: number): number {
  return k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
}

/** Overshoots past 1 and settles; `overshoot` 1.7 is the classic Penner value. */
export function easeOutBack(k: number, overshoot = 1.70158): number {
  const c3 = overshoot + 1;
  const x = k - 1;
  return 1 + c3 * x * x * x + overshoot * x * x;
}

export function easeInOutBack(k: number, overshoot = 1.70158): number {
  const c2 = overshoot * 1.525;
  return k < 0.5
    ? (Math.pow(2 * k, 2) * ((c2 + 1) * 2 * k - c2)) / 2
    : (Math.pow(2 * k - 2, 2) * ((c2 + 1) * (k * 2 - 2) + c2) + 2) / 2;
}

/** Deterministic pseudo-random in `[0, 1)` for an integer (and optional salt). */
export function hash(n: number, salt = 0): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
