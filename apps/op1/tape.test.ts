import { describe, expect, it } from "vitest";
import { TapeMachine, TapeParam } from "./tape";

const RATE = 8000;

/** Run the tape for `frames` with a constant input, returning the left output. */
function run(tape: TapeMachine, frames: number, input = 0, position = 0): Float32Array {
  const inL = new Float32Array(frames).fill(input);
  const inR = inL.slice();
  const outL = new Float32Array(frames);
  const outR = new Float32Array(frames);
  tape.process(inL, inR, outL, outR, frames, position);
  return outL;
}

function withSettings(tape: TapeMachine, changes: Partial<Record<keyof typeof TapeParam, number>>): void {
  const next = [...tape.settings] as [number, number, number, number];
  for (const [key, value] of Object.entries(changes)) next[TapeParam[key as keyof typeof TapeParam]] = value;
  tape.settings = next;
}

describe("TapeMachine", () => {
  it("records onto the selected track only while playing", () => {
    const tape = new TapeMachine(RATE);
    tape.setRecording(true);
    run(tape, 100, 0.5);
    expect(tape.hasAudio(0)).toBe(false);

    tape.play();
    run(tape, 100, 0.5);
    expect(tape.extent[0]).toBe(100);
    expect(tape.head).toBe(100);

    tape.stop();
    tape.rewind();
    tape.play();
    const out = run(tape, 100);
    expect(out[0]).toBeCloseTo(0.5 * 0.8);
    expect(out[99]).toBeCloseTo(0.5 * 0.8);
  });

  it("overdubs pass after pass around the loop", () => {
    const tape = new TapeMachine(RATE);
    withSettings(tape, { Tempo: 120, Loop: 1 });
    const loop = tape.loopLength();
    expect(loop).toBe(RATE * 2);
    tape.setRecording(true);
    tape.play();
    run(tape, loop, 0.25);
    run(tape, loop, 0.25);
    expect(tape.head).toBe(0);
    tape.setRecording(false);
    const out = run(tape, 10);
    expect(out[5]).toBeCloseTo(0.5 * 0.8);
  });

  it("runs out at the end of the tape without a loop", () => {
    const tape = new TapeMachine(RATE);
    withSettings(tape, { Loop: 0 });
    tape.head = tape.capacity - 10;
    tape.play();
    run(tape, 20);
    expect(tape.playing).toBe(false);
    expect(tape.head).toBe(tape.capacity - 1);
  });

  it("plays at double speed and backwards", () => {
    const tape = new TapeMachine(RATE);
    tape.setRecording(true);
    tape.play();
    const ramp = new Float32Array(400).map((_, i) => i / 400);
    tape.process(ramp, ramp, new Float32Array(400), new Float32Array(400), 400, 0);
    tape.stop();

    tape.rewind();
    withSettings(tape, { Speed: 2 });
    tape.play();
    run(tape, 100);
    expect(tape.head).toBe(200);

    tape.reverse = true;
    withSettings(tape, { Speed: 1 });
    const out = run(tape, 50);
    expect(out[0]! > out[49]!).toBe(true);
    expect(tape.head).toBe(150);
  });

  it("fills the gaps when recording fast, so a sped-up take plays back whole", () => {
    const tape = new TapeMachine(RATE);
    withSettings(tape, { Speed: 2 });
    tape.setRecording(true);
    tape.play();
    run(tape, 100, 0.5);
    tape.stop();
    tape.rewind();
    withSettings(tape, { Speed: 1 });
    tape.play();
    const out = run(tape, 199);
    expect(Math.min(...out)).toBeGreaterThan(0.3);
  });

  it("mutes, levels and mixes down", () => {
    const tape = new TapeMachine(RATE);
    withSettings(tape, { Loop: 0 });
    tape.setRecording(true);
    tape.play();
    run(tape, 50, 0.5);
    tape.stop();
    tape.rewind();
    tape.track = 1;
    tape.setRecording(true);
    tape.play();
    run(tape, 50, 0.25);
    tape.stop();

    tape.mutes = [true, false, false, false];
    const [left, right] = tape.mixdown();
    expect(left).toHaveLength(50);
    expect(left[10]).toBeCloseTo(Math.tanh(0.25 * 0.8), 2);
    expect(right[10]).toBeCloseTo(left[10]!, 6);

    // Panned hard left, a track leaves the right side; the middle is where it always was.
    tape.pans = [0, -1, 0, 0];
    const [hardLeft, silent] = tape.mixdown();
    expect(silent[10]).toBeCloseTo(0, 6);
    expect(hardLeft[10]).toBeCloseTo(Math.tanh(0.25 * 0.8 * Math.SQRT2), 2);
    tape.pans = [0, 0, 0, 0];

    tape.clearTrack(1);
    expect(tape.hasAudio(1)).toBe(false);
    expect(tape.peaks[1]!.every((p) => p === 0)).toBe(true);
  });

  it("clicks on the beat when the metronome is up", () => {
    const tape = new TapeMachine(RATE);
    withSettings(tape, { Click: 1, Tempo: 120 });
    tape.play();
    const out = run(tape, RATE);
    const beat = RATE / 2;
    const energy = (from: number) => out.subarray(from, from + 40).reduce((sum, s) => sum + Math.abs(s), 0);
    expect(energy(0)).toBeGreaterThan(1);
    expect(energy(beat)).toBeGreaterThan(1);
    expect(energy(beat / 2)).toBe(0);
  });
});
