/**
 * The sound of "A Lot Like 1984": the ad's own soundtrack under the edit —
 * Big Brother's speech, the hall, the explosion — with the machine's sounds
 * laid over it: an alert beep for every alert, a tick for every notification,
 * a thump under the impact, and after the footage a soft chord and the chime.
 */
import { midiToFrequency, type VideoExcerpt } from "@mockintosh/sdk";
import { seg } from "../ease";
import { FootageSound } from "../footage";
import type { ReelSoundtrack } from "../reels";
import { chime } from "../sound/chime";
import { Score, layered, type Note, type Voice } from "../sound/score";
import { dropPhase, perc, pulse, sine } from "../sound/synth";
import { ALERTS, BANNERS, CARD_AT, CRASH, CUTS, IMPACT, LOGO_AT } from "./edit";

/** Something like the Simple Beep: a bright square tone, quickly gone. */
const beep: Voice = (dt, note, c) =>
  (pulse(note.freq * dt, 0.5, note.freq / c.sampleRate) * 0.6 + 0.4 * sine(note.freq * 2 * dt)) * perc(dt, 0.002, 0.12);

/** A notification: a short, high two-tone blip. */
const tick: Voice = (dt, note) => (sine(note.freq * dt) + 0.5 * sine(note.freq * 1.5 * dt)) * perc(dt, 0.001, 0.05);

/** A low thump under the ad's explosion. */
const thump: Voice = (dt) => sine(dropPhase(dt, 80, 26, 6)) * perc(dt, 0.003, 0.8);

/** A soft organ-like tone for the card. */
const pad: Voice = (dt, note) => {
  const f = note.freq;
  return (sine(f * dt) + 0.3 * sine(2 * f * dt) + 0.12 * sine(3.01 * f * dt) + 0.5 * sine(f * 1.002 * dt)) * gatePad(dt, note.dur) * 0.4;
};

function gatePad(dt: number, dur: number): number {
  return Math.min(1, dt / 1.2) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 1.4));
}

function fx(at: number, tail: number, freq: number, gain: number, pan: number, voice: Voice): Note {
  return { at, dur: 0, tail, freq, gain, pan, voice, wet: 0.3 };
}

/** The ad's sound fades up with the picture and away before the card. */
function footageLevel(t: number): number {
  return Math.min(seg(t, 0, 0.4), 1 - seg(t, CARD_AT - 0.7, CARD_AT));
}

export function hammerScore(footage: VideoExcerpt | undefined): ReelSoundtrack {
  const notes: Note[] = [];
  for (const cue of ALERTS) notes.push(fx(cue.at, 0.2, 1046, 0.16, 0.1 * cue.step, beep));
  BANNERS.forEach((b, i) => notes.push(fx(b.at, 0.08, 1760 + (i % 3) * 220, 0.07, 0.4, tick)));
  notes.push(fx(IMPACT, 0.9, 0, 0.32, 0, thump));
  notes.push(fx(CRASH.at, 0.2, 523, 0.14, 0, beep));
  [48, 55, 64, 71, 74].forEach((midi, i) =>
    notes.push({
      at: CARD_AT + 0.4 + i * 0.12,
      dur: LOGO_AT - CARD_AT - 0.8,
      tail: 1.4,
      freq: midiToFrequency(midi),
      gain: 0.2,
      pan: (i - 2) * 0.3,
      voice: pad,
    }),
  );
  notes.push(...chime(LOGO_AT, 0.2));
  const machine = new Score(notes, [
    { delay: 0.11, gain: 0.3, pan: -0.6 },
    { delay: 0.23, gain: 0.2, pan: 0.6 },
  ]);
  if (!footage) return machine;
  return layered(new FootageSound(CUTS, footage, { gain: 1, level: footageLevel }), machine);
}
