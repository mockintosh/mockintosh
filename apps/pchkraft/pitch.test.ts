/**
 * YIN on a sung tone: a sine is a hum with the breath taken out.
 */
import { describe, expect, it } from "vitest";
import { PitchTracker, detectPitch } from "./pitch";

const RATE = 48000;

function sine(hz: number, frames: number, amplitude = 0.4): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * amplitude;
  return out;
}

describe("pitch detection", () => {
  it("hears A4 and A3, and not an octave error", () => {
    const a4 = detectPitch(sine(440, 4096), RATE);
    const a3 = detectPitch(sine(220, 4096), RATE);
    expect(a4).not.toBeNull();
    expect(a3).not.toBeNull();
    expect(a4!.note).toBeCloseTo(69, 0);
    expect(a3!.note).toBeCloseTo(57, 0);
    expect(a4!.clarity).toBeGreaterThan(0.8);
    expect(Math.abs(a3!.note - 69)).toBeGreaterThan(6);
  });

  it("says nothing about silence", () => {
    expect(detectPitch(new Float32Array(4096), RATE)).toBeNull();
  });

  it("reports a pitch once a window has arrived, and silence when it stops", () => {
    const tracker = new PitchTracker(RATE);
    expect(tracker.push(sine(440, 1000))).toBeNull();
    const heard = tracker.push(sine(440, 1200));
    expect(heard?.kind).toBe("pitch");
    if (heard?.kind === "pitch") expect(heard.note).toBeCloseTo(69, 0);
    const quiet = tracker.push(new Float32Array(4096));
    expect(quiet?.kind).toBe("silence");
  });
});
