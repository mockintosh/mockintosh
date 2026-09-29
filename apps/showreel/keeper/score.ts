/**
 * The Keeper's score: what a pianist in a small cinema would play under it —
 * a waltz in D minor — with the projector clattering at 24 frames a second,
 * the sea, the gulls and the lighthouse bell. Under water the piano gives way
 * to a drone, the whale and the bubbles; it climbs back with the beam and
 * resolves to D major on FIN.
 */
import { midiToFrequency } from "@mockintosh/sdk";
import { hash, seg } from "../ease";
import { Score, type Bed, type Note, type Voice } from "../sound/score";
import { TAU, gate, perc, sine, smoothNoise, sweepPhase, white } from "../sound/synth";

const BEAT = 0.6;
const BAR = BEAT * 3;
const DOWNBEAT = 0.3;

/** Four partials, the higher ones dying faster, a stiff string's stretch and a felt thump. */
const piano: Voice = (dt, note, c) => {
  const f = note.freq;
  const damp = Math.sqrt(f / 262);
  let v = 0;
  for (let k = 1; k <= 4; k++) {
    const fk = f * k * (1 + 0.0004 * k * k);
    v += (Math.sin(TAU * fk * dt) * Math.exp(-dt * (0.7 + k * 0.9) * damp)) / k;
  }
  const hammer = white(c.n, 13) * Math.exp(-dt / 0.004) * 0.12;
  return (v * 0.6 + hammer) * gate(dt, note.dur, 0.002, 0.3);
};

/** A buoy bell: FM, inharmonic, long. */
const bell: Voice = (dt, note) => {
  const f = note.freq;
  return Math.sin(TAU * f * dt + 2.4 * Math.exp(-dt / 0.6) * Math.sin(TAU * f * 1.41 * dt)) * perc(dt, 0.002, 1.6);
};

/** A gull: a falling, gritty two-tone cry. */
const gull: Voice = (dt, note) => {
  const p = sweepPhase(dt, note.freq, note.freq * 0.62, note.dur);
  return (sine(p) + 0.45 * sine(2.02 * p) + 0.2 * sine(3.1 * p)) * gate(dt, note.dur, 0.02, 0.05) * 0.5;
};

/**
 * The whale: a moan whose pitch wanders on a slow sine plus a vibrato —
 * integrated in closed form so it stays a function of time.
 */
const whale: Voice = (dt, note) => {
  const base = note.freq;
  const w1 = TAU * 0.33;
  const w2 = TAU * 5.5;
  const phase = base * dt + (base * 0.45 * (1 - Math.cos(w1 * dt))) / w1 + (base * 0.01 * (1 - Math.cos(w2 * dt))) / w2;
  return (sine(phase) + 0.3 * sine(phase * 0.5) + 0.12 * sine(phase * 2)) * gate(dt, note.dur, 0.35, 0.7);
};

const bubble: Voice = (dt, note) => sine(sweepPhase(dt, note.freq, note.freq * 1.9, 0.045)) * perc(dt, 0.001, 0.035);

/** A drone under the water: two sines a hair apart, beating slowly. */
const drone: Voice = (dt, note) =>
  (sine(note.freq * dt) + sine(note.freq * 1.004 * dt) + 0.4 * sine(note.freq * 1.5 * dt)) * gate(dt, note.dur, 0.8, 0.8) * 0.4;

/** The beam turning to camera: a swell of air that opens and burns out. */
const flare: Voice = (dt, note) => {
  const k = Math.min(1, dt / note.dur);
  return (smoothNoise(dt, 600 + 7000 * k, 31) + 0.6 * smoothNoise(dt, 9000, 37)) * k * k * k * gate(dt, note.dur, 0.01, 0.03);
};

const CHORDS: readonly (readonly [bass: number, chord: readonly number[]])[] = [
  [50, [57, 62, 65]],
  [43, [58, 62, 67]],
  [45, [55, 61, 64]],
  [50, [57, 62, 65]],
];

/** [beat, beats held, MIDI] for each bar's melody. */
const MELODY: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0, 2, 74],
    [2, 1, 69],
  ],
  [
    [0, 1.5, 70],
    [1.5, 0.5, 69],
    [2, 1, 67],
  ],
  [
    [0, 2, 73],
    [2, 1, 76],
  ],
  [
    [0, 1, 74],
    [1, 1, 72],
    [2, 1, 69],
  ],
];

function key(at: number, dur: number, tail: number, midi: number, gain: number, pan: number, voice: Voice, wet = 0): Note {
  return { at, dur, tail, freq: midiToFrequency(midi), gain, pan, voice, wet };
}

/** Where the picture is lit, and so where the projector runs. */
function projectorLevel(t: number): number {
  return seg(t, 0.08, 0.6) * (1 - seg(t, 14.2, 14.92));
}

/** The sea above water, and its muffled roar below. */
function surfLevel(t: number): { above: number; below: number } {
  const above = seg(t, 1.8, 2.8) * (1 - seg(t, 7, 7.7)) + seg(t, 11.2, 12) * (1 - seg(t, 12.6, 13));
  const below = seg(t, 7.3, 8.2) * (1 - seg(t, 10.8, 11.6));
  return { above, below };
}

const projector: Bed = {
  pan: 0.15,
  sound(c) {
    const level = projectorLevel(c.t);
    if (level <= 0) return 0;
    const x = c.t * 24;
    const frame = Math.floor(x);
    const since = (x - frame) / 24;
    // The claw pulls each frame down: a click, louder or softer frame to frame.
    const click = white(c.n, 3) * Math.exp(-since / 0.0035) * (0.6 + 0.4 * hash(frame, 7));
    const motor = sine(c.t * 60) * 0.25 + smoothNoise(c.t, 900, 9) * 0.3;
    return (click + motor) * level * 0.12;
  },
};

function surfBed(pan: number, seed: number): Bed {
  return {
    pan,
    sound(c) {
      const { above, below } = surfLevel(c.t);
      if (above <= 0 && below <= 0) return 0;
      const swell = 0.55 + 0.45 * Math.sin(c.t * 1.1 + seed);
      const wash = (smoothNoise(c.t, 3200, seed) * 0.6 + smoothNoise(c.t, 700, seed + 1)) * swell * above;
      const roar = smoothNoise(c.t, 160, seed + 2) * below * 1.6;
      return (wash + roar) * 0.16;
    },
  };
}

export function keeperScore(): Score {
  const notes: Note[] = [];

  // The waltz, from the title card until the camera goes under.
  for (let bar = 0; bar < 4; bar++) {
    const at = DOWNBEAT + bar * BAR;
    const [bass, chord] = CHORDS[bar]!;
    notes.push(key(at, BEAT * 0.9, 0.9, bass - 12, 0.3, -0.25, piano, 0.5));
    for (const beat of [1, 2]) {
      for (const midi of chord) notes.push(key(at + beat * BEAT, BEAT * 0.55, 0.5, midi - 12, 0.13, -0.1, piano, 0.5));
    }
    for (const [beat, held, midi] of MELODY[bar]!) {
      notes.push(key(at + beat * BEAT, held * BEAT, 0.8, midi, 0.26, 0.2, piano, 0.7));
    }
  }

  // The lighthouse: its bell, and the gulls.
  notes.push(key(5.75, 0, 3, 57, 0.28, -0.5, bell, 0.4));
  notes.push(key(6.65, 0, 2.6, 57, 0.2, -0.5, bell, 0.4));
  notes.push({ ...key(5.9, 0.22, 0.05, 90, 0.08, 0.6, gull), freq: 1900 });
  notes.push({ ...key(6.18, 0.3, 0.05, 90, 0.07, 0.4, gull), freq: 1700 });
  notes.push({ ...key(6.95, 0.2, 0.05, 90, 0.05, 0.7, gull), freq: 2100 });

  // The dive: a run tumbling down the keyboard as the camera sinks.
  const run = [86, 81, 77, 74, 69, 65, 62, 57, 53, 50, 45, 41];
  run.forEach((midi, i) => notes.push(key(7.0 + i * 0.055, 0.1, 0.6, midi, 0.2 - i * 0.01, 0.4 - i * 0.07, piano, 0.6)));

  // Below: a drone, the whale passing left to right, bubbles.
  notes.push(key(7.6, 3.1, 0.8, 38, 0.2, 0, drone));
  notes.push({ ...key(8.0, 1.6, 0.7, 0, 0.13, 0.5, whale), freq: 190 });
  notes.push({ ...key(9.9, 1.3, 0.7, 0, 0.11, -0.3, whale), freq: 150 });
  for (let k = 0; k < 22; k++) {
    const at = 7.5 + k * 0.15 + hash(k, 3) * 0.1;
    notes.push({
      ...key(at, 0, 0.05, 0, 0.05, hash(k, 5) * 1.6 - 0.8, bubble),
      freq: 500 + hash(k, 9) * 900,
    });
  }

  // The rise into the beam: arpeggios climbing and swelling.
  const bflat = [46, 53, 58, 62, 65, 70, 74, 77, 82];
  const a7 = [45, 52, 57, 61, 64, 67, 69, 73, 76, 79, 81];
  bflat.forEach((midi, i) => notes.push(key(10.9 + i * 0.1, 0.25, 0.7, midi, 0.1 + i * 0.012, -0.3 + i * 0.07, piano, 0.6)));
  a7.forEach((midi, i) => notes.push(key(11.8 + i * 0.07, 0.2, 0.6, midi, 0.14 + i * 0.012, 0.35 - i * 0.07, piano, 0.6)));
  notes.push({ ...key(12.2, 0.75, 0.03, 0, 0.3, 0, flare), freq: 0 });

  // FIN: a rolled D major, ringing out as the iris closes.
  [38, 50, 57, 62, 66, 69, 74, 78].forEach((midi, i) => notes.push(key(13.0 + i * 0.035, 1.3, 0.55, midi, 0.2, -0.4 + i * 0.1, piano, 0.7)));

  return new Score(
    notes,
    [
      { delay: 0.071, gain: 0.35, pan: -0.8 },
      { delay: 0.133, gain: 0.25, pan: 0.8 },
      { delay: 0.227, gain: 0.14, pan: -0.3 },
    ],
    [projector, surfBed(-0.6, 101), surfBed(0.6, 211)],
    1.4,
  );
}
