import { describe, expect, it } from "vitest";
import { diatonicChord, directionOf, romanNumeral, spellNote, voiceChord, type Modifier } from "./theory";

const C = 0;
const F = 5;
const A = 9;
const MAJOR = 0;
const MINOR = 1;

const names = (key: number, mode: number, modifier: Modifier = "triad") =>
  [0, 1, 2, 3, 4, 5, 6].map((degree) => diatonicChord(key, mode, degree, modifier).name);

describe("diatonic chords", () => {
  it("builds the seven triads of a key", () => {
    expect(names(C, MAJOR)).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
    expect(names(A, MINOR)).toEqual(["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
  });

  it("spells notes the way the key's signature does", () => {
    expect(names(F, MAJOR)).toEqual(["F", "Gm", "Am", "Bb", "C", "Dm", "Edim"]);
    expect(names(7, MAJOR)[6]).toBe("F#dim");
    expect(spellNote(10, 2, MINOR)).toBe("Bb");
  });

  it("stacks diatonic sevenths", () => {
    expect(names(C, MAJOR, "seventh")).toEqual(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"]);
  });

  it("recolours a chord from the joystick", () => {
    const on = (degree: number, modifier: Modifier) => diatonicChord(C, MAJOR, degree, modifier).name;
    expect(on(0, "add9")).toBe("Cadd9");
    expect(on(1, "add9")).toBe("Dmadd9");
    expect(on(4, "sus4")).toBe("Gsus4");
    expect(on(4, "sus2")).toBe("Gsus2");
    expect(on(3, "sixth")).toBe("F6");
    expect(on(6, "sixth")).toBe("Bdim7");
    expect(on(0, "aug")).toBe("Caug");
    expect(on(0, "dim")).toBe("Cdim");
    // Flip swaps major and minor: in A minor it gives the dominant E major.
    expect(on(0, "flip")).toBe("Cm");
    expect(on(5, "flip")).toBe("A");
    expect(diatonicChord(A, MINOR, 4, "flip").name).toBe("E");
  });

  it("numbers degrees by their quality", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => romanNumeral(C, MAJOR, d))).toEqual([
      "I", "ii", "iii", "IV", "V", "vi", "vii°",
    ]);
  });
});

describe("voicing", () => {
  it("keeps chords in one octave-wide window, so voices move by step", () => {
    const voice = (degree: number) => voiceChord(diatonicChord(C, MAJOR, degree, "triad"), 60, true);
    expect(voice(0)).toEqual({ bass: 48, notes: [55, 60, 64] });
    expect(voice(3)).toEqual({ bass: 41, notes: [57, 60, 65] });
    expect(voice(4)).toEqual({ bass: 43, notes: [55, 59, 62] });
    for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
      const { notes } = voice(degree);
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(54);
      expect(Math.max(...notes)).toBeLessThan(66);
    }
  });

  it("puts a ninth above the rest and can leave out the bass", () => {
    const cadd9 = voiceChord(diatonicChord(C, MAJOR, 0, "add9"), 60, false);
    expect(cadd9.bass).toBeNull();
    expect(cadd9.notes).toEqual([55, 60, 64, 74]);
  });
});

describe("joystick", () => {
  it("reads directions from the arrow keys", () => {
    expect(directionOf(false, false, false, false)).toBe("C");
    expect(directionOf(true, false, false, false)).toBe("N");
    expect(directionOf(false, true, true, false)).toBe("SW");
    expect(directionOf(true, true, false, true)).toBe("E");
  });
});
