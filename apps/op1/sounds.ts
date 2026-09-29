/**
 * What an OP-1 remembers about an instrument. A synth sound is an engine
 * with its four values, an envelope, an effect and an LFO — and it keeps the
 * values of every engine and effect, so trying another and coming back loses
 * nothing. A drum kit is the pads' edits, the kit's settings and an effect.
 */
import { choiceParam, formatHz, formatSeconds, numberParam } from "../synth/params";
import { KIT_DEFS, PAD_COUNT, PAD_DEFS } from "./drums";
import { FX, FxKind } from "./fx";
import { defaultQuad, percent, sanitizeQuad, type Quad, type QuadDefs } from "./params";
import { SYNTHS } from "./synths";

const time = (key: string, label: string, name: string, fallback: number) =>
  numberParam(key, label, name, 0.001, 8, fallback, formatSeconds, { curve: "exp" });

export const ENV_DEFS: QuadDefs = [
  time("attack", "ATTACK", "ATTACK", 0.004),
  time("decay", "DECAY", "DECAY", 0.4),
  numberParam("sustain", "SUSTN", "SUSTAIN", 0, 1, 0.7, percent),
  time("release", "RELEAS", "RELEASE", 0.3),
];

/** Shapes in the Synthesizer's `Lfo` order. */
export const LFO_SHAPES = ["SINE", "TRIANGLE", "SQUARE", "RANDOM", "RAMP"] as const;
export const LfoTarget = { Pitch: 0, Volume: 1, Param1: 2, Param2: 3 } as const;
export const LFO_TARGETS = ["PITCH", "VOLUME", "PARAM 1", "PARAM 2"] as const;

export const LFO_DEFS: QuadDefs = [
  numberParam("speed", "SPEED", "LFO SPEED", 0.05, 20, 3, formatHz, { curve: "exp" }),
  numberParam("depth", "DEPTH", "LFO DEPTH", 0, 1, 0, percent),
  choiceParam("shape", "SHAPE", "LFO SHAPE", LFO_SHAPES),
  choiceParam("target", "TARGET", "LFO TARGET", LFO_TARGETS),
];

export interface SynthSound {
  name: string;
  /** Index into `SYNTHS`. */
  synth: number;
  /** One quad per engine, in `SYNTHS` order. */
  engines: readonly Quad[];
  env: Quad;
  /** Index into `FX`. */
  fx: number;
  /** One quad per effect, in `FX` order. */
  fxParams: readonly Quad[];
  lfo: Quad;
}

export interface DrumKit {
  /** One quad of `PAD_DEFS` per pad. */
  pads: readonly Quad[];
  kit: Quad;
  fx: number;
  fxParams: readonly Quad[];
}

export const SLOT_COUNT = 8;

const defaultEngines = () => SYNTHS.map((s) => defaultQuad(s.defs));
const defaultFx = () => FX.map((f) => defaultQuad(f.defs));

/** What makes a sound: its engine and values, envelope, effect and LFO; everything else is default. */
export interface SoundSpec {
  synth: number;
  engine: Quad;
  env: Quad;
  fx: number;
  fxValues?: Quad;
  lfo?: Quad;
}

export function synthSound(name: string, spec: SoundSpec): SynthSound {
  const engines = defaultEngines();
  engines[spec.synth] = spec.engine;
  const fxParams = defaultFx();
  if (spec.fxValues) fxParams[spec.fx] = spec.fxValues;
  return { name, synth: spec.synth, engines, env: spec.env, fx: spec.fx, fxParams, lfo: spec.lfo ?? defaultQuad(LFO_DEFS) };
}

/** Engines in `SYNTHS` order. */
export const Synth = { Cluster: 0, Fm: 1, String: 2, Pulse: 3, Digital: 4, Dna: 5, Sampler: 6 } as const;
/** LFO shapes in `LFO_SHAPES` order. */
export const LfoShape = { Sine: 0, Triangle: 1, Square: 2, Random: 3, Ramp: 4 } as const;
const Shape = LfoShape;

/** The eight factory sounds, one per slot. */
export const FACTORY_SOUNDS: readonly SynthSound[] = [
  synthSound("CLOUDS", {
    synth: Synth.Cluster,
    engine: [0.55, 0.85, 0.6, 0.2],
    env: [0.45, 1.2, 0.8, 1.6],
    fx: FxKind.Spring,
    fxValues: [0.8, 0.35, 0.45, 0.7],
    lfo: [0.25, 0.3, Shape.Triangle, LfoTarget.Param1],
  }),
  synthSound("ROADS", {
    synth: Synth.Fm,
    engine: [1 / 9, 0.35, 0.05, 0.35],
    env: [0.002, 1.8, 0.25, 0.5],
    fx: FxKind.Delay,
    fxValues: [3, 0.35, 0.15, 0.2],
    lfo: [4.5, 0.18, Shape.Sine, LfoTarget.Volume],
  }),
  synthSound("PLUCK", {
    synth: Synth.String,
    engine: [0.6, 0.75, 0.7, 0.3],
    env: [0.001, 2, 1, 0.4],
    fx: FxKind.Spring,
    fxValues: [0.5, 0.45, 0.25, 0.6],
  }),
  synthSound("BASS", {
    synth: Synth.Pulse,
    engine: [0.35, 0.15, 0.7, 0.35],
    env: [0.002, 0.4, 0.7, 0.12],
    fx: FxKind.Nitro,
    fxValues: [500, 0.5, 0.25, 0],
  }),
  synthSound("GRIT", {
    synth: Synth.Digital,
    engine: [0.45, 0.5, 0.25, 0.6],
    env: [0.001, 0.3, 0.5, 0.2],
    fx: FxKind.Delay,
    fxValues: [2, 0.4, 0.2, 0.1],
    lfo: [0.5, 0.4, Shape.Triangle, LfoTarget.Param1],
  }),
  synthSound("WIND", {
    synth: Synth.Dna,
    engine: [0.9, 0.9, 0.1, 0.5],
    env: [0.6, 1, 0.8, 1.2],
    fx: FxKind.Spring,
    fxValues: [0.9, 0.3, 0.5, 0.8],
  }),
  synthSound("BELLS", {
    synth: Synth.Fm,
    engine: [7 / 9, 0.5, 0, 0.55],
    env: [0.001, 2.5, 0, 2],
    fx: FxKind.Delay,
    fxValues: [4, 0.45, 0.3, 0.1],
  }),
  synthSound("LEAD", {
    synth: Synth.Cluster,
    engine: [0.25, 0.4, 0.7, 0.35],
    env: [0.01, 0.3, 0.8, 0.3],
    fx: FxKind.Delay,
    fxValues: [1, 0.3, 0.25, 0.1],
    lfo: [5.5, 0.12, Shape.Sine, LfoTarget.Pitch],
  }),
];

export function factorySound(slot: number): SynthSound {
  return FACTORY_SOUNDS[slot] ?? FACTORY_SOUNDS[0]!;
}

export function defaultKit(): DrumKit {
  const fxParams = defaultFx();
  fxParams[FxKind.Spring] = [0.35, 0.5, 0.12, 0.5];
  return {
    pads: Array.from({ length: PAD_COUNT }, () => defaultQuad(PAD_DEFS)),
    kit: defaultQuad(KIT_DEFS),
    fx: FxKind.Spring,
    fxParams,
  };
}

const index = (value: unknown, count: number, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count ? value : fallback;

function sanitizeQuads(list: readonly { defs: QuadDefs }[], value: unknown, fallback: readonly Quad[]): Quad[] {
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  return list.map((entry, i) => (items[i] === undefined ? fallback[i]! : sanitizeQuad(entry.defs, items[i])));
}

/** A sound from untrusted JSON, falling back to `fallback` field by field. */
export function sanitizeSound(value: unknown, fallback: SynthSound): SynthSound {
  if (!value || typeof value !== "object") return fallback;
  const r = value as Record<string, unknown>;
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 12).toUpperCase() : fallback.name,
    synth: index(r.synth, SYNTHS.length, fallback.synth),
    engines: sanitizeQuads(SYNTHS, r.engines, fallback.engines),
    env: r.env === undefined ? fallback.env : sanitizeQuad(ENV_DEFS, r.env),
    fx: index(r.fx, FX.length, fallback.fx),
    fxParams: sanitizeQuads(FX, r.fxParams, fallback.fxParams),
    lfo: r.lfo === undefined ? fallback.lfo : sanitizeQuad(LFO_DEFS, r.lfo),
  };
}

export function sanitizeKit(value: unknown): DrumKit {
  const fallback = defaultKit();
  if (!value || typeof value !== "object") return fallback;
  const r = value as Record<string, unknown>;
  const pads = Array.isArray(r.pads) ? (r.pads as unknown[]) : [];
  return {
    pads: fallback.pads.map((pad, i) => (pads[i] === undefined ? pad : sanitizeQuad(PAD_DEFS, pads[i]))),
    kit: r.kit === undefined ? fallback.kit : sanitizeQuad(KIT_DEFS, r.kit),
    fx: index(r.fx, FX.length, fallback.fx),
    fxParams: sanitizeQuads(FX, r.fxParams, fallback.fxParams),
  };
}
