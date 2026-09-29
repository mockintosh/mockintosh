/**
 * Hello's score: the machine's own sounds — the startup chime, disk chatter,
 * mouse clicks, zoom swooshes, key clicks, an alert, the Trash crumpling —
 * each on the frame it is seen, and a launch-film groove under the type and
 * the apps. Windows and icons play marimba notes as they appear, so the
 * storm and the parade are melodies.
 */
import { midiToFrequency } from "@mockintosh/sdk";
import { hash } from "../ease";
import { chime } from "../sound/chime";
import { Score, type Note, type Voice } from "../sound/score";
import { TAU, dropPhase, gate, perc, pulse, saw, sine, smoothNoise, sweepPhase, white } from "../sound/synth";
import {
  CARDS,
  CLOSE_GAP,
  CLOSE_START,
  FLICKER,
  FLICKER_AT,
  FLICKER_STEP,
  HELLO_OPENS,
  LAND_AT,
  LAND_GAP,
  STORM_GAP,
  STORM_OPEN,
  TAGLINE,
  WORDMARK,
} from "./cues";
import { STORM } from "./windows";

const BEAT = 0.35;
const GROOVE_FROM = CARDS[0]!.at;
const GROOVE_TO = 12.3;

const click: Voice = (dt, note, c) => (white(c.n, note.seed ?? 1) * 0.6 + sine(2400 * dt) * 0.4) * Math.exp(-dt / 0.0025);

const tick: Voice = (dt, note) => sine(note.freq * dt) * perc(dt, 0.0005, 0.012);

const marimba: Voice = (dt, note) => {
  const f = note.freq;
  return (sine(f * dt) * Math.exp(-dt / 0.28) + 0.35 * sine(3.93 * f * dt) * Math.exp(-dt / 0.035)) * perc(dt, 0.001, 5);
};

/** A zoom rectangle's swoosh: air opening as it flies. */
const swoosh: Voice = (dt, note) => {
  const k = Math.min(1, dt / note.dur);
  const rise = note.seed === 1 ? 1 - k : k;
  return smoothNoise(dt, 900 + 6000 * rise, 19) * Math.sin(Math.PI * k) * gate(dt, note.dur, 0.005, 0.01);
};

/** The pencil: scratchy noise that rises and falls with each stroke. */
const pencil: Voice = (dt, note) => smoothNoise(dt, 5200, 57) * (0.35 + 0.65 * Math.abs(Math.sin(TAU * 3.1 * dt))) * gate(dt, note.dur, 0.02, 0.04);

/** A head seeking across the disk: a clunk and a buzz. */
const seek: Voice = (dt, note, c) => (white(c.n, 61) * 0.5 + pulse(note.freq * dt, 0.5, note.freq / c.sampleRate) * 0.3) * perc(dt, 0.0008, 0.018);

/** The alert: two glassy FM tones, falling. */
const alertTone: Voice = (dt, note) => {
  const f = note.freq;
  return Math.sin(TAU * f * dt + 1.6 * Math.exp(-dt / 0.15) * Math.sin(TAU * f * 2 * dt)) * perc(dt, 0.002, 0.3);
};

/** Paper crushed: sparse crackles thickening and thinning. */
const crumple: Voice = (dt, note, c) => {
  const k = dt / note.dur;
  const density = Math.sin(Math.PI * Math.min(1, k));
  const grain = Math.floor(c.t * 1400);
  return hash(grain, 67) < 0.35 * density ? white(c.n, 71) * gate(dt, note.dur, 0.01, 0.05) : 0;
};

const kick: Voice = (dt) => sine(dropPhase(dt, 150, 48, 24)) * perc(dt, 0.001, 0.16);
const clap: Voice = (dt, _n, c) => {
  // Three quick slaps, then the room.
  const slaps = Math.exp(-(dt % 0.011) / 0.003) * (dt < 0.033 ? 1 : 0);
  return white(c.n, 73) * (slaps * 0.5 + perc(dt, 0.001, 0.09) * 0.5);
};
const hat: Voice = (dt, _n, c) => (white(c.n, 79) - white(c.n - 1, 79)) * 0.5 * perc(dt, 0.0005, 0.02);
const bass: Voice = (dt, note, c) =>
  saw(note.freq * dt, note.freq / c.sampleRate) * gate(dt, note.dur, 0.003, 0.04) * (0.6 + 0.4 * Math.exp(-dt / 0.05));
const brass: Voice = (dt, note, c) => {
  const f = note.freq;
  const sr = c.sampleRate;
  return (saw(f * dt, f / sr) + saw(f * 1.005 * dt, (f * 1.005) / sr) + saw(f * 0.995 * dt, (f * 0.995) / sr)) * 0.33 * perc(dt, 0.004, 0.22);
};
const blip: Voice = (dt, note, c) => pulse(note.freq * dt, 0.25, note.freq / c.sampleRate) * perc(dt, 0.001, 0.05);
const crash: Voice = (dt, _n, c) => (white(c.n, 83) - 0.5 * white(c.n - 1, 83)) * perc(dt, 0.002, 0.9);
const riser: Voice = (dt, note) => {
  const k = Math.min(1, dt / note.dur);
  return smoothNoise(dt, 500 + 8000 * k * k, 89) * k * k * gate(dt, note.dur, 0.01, 0.01);
};

/** The tube going dark: a thump, a falling whine, static fading. */
const powerDown: Voice = (dt, note, c) =>
  sine(dropPhase(dt, 90, 30, 6)) * perc(dt, 0.001, 0.2) * 0.8 +
  sine(sweepPhase(dt, 2600, 140, note.dur)) * perc(dt, 0.002, 0.12) * 0.25 +
  white(c.n, 97) * perc(dt, 0.001, 0.08) * 0.3;

const warmUp: Voice = (dt, _n, c) => sine(dropPhase(dt, 110, 40, 12)) * perc(dt, 0.001, 0.3) + white(c.n, 101) * perc(dt, 0.0005, 0.01) * 0.4;

/** C major pentatonic, climbing. */
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96, 98, 100, 103, 105];
/** C, Am, F, G — a bar of four beats each. */
const PROGRESSION = [
  [36, [60, 64, 67, 72]],
  [33, [60, 64, 69, 72]],
  [29, [60, 65, 69, 72]],
  [31, [59, 62, 67, 71]],
] as const;

function tone(at: number, dur: number, tail: number, midi: number, gain: number, pan: number, voice: Voice, extra: Partial<Note> = {}): Note {
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

function fx(at: number, dur: number, tail: number, gain: number, pan: number, voice: Voice, extra: Partial<Note> = {}): Note {
  return { at, dur, tail, freq: 0, gain, pan, voice, ...extra };
}

function mouse(notes: Note[], at: number, pan = 0.2): void {
  notes.push(fx(at, 0, 0.02, 0.35, pan, click));
}

/** The pointer dragging down a menu: a tick per item, then the choose blink. */
function menuPick(notes: Note[], press: number, from: number, to: number, items: number): void {
  mouse(notes, press, -0.3);
  for (let k = 0; k < items; k++) notes.push(tone(from + ((to - from) * k) / items, 0, 0.02, 96, 0.05, -0.3, tick));
  for (let k = 0; k < 3; k++) notes.push(tone(to + k * 0.08, 0, 0.02, 100, 0.06, -0.3, tick));
  mouse(notes, to, -0.3);
}

export function helloScore(): Score {
  const notes: Note[] = [];

  // Power On: the tube, the chime, the disk and the extensions.
  notes.push(fx(0.25, 0, 0.35, 0.6, 0, warmUp));
  notes.push(...chime(0.56, 0.22));
  for (let k = 0; k < 16; k++) {
    const at = 1.1 + k * 0.052 + hash(k, 5) * 0.03;
    notes.push({
      ...fx(at, 0, 0.03, 0.12, 0.5, seek),
      freq: 90 + hash(k, 7) * 160,
    });
  }
  for (let i = 0; i < 11; i++) notes.push(tone(1.15 + i * 0.055, 0, 0.02, 91 + (i % 3) * 2, 0.04, -0.6 + i * 0.1, tick));

  // Hello: the menubar, the pencil, the marquee.
  mouse(notes, 2.0, 0);
  notes.push(fx(2.55, 1.3, 0.05, 0.2, 0, pencil));
  mouse(notes, 3.95);
  mouse(notes, 4.2);

  // Windows: a double-click, then every window zooms open on the next note up.
  mouse(notes, HELLO_OPENS - 0.05);
  mouse(notes, HELLO_OPENS + 0.05);
  const opens = [HELLO_OPENS, ...STORM.map((_, i) => STORM_OPEN + i * STORM_GAP)];
  opens.forEach((at, i) => {
    const pan = -0.7 + (1.4 * i) / opens.length;
    notes.push(fx(at - 0.12, 0.12, 0.01, 0.1, pan, swoosh));
    notes.push(tone(at, 0, 0.5, PENTA[i]! - 12, 0.18, pan, marimba, { wet: 0.4 }));
  });
  const keyCaps = STORM_OPEN + 5 * STORM_GAP;
  for (let k = 0; k < 5; k++) notes.push(fx(keyCaps + k / 9, 0, 0.02, 0.22, -0.4, click, { seed: 3 + k }));
  const calculator = STORM_OPEN + 7 * STORM_GAP;
  notes.push(tone(calculator + 0.25, 0.06, 0.02, 88, 0.05, 0.3, blip), tone(calculator + 0.5, 0.06, 0.02, 91, 0.05, 0.3, blip));
  const copying = STORM_OPEN + 8 * STORM_GAP;
  for (let k = 0; k < 5; k++)
    notes.push({
      ...fx(copying + k * 0.03, 0, 0.03, 0.1, 0.4, seek),
      freq: 120 + k * 30,
    });
  const reality = STORM_OPEN + 9 * STORM_GAP;
  notes.push(tone(reality, 0, 0.4, 81, 0.2, 0, alertTone, { wet: 0.5 }), tone(reality + 0.09, 0, 0.45, 76, 0.2, 0, alertTone, { wet: 0.5 }));
  mouse(notes, reality + 0.45);
  // Into the Trash, topmost first, falling down the scale.
  for (let j = 0; j < opens.length; j++) {
    const at = CLOSE_START + j * CLOSE_GAP;
    notes.push(fx(at, 0.16, 0.01, 0.07, 0.6, swoosh, { seed: 1 }));
    notes.push(tone(at + 0.12, 0, 0.35, PENTA[opens.length - 1 - j]! - 12, 0.12, 0.6, marimba));
  }
  notes.push(fx(6.45, 0.5, 0.05, 0.28, 0.7, crumple));

  // Type: the Special menu, then the groove under the cards.
  menuPick(notes, 7.35, 7.42, 7.64, 4);
  for (let t = GROOVE_FROM, beat = 0; t < GROOVE_TO - 1e-6; t += BEAT, beat++) {
    const inFill = t >= FLICKER_AT && t < FLICKER_AT + FLICKER.length * FLICKER_STEP;
    notes.push(fx(t, 0, 0.3, 0.8, 0, kick));
    if (!inFill) notes.push(fx(t + BEAT / 2, 0, 0.05, 0.22, 0.35, hat));
    if (beat % 2 === 1 && !inFill) notes.push(fx(t, 0, 0.2, 0.3, -0.1, clap));
    const [root, chord] = PROGRESSION[Math.floor(beat / 4) % PROGRESSION.length]!;
    notes.push(tone(t, BEAT * 0.45, 0.04, root, 0.22, 0, bass), tone(t + BEAT / 2, BEAT * 0.4, 0.04, root + 12, 0.16, 0, bass));
    if (beat % 4 === 0)
      chord.forEach((m, i) =>
        notes.push(
          tone(t, BEAT * 3, 0.2, m, 0.045, (i - 1.5) * 0.3, brass, {
            wet: 0.3,
          }),
        ),
      );
  }
  CARDS.forEach((card, i) => {
    notes.push(fx(card.at, 0, 0.9, 0.25, 0, crash));
    [0, 4, 7, 12].forEach((iv) => notes.push(tone(card.at, 0, 0.3, 60 + [0, -3, 5, 7][i]! + iv, 0.08, (iv - 6) / 12, brass, { wet: 0.4 })));
  });
  FLICKER.forEach((_, i) => {
    const at = FLICKER_AT + i * FLICKER_STEP;
    notes.push(fx(at, 0, 0.12, 0.22, (i % 2 ? 1 : -1) * 0.3, clap));
    notes.push(tone(at, 0.04, 0.02, 72 + i * 2, 0.07, 0, blip));
  });

  // Apps: each icon lands on a note, the marquee sweeps, the drag rises into a hit.
  for (let o = 0; o < 15; o++) notes.push(tone(LAND_AT + o * LAND_GAP, 0, 0.4, PENTA[o]!, 0.13, -0.6 + o * 0.085, marimba, { wet: 0.4 }));
  mouse(notes, 11.15);
  notes.push(fx(11.15, 0.4, 0.02, 0.1, 0, swoosh));
  mouse(notes, 11.55);
  mouse(notes, 11.8);
  notes.push(fx(11.8, 0.5, 0.01, 0.25, 0, riser));
  mouse(notes, 12.3);
  notes.push(fx(12.3, 0, 1.2, 0.35, 0, crash));

  // Shut Down: the chime again for the lockup, letters ticking in, the menu, the tube.
  notes.push(...chime(12.4, 0.2));
  [...WORDMARK].forEach((_, i) => notes.push(tone(12.6 + i * 0.045, 0, 0.12, PENTA[i]! + 12, 0.035, -0.5 + i * 0.1, marimba)));
  for (let i = 0; i < TAGLINE.length; i += 3)
    notes.push(
      fx(13.12 + (0.33 * i) / TAGLINE.length, 0, 0.02, 0.1, 0.1, click, {
        seed: 9 + i,
      }),
    );
  menuPick(notes, 13.6, 13.64, 13.8, 5);
  notes.push(tone(14.05, 0, 0.25, 84, 0.05, 0, marimba));
  notes.push(fx(14.6, 0.3, 0.25, 0.5, 0, powerDown));

  return new Score(
    notes,
    [
      { delay: 0.09, gain: 0.3, pan: -0.6 },
      { delay: 0.16, gain: 0.22, pan: 0.6 },
      { delay: 0.27, gain: 0.12, pan: 0 },
    ],
    [],
    0.85,
  );
}
