/**
 * What the OP-1 remembers between launches: the sounds, the kit, the two
 * patterns, the settings of the instrument pages and which tape was on, as
 * `session.json` in the app's storage. Recorded samples are kept beside it
 * as WAVE files, one per sound slot, and kept tapes likewise (`tapes.ts`);
 * the tape and mixer settings go with each tape.
 */
import { PAD_COUNT } from "./drums";
import type { SampleSource } from "./sampler";
import { emptyPattern, sanitizePattern, type Pattern } from "./sequencer";
import { FACTORY_SOUNDS, SLOT_COUNT, defaultKit, sanitizeKit, sanitizeSound, type DrumKit, type SynthSound } from "./sounds";
import { sanitizeTapeRef, type TapeRef } from "./tapes";

export const SESSION_KEY = "session.json";

/** The storage key of a slot's sample. */
export const sampleKey = (slot: number): string => `sample-${slot + 1}.wav`;

export const MODE_NAMES = ["synth", "drum", "tape", "mixer"] as const;
export type Mode = (typeof MODE_NAMES)[number];

export const SYNTH_PAGES = ["ENGINE", "ENVELOPE", "EFFECT", "LFO"] as const;
export const DRUM_PAGES = ["PAD", "KIT", "EFFECT"] as const;
export const MIXER_PAGES = ["LEVEL", "PAN"] as const;

export const MIN_OCTAVE = -2;
export const MAX_OCTAVE = 2;
export const DEFAULT_VOLUME = 0.7;
/** Notes a synth pattern may hold: the MIDI range. */
const NOTE_LIMIT = 128;

export interface Session {
  sounds: SynthSound[];
  slot: number;
  kit: DrumKit;
  /** The tape that was on the machine; null to start with the default one. */
  openTape: TapeRef | null;
  octave: number;
  volume: number;
  mode: Mode;
  synthPage: number;
  drumPage: number;
  mixerPage: number;
  pad: number;
  /** Whether the instrument modes show their pattern. */
  sequencer: boolean;
  synthPattern: Pattern;
  drumPattern: Pattern;
  sampleSource: SampleSource;
}

export function defaultSession(): Session {
  return {
    sounds: [...FACTORY_SOUNDS],
    slot: 0,
    kit: defaultKit(),
    openTape: null,
    octave: 0,
    volume: DEFAULT_VOLUME,
    mode: "synth",
    synthPage: 0,
    drumPage: 0,
    mixerPage: 0,
    pad: 0,
    sequencer: false,
    synthPattern: emptyPattern(),
    drumPattern: emptyPattern(),
    sampleSource: "op1",
  };
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

/** A session from untrusted JSON, field by field; `null` if it isn't one at all. */
export function sanitizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const sounds = Array.isArray(r.sounds) ? (r.sounds as unknown[]) : [];
  const fallback = defaultSession();
  return {
    sounds: FACTORY_SOUNDS.map((factory, i) => sanitizeSound(sounds[i], factory)),
    slot: clampInt(r.slot, 0, SLOT_COUNT - 1, 0),
    kit: sanitizeKit(r.kit),
    openTape: sanitizeTapeRef(r.openTape),
    octave: clampInt(r.octave, MIN_OCTAVE, MAX_OCTAVE, 0),
    volume: typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.max(0, Math.min(1, r.volume)) : fallback.volume,
    mode: MODE_NAMES.find((m) => m === r.mode) ?? fallback.mode,
    synthPage: clampInt(r.synthPage, 0, SYNTH_PAGES.length - 1, 0),
    drumPage: clampInt(r.drumPage, 0, DRUM_PAGES.length - 1, 0),
    mixerPage: clampInt(r.mixerPage, 0, MIXER_PAGES.length - 1, 0),
    pad: clampInt(r.pad, 0, PAD_COUNT - 1, 0),
    sequencer: r.sequencer === true,
    synthPattern: sanitizePattern(r.synthPattern, NOTE_LIMIT),
    drumPattern: sanitizePattern(r.drumPattern, PAD_COUNT),
    sampleSource: r.sampleSource === "speaker" ? "speaker" : "op1",
  };
}

export function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
