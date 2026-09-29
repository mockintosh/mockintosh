/**
 * The demo songs: written within what the sequencer can hold, and bounced
 * through the engine into a loop per track that joins without a seam.
 */
import { describe, expect, it } from "vitest";
import { defaultKit } from "./sounds";
import { PAD_COUNT, PADS } from "./drums";
import { MAX_STEPS } from "./sequencer";
import { beat, bounceSong, drumKit, noteNumber, phrase, SongBounce, songLevels, songPans, songTapeSettings } from "./song";
import { DEMO_SONGS } from "./songs";
import { TAPE_SECONDS, TAPE_TRACKS, TapeMachine } from "./tape";

const SR = 48000;

function rms(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

function peak(data: Float32Array): number {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  return max;
}

const pad = (name: string) => PADS.findIndex((p) => p.name === name);

describe("song notation", () => {
  it("reads note names", () => {
    expect(noteNumber("C4")).toBe(60);
    expect(noteNumber("F#2")).toBe(42);
    expect(noteNumber("Bb3")).toBe(58);
    expect(noteNumber("A1")).toBe(33);
    expect(() => noteNumber("H2")).toThrow();
  });

  it("writes chords, holds and accents into a phrase, a bar every sixteen steps", () => {
    const pattern = phrase([{ 0: "E4 C4 G4 ~6 !", 8: "D4" }, { 15: "A3 ~2" }], { swing: 0.3, gate: 0.7 });
    expect(pattern.length).toBe(32);
    expect(pattern.steps[0]).toEqual([60, 64, 67]);
    expect(pattern.holds[0]).toBe(6);
    expect(pattern.accents[0]).toBe(true);
    expect(pattern.steps[8]).toEqual([62]);
    expect(pattern.holds[8]).toBe(1);
    expect(pattern.accents[8]).toBe(false);
    expect(pattern.steps[31]).toEqual([57]);
    expect(pattern.holds[31]).toBe(2);
    expect(pattern.steps[1]).toEqual([]);
    expect(pattern.swing).toBe(0.3);
    expect(pattern.gate).toBe(0.7);
  });

  it("refuses what the sequencer can't hold", () => {
    expect(() => phrase([{ 0: "C4 ~0" }])).toThrow();
    expect(() => phrase([{ 0: "C4 ~17" }])).toThrow();
    expect(() => phrase([{ 0: "C4 ~x" }])).toThrow();
    expect(() => phrase([{ 0: "Q4" }])).toThrow();
    expect(() => phrase([{}, {}, {}, {}, {}])).toThrow();
  });

  it("reads drum grids, an accent accenting the whole step", () => {
    const pattern = beat({ KICK: "X...x...|x", SNARE: "x...x" });
    expect(pattern.length).toBe(9);
    expect(pattern.steps[0]).toEqual([pad("KICK"), pad("SNARE")].sort((a, b) => a - b));
    expect(pattern.accents[0]).toBe(true);
    expect(pattern.accents[4]).toBe(false);
    expect(pattern.steps[8]).toEqual([pad("KICK")]);
    expect(pattern.steps[1]).toEqual([]);
    expect(() => beat({ TAMBOURINE: "x" })).toThrow();
    expect(() => beat({ KICK: "x".repeat(MAX_STEPS + 1) })).toThrow();
  });

  it("edits a kit from the default, only where written", () => {
    const base = defaultKit();
    const kit = drumKit({ pads: { KICK: { level: 0.5 } }, kit: { drive: 0.9 } });
    const kick = pad("KICK");
    expect(kit.pads[kick]![3]).toBe(0.5);
    expect(kit.pads[kick]!.slice(0, 3)).toEqual(base.pads[kick]!.slice(0, 3));
    expect(kit.pads[kick === 0 ? 1 : 0]).toEqual(base.pads[kick === 0 ? 1 : 0]);
    expect(kit.kit[1]).toBe(0.9);
    expect(kit.fx).toBe(base.fx);
    expect(() => drumKit({ pads: { TAMBOURINE: {} } })).toThrow();
  });
});

describe.each(DEMO_SONGS.map((song) => [song.name, song] as const))("%s", (_name, song) => {
  it("fits the tape and the sequencer", () => {
    expect(song.parts).toHaveLength(TAPE_TRACKS);
    const tape = new TapeMachine(SR);
    tape.settings = songTapeSettings(song);
    expect(tape.loopLength() / SR).toBeLessThan(TAPE_SECONDS);
    for (const part of song.parts) {
      const limit = part.instrument === "drum" ? PAD_COUNT : 128;
      expect(part.patterns.length, part.name).toBeGreaterThan(0);
      for (const pattern of part.patterns) {
        expect(song.bars * 16 % pattern.length, part.name).toBe(0);
        expect(pattern.length).toBeLessThanOrEqual(MAX_STEPS);
        expect(pattern.steps).toHaveLength(MAX_STEPS);
        for (const step of pattern.steps) for (const value of step) expect(value).toBeLessThan(limit);
      }
    }
    for (const level of songLevels(song)) expect(level).toBeGreaterThan(0);
    for (const pan of songPans(song)) expect(Math.abs(pan)).toBeLessThanOrEqual(1);
  });

  it("bounces every part to a loop of its own track, audible and unclipped", () => {
    const tracks = bounceSong(song, SR);
    const tape = new TapeMachine(SR);
    tape.settings = songTapeSettings(song);
    expect(tracks).toHaveLength(TAPE_TRACKS);
    for (const [t, data] of tracks.entries()) {
      const name = song.parts[t]!.name;
      expect(data.length, name).toBe(tape.loopLength());
      expect(rms(data, 0, data.length), name).toBeGreaterThan(0.01);
      expect(peak(data), name).toBeLessThan(1.5);
    }
  });
});

describe("bouncing", () => {
  const song = DEMO_SONGS[0]!;
  const tracks = bounceSong(song, SR);
  const tape = new TapeMachine(SR);
  tape.settings = songTapeSettings(song);
  const loop = tape.loopLength();
  const step = tape.beatFrames() / 4;

  it("plays the beat where it is written, the off-beats swung", () => {
    const drums = tracks[0]!;
    const window = Math.round(step / 3);
    const at = (s: number) => rms(drums, Math.round(s * step), Math.round(s * step) + window);
    const before = (s: number) => rms(drums, Math.round(s * step) - window, Math.round(s * step));
    // The snare on beat two, and the kick pushed in ahead of beat three.
    expect(at(4)).toBeGreaterThan(before(4) * 1.5);
    expect(at(7 + song.parts[0]!.patterns[0]!.swing * 0.5)).toBeGreaterThan(0.05);
  });

  it("lets the last bar ring over the first, so the loop has no seam", () => {
    const lead = tracks[3]!;
    // The lead's first note is on step 3; before it, only the last note's tail sounds.
    expect(rms(lead, 0, Math.round(2 * step))).toBeGreaterThan(0.002);
  });

  it("comes out the same however the work is split", () => {
    const split: Float32Array[] = [];
    const bounce = new SongBounce(song, SR, (track, data) => {
      split[track] = data;
    });
    let runs = 0;
    while (!bounce.done) {
      expect(bounce.progress).toBeLessThan(1);
      bounce.run(3000);
      runs++;
    }
    expect(bounce.progress).toBe(1);
    expect(runs).toBeGreaterThan(100);
    for (let t = 0; t < TAPE_TRACKS; t++) expect(split[t]).toEqual(tracks[t]);
  });

  it("loads onto a tape track as if recorded there", () => {
    const machine = new TapeMachine(SR);
    machine.settings = songTapeSettings(song);
    machine.load(1, tracks[1]!);
    expect(machine.hasAudio(1)).toBe(true);
    expect(machine.hasAudio(0)).toBe(false);
    expect(machine.extent[1]).toBeGreaterThan(loop * 0.9);
    expect(peak(machine.peaks[1]!)).toBeCloseTo(peak(tracks[1]!), 5);
    machine.play();
    const out = [new Float32Array(4800), new Float32Array(4800)] as const;
    const silent = new Float32Array(4800);
    machine.process(silent, silent, out[0], out[1], 4800, 0);
    expect(rms(out[0], 0, 4800)).toBeGreaterThan(0.01);
  });
});
