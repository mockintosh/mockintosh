/**
 * The cassette's music theory: a key, a scale, and the triads that scale
 * contains. Hummed pitches snap onto the scale. Once a beat of them has
 * gathered, the triad that best covers that beat is the chord. The four keys
 * play the chords a song uses most, and a hum prefers those when the melody
 * fits them equally. Nothing here makes sound — the engine only ever sees
 * MIDI note numbers.
 */

/** Semitones above a chord's root. */
export interface ScaleChord {
  /** "I", "iv", "bVII". */
  numeral: string;
  /** Semitones above the key's tonic. */
  root: number;
  /** Semitones above the chord's own root, low to high. */
  intervals: readonly number[];
}

export interface Scale {
  /** Short name for the display: "MAJOR". */
  name: string;
  /** Menu name: "Major". */
  menu: string;
  /** Semitones above the tonic that hummed notes may land on. */
  steps: readonly number[];
  /** The four keys, in pad order. */
  chords: readonly [ScaleChord, ScaleChord, ScaleChord, ScaleChord];
  /** Every triad a hum may choose, low root to high. The four keys are in here. */
  triads: readonly ScaleChord[];
}

/** The notes of one beat, as pitch classes above the key's tonic. */
export interface BeatMelody {
  /** The note sounding on the beat, or null when the beat starts empty. */
  downbeat: number | null;
  /** The other notes hummed before the next beat. */
  rest: readonly number[];
}

const MAJOR_CHORDS: Scale["chords"] = [
  { numeral: "I", root: 0, intervals: [0, 4, 7] },
  { numeral: "IV", root: 5, intervals: [0, 4, 7] },
  { numeral: "V", root: 7, intervals: [0, 4, 7] },
  { numeral: "vi", root: 9, intervals: [0, 3, 7] },
];

const MINOR_CHORDS: Scale["chords"] = [
  { numeral: "i", root: 0, intervals: [0, 3, 7] },
  { numeral: "iv", root: 5, intervals: [0, 3, 7] },
  { numeral: "v", root: 7, intervals: [0, 3, 7] },
  { numeral: "VI", root: 8, intervals: [0, 4, 7] },
];

const DORIAN_CHORDS: Scale["chords"] = [
  { numeral: "i", root: 0, intervals: [0, 3, 7] },
  { numeral: "IV", root: 5, intervals: [0, 4, 7] },
  { numeral: "v", root: 7, intervals: [0, 3, 7] },
  { numeral: "VII", root: 10, intervals: [0, 4, 7] },
];

const mod = (n: number, m: number) => ((n % m) + m) % m;

const ROMAN: Readonly<Record<number, string>> = {
  0: "I", 2: "II", 3: "III", 4: "III", 5: "IV", 7: "V", 8: "VI", 9: "VI", 10: "VII", 11: "VII",
};

/** Root, third, and fifth, when every tone sits on the scale. The fifth may be diminished. */
function triadOn(steps: readonly number[], root: number, flatSeventh: boolean): ScaleChord | null {
  const third = steps.includes(mod(root + 3, 12)) ? 3 : steps.includes(mod(root + 4, 12)) ? 4 : null;
  if (third === null) return null;
  const fifth = steps.includes(mod(root + 7, 12)) ? 7 : steps.includes(mod(root + 6, 12)) ? 6 : null;
  if (fifth === null) return null;
  let numeral = ROMAN[root] ?? "I";
  if (flatSeventh && root === 10) numeral = "bVII";
  if (third === 3) numeral = numeral.toLowerCase();
  if (fifth === 6) numeral += "o";
  return { numeral, root, intervals: [0, third, fifth] };
}

const sameChord = (a: ScaleChord, b: ScaleChord) =>
  a.root === b.root && a.intervals[1] === b.intervals[1] && a.intervals[2] === b.intervals[2];

function scaleOf(name: string, menu: string, steps: readonly number[], chords: Scale["chords"], flatSeventh: boolean): Scale {
  const triads = steps.flatMap((root) => {
    const triad = triadOn(steps, root, flatSeventh);
    return triad ? [triad] : [];
  });
  for (const chord of chords) {
    if (!triads.some((triad) => sameChord(triad, chord))) triads.push(chord);
  }
  triads.sort((a, b) => a.root - b.root);
  return { name, menu, steps, chords, triads };
}

const MIXO_CHORDS: Scale["chords"] = [
  { numeral: "I", root: 0, intervals: [0, 4, 7] },
  { numeral: "IV", root: 5, intervals: [0, 4, 7] },
  { numeral: "v", root: 7, intervals: [0, 3, 7] },
  { numeral: "bVII", root: 10, intervals: [0, 4, 7] },
];

/** The five scales. Pentatonic snaps the melody to five notes and borrows F and G so the keys still have four chords. */
export const SCALES: readonly Scale[] = [
  scaleOf("MAJOR", "Major", [0, 2, 4, 5, 7, 9, 11], MAJOR_CHORDS, false),
  scaleOf("MINOR", "Minor", [0, 2, 3, 5, 7, 8, 10], MINOR_CHORDS, false),
  scaleOf("DORIAN", "Dorian", [0, 2, 3, 5, 7, 9, 10], DORIAN_CHORDS, false),
  scaleOf("MIXO", "Mixolydian", [0, 2, 4, 5, 7, 9, 10], MIXO_CHORDS, true),
  scaleOf("PENTA", "Pentatonic", [0, 2, 4, 7, 9], MAJOR_CHORDS, false),
];

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
/** Key names as a player reads them: flats for the flat keys, F# kept sharp. */
export const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

/** How far a hummed pitch must pass the midpoint before it leaves the note it was on. */
const STICK = 0.3;

/** Flat spelling for the flat keys; the rest read with sharps. */
export function usesFlats(key: number): boolean {
  return key === 1 || key === 3 || key === 5 || key === 8 || key === 10;
}

/** Pitch class spelled in the key's accidentals: "Bb", not "A#", in F. */
export function spell(pitchClass: number, flats: boolean): string {
  return (flats ? FLAT : SHARP)[mod(pitchClass, 12)]!;
}

/** "C4", "F#3". MIDI 60 is C4. */
export function noteName(midi: number, flats: boolean): string {
  const rounded = Math.round(midi);
  return `${spell(rounded, flats)}${Math.floor(rounded / 12) - 1}`;
}

/** "Am", "F#", "Bb", "Bdim". */
export function chordLabel(key: number, chord: ScaleChord): string {
  const name = spell(key + chord.root, usesFlats(key));
  if (chord.intervals[2] === 6) return `${name}dim`;
  return chord.intervals[1] === 3 ? `${name}m` : name;
}

/** Which pad plays `triad`, or null when that triad has no key. */
export function padForTriad(scale: Scale, triad: number | null): number | null {
  if (triad === null) return null;
  const chord = scale.triads[triad];
  if (!chord) return null;
  const pad = scale.chords.findIndex((item) => sameChord(item, chord));
  return pad >= 0 ? pad : null;
}

/** The triad a pad plays. */
export function triadForPad(scale: Scale, pad: number): number {
  const chord = scale.chords[pad];
  if (!chord) return 0;
  const index = scale.triads.findIndex((item) => sameChord(item, chord));
  return index < 0 ? 0 : index;
}

/**
 * The scale tone nearest `midi`. On a tie, stay on `previous` when it is one
 * of the two, otherwise take the lower tone.
 */
export function nearestScaleTone(midi: number, root: number, steps: readonly number[], previous: number | null): number {
  let best = Math.round(midi);
  let bestDist = Infinity;
  const from = Math.floor(midi) - 6;
  const to = Math.ceil(midi) + 6;
  for (let n = from; n <= to; n++) {
    if (!steps.includes(mod(n - root, 12))) continue;
    const dist = Math.abs(n - midi);
    const closer = dist < bestDist - 1e-9;
    const tie = Math.abs(dist - bestDist) <= 1e-9;
    const betterTie = tie && (n === previous || (best !== previous && n < best));
    if (closer || betterTie) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Snap a hummed pitch onto the scale. Once it has landed, it stays until the
 * voice crosses the midpoint toward another scale tone — a hum that wobbles
 * on the crack between two notes doesn't chatter.
 */
export function snapToScale(midi: number, root: number, steps: readonly number[], previous: number | null): number {
  const nearest = nearestScaleTone(midi, root, steps, previous);
  if (previous === null || nearest === previous) return nearest;
  if (!steps.includes(mod(previous - root, 12))) return nearest;
  const mid = (previous + nearest) / 2;
  const crossed = nearest > previous ? midi > mid + STICK : midi < mid - STICK;
  return crossed ? nearest : previous;
}

/**
 * Where `pitchClass` sits in `chord`: 0 is the root, 1 the third, 2 the fifth.
 * −1 when the tone is not in the chord.
 */
function toneRole(chord: ScaleChord, pitchClass: number): number {
  return chord.intervals.indexOf(mod(pitchClass - chord.root, 12));
}

/** Root, third, and fifth on the beat. A note anywhere else in the beat counts less. */
const ON_BEAT = [3, 2, 1] as const;
const IN_BEAT = 1;
const OUTSIDE = -2;
/** The four keys win a tie, and so does the chord already playing. */
const KEY_BONUS = 1;
const HOLD_BONUS = 1;

function toneScore(chord: ScaleChord, pitchClass: number, downbeat: boolean): number {
  const role = toneRole(chord, mod(pitchClass, 12));
  if (role < 0) return OUTSIDE;
  return downbeat ? (ON_BEAT[role] ?? IN_BEAT) : IN_BEAT;
}

function scoreTriad(scale: Scale, index: number, melody: BeatMelody, previous: number | null): number {
  const triad = scale.triads[index];
  if (!triad) return OUTSIDE;
  let score = 0;
  if (melody.downbeat !== null) score += toneScore(triad, melody.downbeat, true);
  for (const pitchClass of melody.rest) score += toneScore(triad, pitchClass, false);
  if (scale.chords.some((chord) => sameChord(chord, triad))) score += KEY_BONUS;
  if (previous === index) score += HOLD_BONUS;
  return score;
}

/**
 * The triad that best covers `melody`. The note on the beat counts most when
 * it is the root, then the third, then the fifth. Notes that don't belong
 * count against a chord. Null when the beat is empty.
 */
export function chordForBeat(scale: Scale, melody: BeatMelody, previous: number | null): number | null {
  if (melody.downbeat === null && melody.rest.length === 0) return null;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < scale.triads.length; i++) {
    const score = scoreTriad(scale, i, melody, previous);
    const hold = score === bestScore && i === previous;
    if (score > bestScore || hold) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export interface Voicing {
  /** Chord tones packed close together around the middle of the keyboard. */
  notes: number[];
  /** The root, down near C2, so every chord has a bass note. */
  bass: number;
}

/** Voice `chord` in `key` with its tones near `center` (MIDI) and the root in the bass. */
export function voiceChord(key: number, chord: ScaleChord, center = 60): Voicing {
  const rootPc = mod(key + chord.root, 12);
  const low = center - 6;
  const notes = chord.intervals.map((interval) => low + mod(rootPc + interval - low, 12));
  notes.sort((a, b) => a - b);
  return { notes, bass: 36 + mod(rootPc - 36, 12) };
}
