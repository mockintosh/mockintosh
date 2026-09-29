/**
 * Hearing: the monitor's latest window turned into what scenes react to —
 * the waveform, a log-frequency spectrum, loudness, onsets and pitch.
 *
 * Levels adapt to the source (an automatic gain on the spectrum and on
 * loudness), so a quiet pad moves a scene as fully as a loud drum loop, and
 * everything is smoothed on the frame's `dt` so a slow frame rate reads the
 * same as a fast one.
 */
import { fft } from "../synth/fft";

/** Frames of sound each look covers: about 43 ms at 48 kHz. */
export const WINDOW = 2048;
/** Log-spaced spectrum bands from `LOW_HZ` to `HIGH_HZ`. */
export const BANDS = 64;
export const LOW_HZ = 30;
export const HIGH_HZ = 16000;

/** What a scene gets every frame. All levels are 0…1 unless noted. */
export interface Listening {
  /** Seconds since listening began, and since the previous frame. */
  readonly time: number;
  readonly dt: number;
  readonly sampleRate: number;
  /** The latest `WINDOW` frames, oldest first, as played (−1…1). */
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly mono: Float32Array;
  /** Multiply samples by this to fill ±1: the waveform's automatic gain (1…24). */
  readonly gain: number;
  /** `BANDS` bands, low to high: fast attack, gentle release. */
  readonly spectrum: Float32Array;
  /** Each band's recent maximum, falling slowly: the caps on a bar graph. */
  readonly peaks: Float32Array;
  readonly level: number;
  readonly bass: number;
  readonly mid: number;
  readonly treble: number;
  /** An onset (a drum hit, a new note) landed this frame. */
  readonly beat: boolean;
  /** 1 on an onset, decaying to 0 in about half a second. */
  readonly pulse: number;
  /** Onsets heard so far. */
  readonly beats: number;
  /** A clock that runs faster the louder it gets; drive motion from it. */
  readonly travel: number;
  /** The dominant pitch in Hz and as a fractional MIDI note, when there is one. */
  readonly pitch: number | null;
  readonly note: number | null;
  /** How sure the pitch is, 0…1. */
  readonly clarity: number;
  /** Eases to 1 while anything is audible and back to 0 over a second or two of silence. */
  readonly presence: number;
  readonly silent: boolean;
}

/** Centre frequency of band `b` (fractional bands allowed). */
export function bandFrequency(b: number): number {
  return LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, (b + 0.5) / BANDS);
}

/** The band a frequency falls in, fractional; clamped to the spectrum. */
export function frequencyBand(hz: number): number {
  const b = (Math.log(hz / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ)) * BANDS - 0.5;
  return Math.max(0, Math.min(BANDS - 1, b));
}

/** `values` (read as a curve) resampled to `out.length` points, linearly. */
export function resample(values: Float32Array, out: Float32Array): Float32Array {
  const n = values.length;
  for (let i = 0; i < out.length; i++) {
    const at = out.length === 1 ? 0 : (i * (n - 1)) / (out.length - 1);
    const k = Math.floor(at);
    const f = at - k;
    out[i] = values[k]! * (1 - f) + (values[Math.min(n - 1, k + 1)] ?? 0) * f;
  }
  return out;
}

/** Dynamic range the spectrum's automatic gain maps onto 0…1, in dB. */
const SPECTRUM_RANGE_DB = 54;
const LEVEL_RANGE_DB = 36;
/** Below this the input counts as silence (dBFS RMS). */
const SILENCE_DB = -64;
/** The quietest the automatic gain will reach up to, so hiss stays dark. */
const SPECTRUM_FLOOR_DB = -48;
const LEVEL_FLOOR_DB = -42;
/** How fast the gain recovers after a loud passage, dB per second. */
const GAIN_RECOVERY_DB = 9;
const MIN_ONSET_GAP = 0.13;
const PITCH_FFT = WINDOW * 2;
const MIN_PITCH_HZ = 40;
const MAX_PITCH_HZ = 1800;

/** Exponential smoothing toward `target` with time constant `tau` seconds. */
function approach(value: number, target: number, dt: number, tau: number): number {
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

function decibels(power: number): number {
  return 10 * Math.log10(power + 1e-20);
}

/** Bins `[from, to)` a band covers, or a fractional bin when it is narrower than one. */
interface BandBins {
  from: number;
  to: number;
  centre: number;
}

export class Listener implements Listening {
  time = 0;
  dt = 0;
  readonly sampleRate: number;
  readonly left = new Float32Array(WINDOW);
  readonly right = new Float32Array(WINDOW);
  readonly mono = new Float32Array(WINDOW);
  gain = 1;
  readonly spectrum = new Float32Array(BANDS);
  readonly peaks = new Float32Array(BANDS);
  level = 0;
  bass = 0;
  mid = 0;
  treble = 0;
  beat = false;
  pulse = 0;
  beats = 0;
  travel = 0;
  pitch: number | null = null;
  note: number | null = null;
  clarity = 0;
  presence = 0;
  silent = true;

  private readonly bins: BandBins[];
  private readonly hann = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)));
  private readonly re = new Float64Array(WINDOW);
  private readonly im = new Float64Array(WINDOW);
  private readonly acRe = new Float64Array(PITCH_FFT);
  private readonly acIm = new Float64Array(PITCH_FFT);
  /** This frame's gain-mapped bands before smoothing, and last frame's, for onsets. */
  private readonly raw = new Float32Array(BANDS);
  private readonly previous = new Float32Array(BANDS);
  private spectrumCeiling = SPECTRUM_FLOOR_DB;
  private levelCeiling = LEVEL_FLOOR_DB;
  private peakCeiling = 0.05;
  private fluxMean = 0;
  private fluxVariance = 0;
  private sinceOnset = Infinity;
  private bassUntil = 0;
  private midUntil = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    const binHz = sampleRate / WINDOW;
    this.bins = Array.from({ length: BANDS }, (_, b) => {
      const f0 = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, b / BANDS);
      const f1 = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, (b + 1) / BANDS);
      const from = Math.max(1, Math.round(f0 / binHz));
      const to = Math.min(WINDOW / 2, Math.round(f1 / binHz));
      return { from, to, centre: bandFrequency(b) / binHz };
    });
    for (let b = 0; b < BANDS; b++) {
      const hz = bandFrequency(b);
      if (hz < 250) this.bassUntil = b + 1;
      if (hz < 2000) this.midUntil = b + 1;
    }
  }

  /**
   * Take in the latest window. `left` and `right` hold `WINDOW` frames each;
   * `dt` is the time since the previous call, in seconds.
   */
  hear(left: Float32Array, right: Float32Array, dt: number): void {
    this.dt = Math.max(0, Math.min(0.1, dt));
    this.time += this.dt;
    this.left.set(left.subarray(left.length - WINDOW));
    this.right.set(right.subarray(right.length - WINDOW));
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < WINDOW; i++) {
      // One NaN from a misbehaving source would otherwise stick in every ceiling for good.
      if (!Number.isFinite(this.left[i]!)) this.left[i] = 0;
      if (!Number.isFinite(this.right[i]!)) this.right[i] = 0;
      const m = (this.left[i]! + this.right[i]!) * 0.5;
      this.mono[i] = m;
      sum += m * m;
      const a = Math.max(Math.abs(this.left[i]!), Math.abs(this.right[i]!));
      if (a > peak) peak = a;
    }
    const rmsDb = decibels(sum / WINDOW);
    this.hearLoudness(rmsDb, peak);
    this.hearSpectrum();
    this.hearOnsets();
    this.hearPitch(rmsDb);
    this.travel += this.dt * (0.35 + 1.6 * this.level + 1.4 * this.pulse);
  }

  private hearLoudness(rmsDb: number, peak: number): void {
    const { dt } = this;
    const audible = rmsDb > SILENCE_DB;
    this.presence = approach(this.presence, audible ? 1 : 0, dt, audible ? 0.08 : 0.6);
    this.silent = this.presence < 0.04;

    this.levelCeiling = Math.max(LEVEL_FLOOR_DB, rmsDb, this.levelCeiling - GAIN_RECOVERY_DB * dt);
    const level = audible ? Math.max(0, Math.min(1, (rmsDb - (this.levelCeiling - LEVEL_RANGE_DB)) / LEVEL_RANGE_DB)) : 0;
    this.level = level > this.level ? approach(this.level, level, dt, 0.02) : approach(this.level, level, dt, 0.18);

    this.peakCeiling = Math.max(0.04, peak, this.peakCeiling * Math.exp(-0.6 * dt));
    this.gain = Math.max(1, Math.min(24, 0.9 / this.peakCeiling));
  }

  private hearSpectrum(): void {
    const { re, im, hann, dt } = this;
    for (let i = 0; i < WINDOW; i++) {
      re[i] = this.mono[i]! * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    // A full-scale sine peaks at |X| = N/4 through a Hann window: that's 0 dB.
    const reference = (WINDOW / 4) * (WINDOW / 4);
    const power = (k: number) => (re[k]! * re[k]! + im[k]! * im[k]!) / reference;
    let loudest = -Infinity;
    for (let b = 0; b < BANDS; b++) {
      const { from, to, centre } = this.bins[b]!;
      let p = 0;
      if (to - from >= 1) {
        for (let k = from; k < to; k++) p = Math.max(p, power(k));
      } else {
        // Narrower than a bin: read between the two nearest.
        const k = Math.max(1, Math.floor(centre));
        const f = centre - k;
        p = power(k) * (1 - f) + power(k + 1) * f;
      }
      const db = decibels(p);
      this.raw[b] = db;
      if (db > loudest) loudest = db;
    }
    this.spectrumCeiling = Math.max(SPECTRUM_FLOOR_DB, loudest, this.spectrumCeiling - GAIN_RECOVERY_DB * dt);
    const floor = this.spectrumCeiling - SPECTRUM_RANGE_DB;
    let bass = 0;
    let mid = 0;
    let treble = 0;
    for (let b = 0; b < BANDS; b++) {
      const v = Math.max(0, Math.min(1, ((this.raw[b]! - floor) / SPECTRUM_RANGE_DB) * 1.08)) * Math.min(1, this.presence * 1.5);
      this.raw[b] = v;
      const s = this.spectrum[b]!;
      this.spectrum[b] = v > s ? approach(s, v, dt, 0.012) : approach(s, v, dt, 0.12);
      this.peaks[b] = Math.max(this.spectrum[b]!, this.peaks[b]! - dt * 0.5);
      if (b < this.bassUntil) bass += this.spectrum[b]!;
      else if (b < this.midUntil) mid += this.spectrum[b]!;
      else treble += this.spectrum[b]!;
    }
    this.bass = bass / this.bassUntil;
    this.mid = mid / (this.midUntil - this.bassUntil);
    this.treble = treble / (BANDS - this.midUntil);
  }

  /** Spectral flux against its own recent statistics: a rise that stands out is an onset. */
  private hearOnsets(): void {
    const { dt } = this;
    let flux = 0;
    for (let b = 0; b < this.midUntil; b++) {
      const rise = this.raw[b]! - this.previous[b]!;
      if (rise > 0) flux += b < this.bassUntil ? rise * 1.5 : rise;
    }
    this.previous.set(this.raw);
    const deviation = Math.sqrt(this.fluxVariance);
    this.sinceOnset += dt;
    this.beat = this.presence > 0.5 && this.sinceOnset > MIN_ONSET_GAP && flux > this.fluxMean + 1.8 * deviation + 1.1;
    if (this.beat) {
      this.sinceOnset = 0;
      this.beats++;
    }
    const k = 1 - Math.exp(-dt / 0.6);
    const delta = flux - this.fluxMean;
    this.fluxMean += delta * k;
    this.fluxVariance = (1 - k) * (this.fluxVariance + delta * delta * k);
    this.pulse = Number.isFinite(this.sinceOnset) ? Math.exp(-this.sinceOnset * 6) : 0;
  }

  /**
   * Autocorrelation through the FFT (the power spectrum's transform),
   * unbiased for the shrinking overlap; the first peak near the tallest is
   * the period, which keeps octave errors down.
   */
  private hearPitch(rmsDb: number): void {
    const { acRe, acIm } = this;
    acRe.fill(0);
    acIm.fill(0);
    for (let i = 0; i < WINDOW; i++) acRe[i] = this.mono[i]!;
    fft(acRe, acIm);
    for (let k = 0; k < PITCH_FFT; k++) {
      acRe[k] = acRe[k]! * acRe[k]! + acIm[k]! * acIm[k]!;
      acIm[k] = 0;
    }
    fft(acRe, acIm);
    const zero = acRe[0]!;
    let found: number | null = null;
    let clarity = 0;
    if (zero > 0 && rmsDb > SILENCE_DB + 10) {
      const minLag = Math.floor(this.sampleRate / MAX_PITCH_HZ);
      const maxLag = Math.min(WINDOW - 256, Math.ceil(this.sampleRate / MIN_PITCH_HZ));
      const r = (lag: number) => (acRe[lag]! / zero) * (WINDOW / (WINDOW - lag));
      let lag = minLag;
      while (lag < maxLag && r(lag) > 0) lag++;
      let best = 0;
      for (let k = lag; k < maxLag; k++) best = Math.max(best, r(k));
      for (let k = lag + 1; k < maxLag - 1; k++) {
        const v = r(k);
        if (v >= best * 0.9 && v >= r(k - 1) && v >= r(k + 1)) {
          const a = r(k - 1);
          const c = r(k + 1);
          const bend = a - 2 * v + c;
          const offset = bend < 0 ? (0.5 * (a - c)) / bend : 0;
          found = this.sampleRate / (k + offset);
          clarity = Math.min(1, v);
          break;
        }
      }
    }
    this.clarity = approach(this.clarity, clarity, this.dt, 0.08);
    if (found === null || clarity < 0.55) {
      if (this.clarity < 0.3) {
        this.pitch = null;
        this.note = null;
      }
      return;
    }
    const note = 69 + 12 * Math.log2(found / 440);
    // Glide within a quarter tone, jump to a new note.
    this.note = this.note !== null && Math.abs(note - this.note) < 0.5 ? approach(this.note, note, this.dt, 0.05) : note;
    this.pitch = 440 * Math.pow(2, (this.note - 69) / 12);
  }
}
