import { describe, expect, it } from "vitest";
import { BANDS, Listener, WINDOW, frequencyBand } from "./listen";

const RATE = 48000;
const FPS = 60;

type Signal = (t: number) => number;

/** Listen to `signal` for `seconds` at 60 fps, as the monitor would hand it over. */
function listen(signal: Signal, seconds: number, listener = new Listener(RATE)): Listener {
  const left = new Float32Array(WINDOW);
  for (let f = 1; f <= seconds * FPS; f++) {
    const now = f / FPS;
    for (let i = 0; i < WINDOW; i++) left[i] = signal(now - (WINDOW - i) / RATE);
    listener.hear(left, left, 1 / FPS);
  }
  return listener;
}

const sine = (hz: number, amp = 0.5): Signal => (t) => amp * Math.sin(2 * Math.PI * hz * t);
const saw = (hz: number, amp = 0.4): Signal => (t) => amp * (2 * ((t * hz) % 1) - 1);
/** A kick every `period` seconds: a 55 Hz thump with a fast decay. */
const kicks = (period: number): Signal => (t) => {
  if (t < 0) return 0;
  const local = t % period;
  return 0.8 * Math.exp(-local * 18) * Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-local * 40)) * local);
};

describe("Listener", () => {
  it("hears silence as silence", () => {
    const s = listen(() => 0, 1);
    expect(s.silent).toBe(true);
    expect(s.level).toBe(0);
    expect(s.beats).toBe(0);
    expect(s.pitch).toBeNull();
    expect(Math.max(...s.spectrum)).toBe(0);
  });

  it("finds the pitch of a sine and puts its energy in the right band", () => {
    const s = listen(sine(440), 0.5);
    expect(s.silent).toBe(false);
    expect(s.pitch).not.toBeNull();
    expect(Math.abs(s.pitch! - 440) / 440).toBeLessThan(0.01);
    expect(Math.round(s.note!)).toBe(69);
    const loudest = s.spectrum.indexOf(Math.max(...s.spectrum));
    expect(Math.abs(loudest - frequencyBand(440))).toBeLessThanOrEqual(1);
  });

  it("does not jump an octave on a bright low tone", () => {
    const s = listen(saw(110), 0.5);
    expect(Math.round(s.note!)).toBe(45);
  });

  it("counts kicks at 120 BPM", () => {
    const s = listen(kicks(0.5), 4);
    expect(s.beats).toBeGreaterThanOrEqual(7);
    expect(s.beats).toBeLessThanOrEqual(9);
    expect(s.bass).toBeGreaterThan(s.treble);
  });

  it("gives a quiet source nearly the same level as a loud one", () => {
    const loud = listen(saw(220, 0.5), 3);
    const quiet = listen(saw(220, 0.02), 3);
    expect(quiet.silent).toBe(false);
    expect(quiet.level).toBeGreaterThan(loud.level * 0.7);
    expect(quiet.gain).toBeGreaterThan(loud.gain * 5);
  });

  it("goes quiet again after the sound stops", () => {
    const s = listen(sine(330), 1);
    listen(() => 0, 3, s);
    expect(s.silent).toBe(true);
    expect(s.level).toBeLessThan(0.01);
    expect(s.spectrum.every((v) => v < 0.05)).toBe(true);
    expect(s.spectrum.length).toBe(BANDS);
  });

  it("shrugs off a NaN from a misbehaving source", () => {
    const s = listen((t) => (Math.abs(t - 0.2) < 0.001 ? NaN : sine(440)(t)), 0.5);
    for (const value of [s.level, s.bass, s.mid, s.treble, s.gain, s.pulse, s.travel]) expect(Number.isFinite(value)).toBe(true);
    expect(s.spectrum.every(Number.isFinite)).toBe(true);
    expect(Math.round(s.note!)).toBe(69);
  });
});
