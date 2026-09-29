/**
 * Chords the way a pocket chord instrument thinks of them: pick a key, and
 * seven buttons play the chords built on each degree of its scale. A
 * joystick recolours whichever chord you hold — a seventh, a suspension,
 * major swapped for minor — and the voicing keeps every chord close to the
 * last, so moving between them sounds like a player, not a chord chart.
 *
 * Pure data and functions; the engine only ever sees MIDI notes.
 */

/** A 7-note scale as semitones above its tonic. */
export interface Mode {
  name: string;
  steps: readonly [number, number, number, number, number, number, number];
}

export const MODES: readonly Mode[] = [
  { name: "MAJOR", steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: "MINOR", steps: [0, 2, 3, 5, 7, 8, 10] },
];

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
/** Key names as a musician reads them: flats for the flat keys. */
export const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
/** Major keys whose signatures carry flats. */
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1]);

/** Whether a key spells its notes with flats (a minor key reads like its relative major). */
function usesFlats(key: number, mode: number): boolean {
  const relativeMajor = mode === 1 ? (key + 3) % 12 : key;
  return FLAT_MAJORS.has(relativeMajor);
}

const pitchClass = (note: number) => ((note % 12) + 12) % 12;

/** A note's name in a key, without its octave: "Bb", not "A#", in F major. */
export function spellNote(note: number, key: number, mode: number): string {
  return (usesFlats(key, mode) ? FLAT_NAMES : SHARP_NAMES)[pitchClass(note)]!;
}

/** Where the joystick points. `C` is the centre, at rest. */
export type Direction = "C" | "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** What the joystick does to the chord under your finger. */
export type Modifier = "triad" | "seventh" | "add9" | "sus4" | "sixth" | "flip" | "dim" | "sus2" | "aug";

/** The joystick's map. Up adds colour, down turns the chord over, the sides suspend it. */
export const JOYSTICK: Readonly<Record<Direction, Modifier>> = {
  C: "triad",
  N: "seventh",
  NE: "add9",
  E: "sus4",
  SE: "sixth",
  S: "flip",
  SW: "dim",
  W: "sus2",
  NW: "aug",
};

/** Short labels for the joystick's gate. */
export const MODIFIER_LABELS: Readonly<Record<Modifier, string>> = {
  triad: "",
  seventh: "7",
  add9: "9",
  sus4: "S4",
  sixth: "6",
  flip: "M/m",
  dim: "dim",
  sus2: "S2",
  aug: "+",
};

/** Arrow keys held → a direction; opposite arrows cancel. */
export function directionOf(up: boolean, down: boolean, left: boolean, right: boolean): Direction {
  const v = up === down ? "" : up ? "N" : "S";
  const h = left === right ? "" : left ? "W" : "E";
  return ((v + h) || "C") as Direction;
}

export interface Chord {
  /** Scale degree 0…6 the chord was built on. */
  degree: number;
  /** Root pitch class, 0 = C. */
  root: number;
  /** Semitones above the root, ascending, starting at 0. Ninths stay above the octave (14). */
  intervals: readonly number[];
  /** "Am7", "Fsus2", "Bdim". */
  name: string;
}

/** Chord symbols by interval shape. */
const SUFFIXES: Readonly<Record<string, string>> = {
  "0,4,7": "",
  "0,3,7": "m",
  "0,3,6": "dim",
  "0,4,8": "aug",
  "0,2,7": "sus2",
  "0,5,7": "sus4",
  "0,4,7,11": "maj7",
  "0,4,7,10": "7",
  "0,3,7,10": "m7",
  "0,3,7,11": "m(maj7)",
  "0,3,6,10": "m7b5",
  "0,3,6,9": "dim7",
  "0,4,7,9": "6",
  "0,3,7,9": "m6",
  "0,4,7,14": "add9",
  "0,3,7,14": "madd9",
  "0,3,6,14": "dim(add9)",
};

function chordSuffix(intervals: readonly number[]): string {
  return SUFFIXES[intervals.join(",")] ?? "?";
}

/** The scale tone `steps` degrees above `degree`, in semitones above the tonic (may pass the octave). */
function scaleTone(mode: Mode, degree: number, steps: number): number {
  const index = degree + steps;
  return mode.steps[index % 7]! + 12 * Math.floor(index / 7);
}

/** Roman numeral for a degree's triad: capitals for major, lower case for minor, ° for diminished. */
export function romanNumeral(key: number, modeIndex: number, degree: number): string {
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const triad = diatonicChord(key, modeIndex, degree, "triad").intervals;
  const numeral = numerals[degree]!;
  if (triad[1] === 4) return numeral;
  return triad[2] === 6 ? `${numeral.toLowerCase()}°` : numeral.toLowerCase();
}

/** The chord on `degree` of `key`'s `mode`, recoloured by `modifier`. */
export function diatonicChord(key: number, modeIndex: number, degree: number, modifier: Modifier): Chord {
  const mode = MODES[modeIndex] ?? MODES[0]!;
  const d = ((degree % 7) + 7) % 7;
  const base = scaleTone(mode, d, 0);
  const third = scaleTone(mode, d, 2) - base;
  const fifth = scaleTone(mode, d, 4) - base;
  const seventh = scaleTone(mode, d, 6) - base;

  let intervals: number[];
  switch (modifier) {
    case "seventh":
      intervals = [0, third, fifth, seventh];
      break;
    case "add9":
      intervals = [0, third, fifth, 14];
      break;
    case "sixth":
      intervals = [0, third, fifth, 9];
      break;
    case "sus2":
      intervals = [0, 2, 7];
      break;
    case "sus4":
      intervals = [0, 5, 7];
      break;
    case "flip":
      // Major becomes minor; minor and diminished become major.
      intervals = third === 4 ? [0, 3, fifth] : [0, 4, 7];
      break;
    case "dim":
      intervals = [0, 3, 6];
      break;
    case "aug":
      intervals = [0, 4, 8];
      break;
    default:
      intervals = [0, third, fifth];
  }
  const root = pitchClass(key + base);
  return { degree: d, root, intervals, name: spellNote(root, key, modeIndex) + chordSuffix(intervals) };
}

/** The MIDI notes to play for a chord. */
export interface Voicing {
  /** The root, down in the bass; null without a bass note. */
  bass: number | null;
  /** Chord tones, ascending. */
  notes: readonly number[];
}

/** Lowest bass note: the bass sits in E1…Eb2, the range of a bass guitar's open strings. */
const BASS_FLOOR = 40;

/**
 * Close voicing inside the octave-wide window centred on `center`: each
 * chord tone takes the one pitch it has there. Every chord in a key lands in
 * the same window, so changing chords moves each voice a step or two — the
 * inversions a player would choose. A ninth stays a ninth, above the rest.
 */
export function voiceChord(chord: Chord, center: number, bass: boolean): Voicing {
  const low = center - 6;
  const notes: number[] = [];
  for (const interval of chord.intervals) {
    if (interval >= 12) continue;
    notes.push(low + pitchClass(chord.root + interval - low));
  }
  notes.sort((a, b) => a - b);
  for (const interval of chord.intervals) {
    if (interval < 12) continue;
    const top = notes[notes.length - 1]!;
    notes.push(top + (pitchClass(chord.root + interval - top) || 12));
  }
  return {
    bass: bass ? BASS_FLOOR + pitchClass(chord.root - BASS_FLOOR) : null,
    notes,
  };
}
