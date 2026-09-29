/**
 * Voice to MIDI: the YIN pitch detector (de Cheveigné & Kawahara). It finds
 * the period of a hum by the first dip in the cumulative mean normalized
 * difference — the fundamental, not a harmonic — and reports it as a MIDI
 * note the scale snap can land on.
 *
 * `PitchTracker` is what the microphone callback uses. It keeps its buffers,
 * and the reading it returns is reused on the next block: copy out the note
 * before pushing again.
 */

export interface Pitch {
  hz: number;
  /** Fractional MIDI note, 69 = A4. */
  note: number;
  /** 0…1. A clean hum is near 1; noise sits lower. */
  clarity: number;
}

export type PitchReading = { kind: "silence" } | { kind: "unsure" } | ({ kind: "pitch" } & Pitch);

/** Lowest and highest hum the detector will call a note. */
const MIN_HZ = 70;
const MAX_HZ = 1000;
/** YIN's absolute threshold: the first dip below this is the period. */
const THRESHOLD = 0.15;
/** Quieter than this (RMS) is a breath, not a note. */
const SILENCE_RMS = 0.008;
/** A minimum this high is spoken noise, not a pitch. */
const UNPITCHED = 0.4;

const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440);

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/**
 * The pitch of one window, or null when it isn't a tone. `diff` and `cmndf`
 * are scratch; pass them to avoid allocating.
 */
export function detectPitch(samples: Float32Array, sampleRate: number, diff?: Float64Array, cmndf?: Float64Array): Pitch | null {
  const n = samples.length;
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(Math.floor(n / 2) - 1, Math.ceil(sampleRate / MIN_HZ));
  if (maxLag <= minLag + 1) return null;

  const difference = diff && diff.length > maxLag ? diff : new Float64Array(maxLag + 1);
  const normalized = cmndf && cmndf.length > maxLag ? cmndf : new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    const limit = n - tau;
    for (let i = 0; i < limit; i++) {
      const delta = samples[i]! - samples[i + tau]!;
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  normalized[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += difference[tau]!;
    normalized[tau] = running > 0 ? (difference[tau]! * tau) / running : 1;
  }

  let tau = minLag;
  while (tau <= maxLag && normalized[tau]! > THRESHOLD) tau++;
  if (tau > maxLag) {
    let best = minLag;
    for (let t = minLag + 1; t <= maxLag; t++) if (normalized[t]! < normalized[best]!) best = t;
    if (normalized[best]! > UNPITCHED) return null;
    tau = best;
  } else {
    while (tau + 1 <= maxLag && normalized[tau + 1]! < normalized[tau]!) tau++;
  }

  const left = normalized[tau - 1] ?? normalized[tau]!;
  const center = normalized[tau]!;
  const right = normalized[tau + 1] ?? center;
  const bend = left - 2 * center + right;
  const offset = bend === 0 ? 0 : (left - right) / (2 * bend);
  const period = tau + Math.max(-1, Math.min(1, offset));
  const hz = sampleRate / period;
  return { hz, note: midiOf(hz), clarity: Math.max(0, Math.min(1, 1 - center)) };
}

/** How many samples the tracker listens to at once, and how far it steps. */
export const PITCH_WINDOW = 2048;
export const PITCH_HOP = 1024;

/**
 * A running detector. `push` takes whatever the microphone just delivered
 * and returns a reading when a new window is ready, otherwise null.
 */
export class PitchTracker {
  private readonly ring: Float32Array;
  private readonly window: Float32Array;
  private readonly diff: Float64Array;
  private readonly cmndf: Float64Array;
  private write = 0;
  private count = 0;
  private sinceHop = 0;
  private readonly reading: PitchReading = { kind: "silence" };

  constructor(
    private readonly sampleRate: number,
    private readonly windowSize = PITCH_WINDOW,
    private readonly hop = PITCH_HOP,
  ) {
    this.ring = new Float32Array(windowSize);
    this.window = new Float32Array(windowSize);
    const maxLag = Math.ceil(sampleRate / MIN_HZ) + 2;
    this.diff = new Float64Array(maxLag);
    this.cmndf = new Float64Array(maxLag);
  }

  /** The latest reading, or null when this block didn't complete a window. */
  push(samples: Float32Array): PitchReading | null {
    let ready = false;
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.write] = samples[i]!;
      this.write = (this.write + 1) % this.ring.length;
      if (this.count < this.ring.length) this.count++;
      this.sinceHop++;
      if (this.count === this.ring.length && this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        this.copyWindow();
        ready = true;
      }
    }
    if (!ready) return null;
    return this.measure();
  }

  /** The ring, oldest sample first, into the analysis window. */
  private copyWindow(): void {
    const start = this.write;
    const tail = this.ring.length - start;
    this.window.set(this.ring.subarray(start));
    if (start > 0) this.window.set(this.ring.subarray(0, start), tail);
  }

  private measure(): PitchReading {
    if (rms(this.window) < SILENCE_RMS) {
      this.reading.kind = "silence";
      return this.reading;
    }
    const pitch = detectPitch(this.window, this.sampleRate, this.diff, this.cmndf);
    if (!pitch) {
      this.reading.kind = "unsure";
      return this.reading;
    }
    const reading = this.reading as { kind: "pitch" } & Pitch;
    reading.kind = "pitch";
    reading.hz = pitch.hz;
    reading.note = pitch.note;
    reading.clarity = pitch.clarity;
    return reading;
  }
}
