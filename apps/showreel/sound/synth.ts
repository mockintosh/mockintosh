/**
 * Stateless synthesis. Every voice here is a closed-form function of the time
 * since its note began, so a soundtrack is a pure function of reel time, like
 * the pictures: scrub, loop or seek and the sound is simply correct.
 *
 * No filters with memory, no oscillators that accumulate phase — pitch sweeps
 * are integrated analytically, and "filtered" noise is value noise read at a
 * lower rate.
 */

export const TAU = Math.PI * 2;

/** Where a sample falls: reel seconds, sample index on the reel's clock, and the rate. */
export interface SampleClock {
  t: number;
  n: number;
  sampleRate: number;
}

/** A fast integer hash in −1…1. */
export function white(n: number, seed = 0): number {
  let h = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return (h & 0xffff) / 32767.5 - 1;
}

/**
 * Noise with its energy below about `rate` Hz: hashed values `rate` times a
 * second, joined smoothly. The stateless stand-in for low-passed noise.
 */
export function smoothNoise(t: number, rate: number, seed = 0): number {
  const x = t * rate;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return white(i, seed) * (1 - s) + white(i + 1, seed) * s;
}

export function sine(phase: number): number {
  return Math.sin(TAU * phase);
}

/** PolyBLEP correction for a step at phase 0, `dt` = cycles per sample. */
function blep(p: number, dt: number): number {
  if (p < dt) {
    const x = p / dt;
    return x + x - x * x - 1;
  }
  if (p > 1 - dt) {
    const x = (p - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** A band-limited pulse wave; `duty` 0.5 is square. */
export function pulse(phase: number, duty: number, dt: number): number {
  const p = phase - Math.floor(phase);
  let v = p < duty ? 1 : -1;
  v += blep(p, dt);
  const q = p - duty + (p < duty ? 1 : 0);
  v -= blep(q, dt);
  return v;
}

/** A band-limited sawtooth. */
export function saw(phase: number, dt: number): number {
  const p = phase - Math.floor(phase);
  return 2 * p - 1 - blep(p, dt);
}

/** Cycles elapsed after `dt` s of a pitch falling exponentially from f0 to f1 at `rate`/s. */
export function dropPhase(dt: number, f0: number, f1: number, rate: number): number {
  return f1 * dt + ((f0 - f1) * (1 - Math.exp(-rate * dt))) / rate;
}

/** Cycles elapsed after `dt` s of a linear sweep from f0 to f1 over `span` s, then held. */
export function sweepPhase(dt: number, f0: number, f1: number, span: number): number {
  if (dt < span) return f0 * dt + (0.5 * (f1 - f0) * dt * dt) / span;
  return f0 * span + 0.5 * (f1 - f0) * span + f1 * (dt - span);
}

/** Linear attack to 1, then exponential decay with time constant `decay`. */
export function perc(dt: number, attack: number, decay: number): number {
  if (dt < 0) return 0;
  if (dt < attack) return dt / attack;
  return Math.exp(-(dt - attack) / decay);
}

/** Attack, hold at 1 until `dur`, then release; clicks never, thanks to the ramps. */
export function gate(dt: number, dur: number, attack: number, release: number): number {
  if (dt < 0) return 0;
  const a = attack > 0 ? Math.min(1, dt / attack) : 1;
  if (dt <= dur) return a;
  return a * Math.max(0, 1 - (dt - dur) / release);
}
