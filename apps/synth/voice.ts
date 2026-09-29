/**
 * One voice: two oscillators (osc 2 can frequency-modulate osc 1), a sub
 * oscillator an octave down, noise, drive, a resonant multimode filter with
 * its own envelope, and an amplifier envelope.
 */
import { Envelope, Noise, StateVariableFilter, Wave, noteHz, oscillator, softClip } from "./dsp";
import type { Patch } from "./params";

/** Where a note came from, so the sequencer never releases a key you are holding. */
export type NoteSource = "keys" | "seq" | "arp";

/** What every voice shares for one control period. */
export interface VoiceContext {
  patch: Patch;
  /** Bumped whenever `patch` is replaced; voices reconfigure envelopes on change. */
  patchVersion: number;
  sampleRate: number;
  /** Global LFO, −1…1, for this control period. */
  lfo: number;
}

const FILTER_LP24 = 0;
const FILTER_LP12 = 1;
const FILTER_BAND = 2;
/** Butterworth damping for the non-resonant first stage of the 24 dB cascade. */
const BUTTERWORTH_K = Math.SQRT2;

export class Voice {
  /** Sounding pitch; glides towards `target`. */
  note = 60;
  target = 60;
  velocity = 0.8;
  accent = false;
  /** Key (or step) is down; the voice may still be sounding after it lifts. */
  gateOn = false;
  source: NoteSource = "keys";
  /** Frame the note started, for stealing the oldest voice. */
  startedAt = 0;
  /** Cents; unison spread and analog drift. */
  detune = 0;
  /** −1 (left) … 1 (right). */
  pan = 0;
  gain = 1;
  /** Glide time for the current move in seconds, overriding the patch's (sequencer slides). */
  slideTime = 0;

  private phase1 = 0;
  private phase2 = 0;
  private phaseSub = 0;
  private readonly noise: Noise;
  private readonly filter = new StateVariableFilter();
  private readonly prefilter = new StateVariableFilter();
  private readonly amp = new Envelope();
  private readonly filterEnv = new Envelope();
  private configuredVersion = -1;

  constructor(seed: number) {
    this.noise = new Noise(seed);
  }

  get active(): boolean {
    return this.amp.active;
  }

  /** Amplitude envelope level, for choosing which voice to steal. */
  get level(): number {
    return this.amp.value;
  }

  start(note: number, velocity: number, accent: boolean, source: NoteSource, frame: number, glideFrom?: number): void {
    if (!this.amp.active) {
      this.phase1 = this.noise.unit();
      this.phase2 = this.noise.unit();
      this.phaseSub = this.phase1 / 2;
      this.filter.reset();
      this.prefilter.reset();
    }
    this.target = note;
    this.note = glideFrom ?? note;
    this.velocity = velocity;
    this.accent = accent;
    this.source = source;
    this.startedAt = frame;
    this.slideTime = 0;
    this.gateOn = true;
    this.amp.gate(true);
    this.filterEnv.gate(true);
  }

  /** Change pitch without retriggering: legato playing and sequencer slides. */
  legato(note: number, slideTime = 0): void {
    this.target = note;
    this.slideTime = slideTime;
  }

  release(): void {
    this.gateOn = false;
    this.amp.gate(false);
    this.filterEnv.gate(false);
  }

  kill(): void {
    this.gateOn = false;
    this.amp.reset();
    this.filterEnv.reset();
  }

  /** Add `frames` samples into `left` / `right` from `offset`. */
  render(left: Float32Array, right: Float32Array, offset: number, frames: number, ctx: VoiceContext): void {
    const p = ctx.patch;
    const sr = ctx.sampleRate;
    if (this.configuredVersion !== ctx.patchVersion) {
      this.amp.configure(p.attack, p.decay, p.sustain, p.release, sr);
      this.filterEnv.configure(p.fAttack, p.fDecay, p.fSustain, p.fRelease, sr);
      this.configuredVersion = ctx.patchVersion;
    }

    const glide = this.slideTime > 0 ? this.slideTime : p.glide * p.glide * 1.2;
    if (glide > 0.0005 && this.note !== this.target) {
      this.note = this.target + (this.note - this.target) * Math.exp(-frames / (glide * sr * 0.25));
      if (Math.abs(this.note - this.target) < 0.001) this.note = this.target;
    } else {
      this.note = this.target;
    }

    const pitch = this.note + this.detune / 100 + ctx.lfo * p.lfoPitch * p.lfoPitch * 12;
    const base = pitch + 12 * p.osc1Octave;
    const dt1 = Math.min(0.49, noteHz(base) / sr);
    const dt2 = Math.min(0.49, noteHz(base + p.osc2Semi + p.osc2Fine / 100) / sr);
    const dtSub = dt1 / 2;
    const width = Math.min(0.98, Math.max(0.02, p.pulseWidth + ctx.lfo * p.lfoPwm * 0.45));
    const fmDepth = p.fm * p.fm * 3;

    const envDepth = p.filterEnv * (0.75 + 0.25 * this.velocity) * (this.accent ? 1.4 : 1);
    const octaves =
      envDepth * 7 * this.filterEnv.value + (p.keyTrack * (this.note - 60)) / 12 + ctx.lfo * p.lfoFilter * 3;
    const cutoff = p.cutoff * Math.pow(2, octaves);
    const resonance = Math.min(1, p.resonance + (this.accent ? 0.1 : 0));
    this.filter.setup(cutoff, resonance, sr);
    const lp24 = p.filterType === FILTER_LP24;
    if (lp24) this.prefilter.copyCoefficients(this.filter, BUTTERWORTH_K);

    const driveGain = 1 + p.drive * 6;
    const makeup = 2 / (1 + p.drive * 2);
    const level = (0.35 + 0.65 * this.velocity) * (this.accent ? 1.25 : 1) * this.gain;
    const angle = ((this.pan + 1) * Math.PI) / 4;
    const gainL = Math.cos(angle) * level;
    const gainR = Math.sin(angle) * level;
    const { osc1Wave, osc2Wave, osc1Level, osc2Level, subLevel, noiseLevel, filterType } = p;

    for (let i = 0; i < frames; i++) {
      const o2 = oscillator(osc2Wave, this.phase2, dt2, width);
      const inc1 = fmDepth > 0 ? Math.min(0.49, Math.max(1e-6, dt1 * (1 + fmDepth * o2))) : dt1;
      const o1 = oscillator(osc1Wave, this.phase1, inc1, width);
      let x = o1 * osc1Level + o2 * osc2Level;
      if (subLevel > 0) x += oscillator(Wave.Square, this.phaseSub, dtSub, 0.5) * subLevel;
      if (noiseLevel > 0) x += this.noise.next() * noiseLevel;
      x = softClip(x * 0.5 * driveGain) * makeup;

      let y: number;
      if (lp24) {
        this.prefilter.process(x);
        this.filter.process(this.prefilter.low);
        y = this.filter.low;
      } else {
        this.filter.process(x);
        y = filterType === FILTER_LP12 ? this.filter.low : filterType === FILTER_BAND ? this.filter.band * 2 : this.filter.high;
      }

      const a = this.amp.next();
      this.filterEnv.next();
      left[offset + i] = left[offset + i]! + y * a * gainL;
      right[offset + i] = right[offset + i]! + y * a * gainR;

      this.phase1 += inc1;
      if (this.phase1 >= 1) this.phase1 -= 1;
      this.phase2 += dt2;
      if (this.phase2 >= 1) this.phase2 -= 1;
      this.phaseSub += dtSub;
      if (this.phaseSub >= 1) this.phaseSub -= 1;
    }
    if (!this.amp.active) this.gateOn = false;
  }
}

/** What voice stealing needs to know about a voice, whatever makes its sound. */
export interface StealableVoice {
  readonly active: boolean;
  readonly gateOn: boolean;
  readonly level: number;
  readonly startedAt: number;
}

/** An idle voice, else the quietest released one, else the oldest. */
export function pickVoice<V extends StealableVoice>(voices: readonly V[]): V {
  let best: V | undefined;
  for (const v of voices) if (!v.active && (!best || v.startedAt < best.startedAt)) best = v;
  if (best) return best;
  for (const v of voices) if (!v.gateOn && (!best || v.level < best.level)) best = v;
  if (best) return best;
  for (const v of voices) if (!best || v.startedAt < best.startedAt) best = v;
  return best!;
}
