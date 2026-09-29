/**
 * The Mockintosh startup chime: a big major chord struck all at once, close
 * to the classic. Reels that show the machine waking (or the logo) ring it.
 */
import { midiToFrequency } from "@mockintosh/sdk";
import type { Note, Voice } from "./score";
import { perc, sine } from "./synth";

/** A warm, bell-edged chord tone: fundamental, octave, a whisper of the twelfth. */
const chimeTone: Voice = (dt, note) => {
  const f = note.freq;
  const v = sine(f * dt) + sine(f * 1.003 * dt) * 0.6 + 0.35 * sine(2 * f * dt) * Math.exp(-dt / 0.5) + 0.12 * sine(3 * f * dt) * Math.exp(-dt / 0.2);
  return v * perc(dt, 0.006, 1.4) * 0.5;
};

const CHORD = [48, 55, 60, 64, 67, 72];

/** The chime's notes at `at`, each at `gain`, spread across the stereo field. */
export function chime(at: number, gain: number): Note[] {
  return CHORD.map((midi, i) => ({
    at,
    dur: 0,
    tail: 2.2,
    freq: midiToFrequency(midi),
    gain,
    pan: (i - 2.5) * 0.18,
    voice: chimeTone,
    wet: 0.6,
  }));
}
