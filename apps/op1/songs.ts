/**
 * The demo songs: eight-bar loops, each in a style of its own, each using
 * all four tracks — drums, bass, harmony and a lead — and each with sounds
 * of its own rather than the factory slots, so what the user has done to
 * their sounds doesn't change them. See `song.ts` for the notation.
 */
import { FxKind } from "./fx";
import { beat, drumKit, noteNumber, phrase, STEPS_PER_BAR, type Bar, type Song } from "./song";
import { LfoShape, LfoTarget, Synth, synthSound } from "./sounds";

// ---------------------------------------------------------------------------
// Writing bars that follow a rule
// ---------------------------------------------------------------------------

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const noteAt = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** A bar of 16ths walking `order` through `notes`, accented every `accentEvery` steps. */
function walk(notes: readonly string[], order: readonly number[], accentEvery = 4): Bar {
  const bar: Record<number, string> = {};
  for (let i = 0; i < STEPS_PER_BAR; i++) {
    const note = notes[order[i % order.length]!]!;
    bar[i] = i % accentEvery === 0 ? `${note} !` : note;
  }
  return bar;
}

/** A bar of eighths jumping between a root and its octave, the downbeats accented. */
function octaves(root: string): Bar {
  const low = noteNumber(root);
  const bar: Record<number, string> = {};
  for (let i = 0; i < STEPS_PER_BAR; i += 2) bar[i] = i % 8 === 0 ? `${noteAt(low)} !` : noteAt(i % 4 === 0 ? low : low + 12);
  return bar;
}

/** Semitones of the Berlin School sequence over a triad: root, fifth, octave and tenth, turning. */
const BERLIN = [0, 7, 12, 7, 3, 7, 15, 7, 0, 7, 12, 19, 3, 7, 15, 12] as const;

/** A bar of that sequence from `root`, minor or major, accented every three steps so it rolls across the beat. */
function berlin(root: string, major = false): Bar {
  const low = noteNumber(root);
  const bar: Record<number, string> = {};
  BERLIN.forEach((semis, i) => {
    const shifted = major && semis % 12 === 3 ? semis + 1 : semis;
    const note = noteAt(low + shifted);
    bar[i] = i % 3 === 0 ? `${note} !` : note;
  });
  return bar;
}

// ---------------------------------------------------------------------------
// Sunday Tape: lo-fi hip hop in the manner of Cuckoo's OP-1 jams
// ---------------------------------------------------------------------------

const LOFI_SWING = 0.45;

const LOFI = {
  KICK: "X......x..x.....|X.x.......x.....",
  SNARE: "....X.......X...|....X.......X...",
  RIM: "...............x|.........x......",
  "C.HAT": "x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x...",
  "O.HAT": "................|..............x.",
};

const LOFI_FILL = {
  ...LOFI,
  KICK: "X......x..x.....|X.x.......x..x..",
  RIM: "...............x|..........x.x.xx",
  "C.HAT": "x.x.x.x.x.x.x.x.|x.x.x.x.x.......",
  "O.HAT": "",
};

const Fmaj9 = "A3 C4 E4 G4";
const Em9 = "G3 B3 D4 F#4";
const A7b9 = "G3 C#4 E4 Bb4";
const Dm9 = "F3 A3 C4 E4";
const Gm9 = "Bb3 D4 F4 A4";
const C13 = "E3 Bb3 D4 A4";

const SUNDAY_TAPE: Song = {
  name: "Sunday Tape",
  tempo: 88,
  bars: 8,
  parts: [
    {
      name: "DRUMS",
      instrument: "drum",
      level: 0.62,
      pan: 0,
      kit: drumKit({
        pads: {
          KICK: { level: 0.95, decay: 1.3 },
          SNARE: { level: 0.75, tone: -0.3, decay: 1.2 },
          RIM: { level: 0.45, tone: -0.2 },
          "C.HAT": { level: 0.38, tone: -0.5 },
          "O.HAT": { level: 0.3, tone: -0.5 },
          CRASH: { level: 0.28, tone: -0.6 },
        },
        kit: { tune: -1, drive: 0.35 },
        fx: FxKind.Spring,
        fxValues: [0.4, 0.6, 0.12, 0.5],
      }),
      patterns: [beat({ ...LOFI, CRASH: "x" }, LOFI_SWING), beat(LOFI, LOFI_SWING), beat(LOFI, LOFI_SWING), beat(LOFI_FILL, LOFI_SWING)],
    },
    {
      name: "BASS",
      instrument: "synth",
      level: 0.95,
      pan: 0,
      sound: synthSound("ROUND BASS", {
        synth: Synth.Pulse,
        engine: [0.9, 0.1, 0.6, 0.3],
        env: [0.004, 0.6, 0.6, 0.15],
        fx: FxKind.Spring,
        fxValues: [0.3, 0.7, 0.05, 0.5],
      }),
      patterns: [
        phrase(
          [
            { 0: "F2 ~6 !", 7: "F2 ~2", 10: "C3 ~3", 14: "F2 ~2" },
            { 0: "E2 ~6 !", 6: "E2 ~2", 8: "A1 ~3 !", 11: "A2 ~2", 14: "C#2 ~2" },
            { 0: "D2 ~6 !", 7: "D2 ~2", 10: "A2 ~3", 14: "D2 ~2" },
            { 0: "G2 ~6 !", 6: "G2 ~2", 8: "C2 ~3 !", 11: "C3 ~2", 14: "E2 ~2" },
          ],
          { swing: LOFI_SWING, gate: 0.85 },
        ),
      ],
    },
    {
      name: "KEYS",
      instrument: "synth",
      level: 0.45,
      pan: -0.35,
      sound: synthSound("TAPE KEYS", {
        synth: Synth.Fm,
        engine: [1 / 9, 0.3, 0.05, 0.4],
        env: [0.003, 2.5, 0.4, 0.9],
        fx: FxKind.Spring,
        fxValues: [0.7, 0.55, 0.3, 0.8],
        lfo: [4.5, 0.2, LfoShape.Sine, LfoTarget.Volume],
      }),
      patterns: [
        phrase(
          [
            { 0: `${Fmaj9} ~7 !`, 10: `${Fmaj9} ~6` },
            { 0: `${Em9} ~6 !`, 8: `${A7b9} ~8` },
            { 0: `${Dm9} ~7 !`, 10: `${Dm9} ~6` },
            { 0: `${Gm9} ~6 !`, 8: `${C13} ~8` },
          ],
          { swing: LOFI_SWING, gate: 0.95 },
        ),
      ],
    },
    {
      name: "FLUTE",
      instrument: "synth",
      level: 1,
      pan: 0.3,
      sound: synthSound("TAPE FLUTE", {
        synth: Synth.Dna,
        engine: [0.35, 0.92, 0.1, 0.15],
        env: [0.04, 0.3, 0.85, 0.25],
        fx: FxKind.Delay,
        fxValues: [2, 0.35, 0.22, 0.3],
        lfo: [5, 0.1, LfoShape.Sine, LfoTarget.Pitch],
      }),
      patterns: [
        phrase(
          [
            { 3: "A4", 6: "C5", 8: "E5 ~3 !", 11: "D5 ~4" },
            { 0: "D5", 3: "B4", 6: "G4 ~2", 8: "C#5", 10: "Bb4 ~2", 12: "A4 ~4" },
            { 2: "C5", 4: "A4 ~2", 6: "F4 ~2", 8: "E4 ~6" },
            { 0: "G4 ~2", 3: "Bb4", 6: "D5 ~2", 8: "E5 ~2", 10: "D5 ~3", 13: "C5 ~3" },
          ],
          { swing: LOFI_SWING },
        ),
        phrase(
          [
            { 0: "G5 ~3 !", 3: "E5 ~3", 6: "C5 ~2", 8: "F5 ~2", 10: "E5 ~4", 14: "D5 ~2" },
            { 2: "B4 ~2", 4: "D5 ~2", 6: "F#5 ~2 !", 8: "E5 ~3", 11: "C#5 ~3", 14: "Bb4 ~2" },
            { 0: "A4 ~2", 2: "C5 ~2", 4: "E5 ~2", 6: "F5", 7: "E5 ~3", 10: "C5 ~2", 12: "A4 ~4" },
            { 0: "Bb4 ~4", 4: "A4 ~4", 8: "Bb4 ~2", 10: "A4 ~2", 12: "G4 ~2", 14: "F4 ~2" },
          ],
          { swing: LOFI_SWING },
        ),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Acid Desktop: acid house — a square bass through a resonant filter that
// the accents kick open, four to the floor
// ---------------------------------------------------------------------------

const HOUSE = {
  KICK: "X...X...X...X...|X...X...X...X...",
  CLAP: "....x.......x...|....x.......x...",
  "C.HAT": ".x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x",
  "O.HAT": "..x...x...x...x.|..x...x...x...x.",
};

const HOUSE_FILL = {
  ...HOUSE,
  KICK: "X...X...X...X...|X...X...X.X.X.X.",
  CLAP: "....x.......x...|....x.......xxxx",
  "O.HAT": "..x...x...x...x.|..x...x.........",
};

const Am7 = "A3 C4 E4 G4";
const Asus = "A3 D4 E4 G4";

const ACID_DESKTOP: Song = {
  name: "Acid Desktop",
  tempo: 126,
  bars: 8,
  parts: [
    {
      name: "DRUMS",
      instrument: "drum",
      level: 0.42,
      pan: 0,
      kit: drumKit({
        pads: {
          KICK: { level: 1, pitch: -1, decay: 1.6 },
          CLAP: { level: 0.7 },
          "C.HAT": { level: 0.4, tone: 0.2 },
          "O.HAT": { level: 0.45 },
          CRASH: { level: 0.35 },
        },
        kit: { drive: 0.4 },
        fx: FxKind.Spring,
        fxValues: [0.5, 0.5, 0.1, 0.6],
      }),
      patterns: [beat({ ...HOUSE, CRASH: "x" }), beat(HOUSE), beat(HOUSE), beat(HOUSE_FILL)],
    },
    {
      name: "ACID",
      instrument: "synth",
      level: 1,
      pan: 0,
      sound: synthSound("ACID", {
        synth: Synth.Pulse,
        engine: [1, 0, 0.15, 1],
        env: [0.001, 0.22, 0.25, 0.06],
        fx: FxKind.Nitro,
        fxValues: [200, 0.88, 1, 0],
      }),
      patterns: (() => {
        const low = phrase(
          [
            { 0: "A1 !", 1: "A1", 2: "A2 !", 3: "A1", 4: "C3", 5: "A1", 6: "G2 ~2", 8: "A1 !", 9: "E2", 10: "A2", 11: "A1", 12: "D3 ~2 !", 14: "C3", 15: "A2" },
            { 0: "A1 !", 2: "A1", 3: "A2 !", 4: "A1", 6: "E3 !", 7: "A1", 8: "G2", 9: "A1", 10: "C3 ~2", 12: "A1 !", 13: "A2", 14: "G2 !", 15: "E2" },
          ],
          { gate: 0.5 },
        );
        const high = phrase(
          [
            { 0: "A1 !", 1: "A2", 2: "A3 !", 3: "A1", 4: "C4 !", 5: "A1", 6: "G3 ~2", 8: "A1 !", 9: "E3", 10: "A3 !", 11: "A1", 12: "D4 ~2 !", 14: "C4", 15: "A2" },
            { 0: "A1 !", 2: "A2", 3: "A3 !", 4: "A1", 6: "E4 !", 7: "A1", 8: "G3", 9: "A2", 10: "C4 ~2 !", 12: "A1 !", 13: "A3", 14: "G3 !", 15: "E3" },
          ],
          { gate: 0.5 },
        );
        return [low, low, high, low];
      })(),
    },
    {
      name: "STAB",
      instrument: "synth",
      level: 1,
      pan: -0.4,
      sound: synthSound("STAB", {
        synth: Synth.Cluster,
        engine: [0.45, 0.8, 0.55, 0.25],
        env: [0.001, 0.35, 0, 0.25],
        fx: FxKind.Delay,
        fxValues: [2, 0.5, 0.35, 0.05],
      }),
      patterns: [phrase([{ 3: `${Am7} !`, 10: Am7 }, { 6: Am7, 14: `${Asus} !` }])],
    },
    {
      name: "BLEEP",
      instrument: "synth",
      level: 1,
      pan: 0.45,
      sound: synthSound("BLEEP", {
        synth: Synth.Fm,
        engine: [4 / 9, 0.55, 0.15, 0.25],
        env: [0.001, 0.45, 0.2, 0.3],
        fx: FxKind.Delay,
        fxValues: [2, 0.55, 0.4, 0.1],
      }),
      patterns: [
        phrase([{ 2: "E5" }, { 10: "A5 !" }, { 2: "E5", 7: "C6" }, { 10: "B5 !", 14: "A5" }]),
        phrase([{ 2: "E5", 6: "A5" }, { 2: "C6 !", 10: "B5" }, { 2: "E5", 7: "C6", 12: "D6" }, { 2: "E6 !", 10: "C6", 14: "B5" }]),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Six Colors: synthwave — a wide saw pad, a driving octave bass, a big
// room on the snare, and a lead that sings over i–VI–III–VII
// ---------------------------------------------------------------------------

const WAVE = {
  KICK: "X.......X.......|X.......X.......",
  SNARE: "....X.......X...|....X.......X...",
  CLAP: "....x.......x...|....x.......x...",
  "C.HAT": "x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.",
};

const WAVE_FILL = {
  ...WAVE,
  SNARE: "....X.......X...|....X...........",
  CLAP: "....x.......x...|....x...........",
  "C.HAT": "x.x.x.x.x.x.x.x.|x.x.x.x.x.x.....",
  "TOM H": "................|............XX..",
  "TOM M": "................|..............x.",
  "TOM L": "................|...............x",
};

const SIX_COLORS: Song = {
  name: "Six Colors",
  tempo: 100,
  bars: 8,
  parts: [
    {
      name: "DRUMS",
      instrument: "drum",
      level: 0.5,
      pan: 0,
      kit: drumKit({
        pads: {
          KICK: { level: 1, decay: 1.5 },
          SNARE: { level: 0.9, decay: 2.2, tone: 0.2 },
          CLAP: { level: 0.55 },
          "C.HAT": { level: 0.35 },
          "TOM H": { level: 0.7 },
          "TOM M": { level: 0.7 },
          "TOM L": { level: 0.7 },
          CRASH: { level: 0.4, decay: 1.5 },
        },
        kit: { drive: 0.2 },
        fx: FxKind.Spring,
        fxValues: [0.9, 0.25, 0.3, 0.9],
      }),
      patterns: [beat({ ...WAVE, CRASH: "x" }), beat(WAVE), beat(WAVE), beat(WAVE_FILL)],
    },
    {
      name: "BASS",
      instrument: "synth",
      level: 1,
      pan: 0,
      sound: synthSound("DRIVE BASS", {
        synth: Synth.Pulse,
        engine: [0.35, 0.25, 0.5, 0.42],
        env: [0.002, 0.25, 0.55, 0.08],
        fx: FxKind.Nitro,
        fxValues: [700, 0.35, 0.25, 0],
      }),
      patterns: [phrase([octaves("A1"), octaves("F1"), octaves("C2"), octaves("G1")], { gate: 0.7 })],
    },
    {
      name: "PAD",
      instrument: "synth",
      level: 0.5,
      pan: -0.35,
      sound: synthSound("NEON PAD", {
        synth: Synth.Cluster,
        engine: [0.75, 0.9, 0.5, 0.15],
        env: [0.35, 1.5, 0.85, 1.4],
        fx: FxKind.Spring,
        fxValues: [0.85, 0.35, 0.4, 0.9],
        lfo: [0.2, 0.4, LfoShape.Triangle, LfoTarget.Param1],
      }),
      patterns: [phrase([{ 0: "A3 C4 E4 ~16" }, { 0: "A3 C4 F4 ~16" }, { 0: "G3 C4 E4 ~16" }, { 0: "G3 B3 D4 ~16" }], { gate: 1 })],
    },
    {
      name: "LEAD",
      instrument: "synth",
      level: 0.9,
      pan: 0.25,
      sound: synthSound("NEON LEAD", {
        synth: Synth.Cluster,
        engine: [0.3, 0.45, 0.72, 0.3],
        env: [0.015, 0.5, 0.75, 0.4],
        fx: FxKind.Delay,
        fxValues: [2, 0.4, 0.3, 0.2],
        lfo: [5.5, 0.1, LfoShape.Sine, LfoTarget.Pitch],
      }),
      patterns: [
        phrase(
          [
            { 0: "E5 ~6 !", 6: "D5 ~2", 8: "C5 ~4", 12: "B4 ~2", 14: "C5 ~2" },
            { 0: "A4 ~12", 14: "C5 ~2" },
            { 0: "E5 ~6 !", 6: "D5 ~2", 8: "C5 ~4", 12: "D5 ~2", 14: "E5 ~2" },
            { 0: "D5 ~12", 12: "B4 ~4" },
          ],
          { gate: 0.95 },
        ),
        phrase(
          [
            { 0: "A5 ~6 !", 6: "G5 ~2", 8: "E5 ~4", 12: "D5 ~2", 14: "E5 ~2" },
            { 0: "F5 ~8 !", 8: "E5 ~4", 12: "C5 ~4" },
            { 0: "G5 ~6 !", 6: "F5 ~2", 8: "E5 ~4", 12: "D5 ~2", 14: "C5 ~2" },
            { 0: "B4 ~8", 8: "D5 ~8 !" },
          ],
          { gate: 0.95 },
        ),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Welcome to Macintosh: Berlin School — a sequence rolling through D minor
// with its accents in threes, slow strings, and chimes
// ---------------------------------------------------------------------------

const PULSE_BEAT = {
  KICK: "x...x...x...x...",
  SHAKER: "xXxXxXxXxXxXxXxX",
  RIM: "....x.......x...",
};

const WELCOME_TO_MACINTOSH: Song = {
  name: "Welcome to Macintosh",
  tempo: 112,
  bars: 8,
  parts: [
    {
      name: "DRUMS",
      instrument: "drum",
      level: 0.45,
      pan: 0,
      kit: drumKit({
        pads: {
          KICK: { level: 0.8, decay: 0.8 },
          SHAKER: { level: 0.35 },
          RIM: { level: 0.4 },
        },
        fx: FxKind.Spring,
        fxValues: [0.6, 0.5, 0.2, 0.7],
      }),
      patterns: [beat(PULSE_BEAT)],
    },
    {
      name: "SEQUENCE",
      instrument: "synth",
      level: 1,
      pan: -0.3,
      sound: synthSound("SEQUENCE", {
        synth: Synth.Pulse,
        engine: [0.35, 0.15, 0, 0.55],
        env: [0.001, 0.22, 0.1, 0.12],
        fx: FxKind.Delay,
        fxValues: [2, 0.45, 0.3, 0.15],
      }),
      patterns: [
        phrase([berlin("D3"), berlin("D3"), berlin("A#2", true), berlin("A#2", true)], { gate: 0.5 }),
        phrase([berlin("G2"), berlin("G2"), berlin("A2", true), berlin("A2", true)], { gate: 0.5 }),
      ],
    },
    {
      name: "STRINGS",
      instrument: "synth",
      level: 0.55,
      pan: 0.3,
      sound: synthSound("STRINGS", {
        synth: Synth.Cluster,
        engine: [0.6, 0.85, 0.42, 0.1],
        env: [0.8, 2, 0.9, 1.8],
        fx: FxKind.Spring,
        fxValues: [0.9, 0.4, 0.45, 0.9],
        lfo: [0.3, 0.3, LfoShape.Sine, LfoTarget.Param1],
      }),
      patterns: [
        phrase([{ 0: "D3 F3 A3 ~16" }, { 0: "D3 F3 A3 ~16" }, { 0: "D3 F3 Bb3 ~16" }, { 0: "D3 F3 Bb3 ~16" }], { gate: 1 }),
        phrase([{ 0: "D3 G3 Bb3 ~16" }, { 0: "D3 G3 Bb3 ~16" }, { 0: "C#3 E3 A3 ~16" }, { 0: "C#3 E3 A3 ~16" }], { gate: 1 }),
      ],
    },
    {
      name: "CHIMES",
      instrument: "synth",
      level: 0.6,
      pan: 0.15,
      sound: synthSound("CHIMES", {
        synth: Synth.Fm,
        engine: [7 / 9, 0.5, 0, 0.55],
        env: [0.001, 2.5, 0, 2],
        fx: FxKind.Delay,
        fxValues: [4, 0.45, 0.3, 0.1],
      }),
      patterns: [
        phrase([
          { 0: "A5 !", 6: "F5", 12: "D5" },
          { 0: "E5", 4: "F5", 8: "A5 !" },
          { 0: "Bb5 !", 6: "F5", 12: "D5" },
          { 0: "C6", 4: "Bb5", 8: "F5 !" },
        ]),
        phrase([
          { 0: "G5 !", 6: "D5", 12: "Bb4" },
          { 0: "C5", 4: "D5", 8: "G5 !" },
          { 0: "A5 !", 6: "E5", 12: "C#5" },
          { 0: "E5", 4: "G5", 8: "A5 !", 12: "C#6" },
        ]),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Puzzle DA: chiptune — two pulse channels, a crushed-sine "triangle" bass
// and noise drums, as a games console would have it, over I–vi–IV–V
// ---------------------------------------------------------------------------

const CHIP = {
  KICK: "X.......X.x.....|X.......X.......",
  "SNARE 2": "....X.......X...|....X.......X...",
  "C.HAT": "x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.",
};

const CHIP_FILL = {
  ...CHIP,
  "SNARE 2": "....X.......X...|....X...X.x.XxXx",
  "C.HAT": "x.x.x.x.x.x.x.x.|x.x.x.x.........",
  ZAP: "................|...............x",
};

const CHIP_ARP = [0, 1, 2, 3, 2, 1] as const;

const PUZZLE_DA: Song = {
  name: "Puzzle DA",
  tempo: 150,
  bars: 8,
  parts: [
    {
      name: "DRUMS",
      instrument: "drum",
      level: 0.7,
      pan: 0,
      kit: drumKit({
        pads: {
          KICK: { level: 0.9, decay: 0.6, tone: 0.3 },
          "SNARE 2": { level: 0.75, decay: 0.8 },
          "C.HAT": { level: 0.35, decay: 0.7 },
          NOISE: { level: 0.4, decay: 0.5 },
          ZAP: { level: 0.6 },
        },
        kit: { drive: 0.5, level: 0.6 },
        fx: FxKind.Phone,
        fxValues: [150, 8000, 0.55, 0.1],
      }),
      patterns: [beat({ ...CHIP, NOISE: "x" }), beat(CHIP), beat(CHIP), beat(CHIP_FILL)],
    },
    {
      name: "TRIANGLE",
      instrument: "synth",
      level: 0.85,
      pan: 0,
      sound: synthSound("TRIANGLE", {
        synth: Synth.Digital,
        engine: [0, 0.8, 0, 0],
        env: [0.001, 0.1, 0.9, 0.03],
        fx: FxKind.Delay,
        fxValues: [3, 0, 0, 0],
      }),
      patterns: [phrase([octaves("C2"), octaves("A1"), octaves("F1"), octaves("G1")], { gate: 0.8 })],
    },
    {
      name: "ARP",
      instrument: "synth",
      level: 0.5,
      pan: -0.45,
      sound: synthSound("ARP", {
        synth: Synth.Pulse,
        engine: [1, 0, 0, 1],
        env: [0.001, 0.08, 0.6, 0.02],
        fx: FxKind.Delay,
        fxValues: [3, 0, 0, 0],
      }),
      patterns: [
        phrase(
          [
            walk(["C4", "E4", "G4", "C5"], CHIP_ARP),
            walk(["A3", "C4", "E4", "A4"], CHIP_ARP),
            walk(["F3", "A3", "C4", "F4"], CHIP_ARP),
            walk(["G3", "B3", "D4", "G4"], CHIP_ARP),
          ],
          { gate: 0.5 },
        ),
      ],
    },
    {
      name: "LEAD",
      instrument: "synth",
      level: 0.75,
      pan: 0.3,
      sound: synthSound("PULSE LEAD", {
        synth: Synth.Pulse,
        engine: [0.44, 0, 0, 1],
        env: [0.001, 0.2, 0.7, 0.05],
        fx: FxKind.Delay,
        fxValues: [1, 0.25, 0.2, 0],
        lfo: [6, 0.08, LfoShape.Sine, LfoTarget.Pitch],
      }),
      patterns: [
        phrase(
          [
            { 0: "E5 !", 2: "G5", 4: "C6 ~2 !", 6: "G5", 8: "E5", 10: "G5", 12: "A5 ~2", 14: "G5" },
            { 0: "E5 ~2 !", 2: "C5", 4: "E5", 6: "A5 ~4 !", 12: "G5", 14: "E5" },
            { 0: "F5 ~2 !", 2: "A5", 4: "C6 ~2", 6: "A5", 8: "F5", 10: "A5", 12: "D6 ~2 !", 14: "C6" },
            { 0: "B5 ~4 !", 4: "G5 ~2", 6: "A5", 8: "B5 ~2", 10: "D6 ~2", 12: "G5 ~4" },
          ],
          { gate: 0.85 },
        ),
        phrase(
          [
            { 0: "C6 ~2 !", 2: "B5", 4: "C6", 6: "G5 ~2", 8: "E5", 10: "G5", 12: "C6 ~2 !", 14: "E6" },
            { 0: "D6 ~2 !", 2: "C6", 4: "A5 ~4", 8: "E5 ~2", 10: "A5", 12: "C6 ~4 !" },
            { 0: "A5 ~2 !", 2: "C6", 4: "F6 ~2 !", 6: "E6", 8: "D6 ~2", 10: "C6", 12: "A5 ~2", 14: "C6" },
            { 0: "B5 ~2 !", 2: "D6", 4: "G6 ~4 !", 8: "F6", 9: "E6", 10: "D6", 11: "B5", 12: "G5 ~4" },
          ],
          { gate: 0.85 },
        ),
      ],
    },
  ],
};

/** The songs, in the order the menu lists them. */
export const DEMO_SONGS: readonly Song[] = [SUNDAY_TAPE, ACID_DESKTOP, SIX_COLORS, WELCOME_TO_MACINTOSH, PUZZLE_DA];
