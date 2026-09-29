/**
 * The instrument's sounds: Synthesizer patches voiced for chords — poly,
 * gentle on the low end, each with its own space. The faceplate's Tone,
 * Room and Volume knobs are applied on top.
 */
import { defaultPatch, PARAMS, clampParam, type Patch } from "../synth/params";

export interface Sound {
  name: string;
  patch: Patch;
}

const sound = (name: string, changes: Partial<Patch>): Sound => ({
  name,
  patch: { ...defaultPatch(), voiceMode: 0, drive: 0, spread: 0.5, ...changes },
});

// Wave indices follow WAVES: SAW 0, SQUARE 1, TRIANGLE 2, SINE 3.
// Filter types follow FILTER_TYPES: LP24 0, LP12 1, BAND 2, HIGH 3.
export const SOUNDS: readonly Sound[] = [
  sound("KEYS", {
    osc1Wave: 3, osc2Wave: 3, osc2Semi: 12, osc2Fine: 0, osc2Level: 0.25, fm: 0.28, filterType: 1,
    cutoff: 5000, resonance: 0, filterEnv: 0.2, fDecay: 0.6, fSustain: 0.2, attack: 0.002, decay: 1.6,
    sustain: 0.3, release: 0.45, chorus: 0.45,
  }),
  sound("PAD", {
    osc1Wave: 0, osc2Wave: 0, osc2Fine: 11, osc2Level: 0.8, filterType: 1, cutoff: 1500, resonance: 0.1,
    filterEnv: 0.15, fAttack: 0.6, fDecay: 1.5, fSustain: 0.6, attack: 0.35, decay: 1, sustain: 0.85,
    release: 1.3, lfoRate: 0.4, lfoFilter: 0.12, spread: 0.8, chorus: 0.7,
  }),
  sound("ORGAN", {
    osc1Wave: 1, osc2Wave: 1, osc2Semi: 12, osc2Fine: 0, osc2Level: 0.5, subLevel: 0.35, filterType: 1,
    cutoff: 4200, resonance: 0, filterEnv: 0, attack: 0.004, decay: 0.1, sustain: 1, release: 0.06,
    lfoRate: 6.2, lfoPitch: 0.07, chorus: 0.55,
  }),
  sound("GUITAR", {
    osc1Wave: 0, osc2Wave: 1, osc2Semi: 12, osc2Fine: 4, osc2Level: 0.3, pulseWidth: 0.35, cutoff: 1400,
    resonance: 0.2, filterEnv: 0.45, fDecay: 0.25, fSustain: 0.05, keyTrack: 0.7, attack: 0.001, decay: 1.1,
    sustain: 0, release: 0.35, delayMix: 0.12, delayTime: 3, delayFeedback: 0.3,
  }),
  sound("STRINGS", {
    osc1Wave: 0, osc2Wave: 0, osc2Fine: -14, osc2Level: 0.8, filterType: 1, cutoff: 2600, resonance: 0.05,
    filterEnv: 0.1, attack: 0.7, decay: 1.5, sustain: 0.9, release: 1.4, lfoRate: 5.2, lfoPitch: 0.1,
    spread: 0.9, chorus: 0.75,
  }),
  sound("BELLS", {
    osc1Wave: 3, osc2Wave: 3, osc2Semi: 19, osc2Fine: 3, osc2Level: 0, fm: 0.5, filterType: 1, cutoff: 9000,
    resonance: 0, filterEnv: 0, attack: 0.001, decay: 2.2, sustain: 0, release: 2, delayMix: 0.18,
    delayTime: 5, delayFeedback: 0.45,
  }),
  sound("CHIP", {
    osc1Wave: 1, pulseWidth: 0.25, osc2Level: 0, filterType: 1, cutoff: 12000, resonance: 0, filterEnv: 0,
    attack: 0.001, decay: 0.25, sustain: 0.55, release: 0.08, spread: 0.2, delayMix: 0.2, delayTime: 2,
  }),
];

/** The patch the engine plays: the sound, brightened or darkened by Tone, with Room and Volume. */
export function soundPatch(settings: { sound: number; tone: number; space: number; volume: number }): Patch {
  const base = (SOUNDS[settings.sound] ?? SOUNDS[0]!).patch;
  return {
    ...base,
    cutoff: clampParam(PARAMS.cutoff, base.cutoff * Math.pow(2, (settings.tone - 0.5) * 5)),
    reverb: settings.space,
    volume: settings.volume,
  };
}
