import { describe, expect, it } from "vitest";
import { encodeWav } from "@mockintosh/sdk";
import {
  DEFAULT_TAPE,
  decodeTape,
  defaultMix,
  encodeTape,
  sameMix,
  sanitizeTapeRef,
  suggestedName,
  tapeKey,
  tapeNameProblem,
  tapeNames,
  type TapeMix,
} from "./tapes";

const tone = (frames: number, amplitude: number) => Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 5) * amplitude);

describe("tape files", () => {
  const mix: TapeMix = { settings: [96, 2, 1.5, 0.25], levels: [0.5, 1, 0.25, 0.8], pans: [-0.5, 0, 0.75, 0] };

  it("keep each track, its overdubs past full scale, and the mix", () => {
    const loud = tone(4800, 1.6);
    const short = tone(1200, 0.3);
    const bytes = encodeTape({ mix, tracks: [loud, null, short, null], sampleRate: 48000 });
    const tape = decodeTape(bytes, 48000)!;

    expect(sameMix(tape.mix, mix)).toBe(true);
    expect(tape.tracks[1]).toBeNull();
    expect(tape.tracks[3]).toBeNull();
    const back = tape.tracks[0]!;
    expect(back.length).toBe(4800);
    expect(Math.max(...back.map(Math.abs))).toBeGreaterThan(1.59);
    for (let i = 0; i < loud.length; i++) expect(Math.abs(back[i]! - loud[i]!)).toBeLessThan(1e-4);
    // The shorter track comes back as long as the longest, silent after its end.
    expect(tape.tracks[2]!.subarray(0, 1200).every((s, i) => Math.abs(s - short[i]!) < 1e-4)).toBe(true);
    expect(tape.tracks[2]!.subarray(1200).every((s) => s === 0)).toBe(true);
  });

  it("read back at another rate, and keep a blank tape", () => {
    const bytes = encodeTape({ mix, tracks: [tone(4800, 0.5), null, null, null], sampleRate: 48000 });
    expect(decodeTape(bytes, 24000)!.tracks[0]!.length).toBe(2400);

    const blank = decodeTape(encodeTape({ mix: defaultMix(), tracks: [null, null, null, null], sampleRate: 48000 }), 48000)!;
    expect(blank.tracks).toEqual([null, null, null, null]);
    expect(sameMix(blank.mix, defaultMix())).toBe(true);
  });

  it("read any WAVE file as its channels at full level, and nothing else", () => {
    const stereo = encodeWav([tone(100, 0.5), tone(100, 0.25)], 48000);
    const tape = decodeTape(stereo, 48000)!;
    expect(tape.tracks.map((t) => t?.length ?? null)).toEqual([100, 100, null, null]);
    expect(Math.abs(tape.tracks[0]![3]! - Math.sin(3 / 5) * 0.5)).toBeLessThan(1e-4);
    expect(sameMix(tape.mix, defaultMix())).toBe(true);
    expect(decodeTape(new Uint8Array([1, 2, 3]), 48000)).toBeNull();
  });
});

describe("tape names", () => {
  it("are found among the app's files, in order", () => {
    expect(tapeKey("Jam")).toBe("Jam.tape.wav");
    expect(tapeNames(["session.json", "sample-1.wav", "b side.tape.wav", "A Side.tape.wav", ".tape.wav"])).toEqual(["A Side", "b side"]);
  });

  it("can't be empty, too long, a path, or a demo's", () => {
    expect(tapeNameProblem("Monday Tape")).toBeNull();
    expect(tapeNameProblem("")).toMatch(/needs a name/);
    expect(tapeNameProblem("x".repeat(19))).toBeNull();
    expect(tapeNameProblem("x".repeat(20))).toMatch(/19/);
    expect(tapeNameProblem("a/b")).toMatch(/can't be called/);
    expect(tapeNameProblem("sunday tape")).toMatch(/“Sunday Tape” is a demo tape/);
  });

  it("are suggested from the tape on, and remembered by reference", () => {
    expect(suggestedName(DEFAULT_TAPE)).toBe("Sunday Tape copy");
    expect(suggestedName({ kind: "demo", name: "Welcome to Macintosh" })).toBe("Welcome to Mac copy");
    expect(suggestedName({ kind: "saved", name: "Jam" })).toBe("Jam");
    expect(suggestedName({ kind: "new" })).toBe("Untitled Tape");
    expect(sanitizeTapeRef({ kind: "saved", name: "Jam" })).toEqual({ kind: "saved", name: "Jam" });
    expect(sanitizeTapeRef({ kind: "new", name: "ignored" })).toEqual({ kind: "new" });
    expect(sanitizeTapeRef({ kind: "demo", name: "" })).toBeNull();
    expect(sanitizeTapeRef("Sunday Tape")).toBeNull();
  });
});
