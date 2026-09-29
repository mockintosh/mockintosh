/**
 * Everything on the faceplate that isn't a chord button: the key, the sound,
 * how chords are played, and the rhythm box. Knobs read these definitions,
 * so they share the Synthesizer's knob, clamping and persistence.
 */
import { choiceParam, numberParam, sanitizeValues, defaultValues, type ParamDef } from "../synth/params";
import { RHYTHMS } from "./drums";
import { SOUNDS } from "./sounds";
import { KEY_NAMES, MODES } from "./theory";

/** How a chord is played when you press its button, in `STYLES` order. */
export const Style = { Chord: 0, Strum: 1, ArpUp: 2, ArpDown: 3, ArpBounce: 4, Pulse: 5 } as const;
export const STYLES = ["CHORD", "STRUM", "ARP UP", "ARP DOWN", "ARP U/D", "PULSE"] as const;

export interface ChordSettings {
  key: number;
  mode: number;
  octave: number;
  sound: number;
  style: number;
  bass: number;
  tone: number;
  space: number;
  rhythm: number;
  tempo: number;
  volume: number;
}

export type SettingKey = keyof ChordSettings;

const percent = (v: number) => `${Math.round(v * 100)}%`;

export const SETTINGS: { readonly [K in SettingKey]: ParamDef<K> } = {
  key: choiceParam("key", "KEY", "KEY", KEY_NAMES),
  mode: choiceParam("mode", "MODE", "MODE", MODES.map((m) => m.name)),
  octave: numberParam("octave", "OCT", "OCTAVE", -2, 2, 0, (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`, {
    step: 1,
    bipolar: true,
  }),
  sound: choiceParam("sound", "SND", "SOUND", SOUNDS.map((s) => s.name)),
  style: choiceParam("style", "STYL", "PLAY STYLE", STYLES),
  bass: choiceParam("bass", "BASS", "BASS NOTE", ["OFF", "ON"], 1),
  tone: numberParam("tone", "TONE", "TONE", 0, 1, 0.5, percent, { bipolar: true }),
  space: numberParam("space", "ROOM", "REVERB", 0, 1, 0.3, percent),
  rhythm: choiceParam("rhythm", "BEAT", "RHYTHM", RHYTHMS.map((r) => r.name)),
  tempo: numberParam("tempo", "BPM", "TEMPO", 60, 200, 100, (v) => `${Math.round(v)} BPM`, { step: 1 }),
  volume: numberParam("volume", "VOL", "VOLUME", 0, 1, 0.7, percent),
};

export function defaultSettings(): ChordSettings {
  return defaultValues(SETTINGS);
}

export function sanitizeSettings(value: unknown): ChordSettings {
  return sanitizeValues(SETTINGS, value);
}

/** Whether a style runs on the tempo clock rather than the moment you press. */
export function isClocked(style: number): boolean {
  return style >= Style.ArpUp;
}
