/**
 * Factory patches and demo songs. A patch is a partial overlay on the
 * default so each one reads as what makes it different.
 */
import { defaultPatch, defaultPerformance, type Patch, type Performance } from "./params";
import { parsePattern, type Pattern } from "./sequencer";

export interface PatchPreset {
  name: string;
  patch: Patch;
}

const overlay = (name: string, changes: Partial<Patch>): PatchPreset => ({
  name,
  patch: { ...defaultPatch(), ...changes },
});

// Wave indices follow WAVES: SAW 0, SQUARE 1, TRIANGLE 2, SINE 3.
// Filter types follow FILTER_TYPES: LP24 0, LP12 1, BAND 2, HIGH 3.
export const FACTORY_PATCHES: readonly PatchPreset[] = [
  overlay("Init", {}),
  overlay("Acid Test", {
    osc1Wave: 0, osc2Level: 0, osc1Level: 1, cutoff: 260, resonance: 0.82, filterEnv: 0.62, keyTrack: 0.2,
    fAttack: 0.001, fDecay: 0.22, fSustain: 0, fRelease: 0.12, attack: 0.002, decay: 0.3, sustain: 0.8,
    release: 0.06, voiceMode: 1, drive: 0.45, delayMix: 0.18, delayTime: 2, delayFeedback: 0.35, reverb: 0.08,
  }),
  overlay("Supersaw", {
    osc1Wave: 0, osc2Wave: 0, osc2Fine: 12, osc2Level: 0.7, voiceMode: 2, spread: 0.55, cutoff: 5200,
    resonance: 0.1, filterEnv: 0.15, attack: 0.01, release: 0.5, chorus: 0.4, reverb: 0.35, delayMix: 0.15,
  }),
  overlay("Chicago Brass", {
    osc1Wave: 0, osc2Wave: 0, osc2Fine: 9, osc2Level: 0.8, cutoff: 700, resonance: 0.15, filterEnv: 0.55,
    fAttack: 0.07, fDecay: 0.5, fSustain: 0.45, attack: 0.03, sustain: 0.85, release: 0.2, spread: 0.4,
    chorus: 0.2, reverb: 0.2,
  }),
  overlay("Geneva Strings", {
    osc1Wave: 0, osc2Wave: 0, osc2Fine: -14, osc2Level: 0.8, filterType: 1, cutoff: 2600, resonance: 0.05,
    filterEnv: 0.1, attack: 0.9, decay: 1.5, sustain: 0.9, release: 1.6, lfoRate: 5.2, lfoPitch: 0.12,
    spread: 0.8, chorus: 0.75, reverb: 0.55,
  }),
  overlay("Monaco Pluck", {
    osc1Wave: 1, pulseWidth: 0.3, osc2Wave: 2, osc2Semi: 12, osc2Level: 0.35, cutoff: 900, resonance: 0.3,
    filterEnv: 0.55, fDecay: 0.18, fSustain: 0, attack: 0.001, decay: 0.35, sustain: 0, release: 0.3,
    delayMix: 0.35, delayTime: 4, delayFeedback: 0.45, reverb: 0.25,
  }),
  overlay("Sad Mac Bells", {
    osc1Wave: 3, osc2Wave: 3, osc2Semi: 19, osc2Fine: 3, osc2Level: 0, fm: 0.55, filterType: 1, cutoff: 9000,
    resonance: 0, filterEnv: 0, attack: 0.001, decay: 2.2, sustain: 0, release: 2.2, reverb: 0.6,
    delayMix: 0.2, delayTime: 5, delayFeedback: 0.5,
  }),
  overlay("Happy Mac Chime", {
    osc1Wave: 2, osc2Wave: 3, osc2Semi: 12, osc2Fine: 0, osc2Level: 0.4, subLevel: 0.15, filterType: 1,
    cutoff: 4200, resonance: 0, filterEnv: 0.1, attack: 0.004, decay: 2.8, sustain: 0.2, release: 2.5,
    spread: 0.6, chorus: 0.5, reverb: 0.7,
  }),
  overlay("Wobble", {
    osc1Wave: 0, osc2Wave: 1, osc2Semi: -12, osc2Fine: 0, osc2Level: 0.6, subLevel: 0.5, cutoff: 180,
    resonance: 0.55, filterEnv: 0, lfoRate: 3, lfoWave: 1, lfoFilter: 0.75, voiceMode: 1, glide: 0.25,
    drive: 0.6, sustain: 1, release: 0.1,
  }),
  overlay("Sub Marine", {
    osc1Wave: 3, osc1Octave: -1, osc2Level: 0, subLevel: 0.6, filterType: 1, cutoff: 600, resonance: 0,
    filterEnv: 0.2, voiceMode: 1, glide: 0.2, drive: 0.3, sustain: 1, release: 0.15,
  }),
  overlay("Laser Tag", {
    osc1Wave: 1, osc2Level: 0, pulseWidth: 0.25, cutoff: 3000, resonance: 0.6, lfoRate: 14, lfoWave: 3,
    lfoPitch: 0.6, lfoPwm: 0.5, voiceMode: 1, glide: 0.35, delayMix: 0.4, delayTime: 1, delayFeedback: 0.6,
  }),
  overlay("Organ Donor", {
    osc1Wave: 1, osc2Wave: 1, osc2Semi: 12, osc2Fine: 0, osc2Level: 0.6, subLevel: 0.7, filterType: 1,
    cutoff: 5000, resonance: 0, filterEnv: 0, attack: 0.003, decay: 0.1, sustain: 1, release: 0.05,
    lfoRate: 6.5, lfoPitch: 0.08, chorus: 0.6, reverb: 0.25,
  }),
  overlay("8-Bit Hero", {
    osc1Wave: 1, pulseWidth: 0.25, osc2Level: 0, filterType: 1, cutoff: 12000, resonance: 0, filterEnv: 0,
    attack: 0.001, decay: 0.2, sustain: 0.6, release: 0.08, lofi: 1, delayMix: 0.25, delayTime: 2,
  }),
  overlay("One-Bit Wonder", {
    osc1Wave: 1, osc2Wave: 1, osc2Semi: 7, osc2Fine: 0, osc2Level: 0.5, filterType: 1, cutoff: 8000,
    filterEnv: 0, attack: 0.001, decay: 0.15, sustain: 0.5, release: 0.05, lofi: 2, reverb: 0,
  }),
];

export interface DemoSong {
  name: string;
  patch: string;
  pattern: Pattern;
  performance: Performance;
}

const song = (name: string, patch: string, score: string, performance: Partial<Performance>): DemoSong => ({
  name,
  patch,
  pattern: parsePattern(score),
  performance: { ...defaultPerformance(), ...performance },
});

// Scale indices follow SCALES: MAJOR 0, MINOR 1, DORIAN 2, PHRYGIAN 3, PENTATONIC 4, BLUES 5.
export const DEMO_SONGS: readonly DemoSong[] = [
  song("Acid Line", "Acid Test", "0 0! 12~ 0 . 3 0 10~ 12 . 0! 7 5~ 3 0 15!", {
    tempo: 128, root: 9, scale: 1, seqOctave: 0, gate: 0.55, swing: 0.1,
  }),
  song("Berlin School", "Monaco Pluck", "0 7 12 7 3 7 15 7 0 7 12 19 3 7 15 12", {
    tempo: 118, root: 2, scale: 1, seqOctave: 1, gate: 0.4,
  }),
  song("Floppy Disco", "Organ Donor", "0! . 12 . 0! . 12 7 5! . 17 . 5! . 17 12", {
    tempo: 124, root: 5, scale: 0, seqOctave: 0, gate: 0.35, swing: 0.2,
  }),
  song("Bomb Icon", "Wobble", "0~ 0 . 0 3~ 5 . 0 0~ 0 . 7 5~ 3 . 0", {
    tempo: 140, root: 4, scale: 5, seqOctave: 0, gate: 0.8,
  }),
  song("Startup Chord", "Happy Mac Chime", "0! . . . 4 . . . 7 . . . 12! . . .", {
    tempo: 96, root: 0, scale: 0, seqOctave: 2, gate: 1,
  }),
];

/**
 * A random patch that is still an instrument: values are drawn from the
 * parts of each range that sound good rather than uniformly over the knob.
 */
export function surprisePatch(random: () => number): Patch {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length) % items.length]!;
  const between = (lo: number, hi: number) => lo + (hi - lo) * random();
  const exp = (lo: number, hi: number) => lo * Math.pow(hi / lo, random());
  const pluck = random() < 0.4;
  return {
    ...defaultPatch(),
    osc1Wave: pick([0, 0, 1, 2, 3]),
    osc1Octave: pick([-1, 0, 0, 0, 1]),
    pulseWidth: between(0.15, 0.5),
    osc2Wave: pick([0, 1, 2, 3]),
    osc2Semi: pick([0, 0, 7, 12, -12, 5, 19]),
    osc2Fine: between(-15, 15),
    osc1Level: between(0.6, 1),
    osc2Level: between(0, 0.8),
    subLevel: random() < 0.3 ? between(0.2, 0.7) : 0,
    noiseLevel: random() < 0.15 ? between(0.05, 0.3) : 0,
    fm: random() < 0.2 ? between(0.1, 0.6) : 0,
    cutoff: exp(150, 6000),
    resonance: between(0, 0.8),
    filterEnv: between(-0.2, 0.8),
    keyTrack: between(0.2, 0.8),
    filterType: pick([0, 0, 0, 1, 2]),
    fAttack: exp(0.001, pluck ? 0.01 : 0.5),
    fDecay: exp(0.08, 1.5),
    fSustain: between(0, 0.6),
    fRelease: exp(0.05, 1.5),
    attack: exp(0.001, pluck ? 0.01 : 0.8),
    decay: exp(0.1, 2),
    sustain: pluck ? 0 : between(0.4, 1),
    release: exp(0.05, 2),
    lfoRate: exp(0.2, 12),
    lfoWave: pick([0, 1, 2, 3, 4]),
    lfoPitch: random() < 0.25 ? between(0.02, 0.3) : 0,
    lfoFilter: random() < 0.4 ? between(0.1, 0.6) : 0,
    lfoPwm: random() < 0.3 ? between(0.1, 0.6) : 0,
    voiceMode: pick([0, 0, 1, 2]),
    glide: random() < 0.3 ? between(0.05, 0.4) : 0,
    spread: between(0.1, 0.7),
    drive: between(0, 0.5),
    chorus: random() < 0.5 ? between(0.2, 0.8) : 0,
    delayTime: pick([1, 2, 3, 4, 5]),
    delayFeedback: between(0.2, 0.6),
    delayMix: random() < 0.5 ? between(0.1, 0.4) : 0,
    reverb: between(0.05, 0.5),
    lofi: random() < 0.1 ? pick([1, 2]) : 0,
  };
}

export function findPatch(name: string): PatchPreset | undefined {
  return FACTORY_PATCHES.find((p) => p.name === name);
}
