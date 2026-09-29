/**
 * The rhythm box: an analog-style kick, snare and hi-hat, synthesized from a
 * sine sweep and filtered noise, and a handful of one-bar grooves for them.
 */
import { Noise, StateVariableFilter, TAU } from "../synth/dsp";

export const STEPS_PER_BAR = 16;

export type DrumPart = "kick" | "snare" | "hat" | "openHat";

/** One bar, one line per part: `X` accent, `x` hit, `.` rest. */
export interface Rhythm {
  name: string;
  parts: Readonly<Partial<Record<DrumPart, string>>>;
}

export const RHYTHMS: readonly Rhythm[] = [
  {
    name: "ROCK",
    parts: { kick: "X.......X.x.....", snare: "....X.......X...", hat: "x.x.x.x.x.x.x.x." },
  },
  {
    name: "POP",
    parts: { kick: "X.....x.X.......", snare: "....X.......X..x", hat: "xxx.xxx.xxx.xxx.", openHat: "...x...x...x...x" },
  },
  {
    name: "DISCO",
    parts: { kick: "X...X...X...X...", snare: "....X.......X...", hat: "x.x.x.x.x.x.x.x.", openHat: "..x...x...x...x." },
  },
  {
    name: "BOSSA",
    parts: { kick: "X..xX..xX..xX..x", snare: "x..x..x...x..x..", hat: "xxxxxxxxxxxxxxxx" },
  },
  {
    name: "HIP-HOP",
    parts: { kick: "X......x..X.....", snare: "....X.......X...", hat: "x.x.x.xxx.x.x.x." },
  },
  {
    name: "CLICK",
    parts: { hat: "X...x...x...x..." },
  },
];

/** Velocity of a part on a step: 0 for a rest. */
function hitAt(rhythm: Rhythm, part: DrumPart, step: number): number {
  const line = rhythm.parts[part];
  const c = line?.[step % STEPS_PER_BAR];
  return c === "X" ? 1 : c === "x" ? 0.6 : 0;
}

const decayCoef = (seconds: number, sampleRate: number) => Math.exp(-1 / Math.max(1, seconds * sampleRate));

class Kick {
  private amp = 0;
  private sweep = 0;
  private phase = 0;
  private ampCoef = 0;
  private sweepCoef = 0;

  configure(sampleRate: number): void {
    this.ampCoef = decayCoef(0.3, sampleRate);
    this.sweepCoef = decayCoef(0.03, sampleRate);
  }

  trigger(velocity: number): void {
    this.amp = velocity;
    this.sweep = 1;
    this.phase = 0;
  }

  next(sampleRate: number): number {
    if (this.amp < 1e-4) return 0;
    this.phase += (46 + 130 * this.sweep) / sampleRate;
    if (this.phase >= 1) this.phase -= 1;
    const out = Math.sin(TAU * this.phase) * this.amp;
    this.amp *= this.ampCoef;
    this.sweep *= this.sweepCoef;
    return out;
  }
}

class Snare {
  private tone = 0;
  private rattle = 0;
  private phase = 0;
  private toneCoef = 0;
  private rattleCoef = 0;
  private readonly filter = new StateVariableFilter();

  constructor(private readonly noise: Noise) {}

  configure(sampleRate: number): void {
    this.toneCoef = decayCoef(0.045, sampleRate);
    this.rattleCoef = decayCoef(0.11, sampleRate);
    this.filter.setup(1600, 0.1, sampleRate);
  }

  trigger(velocity: number): void {
    this.tone = velocity;
    this.rattle = velocity;
    this.phase = 0;
  }

  next(sampleRate: number): number {
    if (this.rattle < 1e-4) return 0;
    this.phase += 190 / sampleRate;
    if (this.phase >= 1) this.phase -= 1;
    this.filter.process(this.noise.next());
    const out = Math.sin(TAU * this.phase) * this.tone * 0.5 + this.filter.high * this.rattle * 0.7;
    this.tone *= this.toneCoef;
    this.rattle *= this.rattleCoef;
    return out;
  }
}

/** One hi-hat for both lengths: an open hat is choked by the next closed one. */
class HiHat {
  private amp = 0;
  private coef = 0;
  private closedCoef = 0;
  private openCoef = 0;
  private readonly filter = new StateVariableFilter();

  constructor(private readonly noise: Noise) {}

  configure(sampleRate: number): void {
    this.closedCoef = decayCoef(0.022, sampleRate);
    this.openCoef = decayCoef(0.16, sampleRate);
    this.filter.setup(7500, 0.25, sampleRate);
  }

  trigger(velocity: number, open: boolean): void {
    this.amp = velocity;
    this.coef = open ? this.openCoef : this.closedCoef;
  }

  next(): number {
    if (this.amp < 1e-4) return 0;
    this.filter.process(this.noise.next());
    const out = this.filter.high * this.amp * 0.45;
    this.amp *= this.coef;
    return out;
  }
}

export class DrumKit {
  private readonly noise = new Noise(0xd5a1);
  private readonly kick = new Kick();
  private readonly snare = new Snare(this.noise);
  private readonly hat = new HiHat(this.noise);
  private sampleRate = 0;

  configure(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.kick.configure(sampleRate);
    this.snare.configure(sampleRate);
    this.hat.configure(sampleRate);
  }

  /** Strike one part. An open hat chokes a closed one, and the reverse. */
  hit(part: DrumPart, velocity: number): void {
    if (velocity <= 0) return;
    if (part === "kick") this.kick.trigger(velocity);
    else if (part === "snare") this.snare.trigger(velocity);
    else if (part === "openHat") this.hat.trigger(velocity, true);
    else this.hat.trigger(velocity, false);
  }

  /** Trigger every part that hits on `step` of `rhythm`. */
  playStep(rhythm: Rhythm, step: number): void {
    const kick = hitAt(rhythm, "kick", step);
    const snare = hitAt(rhythm, "snare", step);
    const hat = hitAt(rhythm, "hat", step);
    const openHat = hitAt(rhythm, "openHat", step);
    if (kick > 0) this.hit("kick", kick);
    if (snare > 0) this.hit("snare", snare);
    if (openHat > 0) this.hit("openHat", openHat);
    else if (hat > 0) this.hit("hat", hat);
  }

  /** Add `frames` samples into `left` / `right` from `offset`; the hat sits a little right. */
  render(left: Float32Array, right: Float32Array, offset: number, frames: number, level: number): void {
    const sr = this.sampleRate;
    for (let i = 0; i < frames; i++) {
      const center = (this.kick.next(sr) + this.snare.next(sr)) * level;
      const hat = this.hat.next() * level;
      left[offset + i] = left[offset + i]! + center + hat * 0.8;
      right[offset + i] = right[offset + i]! + center + hat * 1.2;
    }
  }
}
