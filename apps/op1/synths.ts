/**
 * The synth engines. Each is a sound source with exactly four parameters,
 * one per encoder, that the voice wraps in an envelope; the character lives
 * here — a supersaw, two-operator FM, a plucked string, a pulse, a digital
 * wavefolder, pitched noise, and a sampler playing the slot's recording.
 *
 * Parameter values are 0…1 so the LFO can sweep any of them; each
 * definition formats its value into something meaningful for the display.
 */
import { Noise, StateVariableFilter, TAU, Wave, noteHz, oscillator } from "../synth/dsp";
import { numberParam, type ParamDef } from "../synth/params";
import { percent, type Quad, type QuadDefs } from "./params";
import { SAMPLE_ROOT, type Sample } from "./sampler";

/** One note's worth of an engine: state that lives as long as the voice. */
export interface SynthOsc {
  /**
   * A new note. `fresh` is true when the voice was silent, so phases may be
   * reset without a click; a retriggered voice keeps ringing into the note.
   */
  start(hz: number, velocity: number, fresh: boolean, sampleRate: number): void;
  /**
   * Write `frames` mono samples (about −1…1) into `out` from index 0.
   * `sample` is the sound's recorded material, for engines that play one.
   */
  render(out: Float32Array, frames: number, hz: number, p: Quad, sampleRate: number, sample: Sample | null): void;
  /** Where playback is in the sample, 0…1, for engines that play one; −1 when finished. */
  readonly position?: number;
}

export interface SynthDef {
  name: string;
  /** What the engine does, for the display's detail line. */
  blurb: string;
  defs: QuadDefs;
  create(seed: number): SynthOsc;
}

const unit = (key: string, label: string, name: string, fallback: number, format: (v: number) => string = percent): ParamDef =>
  numberParam(key, label, name, 0, 1, fallback, format);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Exponential 0…1 → `lo`…`hi`. */
export const expRange = (v: number, lo: number, hi: number): number => lo * Math.pow(hi / lo, clamp01(v));

const hz = (v: number) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`);

// ---------------------------------------------------------------------------
// CLUSTER: seven detuned saws through a resonant low-pass
// ---------------------------------------------------------------------------

/** Where each saw sits in the spread, −1…1; the middle one stays in tune. */
const CLUSTER_OFFSETS = [-1, -0.62, -0.28, 0, 0.26, 0.6, 1] as const;
const clusterCutoff = (v: number) => expRange(v, 60, 17000);

class ClusterOsc implements SynthOsc {
  private readonly phases = new Float64Array(CLUSTER_OFFSETS.length);
  private readonly dts = new Float64Array(CLUSTER_OFFSETS.length);
  private readonly filter = new StateVariableFilter();

  constructor(private readonly noise: Noise) {}

  start(_hz: number, _velocity: number, fresh: boolean): void {
    if (!fresh) return;
    for (let i = 0; i < this.phases.length; i++) this.phases[i] = this.noise.unit();
    this.filter.reset();
  }

  render(out: Float32Array, frames: number, hz: number, p: Quad, sr: number): void {
    const cents = p[0] * p[0] * 55;
    for (let k = 0; k < CLUSTER_OFFSETS.length; k++) {
      this.dts[k] = Math.min(0.49, (hz * Math.pow(2, (CLUSTER_OFFSETS[k]! * cents) / 1200)) / sr);
    }
    const side = p[1];
    const center = 1 - side * 0.45;
    const norm = 0.55 / (center + side * 2.2);
    this.filter.setup(clusterCutoff(p[2]), p[3] * 0.92, sr);
    const { phases, dts } = this;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let k = 0; k < phases.length; k++) {
        const saw = oscillator(Wave.Saw, phases[k]!, dts[k]!, 0.5);
        sum += k === 3 ? saw * center : saw * side;
        let ph = phases[k]! + dts[k]!;
        if (ph >= 1) ph -= 1;
        phases[k] = ph;
      }
      this.filter.process(sum * norm);
      out[i] = this.filter.low;
    }
  }
}

// ---------------------------------------------------------------------------
// FM: a sine carrier, phase-modulated by a sine with feedback
// ---------------------------------------------------------------------------

export const FM_RATIOS = [0.5, 1, 1.5, 2, 3, 4, 5, 7, 9, 11] as const;
export const fmRatio = (v: number): number => FM_RATIOS[Math.round(clamp01(v) * (FM_RATIOS.length - 1))]!;
/** Seconds for the modulation index to fall away; the top of the travel holds it. */
const fmDecay = (v: number) => (v >= 0.99 ? Infinity : expRange(v, 0.02, 5));

class FmOsc implements SynthOsc {
  private carrier = 0;
  private modulator = 0;
  private lastMod = 0;
  private envelope = 1;

  start(_hz: number, velocity: number, fresh: boolean): void {
    if (fresh) {
      this.carrier = 0;
      this.modulator = 0;
      this.lastMod = 0;
    }
    this.envelope = 0.6 + 0.4 * velocity;
  }

  render(out: Float32Array, frames: number, hz: number, p: Quad, sr: number): void {
    const decay = fmDecay(p[3]);
    const index = p[1] * p[1] * 9 * this.envelope;
    if (decay !== Infinity) this.envelope *= Math.exp(-frames / (decay * sr));
    const feedback = p[2] * 1.3;
    const dtC = Math.min(0.49, hz / sr);
    const dtM = Math.min(0.49, (hz * fmRatio(p[0])) / sr);
    for (let i = 0; i < frames; i++) {
      const m = Math.sin(TAU * this.modulator + feedback * this.lastMod);
      this.lastMod = m;
      out[i] = Math.sin(TAU * this.carrier + index * m) * 0.6;
      this.carrier += dtC;
      if (this.carrier >= 1) this.carrier -= 1;
      this.modulator += dtM;
      if (this.modulator >= 1) this.modulator -= 1;
    }
  }
}

// ---------------------------------------------------------------------------
// STRING: Karplus-Strong, one or two strings
// ---------------------------------------------------------------------------

/** A delay line whose loop is damped by a one-pole low-pass: a string. */
class StringLine {
  private buffer = new Float32Array(1);
  private mask = 0;
  private write = 0;
  private damped = 0;

  ensure(sampleRate: number): void {
    let size = 1;
    while (size < sampleRate / 16) size <<= 1;
    if (this.buffer.length === size) return;
    this.buffer = new Float32Array(size);
    this.mask = size - 1;
    this.write = 0;
  }

  clear(): void {
    this.buffer.fill(0);
    this.damped = 0;
  }

  /** One sample: `input` excites the string, whose loop is `delay` samples long. */
  tick(input: number, delay: number, feedback: number, brightness: number): number {
    const { buffer, mask } = this;
    const d = Math.min(mask - 2, Math.max(2, delay));
    const position = this.write - d;
    const i = Math.floor(position);
    const frac = position - i;
    const a = buffer[i & mask]!;
    const delayed = a + (buffer[(i + 1) & mask]! - a) * frac;
    this.damped += (delayed - this.damped) * brightness;
    const y = input + this.damped * feedback;
    buffer[this.write & mask] = y;
    this.write++;
    return y;
  }
}

const stringDouble = (v: number) => v * 22;

class StringOsc implements SynthOsc {
  private readonly a = new StringLine();
  private readonly b = new StringLine();
  private burst = 0;
  private excite = 0;
  private pick = 0;

  constructor(private readonly noise: Noise) {}

  start(hz: number, velocity: number, fresh: boolean, sr: number): void {
    this.a.ensure(sr);
    this.b.ensure(sr);
    if (fresh) {
      this.a.clear();
      this.b.clear();
    }
    this.burst = Math.max(2, Math.round(sr / hz));
    this.excite = 1 + 1.5 * velocity;
    this.pick = 0;
  }

  render(out: Float32Array, frames: number, hz: number, p: Quad, sr: number): void {
    const brightness = 0.12 + 0.88 * p[0];
    // The loop's low-pass delays the signal too; take it out so strings stay in tune.
    const lag = (1 - brightness) / brightness;
    const period = sr / hz - lag;
    const feedback = 0.9 + 0.0995 * Math.sqrt(p[1]);
    const pickCoef = 0.04 + 0.96 * p[2] * p[2];
    const cents = stringDouble(p[3]);
    const double = cents > 0.5;
    const period2 = (sr / (hz * Math.pow(2, cents / 1200))) - lag;
    for (let i = 0; i < frames; i++) {
      let x = 0;
      if (this.burst > 0) {
        this.pick += (this.noise.next() - this.pick) * pickCoef;
        x = this.pick * this.excite;
        this.burst--;
      }
      const ya = this.a.tick(x, period, feedback, brightness);
      out[i] = double ? (ya + this.b.tick(x, period2, feedback, brightness)) * 0.45 : ya * 0.7;
    }
  }
}

// ---------------------------------------------------------------------------
// PULSE: a pulse wave with slow width modulation, a sub, and a tone control
// ---------------------------------------------------------------------------

const pulseWidth = (v: number) => 0.05 + 0.45 * v;
const pulseTone = (v: number) => expRange(v, 80, 15000);
/** Hz of the width modulation. */
const PWM_RATE = 0.9;

class PulseOsc implements SynthOsc {
  private phase = 0;
  private sub = 0;
  private pwm = 0;
  private readonly filter = new StateVariableFilter();

  constructor(private readonly noise: Noise) {}

  start(_hz: number, _velocity: number, fresh: boolean): void {
    if (!fresh) return;
    this.phase = this.noise.unit();
    this.sub = this.phase / 2;
    this.filter.reset();
  }

  render(out: Float32Array, frames: number, hz: number, p: Quad, sr: number): void {
    this.pwm += (PWM_RATE * frames) / sr;
    if (this.pwm >= 1) this.pwm -= 1;
    const width = Math.min(0.97, Math.max(0.03, pulseWidth(p[0]) + Math.sin(TAU * this.pwm) * p[1] * 0.4));
    const dt = Math.min(0.49, hz / sr);
    const dtSub = dt / 2;
    const subLevel = p[2];
    this.filter.setup(pulseTone(p[3]), 0.15, sr);
    for (let i = 0; i < frames; i++) {
      let x = oscillator(Wave.Square, this.phase, dt, width) * 0.45;
      if (subLevel > 0) x += oscillator(Wave.Square, this.sub, dtSub, 0.5) * subLevel * 0.4;
      this.filter.process(x);
      out[i] = this.filter.low;
      this.phase += dt;
      if (this.phase >= 1) this.phase -= 1;
      this.sub += dtSub;
      if (this.sub >= 1) this.sub -= 1;
    }
  }
}

// ---------------------------------------------------------------------------
// DIGITAL: a sine-to-saw morph, folded, crushed and decimated
// ---------------------------------------------------------------------------

const digitalBits = (v: number) => 16 - v * 14;
const digitalHold = (v: number) => 1 + Math.floor(v * v * 48);

class DigitalOsc implements SynthOsc {
  private phase = 0;
  private held = 0;
  private count = 0;

  start(_hz: number, _velocity: number, fresh: boolean): void {
    if (fresh) this.phase = 0;
  }

  render(out: Float32Array, frames: number, hz: number, p: Quad, sr: number): void {
    const dt = Math.min(0.49, hz / sr);
    const fold = 1 + p[0] * 7;
    const levels = Math.pow(2, digitalBits(p[1]) - 1);
    const hold = digitalHold(p[2]);
    const morph = p[3];
    for (let i = 0; i < frames; i++) {
      const s = Math.sin(TAU * this.phase) * (1 - morph) + oscillator(Wave.Saw, this.phase, dt, 0.5) * morph;
      if (++this.count >= hold) {
        this.count = 0;
        this.held = Math.round(Math.sin((s * fold * Math.PI) / 2) * levels) / levels;
      }
      out[i] = this.held * 0.5;
      this.phase += dt;
      if (this.phase >= 1) this.phase -= 1;
    }
  }
}

// ---------------------------------------------------------------------------
// DNA: noise, sampled and held, rung through a band-pass at the note
// ---------------------------------------------------------------------------

const dnaFocus = (v: number) => 0.35 + 0.645 * v;
const dnaGrit = (v: number) => 1 + Math.floor(v * v * 60);

class DnaOsc implements SynthOsc {
  private phase = 0;
  private readonly band = new StateVariableFilter();
  private held = 0;
  private count = 0;
  private flutter = 1;
  private flutterTarget = 1;

  constructor(private readonly noise: Noise) {}

  start(_hz: number, _velocity: number, fresh: boolean): void {
    if (!fresh) return;
    this.phase = 0;
    this.band.reset();
  }

  render(out: Float32Array, frames: number, hz: number, p: Quad, sr: number): void {
    const mix = p[0];
    const focus = dnaFocus(p[1]);
    this.band.setup(hz, focus, sr);
    // A band-pass rings louder the sharper it is; hold the level steady.
    const makeup = (2 - 1.97 * focus) * 1.6;
    const every = dnaGrit(p[2]);
    const depth = p[3];
    if (this.noise.unit() < (frames * 14) / sr) this.flutterTarget = 1 - depth * this.noise.unit();
    const dt = Math.min(0.49, hz / sr);
    for (let i = 0; i < frames; i++) {
      if (++this.count >= every) {
        this.count = 0;
        this.held = this.noise.next();
      }
      this.band.process(this.held);
      this.flutter += (this.flutterTarget - this.flutter) * 0.002;
      const tone = Math.sin(TAU * this.phase);
      out[i] = (tone * (1 - mix) * 0.5 + this.band.band * makeup * mix) * this.flutter;
      this.phase += dt;
      if (this.phase >= 1) this.phase -= 1;
    }
  }
}

// ---------------------------------------------------------------------------
// SAMPLER: a recording, repitched across the keys
// ---------------------------------------------------------------------------

/** Semitones either side of the sample's own pitch that TUNE reaches. */
const SAMPLER_TUNE = 12;
/** Shortest stretch of a sample that plays, in frames. */
const SAMPLER_SPAN = 64;
/** Fade at the start and end of the stretch, so a cut never clicks. */
const SAMPLER_FADE = 48;

export const samplerTune = (v: number): number => (clamp01(v) - 0.5) * 2 * SAMPLER_TUNE;
export const samplerLoops = (v: number): boolean => v >= 0.5;

/** The stretch of `sample` that START and END mark, in frames. */
export function samplerSpan(frames: number, start: number, end: number): { from: number; to: number } {
  const last = Math.max(0, frames - 1);
  let from = Math.round(clamp01(Math.min(start, end)) * last);
  let to = Math.round(clamp01(Math.max(start, end)) * last);
  if (to - from < SAMPLER_SPAN) {
    to = Math.min(last, from + SAMPLER_SPAN);
    from = Math.max(0, to - SAMPLER_SPAN);
  }
  return { from, to };
}

class SamplerOsc implements SynthOsc {
  private head = 0;
  private begun = false;
  private finished = false;
  private length = 1;

  get position(): number {
    return this.finished || !this.begun ? -1 : this.head / this.length;
  }

  start(): void {
    this.begun = false;
    this.finished = false;
  }

  render(out: Float32Array, frames: number, hz: number, p: Quad, sr: number, sample: Sample | null): void {
    const data = sample?.data;
    if (!sample || !data || data.length < 2 || this.finished) {
      out.fill(0, 0, frames);
      return;
    }
    this.length = data.length;
    const { from, to } = samplerSpan(data.length, p[0], p[1]);
    const loops = samplerLoops(p[2]);
    const step = (hz / noteHz(SAMPLE_ROOT + samplerTune(p[3]))) * (sample.sampleRate / sr);
    if (!this.begun) {
      this.head = from;
      this.begun = true;
    }
    const span = to - from;
    const fade = Math.min(SAMPLER_FADE, span / 4);
    for (let i = 0; i < frames; i++) {
      let at = this.head;
      if (at >= to || at < from) {
        if (!loops) {
          this.finished = true;
          out.fill(0, i, frames);
          return;
        }
        at = from + ((((at - from) % span) + span) % span);
      }
      const k = Math.floor(at);
      const f = at - k;
      // Four-point Hermite: smooth enough to transpose an octave either way.
      const y0 = data[k > 0 ? k - 1 : 0]!;
      const y1 = data[k]!;
      const y2 = data[Math.min(data.length - 1, k + 1)]!;
      const y3 = data[Math.min(data.length - 1, k + 2)]!;
      const c1 = 0.5 * (y2 - y0);
      const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
      const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      const edge = Math.min(1, (at - from) / fade, (to - at) / fade);
      out[i] = (((c3 * f + c2) * f + c1) * f + y1) * edge;
      this.head = at + step;
    }
  }
}

// ---------------------------------------------------------------------------
// The catalogue, in the order the display cycles through them
// ---------------------------------------------------------------------------

export const SYNTHS: readonly SynthDef[] = [
  {
    name: "CLUSTER",
    blurb: "seven saws",
    defs: [
      unit("spread", "SPREAD", "SPREAD", 0.5, (v) => `${Math.round(v * v * 55)} ct`),
      unit("mix", "SIDES", "SIDE SAWS", 0.7),
      unit("cutoff", "CUTOFF", "CUTOFF", 0.8, (v) => hz(clusterCutoff(v))),
      unit("reso", "RESO", "RESONANCE", 0.15),
    ],
    create: (seed) => new ClusterOsc(new Noise(seed)),
  },
  {
    name: "FM",
    blurb: "two operators",
    defs: [
      unit("ratio", "RATIO", "MOD RATIO", 1 / 9, (v) => `x${fmRatio(v)}`),
      unit("index", "DEPTH", "MOD DEPTH", 0.45),
      unit("feedback", "FDBK", "FEEDBACK", 0.1),
      unit("bright", "DECAY", "DEPTH DECAY", 0.45, (v) => (v >= 0.99 ? "HOLD" : `${fmDecay(v).toFixed(2)} s`)),
    ],
    create: () => new FmOsc(),
  },
  {
    name: "STRING",
    blurb: "plucked",
    defs: [
      unit("tone", "TONE", "STRING TONE", 0.55),
      unit("sustain", "SUSTN", "SUSTAIN", 0.7),
      unit("pick", "PICK", "PICK HARDNESS", 0.6),
      unit("double", "DOUBLE", "SECOND STRING", 0, (v) => (v * 22 < 0.5 ? "OFF" : `${Math.round(v * 22)} ct`)),
    ],
    create: (seed) => new StringOsc(new Noise(seed)),
  },
  {
    name: "PULSE",
    blurb: "square and sub",
    defs: [
      unit("width", "WIDTH", "PULSE WIDTH", 0.6, (v) => `${Math.round(pulseWidth(v) * 100)}%`),
      unit("pwm", "MOTION", "WIDTH MOTION", 0.3),
      unit("sub", "SUB", "SUB OCTAVE", 0.4),
      unit("tone", "TONE", "TONE", 0.55, (v) => hz(pulseTone(v))),
    ],
    create: (seed) => new PulseOsc(new Noise(seed)),
  },
  {
    name: "DIGITAL",
    blurb: "folded and crushed",
    defs: [
      unit("fold", "FOLD", "WAVE FOLD", 0.25),
      unit("bits", "BITS", "BIT DEPTH", 0.3, (v) => `${Math.round(digitalBits(v))} bit`),
      unit("rate", "RATE", "SAMPLE HOLD", 0.2, (v) => `1/${digitalHold(v)}`),
      unit("morph", "SHAPE", "SINE > SAW", 0.3),
    ],
    create: () => new DigitalOsc(),
  },
  {
    name: "DNA",
    blurb: "tuned noise",
    defs: [
      unit("mix", "NOISE", "NOISE MIX", 0.75),
      unit("focus", "FOCUS", "FOCUS", 0.8),
      unit("grit", "GRIT", "GRIT", 0.25, (v) => `1/${dnaGrit(v)}`),
      unit("flutter", "FLUTR", "FLUTTER", 0.3),
    ],
    create: (seed) => new DnaOsc(new Noise(seed)),
  },
  {
    name: "SAMPLER",
    blurb: "your recording",
    defs: [
      unit("start", "START", "SAMPLE START", 0),
      unit("end", "END", "SAMPLE END", 1),
      numberParam("loop", "LOOP", "LOOP", 0, 1, 0, (v) => (samplerLoops(v) ? "ON" : "OFF"), { step: 1 }),
      unit("tune", "TUNE", "SAMPLE TUNE", 0.5, (v) => {
        const st = samplerTune(v);
        return `${st >= 0 ? "+" : ""}${st.toFixed(1)} st`;
      }),
    ],
    create: () => new SamplerOsc(),
  },
];

/** The engine that plays the slot's sample. */
export const SAMPLER_ENGINE = SYNTHS.length - 1;
