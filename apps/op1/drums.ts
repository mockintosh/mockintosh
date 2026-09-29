/**
 * Drum mode: twenty-four synthesized pads, one per key. Every pad is the
 * same small voice — a pitched body that sweeps down (or up) to its note,
 * and a burst of filtered noise — described by a `PadSound`. The encoders
 * bend the last pad played: pitch, decay, brightness and level.
 */
import { Noise, StateVariableFilter, TAU, Wave, oscillator } from "../synth/dsp";
import { choiceParam, numberParam, type ParamDef } from "../synth/params";
import { percent, signed, type Quad, type QuadDefs } from "./params";

export const PAD_COUNT = 24;

export const NoiseMode = { Low: 0, Band: 1, High: 2 } as const;

export interface PadBody {
  hz: number;
  /** Starting pitch as a multiple of `hz`: above 1 falls, below 1 rises. */
  sweep: number;
  /** Seconds for the sweep to settle. */
  sweepTime: number;
  /** Seconds to fade. */
  decay: number;
  /** A `Wave`; sine by default. */
  wave?: number;
  /** A second, equally loud partial (cowbells, rides). */
  hz2?: number;
}

export interface PadNoise {
  hz: number;
  q: number;
  mode: number;
  decay: number;
  /** A clap: this many quick bursts before the tail. */
  bursts?: number;
}

export interface PadSound {
  name: string;
  body?: PadBody;
  noise?: PadNoise;
  /** Noise share when both parts are present, 0…1. */
  mix?: number;
  /** −1…1, scaled by the kit's spread. */
  pan?: number;
  /** Pads in the same group cut each other off (hats). */
  choke?: number;
}

const HATS = 1;

/** The kit, in key order from the low F. */
export const PADS: readonly PadSound[] = [
  { name: "KICK", body: { hz: 50, sweep: 3.2, sweepTime: 0.035, decay: 0.38 } },
  { name: "BOOM", body: { hz: 43, sweep: 2.2, sweepTime: 0.06, decay: 1.1 } },
  {
    name: "SNARE",
    body: { hz: 185, sweep: 1.4, sweepTime: 0.02, decay: 0.09 },
    noise: { hz: 1800, q: 0.2, mode: NoiseMode.High, decay: 0.16 },
    mix: 0.6,
  },
  {
    name: "RIM",
    body: { hz: 820, sweep: 1, sweepTime: 0.01, decay: 0.02, wave: Wave.Triangle },
    noise: { hz: 3000, q: 0.5, mode: NoiseMode.Band, decay: 0.012 },
    mix: 0.3,
    pan: -0.2,
  },
  {
    name: "SNARE 2",
    body: { hz: 230, sweep: 1.6, sweepTime: 0.015, decay: 0.06 },
    noise: { hz: 3500, q: 0.1, mode: NoiseMode.Band, decay: 0.22 },
    mix: 0.75,
  },
  { name: "CLAP", noise: { hz: 1200, q: 0.3, mode: NoiseMode.Band, decay: 0.2, bursts: 3 }, pan: 0.1 },
  { name: "C.HAT", noise: { hz: 8000, q: 0.3, mode: NoiseMode.High, decay: 0.035 }, pan: 0.35, choke: HATS },
  {
    name: "TOM L",
    body: { hz: 95, sweep: 1.5, sweepTime: 0.08, decay: 0.42 },
    noise: { hz: 600, q: 0.2, mode: NoiseMode.Band, decay: 0.05 },
    mix: 0.12,
    pan: -0.5,
  },
  { name: "P.HAT", noise: { hz: 7000, q: 0.2, mode: NoiseMode.High, decay: 0.07 }, pan: 0.35, choke: HATS },
  {
    name: "TOM M",
    body: { hz: 140, sweep: 1.5, sweepTime: 0.07, decay: 0.34 },
    noise: { hz: 900, q: 0.2, mode: NoiseMode.Band, decay: 0.04 },
    mix: 0.1,
    pan: -0.1,
  },
  { name: "O.HAT", noise: { hz: 7500, q: 0.25, mode: NoiseMode.High, decay: 0.5 }, pan: 0.35, choke: HATS },
  {
    name: "TOM H",
    body: { hz: 200, sweep: 1.5, sweepTime: 0.06, decay: 0.28 },
    noise: { hz: 1200, q: 0.2, mode: NoiseMode.Band, decay: 0.03 },
    mix: 0.1,
    pan: 0.3,
  },
  { name: "CRASH", noise: { hz: 5500, q: 0.1, mode: NoiseMode.High, decay: 1.6 }, pan: -0.4 },
  { name: "CONGA L", body: { hz: 210, sweep: 1.25, sweepTime: 0.015, decay: 0.22 }, pan: -0.3 },
  {
    name: "RIDE",
    body: { hz: 620, hz2: 910, sweep: 1, sweepTime: 0.01, decay: 0.8, wave: Wave.Square },
    noise: { hz: 9000, q: 0.5, mode: NoiseMode.Band, decay: 0.9 },
    mix: 0.75,
    pan: 0.45,
  },
  { name: "CONGA H", body: { hz: 310, sweep: 1.25, sweepTime: 0.012, decay: 0.17 }, pan: 0.3 },
  { name: "COWBELL", body: { hz: 540, hz2: 800, sweep: 1, sweepTime: 0.01, decay: 0.26, wave: Wave.Square }, pan: 0.2 },
  { name: "CLAVE", body: { hz: 2500, sweep: 1, sweepTime: 0.01, decay: 0.035 }, pan: -0.25 },
  { name: "SHAKER", noise: { hz: 6000, q: 0.3, mode: NoiseMode.Band, decay: 0.07 }, pan: 0.5 },
  { name: "ZAP", body: { hz: 90, sweep: 25, sweepTime: 0.05, decay: 0.16 } },
  { name: "BLIP", body: { hz: 1320, sweep: 1, sweepTime: 0.01, decay: 0.05, wave: Wave.Square }, pan: -0.4 },
  { name: "NOISE", noise: { hz: 2000, q: 0.1, mode: NoiseMode.Low, decay: 0.4 } },
  { name: "SUB", body: { hz: 36, sweep: 1.3, sweepTime: 0.02, decay: 1.4 } },
  {
    name: "GLITCH",
    body: { hz: 400, sweep: 0.25, sweepTime: 0.03, decay: 0.08, wave: Wave.Square },
    noise: { hz: 4000, q: 0.4, mode: NoiseMode.Band, decay: 0.02 },
    mix: 0.4,
  },
];

/** The encoders on a pad: how the last pad played is bent. */
export const PAD_DEFS: QuadDefs = [
  numberParam("pitch", "PITCH", "PAD PITCH", -12, 12, 0, signed(" st"), { step: 1, bipolar: true }),
  numberParam("decay", "DECAY", "PAD DECAY", 0.25, 4, 1, (v) => `x${v.toFixed(2)}`, { curve: "exp", bipolar: true }),
  numberParam("tone", "TONE", "PAD TONE", -1, 1, 0, (v) => signed("")(v * 100), { bipolar: true }),
  numberParam("level", "LEVEL", "PAD LEVEL", 0, 1, 0.8, percent),
];

/** Picks a pad by name, as the drum pattern page's fourth encoder does. */
export const PAD_CHOICE: ParamDef = choiceParam("pad", "PAD", "PAD", PADS.map((pad) => pad.name));

/** The encoders on the whole kit. */
export const KIT_DEFS: QuadDefs = [
  numberParam("tune", "TUNE", "KIT TUNE", -12, 12, 0, signed(" st"), { step: 1, bipolar: true }),
  numberParam("drive", "DRIVE", "KIT DRIVE", 0, 1, 0.15, percent),
  numberParam("spread", "SPREAD", "STEREO SPREAD", 0, 1, 0.5, percent),
  numberParam("level", "LEVEL", "KIT LEVEL", 0, 1, 0.8, percent),
];

const coefFor = (seconds: number, sampleRate: number) => Math.exp(-1 / Math.max(1, seconds * sampleRate));
const BURST_GAP = 0.011;
const BURST_DECAY = 0.009;

/** One pad's voice. Retriggering restarts it; it never steals from another pad. */
export class DrumVoice {
  private sound: PadSound = PADS[0]!;
  private bodyAmp = 0;
  private bodyCoef = 0;
  private sweep = 0;
  private sweepCoef = 0;
  private phase = 0;
  private phase2 = 0;
  private bodyHz = 0;
  private body2Hz = 0;
  private noiseAmp = 0;
  private noiseCoef = 0;
  private tailCoef = 0;
  private burstsLeft = 0;
  private burstTimer = 0;
  private burstGap = 0;
  private bodyGain = 0;
  private noiseGain = 0;
  private gainL = 0;
  private gainR = 0;
  private readonly filter = new StateVariableFilter();

  constructor(private readonly noise: Noise) {}

  get active(): boolean {
    return this.bodyAmp > 1e-4 || this.noiseAmp > 1e-4 || this.burstsLeft > 0;
  }

  get choke(): number | undefined {
    return this.sound.choke;
  }

  /**
   * Strike the pad. `edit` is its PITCH, DECAY, TONE, LEVEL; `tune` shifts the
   * whole kit in semitones and `spread` scales the pad's place in the stereo field.
   */
  trigger(sound: PadSound, edit: Quad, tune: number, spread: number, velocity: number, sampleRate: number): void {
    this.sound = sound;
    const [pitch, decay, tone, level] = edit;
    const ratio = Math.pow(2, (pitch + tune) / 12);
    const bright = Math.pow(2, tone * 1.5);
    const mix = sound.body && sound.noise ? sound.mix ?? 0.5 : sound.noise ? 1 : 0;
    const gain = level * velocity;
    this.bodyGain = (1 - mix) * gain;
    this.noiseGain = mix * gain;

    const body = sound.body;
    if (body) {
      this.bodyHz = body.hz * ratio;
      this.body2Hz = (body.hz2 ?? 0) * ratio;
      this.sweep = (body.sweep - 1) * (tone > 0 ? 1 + tone : 1);
      this.sweepCoef = coefFor(body.sweepTime, sampleRate);
      this.bodyCoef = coefFor(body.decay * decay * 0.25, sampleRate);
      this.bodyAmp = 1;
      this.phase = 0;
      this.phase2 = 0.3;
    } else {
      this.bodyAmp = 0;
    }

    const noise = sound.noise;
    if (noise) {
      this.filter.reset();
      this.filter.setup(Math.min(sampleRate * 0.45, noise.hz * ratio * bright), noise.q, sampleRate);
      this.tailCoef = coefFor(noise.decay * decay * 0.25, sampleRate);
      this.noiseAmp = 1;
      this.burstsLeft = Math.max(0, (noise.bursts ?? 1) - 1);
      this.burstGap = Math.round(BURST_GAP * sampleRate);
      this.burstTimer = this.burstGap;
      this.noiseCoef = this.burstsLeft > 0 ? coefFor(BURST_DECAY, sampleRate) : this.tailCoef;
    } else {
      this.noiseAmp = 0;
      this.burstsLeft = 0;
    }

    const angle = ((Math.max(-1, Math.min(1, (sound.pan ?? 0) * spread * 1.6)) + 1) * Math.PI) / 4;
    this.gainL = Math.cos(angle) * Math.SQRT2;
    this.gainR = Math.sin(angle) * Math.SQRT2;
  }

  /** Cut the pad off quickly, as the closed hat does to the open one. */
  stop(): void {
    this.burstsLeft = 0;
    this.bodyAmp = Math.min(this.bodyAmp, 0.01);
    this.noiseAmp = Math.min(this.noiseAmp, 0.01);
  }

  render(left: Float32Array, right: Float32Array, offset: number, frames: number, sampleRate: number): void {
    const sound = this.sound;
    const body = sound.body;
    const noise = sound.noise;
    const wave = body?.wave ?? Wave.Sine;
    for (let i = 0; i < frames; i++) {
      let x = 0;
      if (body && this.bodyAmp > 1e-4) {
        const f = this.bodyHz * (1 + this.sweep);
        const dt = Math.min(0.49, f / sampleRate);
        let s = wave === Wave.Sine ? Math.sin(TAU * this.phase) : oscillator(wave, this.phase, dt, 0.5);
        this.phase += dt;
        if (this.phase >= 1) this.phase -= 1;
        if (this.body2Hz > 0) {
          const dt2 = Math.min(0.49, (this.body2Hz * (1 + this.sweep)) / sampleRate);
          s = (s + oscillator(wave, this.phase2, dt2, 0.5)) * 0.5;
          this.phase2 += dt2;
          if (this.phase2 >= 1) this.phase2 -= 1;
        }
        x += s * this.bodyAmp * this.bodyGain;
        this.bodyAmp *= this.bodyCoef;
        this.sweep *= this.sweepCoef;
      }
      if (noise && (this.noiseAmp > 1e-4 || this.burstsLeft > 0)) {
        if (this.burstsLeft > 0 && --this.burstTimer <= 0) {
          this.burstsLeft--;
          this.burstTimer = this.burstGap;
          this.noiseAmp = 1;
          if (this.burstsLeft === 0) this.noiseCoef = this.tailCoef;
        }
        this.filter.process(this.noise.next());
        const n = noise.mode === NoiseMode.Low ? this.filter.low : noise.mode === NoiseMode.Band ? this.filter.band * 1.5 : this.filter.high;
        x += n * this.noiseAmp * this.noiseGain;
        this.noiseAmp *= this.noiseCoef;
      }
      left[offset + i] = left[offset + i]! + x * this.gainL;
      right[offset + i] = right[offset + i]! + x * this.gainR;
    }
  }
}
