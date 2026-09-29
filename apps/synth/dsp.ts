/**
 * Signal-processing building blocks. Everything is per-sample arithmetic on
 * plain numbers: no allocation after construction, no host APIs, so the
 * engine renders the same in a worklet pump, a test, or on a board.
 */

export const TAU = Math.PI * 2;

/** Equal-tempered frequency of a (fractional) MIDI note. */
export function noteHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * PolyBLEP residual: subtracting it at a discontinuity band-limits a naive
 * saw or pulse, which is the difference between a synth and a buzzer.
 * `t` is the phase (0…1), `dt` the phase increment per sample.
 */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Oscillator shapes, in `WAVES` order. */
export const Wave = { Saw: 0, Square: 1, Triangle: 2, Sine: 3 } as const;

/** One sample of `wave` at `phase` (0…1). `width` is the pulse width of the square. */
export function oscillator(wave: number, phase: number, dt: number, width: number): number {
  switch (wave) {
    case Wave.Saw:
      return 2 * phase - 1 - polyBlep(phase, dt);
    case Wave.Square: {
      let v = phase < width ? 1 : -1;
      v += polyBlep(phase, dt);
      let t = phase - width;
      if (t < 0) t += 1;
      v -= polyBlep(t, dt);
      // A narrow pulse has a DC offset; centre it so width sweeps don't thump.
      return v - (2 * width - 1);
    }
    case Wave.Triangle:
      return 1 - 4 * Math.abs(phase - 0.5);
    default:
      return Math.sin(TAU * phase);
  }
}

/** Cheap rational tanh: close to `Math.tanh` within ±3, saturating beyond. */
export function softClip(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** xorshift32 white noise in −1…1. */
export class Noise {
  private state: number;
  constructor(seed = 0x9e3779b9) {
    this.state = seed | 0 || 1;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    return (x | 0) / 2147483648;
  }
  /** 0…1, for decisions rather than audio. */
  unit(): number {
    return (this.next() + 1) / 2;
  }
}

/**
 * Topology-preserving state-variable filter (Zavalishin). Stable under fast
 * modulation, which matters when an envelope sweeps the cutoff every sample.
 * `setup` takes the cutoff in Hz and resonance 0…1.
 */
export class StateVariableFilter {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 2;
  low = 0;
  band = 0;
  high = 0;

  setup(cutoffHz: number, resonance: number, sampleRate: number): void {
    const fc = Math.min(Math.max(cutoffHz, 10), sampleRate * 0.45);
    const g = Math.tan((Math.PI * fc) / sampleRate);
    this.k = 2 - 1.97 * Math.min(1, Math.max(0, resonance));
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  /** Copy another filter's coefficients (a cascade shares one cutoff). */
  copyCoefficients(from: StateVariableFilter, k: number): void {
    const g = from.a2 / from.a1;
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(input: number): void {
    const v3 = input - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = input - this.k * v1 - v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = this.low = this.band = this.high = 0;
  }
}

export const EnvelopeStage = { Idle: 0, Attack: 1, Decay: 2, Release: 3 } as const;
export type EnvelopeStage = (typeof EnvelopeStage)[keyof typeof EnvelopeStage];

/**
 * ADSR with a linear attack and exponential decay and release — the shape of
 * an analog envelope generator, near enough. Retriggering starts the attack
 * from the current level, so stolen voices don't click.
 */
export class Envelope {
  stage: EnvelopeStage = EnvelopeStage.Idle;
  value = 0;
  private attackStep = 1;
  private decayCoef = 0;
  private releaseCoef = 0;
  private sustain = 1;

  configure(attack: number, decay: number, sustain: number, release: number, sampleRate: number): void {
    this.attackStep = 1 / Math.max(1, attack * sampleRate);
    this.decayCoef = Math.exp(-5 / Math.max(1, decay * sampleRate));
    this.releaseCoef = Math.exp(-5 / Math.max(1, release * sampleRate));
    this.sustain = sustain;
  }

  gate(on: boolean): void {
    if (on) this.stage = EnvelopeStage.Attack;
    else if (this.stage !== EnvelopeStage.Idle) this.stage = EnvelopeStage.Release;
  }

  /** Advance one sample and return the level 0…1. */
  next(): number {
    switch (this.stage) {
      case EnvelopeStage.Attack:
        this.value += this.attackStep;
        if (this.value >= 1) {
          this.value = 1;
          this.stage = EnvelopeStage.Decay;
        }
        break;
      case EnvelopeStage.Decay:
        this.value = this.sustain + (this.value - this.sustain) * this.decayCoef;
        break;
      case EnvelopeStage.Release:
        this.value *= this.releaseCoef;
        if (this.value < 1e-4) {
          this.value = 0;
          this.stage = EnvelopeStage.Idle;
        }
        break;
      default:
        break;
    }
    return this.value;
  }

  get active(): boolean {
    return this.stage !== EnvelopeStage.Idle;
  }

  reset(): void {
    this.stage = EnvelopeStage.Idle;
    this.value = 0;
  }
}

/** LFO shapes, in `LFO_WAVES` order. */
const LfoWave = { Sine: 0, Triangle: 1, Square: 2, SampleHold: 3, Ramp: 4 } as const;

/** A free-running low-frequency oscillator, advanced once per control period. */
export class Lfo {
  private phase = 0;
  private hold = 0;

  constructor(private readonly random: Noise) {}

  /** Advance `frames` samples at `rate` Hz and return the level, −1…1. */
  advance(rate: number, wave: number, frames: number, sampleRate: number): number {
    this.phase += (rate * frames) / sampleRate;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.hold = this.random.next();
    }
    const t = this.phase;
    switch (wave) {
      case LfoWave.Triangle:
        return 1 - 4 * Math.abs(t - 0.5);
      case LfoWave.Square:
        return t < 0.5 ? 1 : -1;
      case LfoWave.SampleHold:
        return this.hold;
      case LfoWave.Ramp:
        return 1 - 2 * t;
      default:
        return Math.sin(TAU * t);
    }
  }
}

/** One-pole smoother for control values: `next(target)` eases towards it. */
export class Smoother {
  private coef: number;
  value: number;
  constructor(initial: number, timeSamples: number) {
    this.value = initial;
    this.coef = Math.exp(-1 / Math.max(1, timeSamples));
  }
  next(target: number): number {
    this.value = target + (this.value - target) * this.coef;
    return this.value;
  }
}
