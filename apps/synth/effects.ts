/**
 * The effects rack, in signal order: lo-fi DAC, chorus, ping-pong delay,
 * reverb. Each processes a stereo block in place.
 */
import { Smoother } from "./dsp";

function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size <<= 1;
  return size;
}

/** Linear-interpolated read `delay` samples behind `write` in a power-of-two ring. */
function readDelay(buffer: Float32Array, mask: number, write: number, delay: number): number {
  const position = write - delay;
  const i = Math.floor(position);
  const frac = position - i;
  const a = buffer[i & mask]!;
  const b = buffer[(i + 1) & mask]!;
  return a + (b - a) * frac;
}

/** The original Macintosh sound hardware ran its DAC at 22254.54 Hz (the horizontal line rate). */
export const MAC_128K_RATE = 22254.54;

export const LofiMode = { Off: 0, Mac128K: 1, OneBit: 2 } as const;

/**
 * Plays the mix through an older speaker: the Macintosh 128K's 8-bit mono
 * DAC at 22 kHz, or a 1-bit beeper at the same rate. Sample-and-hold keeps
 * the aliasing that made those machines sound the way they did.
 */
export class Lofi {
  private phase = 0;
  private held = 0;
  private oneBit = 0;
  private lowpass = 0;
  private highpass = 0;
  private lastIn = 0;

  process(left: Float32Array, right: Float32Array, frames: number, mode: number, sampleRate: number): void {
    if (mode === LofiMode.Off) return;
    const step = MAC_128K_RATE / sampleRate;
    const lp = 1 - Math.exp((-2 * Math.PI * 7000) / sampleRate);
    const hp = Math.exp((-2 * Math.PI * 140) / sampleRate);
    for (let i = 0; i < frames; i++) {
      this.phase += step;
      if (this.phase >= 1) {
        this.phase -= 1;
        const x = (left[i]! + right[i]!) * 0.5;
        if (mode === LofiMode.Mac128K) {
          this.held = Math.round(Math.max(-1, Math.min(1, x)) * 127) / 127;
        } else {
          // A beeper is on or off; silence stays silent, and a little
          // hysteresis keeps a quiet tail from chattering.
          if (Math.abs(x) < 0.002) this.oneBit = 0;
          else if (x > 0.01) this.oneBit = 0.3;
          else if (x < -0.01) this.oneBit = -0.3;
          this.held = this.oneBit;
        }
      }
      // A small speaker: no deep bass, soft top.
      this.lowpass += (this.held - this.lowpass) * lp;
      this.highpass = hp * (this.highpass + this.lowpass - this.lastIn);
      this.lastIn = this.lowpass;
      left[i] = right[i] = this.highpass;
    }
  }
}

/**
 * Juno-style chorus: one bucket-brigade-like delay of the mono mix, read by
 * a triangle LFO on the left and its inverse on the right.
 */
export class Chorus {
  private readonly buffer: Float32Array;
  private readonly mask: number;
  private write = 0;
  private phase = 0;
  private readonly center: number;
  private readonly depth: number;
  private readonly rate: number;

  constructor(sampleRate: number) {
    const size = nextPowerOfTwo(Math.ceil(sampleRate * 0.05));
    this.buffer = new Float32Array(size);
    this.mask = size - 1;
    this.center = sampleRate * 0.0075;
    this.depth = sampleRate * 0.0035;
    this.rate = 0.55 / sampleRate;
  }

  process(left: Float32Array, right: Float32Array, frames: number, mix: number): void {
    if (mix <= 0.0005) return;
    const { buffer, mask } = this;
    for (let i = 0; i < frames; i++) {
      const dry = (left[i]! + right[i]!) * 0.5;
      buffer[this.write & mask] = dry;
      this.phase += this.rate;
      if (this.phase >= 1) this.phase -= 1;
      const tri = 1 - 4 * Math.abs(this.phase - 0.5);
      const wetL = readDelay(buffer, mask, this.write, this.center + this.depth * tri);
      const wetR = readDelay(buffer, mask, this.write, this.center - this.depth * tri);
      left[i] = (left[i]! + wetL * mix) / (1 + mix * 0.4);
      right[i] = (right[i]! + wetR * mix) / (1 + mix * 0.4);
      this.write++;
    }
  }
}

/**
 * Tempo-synced ping-pong delay. The mono input enters the left line, whose
 * echo feeds the right, whose echo feeds the left. The delay time eases to a
 * new tempo like tape, rather than jumping and clicking.
 */
export class PingPongDelay {
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly mask: number;
  private write = 0;
  private readonly time: Smoother;
  private dampL = 0;
  private dampR = 0;
  private readonly damp: number;

  constructor(sampleRate: number, maxSeconds = 3.2) {
    const size = nextPowerOfTwo(Math.ceil(sampleRate * maxSeconds));
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
    this.mask = size - 1;
    this.time = new Smoother(sampleRate * 0.5, sampleRate * 0.08);
    this.damp = 1 - Math.exp((-2 * Math.PI * 4500) / sampleRate);
  }

  process(
    left: Float32Array,
    right: Float32Array,
    frames: number,
    delayFrames: number,
    feedback: number,
    mix: number,
  ): void {
    const { mask } = this;
    const target = Math.min(this.mask - 2, Math.max(1, delayFrames));
    for (let i = 0; i < frames; i++) {
      const delay = this.time.next(target);
      const echoL = readDelay(this.left, mask, this.write, delay);
      const echoR = readDelay(this.right, mask, this.write, delay);
      const input = (left[i]! + right[i]!) * 0.5;
      this.dampL += (input + echoR * feedback - this.dampL) * this.damp;
      this.dampR += (echoL * feedback - this.dampR) * this.damp;
      this.left[this.write & mask] = this.dampL;
      this.right[this.write & mask] = this.dampR;
      left[i] = left[i]! + echoL * mix;
      right[i] = right[i]! + echoR * mix;
      this.write++;
    }
  }
}

class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private store = 0;
  constructor(size: number) {
    this.buffer = new Float32Array(Math.max(1, size));
  }
  process(input: number, feedback: number, damp: number): number {
    const out = this.buffer[this.index]!;
    this.store = out * (1 - damp) + this.store * damp;
    this.buffer[this.index] = input + this.store * feedback;
    if (++this.index >= this.buffer.length) this.index = 0;
    return out;
  }
}

class Allpass {
  private readonly buffer: Float32Array;
  private index = 0;
  constructor(size: number) {
    this.buffer = new Float32Array(Math.max(1, size));
  }
  process(input: number): number {
    const delayed = this.buffer[this.index]!;
    this.buffer[this.index] = input + delayed * 0.5;
    if (++this.index >= this.buffer.length) this.index = 0;
    return delayed - input;
  }
}

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

/** Jezar's Freeverb: eight damped combs into four allpasses per side. */
export class Reverb {
  private readonly combsL: Comb[];
  private readonly combsR: Comb[];
  private readonly allpassL: Allpass[];
  private readonly allpassR: Allpass[];

  constructor(sampleRate: number) {
    const scale = sampleRate / 44100;
    this.combsL = COMB_TUNING.map((n) => new Comb(Math.round(n * scale)));
    this.combsR = COMB_TUNING.map((n) => new Comb(Math.round((n + STEREO_SPREAD) * scale)));
    this.allpassL = ALLPASS_TUNING.map((n) => new Allpass(Math.round(n * scale)));
    this.allpassR = ALLPASS_TUNING.map((n) => new Allpass(Math.round((n + STEREO_SPREAD) * scale)));
  }

  /** `feedback` sets the room size (0.7 small … 0.98 huge); `damp` darkens the tail (0…1). */
  process(left: Float32Array, right: Float32Array, frames: number, mix: number, feedback = 0.86, damp = 0.3): void {
    if (mix <= 0.0005) return;
    const wet = mix * 1.1;
    for (let i = 0; i < frames; i++) {
      const input = (left[i]! + right[i]!) * 0.015;
      let outL = 0;
      let outR = 0;
      for (let c = 0; c < 8; c++) {
        outL += this.combsL[c]!.process(input, feedback, damp);
        outR += this.combsR[c]!.process(input, feedback, damp);
      }
      for (let a = 0; a < 4; a++) {
        outL = this.allpassL[a]!.process(outL);
        outR = this.allpassR[a]!.process(outR);
      }
      left[i] = left[i]! + outL * wet;
      right[i] = right[i]! + outR * wet;
    }
  }
}
