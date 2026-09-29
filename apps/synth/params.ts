/**
 * The synthesizer's parameters: what each knob means, its range and curve,
 * and how it reads on the display. The engine reads plain numbers; knobs
 * work in a normalised 0…1 travel and convert through these definitions.
 */

export const WAVES = ["SAW", "SQUARE", "TRIANGLE", "SINE"] as const;
export const FILTER_TYPES = ["LP 24", "LP 12", "BAND", "HIGH"] as const;
export const LFO_WAVES = ["SINE", "TRIANGLE", "SQUARE", "S&H", "RAMP"] as const;
export const VOICE_MODES = ["POLY", "MONO", "UNISON"] as const;
/** OFF, the Macintosh 128K's 8-bit 22 kHz DAC, or a 1-bit speaker. */
export const LOFI_MODES = ["OFF", "128K", "1-BIT"] as const;
/** Delay time as a note value, in sixteenth-note steps. */
export const DELAY_DIVISIONS = [
  { label: "1/16", steps: 1 },
  { label: "1/8", steps: 2 },
  { label: "3/16", steps: 3 },
  { label: "1/4", steps: 4 },
  { label: "3/8", steps: 6 },
  { label: "1/2", steps: 8 },
] as const;

export interface Patch {
  osc1Wave: number;
  osc1Octave: number;
  pulseWidth: number;
  osc2Wave: number;
  osc2Semi: number;
  osc2Fine: number;
  osc1Level: number;
  osc2Level: number;
  subLevel: number;
  noiseLevel: number;
  fm: number;
  cutoff: number;
  resonance: number;
  filterEnv: number;
  keyTrack: number;
  filterType: number;
  fAttack: number;
  fDecay: number;
  fSustain: number;
  fRelease: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  lfoRate: number;
  lfoWave: number;
  lfoPitch: number;
  lfoFilter: number;
  lfoPwm: number;
  voiceMode: number;
  glide: number;
  spread: number;
  drive: number;
  lofi: number;
  chorus: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  reverb: number;
  volume: number;
}

export type PatchKey = keyof Patch;

interface ParamBase<K extends string> {
  key: K;
  /** Knob caption, four letters or so. */
  label: string;
  /** What the display calls it. */
  name: string;
}

export interface NumberParam<K extends string = string> extends ParamBase<K> {
  kind: "number";
  min: number;
  max: number;
  default: number;
  /** `exp` spreads the travel evenly over octaves or decades; `min` must be positive. */
  curve: "linear" | "exp";
  /** The knob's rest is the middle (detune, envelope amount). */
  bipolar?: boolean;
  /** Snap to multiples of this. */
  step?: number;
  format(value: number): string;
}

export interface ChoiceParam<K extends string = string> extends ParamBase<K> {
  kind: "choice";
  options: readonly string[];
  default: number;
}

export type ParamDef<K extends string = string> = NumberParam<K> | ChoiceParam<K>;

const percent = (v: number) => `${Math.round(v * 100)}%`;
const signedPercent = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
const signed = (unit: string) => (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}${unit}`;

export function formatSeconds(s: number): string {
  if (s < 0.1) return `${Math.round(s * 1000)} ms`;
  if (s < 1) return `${Math.round(s * 100) * 10} ms`;
  return `${s.toFixed(s < 10 ? 2 : 1)} s`;
}

export function formatHz(hz: number): string {
  if (hz < 10) return `${hz.toFixed(2)} Hz`;
  if (hz < 1000) return `${Math.round(hz)} Hz`;
  return `${(hz / 1000).toFixed(hz < 10000 ? 2 : 1)} kHz`;
}

export function numberParam<K extends string>(
  key: K,
  label: string,
  name: string,
  min: number,
  max: number,
  fallback: number,
  format: (v: number) => string,
  extra: Partial<Pick<NumberParam, "curve" | "bipolar" | "step">> = {},
): NumberParam<K> {
  return { kind: "number", key, label, name, min, max, default: fallback, curve: extra.curve ?? "linear", format, ...extra };
}

export function choiceParam<K extends string>(
  key: K,
  label: string,
  name: string,
  options: readonly string[],
  fallback = 0,
): ChoiceParam<K> {
  return { kind: "choice", key, label, name, options, default: fallback };
}

const num = numberParam;
const choice = choiceParam;

const time = <K extends string>(key: K, label: string, name: string, fallback: number, min = 0.001) =>
  num(key, label, name, min, 10, fallback, formatSeconds, { curve: "exp" });

export const PARAMS: { readonly [K in PatchKey]: ParamDef<K> } = {
  osc1Wave: choice("osc1Wave", "WAVE", "OSC 1 WAVE", WAVES),
  osc1Octave: num("osc1Octave", "OCT", "OSC 1 OCTAVE", -2, 2, 0, signed(""), { step: 1, bipolar: true }),
  pulseWidth: num("pulseWidth", "PW", "PULSE WIDTH", 0.05, 0.5, 0.5, percent),
  osc2Wave: choice("osc2Wave", "WAVE", "OSC 2 WAVE", WAVES),
  osc2Semi: num("osc2Semi", "SEMI", "OSC 2 SEMITONES", -24, 24, 0, signed(" st"), { step: 1, bipolar: true }),
  osc2Fine: num("osc2Fine", "FINE", "OSC 2 DETUNE", -50, 50, 7, signed(" ct"), { bipolar: true }),
  osc1Level: num("osc1Level", "OSC1", "OSC 1 LEVEL", 0, 1, 0.8, percent),
  osc2Level: num("osc2Level", "OSC2", "OSC 2 LEVEL", 0, 1, 0.5, percent),
  subLevel: num("subLevel", "SUB", "SUB OSC LEVEL", 0, 1, 0, percent),
  noiseLevel: num("noiseLevel", "NOIS", "NOISE LEVEL", 0, 1, 0, percent),
  fm: num("fm", "FM", "OSC 2 > 1 FM", 0, 1, 0, percent),
  cutoff: num("cutoff", "CUT", "CUTOFF", 30, 18000, 2400, formatHz, { curve: "exp" }),
  resonance: num("resonance", "RES", "RESONANCE", 0, 1, 0.2, percent),
  filterEnv: num("filterEnv", "ENV", "FILTER ENV AMT", -1, 1, 0.35, signedPercent, { bipolar: true }),
  keyTrack: num("keyTrack", "KEY", "KEY TRACKING", 0, 1, 0.5, percent),
  filterType: choice("filterType", "TYPE", "FILTER TYPE", FILTER_TYPES),
  fAttack: time("fAttack", "A", "FILTER ATTACK", 0.003),
  fDecay: time("fDecay", "D", "FILTER DECAY", 0.35, 0.005),
  fSustain: num("fSustain", "S", "FILTER SUSTAIN", 0, 1, 0.25, percent),
  fRelease: time("fRelease", "R", "FILTER RELEASE", 0.3, 0.005),
  attack: time("attack", "A", "AMP ATTACK", 0.004),
  decay: time("decay", "D", "AMP DECAY", 0.5, 0.005),
  sustain: num("sustain", "S", "AMP SUSTAIN", 0, 1, 0.7, percent),
  release: time("release", "R", "AMP RELEASE", 0.25, 0.005),
  lfoRate: num("lfoRate", "RATE", "LFO RATE", 0.05, 25, 5, formatHz, { curve: "exp" }),
  lfoWave: choice("lfoWave", "WAVE", "LFO WAVE", LFO_WAVES),
  lfoPitch: num("lfoPitch", "PTCH", "LFO > PITCH", 0, 1, 0, percent),
  lfoFilter: num("lfoFilter", "FILT", "LFO > CUTOFF", 0, 1, 0, percent),
  lfoPwm: num("lfoPwm", "PWM", "LFO > PULSE W", 0, 1, 0, percent),
  voiceMode: choice("voiceMode", "MODE", "VOICE MODE", VOICE_MODES),
  glide: num("glide", "GLDE", "GLIDE", 0, 1, 0, percent),
  spread: num("spread", "SPRD", "SPREAD", 0, 1, 0.3, percent),
  drive: num("drive", "DRV", "DRIVE", 0, 1, 0.1, percent),
  lofi: choice("lofi", "LOFI", "LO-FI DAC", LOFI_MODES),
  chorus: num("chorus", "CHOR", "CHORUS", 0, 1, 0, percent),
  delayTime: choice("delayTime", "TIME", "DELAY TIME", DELAY_DIVISIONS.map((d) => d.label), 3),
  delayFeedback: num("delayFeedback", "FDBK", "DELAY FEEDBACK", 0, 0.92, 0.4, percent),
  delayMix: num("delayMix", "DLY", "DELAY MIX", 0, 1, 0, percent),
  reverb: num("reverb", "VERB", "REVERB", 0, 1, 0.15, percent),
  volume: num("volume", "VOL", "VOLUME", 0, 1, 0.7, percent),
};

/** A record of parameter values, one per definition. */
export type ParamValues<K extends string> = Record<K, number>;

/** Every parameter at its default. */
export function defaultValues<K extends string>(defs: { readonly [P in K]: ParamDef<P> }): ParamValues<K> {
  const out = {} as ParamValues<K>;
  for (const key of Object.keys(defs) as K[]) out[key] = defs[key].default;
  return out;
}

/** Values from untrusted JSON: known keys, clamped; everything else defaulted. */
export function sanitizeValues<K extends string>(defs: { readonly [P in K]: ParamDef<P> }, value: unknown): ParamValues<K> {
  const out = defaultValues(defs);
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(defs) as K[]) {
    const v = record[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = clampParam(defs[key], v);
  }
  return out;
}

export function defaultPatch(): Patch {
  return defaultValues(PARAMS);
}

/** A patch from untrusted JSON: known keys, clamped; everything else defaulted. */
export function sanitizePatch(value: unknown): Patch {
  return sanitizeValues(PARAMS, value);
}

export function clampParam(def: ParamDef, value: number): number {
  if (def.kind === "choice") return Math.max(0, Math.min(def.options.length - 1, Math.round(value)));
  let v = Math.max(def.min, Math.min(def.max, value));
  if (def.step) v = Math.round(v / def.step) * def.step;
  return v;
}

/** Knob travel 0…1 for a value. */
export function toTravel(def: ParamDef, value: number): number {
  if (def.kind === "choice") return def.options.length <= 1 ? 0 : value / (def.options.length - 1);
  if (def.curve === "exp") return Math.log(value / def.min) / Math.log(def.max / def.min);
  return (value - def.min) / (def.max - def.min);
}

/** Value for a knob travel 0…1, snapped and clamped. */
export function fromTravel(def: ParamDef, travel: number): number {
  const t = Math.max(0, Math.min(1, travel));
  if (def.kind === "choice") return Math.round(t * (def.options.length - 1));
  const raw = def.curve === "exp" ? def.min * Math.pow(def.max / def.min, t) : def.min + t * (def.max - def.min);
  return clampParam(def, raw);
}

export function formatParam(def: ParamDef, value: number): string {
  return def.kind === "choice" ? def.options[Math.round(value)] ?? "?" : def.format(value);
}

// ---------------------------------------------------------------------------
// Performance settings: the sequencer and arpeggiator, saved with the song
// rather than the patch.
// ---------------------------------------------------------------------------

export const SCALES = [
  { name: "MAJOR", steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: "MINOR", steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: "DORIAN", steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: "PHRYGIAN", steps: [0, 1, 3, 5, 7, 8, 10] },
  { name: "PENTATONIC", steps: [0, 3, 5, 7, 10] },
  { name: "BLUES", steps: [0, 3, 5, 6, 7, 10] },
  { name: "CHROMATIC", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
] as const;

export const NOTE_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const ARP_MODES = ["OFF", "UP", "DOWN", "UP+DOWN", "RANDOM", "AS PLAYED"] as const;

export interface Performance {
  tempo: number;
  swing: number;
  length: number;
  root: number;
  scale: number;
  seqOctave: number;
  gate: number;
  arpMode: number;
  arpOctaves: number;
}

export type PerformanceKey = keyof Performance;

export const PERFORMANCE_PARAMS: { readonly [K in PerformanceKey]: ParamDef<K> } = {
  tempo: num("tempo", "BPM", "TEMPO", 40, 240, 120, (v) => `${Math.round(v)} BPM`, { step: 1 }),
  swing: num("swing", "SWG", "SWING", 0, 0.6, 0, percent),
  length: num("length", "LEN", "PATTERN LENGTH", 1, 16, 16, (v) => `${Math.round(v)} STEPS`, { step: 1 }),
  root: choice("root", "ROOT", "KEY", NOTE_KEYS),
  scale: choice("scale", "SCAL", "SCALE", SCALES.map((s) => s.name)),
  seqOctave: num("seqOctave", "OCT", "PATTERN OCTAVE", -1, 3, 1, signed(""), { step: 1 }),
  gate: num("gate", "GATE", "GATE LENGTH", 0.1, 1, 0.5, percent),
  arpMode: choice("arpMode", "ARP", "ARPEGGIATOR", ARP_MODES),
  arpOctaves: num("arpOctaves", "RNGE", "ARP OCTAVES", 1, 4, 1, (v) => `${Math.round(v)} OCT`, { step: 1 }),
};

export function defaultPerformance(): Performance {
  return defaultValues(PERFORMANCE_PARAMS);
}

export function sanitizePerformance(value: unknown): Performance {
  return sanitizeValues(PERFORMANCE_PARAMS, value);
}
