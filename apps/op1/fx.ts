/**
 * The effect slot every instrument has: a tape-ish delay, a spring-ish
 * reverb, an envelope-following filter, and a telephone. Like the engines,
 * each has exactly four parameters.
 */
import { StateVariableFilter, softClip } from "../synth/dsp";
import { PingPongDelay, Reverb } from "../synth/effects";
import { DELAY_DIVISIONS, choiceParam, formatHz, numberParam } from "../synth/params";
import { percent, signed, type Quad, type QuadDefs } from "./params";

export const FxKind = { Delay: 0, Spring: 1, Nitro: 2, Phone: 3 } as const;
export const NITRO_TYPES = ["LOW", "BAND", "HIGH"] as const;

export interface FxDef {
  name: string;
  defs: QuadDefs;
}

const unit = (key: string, label: string, name: string, fallback: number) =>
  numberParam(key, label, name, 0, 1, fallback, percent);

export const FX: readonly FxDef[] = [
  {
    name: "DELAY",
    defs: [
      choiceParam("time", "TIME", "DELAY TIME", DELAY_DIVISIONS.map((d) => d.label), 3),
      numberParam("feedback", "FDBK", "FEEDBACK", 0, 0.92, 0.45, percent),
      unit("mix", "MIX", "DELAY MIX", 0.25),
      unit("wobble", "WOBBLE", "TAPE WOBBLE", 0.15),
    ],
  },
  {
    name: "SPRING",
    defs: [
      unit("size", "SIZE", "ROOM SIZE", 0.55),
      unit("damp", "DAMP", "DAMPING", 0.4),
      unit("mix", "MIX", "REVERB MIX", 0.3),
      unit("width", "WIDTH", "STEREO WIDTH", 0.5),
    ],
  },
  {
    name: "NITRO",
    defs: [
      numberParam("cutoff", "CUTOFF", "CUTOFF", 60, 16000, 2000, formatHz, { curve: "exp" }),
      unit("reso", "RESO", "RESONANCE", 0.45),
      numberParam("env", "ENV", "ENVELOPE", -1, 1, 0.4, (v) => signed("")(v * 100), { bipolar: true }),
      choiceParam("type", "TYPE", "FILTER TYPE", NITRO_TYPES),
    ],
  },
  {
    name: "PHONE",
    defs: [
      numberParam("low", "LOW", "LOW CUT", 80, 2000, 450, formatHz, { curve: "exp" }),
      numberParam("high", "HIGH", "HIGH CUT", 800, 9000, 3200, formatHz, { curve: "exp" }),
      unit("crush", "CRUSH", "CRUSH", 0.3),
      unit("gain", "GAIN", "GAIN", 0.35),
    ],
  },
];

/** Hz of the delay's tape wobble. */
const WOBBLE_RATE = 0.6;
const NITRO_CONTROL = 16;
/**
 * How strongly NITRO hears the level it follows. A voice played normally
 * reads about a quarter, so without this the ENVELOPE amount would only
 * reach a quarter of its six octaves.
 */
const NITRO_SENSITIVITY = 3;

/** One instrument's effect slot. Every kind keeps its state, so switching back resumes its tail. */
export class FxRack {
  private readonly delay: PingPongDelay;
  private readonly reverb: Reverb;
  private wobble = 0;
  private readonly nitroL = new StateVariableFilter();
  private readonly nitroR = new StateVariableFilter();
  private follower = 0;
  private readonly followAttack: number;
  private readonly followRelease: number;
  private readonly phoneLow = new StateVariableFilter();
  private readonly phoneHigh = new StateVariableFilter();
  private phoneHeld = 0;
  private phoneCount = 0;

  constructor(private readonly sampleRate: number) {
    this.delay = new PingPongDelay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.followAttack = 1 - Math.exp(-1 / (0.004 * sampleRate));
    this.followRelease = 1 - Math.exp(-1 / (0.18 * sampleRate));
  }

  /** Process a stereo block in place. `stepFrames` is a sixteenth note, for the delay. */
  process(kind: number, p: Quad, left: Float32Array, right: Float32Array, frames: number, stepFrames: number): void {
    switch (kind) {
      case FxKind.Delay:
        return this.processDelay(p, left, right, frames, stepFrames);
      case FxKind.Spring:
        return this.processSpring(p, left, right, frames);
      case FxKind.Nitro:
        return this.processNitro(p, left, right, frames);
      case FxKind.Phone:
        return this.processPhone(p, left, right, frames);
      default:
        return;
    }
  }

  private processDelay(p: Quad, left: Float32Array, right: Float32Array, frames: number, stepFrames: number): void {
    this.wobble += (WOBBLE_RATE * frames) / this.sampleRate;
    if (this.wobble >= 1) this.wobble -= 1;
    const steps = DELAY_DIVISIONS[Math.round(p[0])]?.steps ?? 4;
    const wow = 1 + p[3] * 0.02 * Math.sin(2 * Math.PI * this.wobble);
    this.delay.process(left, right, frames, steps * stepFrames * wow, p[1], p[2]);
  }

  private processSpring(p: Quad, left: Float32Array, right: Float32Array, frames: number): void {
    this.reverb.process(left, right, frames, p[2], 0.7 + 0.28 * p[0], p[1]);
    const width = p[3] * 2;
    if (Math.abs(width - 1) < 0.01) return;
    for (let i = 0; i < frames; i++) {
      const mid = (left[i]! + right[i]!) * 0.5;
      const side = (left[i]! - right[i]!) * 0.5 * width;
      left[i] = mid + side;
      right[i] = mid - side;
    }
  }

  private processNitro(p: Quad, left: Float32Array, right: Float32Array, frames: number): void {
    const sr = this.sampleRate;
    const [cutoff, reso, amount, type] = p;
    for (let start = 0; start < frames; start += NITRO_CONTROL) {
      const end = Math.min(frames, start + NITRO_CONTROL);
      let level = 0;
      for (let i = start; i < end; i++) level = Math.max(level, Math.abs(left[i]!) + Math.abs(right[i]!));
      const coef = level > this.follower ? this.followAttack : this.followRelease;
      this.follower += (level - this.follower) * (1 - Math.pow(1 - coef, end - start));
      const hz = cutoff * Math.pow(2, Math.min(1, this.follower * NITRO_SENSITIVITY) * amount * 6);
      this.nitroL.setup(hz, reso * 0.95, sr);
      this.nitroR.setup(hz, reso * 0.95, sr);
      for (let i = start; i < end; i++) {
        this.nitroL.process(left[i]!);
        this.nitroR.process(right[i]!);
        if (type === 0) {
          left[i] = this.nitroL.low;
          right[i] = this.nitroR.low;
        } else if (type === 1) {
          left[i] = this.nitroL.band * 1.6;
          right[i] = this.nitroR.band * 1.6;
        } else {
          left[i] = this.nitroL.high;
          right[i] = this.nitroR.high;
        }
      }
    }
  }

  private processPhone(p: Quad, left: Float32Array, right: Float32Array, frames: number): void {
    const [low, high, crush, gain] = p;
    const sr = this.sampleRate;
    this.phoneLow.setup(low, 0.3, sr);
    this.phoneHigh.setup(Math.max(low * 1.2, high), 0.3, sr);
    const drive = 1 + gain * 10;
    const makeup = 1.4 / (1 + gain * 2);
    const levels = Math.pow(2, 12 - crush * 9);
    const hold = 1 + Math.floor(crush * 8);
    for (let i = 0; i < frames; i++) {
      const x = softClip((left[i]! + right[i]!) * 0.5 * drive);
      this.phoneLow.process(x);
      this.phoneHigh.process(this.phoneLow.high);
      if (++this.phoneCount >= hold) {
        this.phoneCount = 0;
        this.phoneHeld = Math.round(this.phoneHigh.low * levels) / levels;
      }
      left[i] = right[i] = this.phoneHeld * makeup;
    }
  }
}
