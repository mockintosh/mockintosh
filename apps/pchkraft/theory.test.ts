/**
 * Snapping a hum onto a scale, and the chord a beat of melody becomes.
 */
import { describe, expect, it } from "vitest";
import {
  SCALES,
  chordForBeat,
  chordLabel,
  nearestScaleTone,
  noteName,
  snapToScale,
  triadForPad,
  voiceChord,
} from "./theory";

const major = SCALES[0]!;
const minor = SCALES[1]!;
const penta = SCALES[4]!;

describe("scale snap", () => {
  it("lands a hum on the nearest scale tone", () => {
    expect(snapToScale(60.2, 0, major.steps, null)).toBe(60);
    expect(snapToScale(61.6, 0, major.steps, null)).toBe(62);
    // F is not in C pentatonic; E is closer than G.
    expect(snapToScale(65, 0, penta.steps, null)).toBe(64);
  });

  it("breaks a tie toward the note already sounding, else downward", () => {
    expect(nearestScaleTone(61, 0, major.steps, null)).toBe(60);
    expect(nearestScaleTone(61, 0, major.steps, 62)).toBe(62);
  });

  it("stays put until the voice crosses the midpoint", () => {
    expect(snapToScale(61.2, 0, major.steps, 60)).toBe(60);
    expect(snapToScale(61.5, 0, major.steps, 60)).toBe(62);
  });

  it("names the four chords of C major and A minor", () => {
    expect(major.chords.map((chord) => chordLabel(0, chord))).toEqual(["C", "F", "G", "Am"]);
    expect(minor.chords.map((chord) => chordLabel(9, chord))).toEqual(["Am", "Dm", "Em", "F"]);
    expect(noteName(69, false)).toBe("A4");
    expect(noteName(61, true)).toBe("Db4");
  });

  it("lists every triad the scale contains, and keeps the four keys among them", () => {
    expect(major.triads.map((chord) => chord.numeral)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "viio"]);
    expect(SCALES[1]!.triads.map((chord) => chord.numeral)).toEqual(["i", "iio", "III", "iv", "v", "VI", "VII"]);
    expect(SCALES[2]!.triads.map((chord) => chord.numeral)).toEqual(["i", "ii", "III", "IV", "v", "vio", "VII"]);
    expect(SCALES[3]!.triads.map((chord) => chord.numeral)).toEqual(["I", "ii", "iiio", "IV", "v", "vi", "bVII"]);
    // Pentatonic's own triads are C and Am. F and G are borrowed so the keys still play.
    expect(penta.triads.map((chord) => chord.numeral)).toEqual(["I", "IV", "V", "vi"]);
    expect(major.chords.map((chord) => triadForPad(major, major.chords.indexOf(chord)))).toEqual([0, 3, 4, 5]);
  });

  it("picks the triad that covers a beat, preferring a key when the fit is equal", () => {
    const c = triadForPad(major, 0);
    const dm = major.triads.findIndex((chord) => chord.numeral === "ii");
    const g = triadForPad(major, 2);
    const am = triadForPad(major, 3);
    // C E G, with C on the beat, is C. A on the beat is Am. D on the beat is Dm.
    expect(chordForBeat(major, { downbeat: 0, rest: [4, 7] }, null)).toBe(c);
    expect(chordForBeat(major, { downbeat: 9, rest: [] }, null)).toBe(am);
    expect(chordForBeat(major, { downbeat: 2, rest: [] }, null)).toBe(dm);
    // G B D leaves C, even if C was the chord before.
    expect(chordForBeat(major, { downbeat: 7, rest: [11, 2] }, c)).toBe(g);
    // One G, after C, is close enough that G wins on its own root.
    expect(chordForBeat(major, { downbeat: 7, rest: [] }, c)).toBe(g);
    // Pentatonic has no Dm, so a D lands on G.
    expect(chordForBeat(penta, { downbeat: 2, rest: [] }, null)).toBe(triadForPad(penta, 2));
    expect(chordForBeat(major, { downbeat: null, rest: [] }, null)).toBeNull();
  });

  it("voices a C major chord around middle C with the root in the bass", () => {
    const voiced = voiceChord(0, major.chords[0]!);
    expect(voiced.notes).toEqual([55, 60, 64]);
    expect(voiced.bass).toBe(36);
  });
});
