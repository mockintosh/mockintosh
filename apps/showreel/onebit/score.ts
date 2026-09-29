/**
 * One Bit's score: electro made of pulse waves and noise — the sound of a
 * one-bit speaker, band-limited — on the reel's 120 BPM cut grid. Every hit
 * lands on a picture event: the tube's thunk, the tunnel's surges, the
 * flash frames, each cut of the edit, and the power-off.
 */
import { midiToFrequency } from "@mockintosh/sdk";
import { Score, type Note, type Voice } from "../sound/score";
import { dropPhase, perc, pulse, gate, saw, sine, smoothNoise, sweepPhase, white } from "../sound/synth";

const BEAT = 0.5;
const STEP = BEAT / 4;

const kick: Voice = (dt) => sine(dropPhase(dt, 170, 44, 28)) * perc(dt, 0.001, 0.2) + white(Math.floor(dt * 40000), 7) * Math.exp(-dt / 0.002) * 0.4;

const snare: Voice = (dt, _n, c) => white(c.n, 3) * perc(dt, 0.001, 0.08) * 0.7 + sine(dropPhase(dt, 240, 170, 25)) * perc(dt, 0.001, 0.05) * 0.6;

/** Differenced noise: the high half of the spectrum. */
const hat: Voice = (dt, note, c) => (white(c.n, 11) - white(c.n - 1, 11)) * 0.5 * perc(dt, 0.0005, note.seed ?? 0.025);

const crash: Voice = (dt, _n, c) => (white(c.n, 17) - white(c.n - 1, 17) * 0.6) * perc(dt, 0.002, 0.7) * 0.6;

const bass: Voice = (dt, note, c) => {
  const f = note.freq;
  const duty = 0.5 - 0.3 * Math.exp(-dt / 0.06);
  return pulse(f * dt, duty, f / c.sampleRate) * gate(dt, note.dur, 0.002, 0.03);
};

const lead: Voice = (dt, note, c) => {
  const f = note.freq * (1 + 0.004 * Math.sin(dt * 34));
  return pulse(f * dt, 0.25, f / c.sampleRate) * perc(dt, 0.002, note.dur * 0.9);
};

const arp: Voice = (dt, note, c) => pulse(note.freq * dt, 0.125 + (note.seed ?? 0) * 0.3, note.freq / c.sampleRate) * perc(dt, 0.001, 0.07);

const stab: Voice = (dt, note, c) => {
  const f = note.freq;
  const sr = c.sampleRate;
  return (saw(f * dt, f / sr) + saw(f * 1.006 * dt, (f * 1.006) / sr) + pulse(f * 0.5 * dt, 0.5, (f * 0.5) / sr)) * 0.33 * perc(dt, 0.002, 0.16);
};

const pad: Voice = (dt, note, c) => {
  const f = note.freq;
  const sr = c.sampleRate;
  const detune = [0.994, 1, 1.007];
  let v = 0;
  for (const d of detune) v += saw(f * d * dt, (f * d) / sr);
  return v * 0.25 * gate(dt, note.dur, 0.35, 0.8);
};

const blip: Voice = (dt, note) => sine(note.freq * dt) * perc(dt, 0.001, 0.04);

/** Noise that opens up as it rises: a riser. */
const riser: Voice = (dt, note) => {
  const k = dt / note.dur;
  return smoothNoise(dt, 400 + 9000 * k * k, 23) * k * k * gate(dt, note.dur, 0.01, 0.02);
};

/** The tube warming: mains hum under a swell of noise. */
const warmUp: Voice = (dt, note) => {
  const k = Math.min(1, dt / note.dur);
  return (sine(50 * dt) * 0.5 + sine(100 * dt) * 0.25 + smoothNoise(dt, 1800, 5) * 0.4) * k * k * gate(dt, note.dur, 0.02, 0.01);
};

/** The picture snapping on: a degauss thunk. */
const thunk: Voice = (dt, _n, c) => sine(dropPhase(dt, 120, 38, 9)) * perc(dt, 0.001, 0.35) + white(c.n, 29) * perc(dt, 0.0005, 0.012) * 0.5;

/** The tube switching off: a whine diving to nothing. */
const zap: Voice = (dt, note) => sine(sweepPhase(dt, 1400, 30, note.dur)) * perc(dt, 0.001, 0.22) * 0.6;

const A_MINOR = [57, 60, 64, 67, 69, 72, 76];
/** Am, F, C, G — one chord per bar from the first groove. */
const CHORDS = [
  [45, 57, 60, 64],
  [41, 57, 60, 65],
  [48, 55, 60, 64],
  [43, 55, 59, 62],
];
const MELODY = [76, 74, 72, 69, 72, 74, 76, 79, 81, 79, 76, 74, 72, 74, 69, 67];

function note(at: number, dur: number, tail: number, midi: number, gain: number, pan: number, voice: Voice, extra: Partial<Note> = {}): Note {
  return {
    at,
    dur,
    tail,
    freq: midiToFrequency(midi),
    gain,
    pan,
    voice,
    ...extra,
  };
}

function hit(at: number, voice: Voice, gain: number, tail = 0.5, pan = 0, extra: Partial<Note> = {}): Note {
  return { at, dur: 0, tail, freq: 0, gain, pan, voice, ...extra };
}

function chordAt(t: number): readonly number[] {
  return CHORDS[Math.floor(Math.max(0, t - 2) / (4 * BEAT)) % CHORDS.length]!;
}

/** The groove: four on the floor, off-beat hats, eighth-note bass. */
function groove(notes: Note[], from: number, to: number, snares: boolean): void {
  for (let t = from; t < to - 1e-6; t += BEAT) {
    const beat = Math.round((t - from) / BEAT);
    notes.push(hit(t, kick, 0.9));
    notes.push(hit(t + BEAT / 2, hat, 0.35, 0.1, 0.3));
    notes.push(hit(t + BEAT / 4, hat, 0.12, 0.05, -0.3, { seed: 0.012 }));
    notes.push(hit(t + (3 * BEAT) / 4, hat, 0.12, 0.05, -0.3, { seed: 0.012 }));
    if (snares && beat % 2 === 1) notes.push(hit(t, snare, 0.55, 0.3, 0.05));
    const root = chordAt(t)[0]!;
    notes.push(note(t, BEAT / 2 - 0.02, 0.05, root, 0.32, 0, bass));
    notes.push(note(t + BEAT / 2, BEAT / 2 - 0.02, 0.05, root + 12, 0.26, 0, bass));
  }
}

function melody(notes: Note[], from: number, to: number): void {
  let i = 0;
  for (let t = from; t < to - 1e-6; t += BEAT / 2, i++) {
    if (i % 8 === 7) continue;
    notes.push(
      note(t, BEAT / 2, 0.1, MELODY[i % MELODY.length]!, 0.16, 0.15, lead, {
        wet: 0.5,
      }),
    );
  }
}

export function oneBitScore(): Score {
  const notes: Note[] = [];

  // Type: the tube warms, snaps on, and an arpeggio rises under the title.
  notes.push(hit(0.05, warmUp, 0.3, 0.02, 0, { dur: 0.6 }));
  notes.push(hit(0.65, thunk, 0.8, 0.5));
  for (let t = 0.8, i = 0; t < 2 - 1e-6; t += STEP, i++) {
    const midi = A_MINOR[i % A_MINOR.length]! + (Math.floor(i / A_MINOR.length) % 2) * 12;
    notes.push(note(t, STEP, 0.1, midi, 0.1 + 0.1 * ((t - 0.8) / 1.2), Math.sin(i) * 0.5, arp, { wet: 0.4, seed: (t - 0.8) / 1.2 }));
  }

  // Shape and Depth: the groove, with snares and a lead when depth arrives.
  groove(notes, 2, 4.5, false);
  groove(notes, 4.5, 7, true);
  melody(notes, 4.5, 7);

  // Particles: the drums fall away; a pad, sparkles, a riser and a roll into the tunnel.
  notes.push(hit(7, crash, 0.7, 1.4));
  notes.push(hit(7, kick, 1));
  notes.push(note(7, 1.2, 0.8, 53, 0.16, -0.2, pad), note(7, 1.2, 0.8, 57, 0.14, 0.2, pad), note(7, 1.2, 0.8, 64, 0.12, 0, pad));
  notes.push(note(8.25, 1.1, 0.4, 55, 0.16, -0.2, pad), note(8.25, 1.1, 0.4, 59, 0.14, 0.2, pad), note(8.25, 1.1, 0.4, 62, 0.12, 0, pad));
  for (let k = 0; k < 26; k++) {
    const at = 7.15 + k * 0.078 + (white(k, 41) + 1) * 0.02;
    const midi = A_MINOR[Math.floor((white(k, 43) + 1) * 3.5) % A_MINOR.length]! + 24;
    notes.push(note(at, 0, 0.12, midi, 0.08, white(k, 47), blip, { wet: 0.6 }));
  }
  notes.push(hit(8.5, riser, 0.35, 0.02, 0, { dur: 1 }));
  for (let t = 9; t < 9.5 - 1e-6; t += t < 9.25 ? STEP / 2 : STEP / 4) {
    notes.push(hit(t, snare, 0.2 + 0.5 * ((t - 9) / 0.5), 0.1));
  }

  // Rhythm: everything, and a crash on each flash frame.
  notes.push(hit(9.5, crash, 0.8, 1.2));
  groove(notes, 9.5, 12, true);
  melody(notes, 10.5, 12);
  for (const flash of [10.5, 11.5]) notes.push(hit(flash, crash, 0.5, 0.8, flash === 10.5 ? -0.4 : 0.4));

  // Edit: a stab and a kick on every quarter-second cut, rooted a new way each time.
  const cutRoots = [57, 53, 60, 55, 57, 64];
  cutRoots.forEach((root, i) => {
    const at = 12 + i * 0.25;
    notes.push(hit(at, kick, 0.95));
    for (const iv of [0, 3, 7]) notes.push(note(at, 0, 0.35, root + iv, 0.13, (i % 2 ? 1 : -1) * 0.3, stab));
    for (let s = 0; s < 4; s++) notes.push(hit(at + s * (0.25 / 4), hat, 0.1 + s * 0.04, 0.04, (s % 2 ? 1 : -1) * 0.5, { seed: 0.01 }));
  });
  notes.push(hit(12, crash, 0.6, 0.8));

  // Credits: one long chord rings out, then the power-off.
  notes.push(hit(13.5, crash, 0.7, 1.2));
  notes.push(hit(13.5, kick, 1));
  for (const midi of [45, 57, 64, 71, 72]) notes.push(note(13.5, 0.9, 0.3, midi, 0.1, (midi % 5) / 5 - 0.4, pad));
  notes.push(hit(14.7, zap, 0.5, 0.25, 0, { dur: 0.25 }));

  return new Score(
    notes,
    [
      { delay: STEP * 2, gain: 0.45, pan: -0.7 },
      { delay: STEP * 3, gain: 0.3, pan: 0.7 },
      { delay: STEP * 6, gain: 0.15, pan: -0.4 },
    ],
    [],
    0.55,
  );
}
