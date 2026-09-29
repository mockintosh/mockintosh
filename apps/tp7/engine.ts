/**
 * The TP-7's transport. One tape at a time sits under the head; the
 * microphone records new tape and the speaker plays tape back. Three things
 * can move it:
 *
 * - the motor — play runs the tape at 1× and spins up and down like one;
 * - the platter — hold the reel and the tape follows your finger, so a
 *   still finger stops it and a flick scrubs through it, pitch and all;
 * - the ring — the spring-loaded shuttle around the reel winds forward or
 *   back, faster the further it is turned.
 *
 * Nothing here knows about the display; it keeps a timeline of where the
 * head was when each block was rendered, so the reel and counter can follow
 * what the speaker is playing rather than what was rendered ahead.
 */
import type { AudioCaptureBlock, AudioRenderBlock } from "@mockintosh/sdk";
import { Timeline } from "../synth/timeline";

/** Frames summarised by one peak on the display. */
export const PEAK_BLOCK = 256;
/** The longest single recording, in seconds. */
export const MAX_TAKE_SECONDS = 600;
/** Tape per turn of the reel: one revolution of a 33⅓ rpm record. */
export const SECONDS_PER_TURN = 1.8;
/** Fastest the shuttle ring winds, as a multiple of normal speed. */
export const MAX_SHUTTLE_RATE = 10;

/** Time constant of the motor spinning up or down. */
const MOTOR_SECONDS = 0.07;
/** How closely the tape chases a finger on the platter. */
const SCRUB_SECONDS = 0.035;
const SCRUB_SMOOTH_SECONDS = 0.008;
const MAX_SCRUB_RATE = 8;
/** A speed this close to where it is heading has arrived. */
const SETTLED = 1e-3;
/** Below this speed the tape fades out, as a playback head's output falls with tape speed. */
const FULL_LEVEL_RATE = 1 / 3;
/** Meters fall by this factor per second. */
const METER_FALL_PER_SECOND = 0.02;
/** How long a clipped input keeps the clip light on. */
const CLIP_HOLD_SECONDS = 1;

/** A recording loaded for playback: mono samples at their own rate. */
export interface Tape {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** The loudest sample in each `PEAK_BLOCK` frames. */
  readonly peaks: Float32Array;
}

/** What is moving the tape right now. */
export type Drive = "motor" | "platter" | "ring";

export function computePeaks(samples: Float32Array): Float32Array {
  const peaks = new Float32Array(Math.ceil(samples.length / PEAK_BLOCK));
  for (let p = 0; p < peaks.length; p++) {
    let max = 0;
    const end = Math.min(samples.length, (p + 1) * PEAK_BLOCK);
    for (let i = p * PEAK_BLOCK; i < end; i++) {
      const s = Math.abs(samples[i]!);
      if (s > max) max = s;
    }
    peaks[p] = max;
  }
  return peaks;
}

/** The average of the channels: the TP-7 plays in mono. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const frames = channels[0]?.length ?? 0;
  const mono = new Float32Array(frames);
  for (const channel of channels) for (let i = 0; i < frames; i++) mono[i] += channel[i]! / channels.length;
  return mono;
}

export function makeTape(samples: Float32Array, sampleRate: number): Tape {
  return { samples, sampleRate, peaks: computePeaks(samples) };
}

/** Speed for a shuttle deflection of −1…1: gentle near the middle, `MAX_SHUTTLE_RATE` at the stops. */
export function shuttleRate(deflection: number): number {
  const d = Math.max(-1, Math.min(1, deflection));
  return Math.sign(d) * (0.5 + (MAX_SHUTTLE_RATE - 0.5) * d * d);
}

/**
 * A recording in progress. Audio arrives in one-second chunks so a long take
 * never reallocates, and peaks are kept as it grows.
 */
export class Take {
  readonly capacity: number;
  length = 0;
  readonly peaks: Float32Array;
  /** Marks dropped while recording, in frames. */
  readonly markers: number[] = [];
  private readonly chunks: Float32Array[] = [];
  private readonly chunkFrames: number;

  constructor(readonly sampleRate: number) {
    this.capacity = Math.round(sampleRate * MAX_TAKE_SECONDS);
    this.chunkFrames = Math.max(1, Math.round(sampleRate));
    this.peaks = new Float32Array(Math.ceil(this.capacity / PEAK_BLOCK));
  }

  get full(): boolean {
    return this.length >= this.capacity;
  }

  /** Append what the microphone heard; returns how many frames fitted. */
  append(samples: Float32Array): number {
    const n = Math.min(samples.length, this.capacity - this.length);
    for (let i = 0; i < n; i++) {
      const at = this.length + i;
      const c = Math.floor(at / this.chunkFrames);
      const chunk = (this.chunks[c] ??= new Float32Array(this.chunkFrames));
      const s = samples[i]!;
      chunk[at - c * this.chunkFrames] = s;
      const p = Math.floor(at / PEAK_BLOCK);
      const a = Math.abs(s);
      if (a > this.peaks[p]!) this.peaks[p] = a;
    }
    this.length += n;
    return n;
  }

  /** The take as one array. */
  samples(): Float32Array {
    const out = new Float32Array(this.length);
    for (let c = 0; c < this.chunks.length; c++) {
      const start = c * this.chunkFrames;
      if (start >= this.length) break;
      out.set(this.chunks[c]!.subarray(0, Math.min(this.chunkFrames, this.length - start)), start);
    }
    return out;
  }
}

export class Tp7Engine {
  tape: Tape | null = null;
  /** The frame under the head, fractional. */
  head = 0;
  /** The motor is running (play). */
  playing = false;
  volume = 0.8;
  /** The recording in progress, while recording. */
  take: Take | null = null;
  /** Set when the motor runs off the end of the tape; the UI clears it. */
  ended = false;
  /** Output rate, learned from the first rendered block. */
  outputRate = 48000;
  /** Stream frames rendered so far. */
  position = 0;
  /** The head (whole tape frames) at the start of each rendered block. */
  readonly heads = new Timeline(256, 0);
  /** Recent peak levels, 0…1. */
  inputLevel = 0;
  outputLevel = 0;
  /** Input frames left on the clip light. */
  clipHold = 0;
  /** The current tape speed, as a multiple of normal. */
  rate = 0;

  private platter: number | null = null;
  private ring = 0;

  get drive(): Drive {
    return this.platter !== null ? "platter" : this.ring !== 0 ? "ring" : "motor";
  }

  get length(): number {
    return this.tape?.samples.length ?? 0;
  }

  /** Put a tape under the head, parked at `head`. */
  load(tape: Tape | null, head = 0): void {
    this.tape = tape;
    this.playing = false;
    this.rate = 0;
    this.platter = null;
    this.ring = 0;
    this.head = this.clamp(head);
    this.heads.clear();
  }

  play(): void {
    if (!this.tape || this.take) return;
    if (this.head >= this.length - 1) this.head = 0;
    this.playing = true;
    this.ended = false;
  }

  stop(): void {
    this.playing = false;
  }

  seek(frame: number): void {
    this.head = this.clamp(frame);
    if (this.platter !== null) this.platter = this.head;
  }

  /** A finger lands on the platter: the tape stops under it. */
  grab(): void {
    this.platter = this.head;
  }

  /** The finger turns the platter by `frames` of tape. */
  turnPlatter(frames: number): void {
    if (this.platter === null) this.platter = this.head;
    this.platter = this.clamp(this.platter + frames);
  }

  /** The finger lets go; the motor takes over again. */
  release(): void {
    this.platter = null;
  }

  /** Turn the shuttle ring, −1 (full rewind) … 1 (full fast-forward); 0 lets it spring back. */
  shuttle(deflection: number): void {
    this.ring = Math.max(-1, Math.min(1, deflection));
  }

  startRecording(sampleRate: number): Take {
    this.playing = false;
    this.platter = null;
    this.ring = 0;
    this.take = new Take(sampleRate);
    return this.take;
  }

  stopRecording(): Take | null {
    const take = this.take;
    this.take = null;
    return take;
  }

  /** Where the tape is at `streamFrame`, as the speaker plays it. */
  headAt(streamFrame: number): number {
    return this.take ? this.take.length : this.heads.at(streamFrame);
  }

  capture(block: AudioCaptureBlock): void {
    const samples = block.channels[0]!;
    let peak = 0;
    for (let i = 0; i < block.frames; i++) {
      const a = Math.abs(samples[i]!);
      if (a > peak) peak = a;
    }
    this.inputLevel = Math.max(peak, this.inputLevel * Math.pow(METER_FALL_PER_SECOND, block.frames / block.sampleRate));
    this.clipHold = peak >= 0.99 ? Math.round(CLIP_HOLD_SECONDS * block.sampleRate) : Math.max(0, this.clipHold - block.frames);
    this.take?.append(samples);
  }

  render(block: AudioRenderBlock): void {
    const { frames, sampleRate } = block;
    this.outputRate = sampleRate;
    this.heads.push(block.position, Math.floor(this.head));
    this.position = block.position + frames;
    const fall = Math.pow(METER_FALL_PER_SECOND, frames / sampleRate);
    const tape = this.tape;
    if (!tape || tape.samples.length < 2) {
      this.rate = 0;
      this.outputLevel *= fall;
      return;
    }

    const samples = tape.samples;
    const last = samples.length - 1;
    const step = tape.sampleRate / sampleRate;
    const motorK = 1 - Math.exp(-1 / (MOTOR_SECONDS * sampleRate));
    const scrubK = 1 - Math.exp(-1 / (SCRUB_SMOOTH_SECONDS * sampleRate));
    const scrubSpan = SCRUB_SECONDS * tape.sampleRate;
    const ringRate = this.ring !== 0 ? shuttleRate(this.ring) : 0;
    const left = block.channels[0]!;
    const right = block.channels[1];
    let head = this.head;
    let rate = this.rate;
    let peak = 0;

    for (let i = 0; i < frames; i++) {
      let target: number;
      if (this.platter !== null) {
        const chase = Math.max(-MAX_SCRUB_RATE, Math.min(MAX_SCRUB_RATE, (this.platter - head) / scrubSpan));
        target = Math.abs(chase) < SETTLED ? 0 : chase;
        rate += (target - rate) * scrubK;
      } else {
        target = this.ring !== 0 ? ringRate : this.playing ? 1 : 0;
        rate += (target - rate) * motorK;
      }
      // The slew only approaches its target; close enough is there, so play is exactly 1× and stop is silent.
      if (Math.abs(target - rate) < SETTLED) rate = target;
      head += rate * step;
      if (head >= last) {
        head = last;
        rate = 0;
        if (this.playing && this.platter === null) {
          this.playing = false;
          this.ended = true;
        }
      } else if (head < 0) {
        head = 0;
        rate = 0;
      }
      const at = Math.floor(head);
      const frac = head - at;
      const s0 = samples[at]!;
      const s1 = samples[Math.min(last, at + 1)]!;
      const level = Math.min(1, Math.abs(rate) / FULL_LEVEL_RATE);
      const out = (s0 + (s1 - s0) * frac) * level * this.volume;
      left[i] = out;
      if (right) right[i] = out;
      const a = Math.abs(out);
      if (a > peak) peak = a;
    }

    this.head = head;
    this.rate = rate;
    this.outputLevel = Math.max(peak, this.outputLevel * fall);
  }

  private clamp(frame: number): number {
    return Math.max(0, Math.min(Math.max(0, this.length - 1), frame));
  }
}
