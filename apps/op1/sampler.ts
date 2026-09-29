/**
 * The sampler's sound material: a few seconds of mono audio that the SAMPLER
 * engine plays back across the keyboard. A take is recorded from the OP-1's
 * own output (resampling) or from the Macintosh's speaker, where every other
 * app plays — the way the OP-1 samples its radio. Until something is recorded
 * a slot plays a factory "aah".
 */
import { decodeWav, encodeWav } from "@mockintosh/sdk";
import { Noise, StateVariableFilter, TAU, noteHz } from "../synth/dsp";

/** Longest take, as on the OP-1's synth sampler. */
export const SAMPLE_SECONDS = 6;
/** The note a sample plays at its own pitch: middle C. */
export const SAMPLE_ROOT = 60;

export interface Sample {
  readonly data: Float32Array;
  readonly sampleRate: number;
}

export type SampleSource = "op1" | "speaker";

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function sampleToWav(sample: Sample): Uint8Array {
  return encodeWav([sample.data], sample.sampleRate);
}

/** A sample from WAVE bytes: channels mixed to mono, cut to `SAMPLE_SECONDS`. */
export function sampleFromWav(bytes: Uint8Array): Sample | null {
  const wav = decodeWav(bytes);
  if (!wav || wav.channels.length === 0) return null;
  const frames = Math.min(wav.channels[0]!.length, Math.round(SAMPLE_SECONDS * wav.sampleRate));
  if (frames === 0) return null;
  const data = new Float32Array(frames);
  const scale = 1 / wav.channels.length;
  for (const channel of wav.channels) for (let i = 0; i < frames; i++) data[i] = data[i]! + channel[i]! * scale;
  return { data, sampleRate: wav.sampleRate };
}

/** Each of `columns` columns' loudest sample, 0…1, for drawing the waveform. */
export function samplePeaks(sample: Sample, columns: number): Float32Array {
  const peaks = new Float32Array(columns);
  const per = sample.data.length / columns;
  for (let c = 0; c < columns; c++) {
    let peak = 0;
    const end = Math.min(sample.data.length, Math.ceil((c + 1) * per));
    for (let i = Math.floor(c * per); i < end; i++) peak = Math.max(peak, Math.abs(sample.data[i]!));
    peaks[c] = Math.min(1, peak);
  }
  return peaks;
}

// ---------------------------------------------------------------------------
// The factory sample
// ---------------------------------------------------------------------------

/** Formants of an open "ah": centre, gain, resonance. */
const AH_FORMANTS = [
  [730, 1, 0.9],
  [1090, 0.5, 0.92],
  [2440, 0.25, 0.93],
] as const;

/** A sung "aah" at middle C: a glottal pulse through three formants, with late vibrato. */
export function factorySample(sampleRate = 48000): Sample {
  const seconds = 1.6;
  const frames = Math.round(seconds * sampleRate);
  const data = new Float32Array(frames);
  const filters = AH_FORMANTS.map(([hz, , resonance]) => {
    const filter = new StateVariableFilter();
    filter.setup(hz, resonance, sampleRate);
    return filter;
  });
  const noise = new Noise(0x5a1e);
  const f0 = noteHz(SAMPLE_ROOT);
  let phase = 0;
  let last = 0;
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const vibrato = 1 + 0.006 * Math.sin(TAU * 5.2 * t) * Math.min(1, Math.max(0, (t - 0.25) / 0.4));
    phase += (f0 * vibrato) / sampleRate;
    if (phase >= 1) phase -= 1;
    // Rosenberg's glottal pulse: open, close, rest. Its slope is what the throat hears.
    const pulse = phase < 0.4 ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.4)) : phase < 0.56 ? Math.cos((Math.PI * (phase - 0.4)) / 0.32) : 0;
    const source = (pulse - last) * 8 + noise.next() * 0.04;
    last = pulse;
    let y = 0;
    filters.forEach((filter, k) => {
      filter.process(source);
      y += filter.band * AH_FORMANTS[k]![1];
    });
    const envelope = Math.min(1, t / 0.06) * Math.min(1, Math.max(0, (seconds - t) / 0.35));
    data[i] = y * envelope;
    peak = Math.max(peak, Math.abs(data[i]!));
  }
  const gain = peak > 0 ? 0.8 / peak : 1;
  for (let i = 0; i < frames; i++) data[i] = data[i]! * gain;
  return { data, sampleRate };
}

let factory: Sample | null = null;

/** The factory sample, made once: what a slot plays until something is recorded into it. */
export function defaultSample(): Sample {
  factory ??= factorySample();
  return factory;
}

// ---------------------------------------------------------------------------
// Recording a take
// ---------------------------------------------------------------------------

/** How loud the source must get before an armed take starts: −40 dB. */
const THRESHOLD = 0.01;
const SHORTEST_TAKE = 0.02;
const FADE_OUT = 0.005;
/** A quiet take is lifted towards this peak, by at most `MAX_GAIN`. */
const TARGET_PEAK = 0.9;
const MAX_GAIN = 4;

/**
 * `armed` waits for sound, `recording` keeps it, `full` has run out of room
 * and waits to be finished.
 */
export type RecorderState = "idle" | "armed" | "recording" | "full";

export class SampleRecorder {
  state: RecorderState = "idle";
  sampleRate = 48000;
  /** The take so far is `data.subarray(0, length)`. */
  data = new Float32Array(0);
  length = 0;

  get listening(): boolean {
    return this.state === "armed" || this.state === "recording";
  }

  get progress(): number {
    return this.data.length > 0 ? this.length / this.data.length : 0;
  }

  /** Get ready for a take at `sampleRate`; it starts with the first sound. */
  arm(sampleRate: number): void {
    this.sampleRate = sampleRate;
    const frames = Math.round(SAMPLE_SECONDS * sampleRate);
    if (this.data.length !== frames) this.data = new Float32Array(frames);
    this.length = 0;
    this.state = "armed";
  }

  /** Keep frames `start` up to `end` of the source, mixed to mono. */
  write(left: Float32Array, right: Float32Array, start: number, end: number): void {
    if (!this.listening) return;
    const data = this.data;
    for (let i = start; i < end; i++) {
      const mono = (left[i]! + right[i]!) * 0.5;
      if (this.state === "armed") {
        if (mono < THRESHOLD && mono > -THRESHOLD) continue;
        this.state = "recording";
      }
      data[this.length++] = mono;
      if (this.length >= data.length) {
        this.state = "full";
        return;
      }
    }
  }

  cancel(): void {
    this.state = "idle";
    this.length = 0;
  }

  /** End the take: faded out at the end and lifted if quiet. `null` if nothing loud enough arrived. */
  finish(): Sample | null {
    const frames = this.length;
    this.state = "idle";
    this.length = 0;
    if (frames < SHORTEST_TAKE * this.sampleRate) return null;
    const data = this.data.slice(0, frames);
    const fade = Math.min(frames, Math.round(FADE_OUT * this.sampleRate));
    for (let i = 0; i < fade; i++) data[frames - 1 - i] = data[frames - 1 - i]! * (i / fade);
    let peak = 0;
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(data[i]!));
    const gain = peak > 0 ? Math.min(MAX_GAIN, Math.max(1, TARGET_PEAK / peak)) : 1;
    if (gain > 1) for (let i = 0; i < frames; i++) data[i] = data[i]! * gain;
    return { data, sampleRate: this.sampleRate };
  }
}

// ---------------------------------------------------------------------------
// Listening to the speaker
// ---------------------------------------------------------------------------

/** What `MonitorTap` needs of an `AudioMonitor`. */
export interface MonitorSource {
  readonly sampleRate: number;
  readonly capacity: number;
  read(left: Float32Array, right: Float32Array): void;
}

/** Frames of the previous look matched against the new one. */
const PROBE = 256;
/** How far the match may land from where the clock says it should, in frames. */
const SLACK = 1536;
/** Relative error under which a match counts as exact. */
const EXACT = 1e-6;
/** Relative error over which the looks share nothing: sound was missed. */
const LOST = 0.1;

/**
 * A monitor only shows the latest moment of the mix. Looking every frame and
 * keeping what's new since the last look turns that into an unbroken
 * recording: the end of the previous look is found in the new one, and
 * everything after it is new. The frame clock only says roughly how much
 * time has passed, so it just narrows the search (and decides in silence,
 * where every alignment is equally right).
 */
export class MonitorTap {
  readonly left: Float32Array;
  readonly right: Float32Array;
  private readonly mono: Float32Array;
  private readonly previous: Float32Array;
  private primed = false;
  private lastMs = 0;

  constructor(private readonly monitor: MonitorSource) {
    const size = monitor.capacity;
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
    this.mono = new Float32Array(size);
    this.previous = new Float32Array(size);
  }

  get sampleRate(): number {
    return this.monitor.sampleRate;
  }

  /** Look at the monitor at `nowMs`. The last `n` frames of `left` / `right` are new, where `n` is returned. */
  pull(nowMs: number): number {
    const size = this.mono.length;
    this.monitor.read(this.left, this.right);
    for (let i = 0; i < size; i++) this.mono[i] = this.left[i]! + this.right[i]!;
    const elapsed = Math.round(((nowMs - this.lastMs) / 1000) * this.monitor.sampleRate);
    const fresh = this.primed ? this.align(Math.max(0, Math.min(size, elapsed))) : 0;
    this.primed = true;
    this.lastMs = nowMs;
    this.previous.set(this.mono);
    return fresh;
  }

  /** How many frames at the end of the new look came after the previous one. */
  private align(expected: number): number {
    const size = this.mono.length;
    const probe = this.previous.subarray(size - PROBE);
    let energy = 0;
    for (let k = 0; k < PROBE; k++) energy += probe[k]! * probe[k]!;
    if (energy < 1e-9) return expected;
    const lo = Math.max(0, expected - SLACK);
    const hi = Math.min(size - PROBE, expected + SLACK);
    let best = expected;
    let bestError = Infinity;
    // Nearest the clock first, so a periodic sound matches the right period.
    for (let d = 0; d <= SLACK; d++) {
      for (const fresh of d === 0 ? [expected] : [expected - d, expected + d]) {
        if (fresh < lo || fresh > hi) continue;
        const end = size - fresh;
        let error = 0;
        for (let k = 0; k < PROBE && error < bestError; k++) {
          const diff = this.mono[end - PROBE + k]! - probe[k]!;
          error += diff * diff;
        }
        if (error < bestError) {
          bestError = error;
          best = fresh;
          if (error <= EXACT * energy) return best;
        }
      }
    }
    return bestError <= LOST * energy ? best : Math.min(size, expected);
  }
}
