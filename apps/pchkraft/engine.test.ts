/**
 * The engine: chords and drums sound when asked, and a recording comes back
 * on the next pass of the tape.
 */
import { describe, expect, it } from "vitest";
import type { AudioRenderBlock } from "@mockintosh/sdk";
import { CassetteEngine } from "./engine";
import { SCALES, triadForPad } from "./theory";

const RATE = 48000;

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(samples.length, to);
  for (let i = from; i < end; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, end - from));
}

function render(engine: CassetteEngine, seconds: number): Float32Array {
  const total = Math.round(seconds * engine.sampleRate);
  const out = new Float32Array(total);
  let at = 0;
  while (at < total) {
    const frames = Math.min(256, total - at);
    const channels: AudioRenderBlock["channels"] = [new Float32Array(frames), new Float32Array(frames)];
    engine.render({ sampleRate: engine.sampleRate, frames, channels, position: engine.position });
    out.set(channels[0]!, at);
    at += frames;
  }
  return out;
}

describe("cassette engine", () => {
  it("plays a chord without printing it, and prints it once record is armed", () => {
    const engine = new CassetteEngine(RATE);
    engine.pressChord(0);
    expect(engine.playing).toBe(false);
    expect(engine.loop.chords[0]).toBe(-1);
    const live = render(engine, 0.1);
    expect(rms(live, 0, live.length)).toBeGreaterThan(0.02);

    engine.releaseChord(0);
    engine.recording = true;
    engine.pressChord(2);
    engine.releaseChord(2);
    expect(engine.playing).toBe(true);
    expect(engine.step).toBe(0);
    expect(engine.loop.chords[0]).toBe(triadForPad(SCALES[0]!, 2));
    expect(engine.loop.chords[1]).toBe(-1);
  });

  it("holds a chord across the steps it is kept down", () => {
    const engine = new CassetteEngine(RATE);
    engine.tempo = 240;
    engine.recording = true;
    engine.pressChord(1);
    render(engine, 0.1);
    engine.releaseChord(1);
    const fourth = triadForPad(SCALES[0]!, 1);
    expect(engine.loop.chords[0]).toBe(fourth);
    expect(engine.loop.chords[1]).toBe(fourth);
    expect(engine.loop.chords[2]).toBe(-1);
  });

  it("plays a recorded kick again on the next pass", () => {
    const engine = new CassetteEngine(RATE);
    engine.tempo = 240;
    engine.recording = true;
    engine.tapDrum("kick");
    expect(engine.loop.kick[0]).toBeGreaterThan(0);
    const audio = render(engine, 1.05);
    // The tap itself, then the same hit when the bar comes round a second later.
    expect(rms(audio, 0, 400)).toBeGreaterThan(0.02);
    expect(rms(audio, 40_000, 47_000)).toBeLessThan(rms(audio, 48_000, 48_400));
  });

  it("writes one chord for a beat of melody, and leaves the next beat empty until it ends", () => {
    const engine = new CassetteEngine(RATE);
    const scale = SCALES[0]!;
    engine.tempo = 240;
    engine.recording = true;
    engine.hear(60);
    render(engine, 0.07);
    engine.hear(64);
    render(engine, 0.07);
    engine.hear(67);
    // Four sixteenths at 240 is a quarter of a second; step a hair past the next beat.
    render(engine, 0.2);
    const tonic = triadForPad(scale, 0);
    expect(engine.loop.chords.slice(0, 4)).toEqual([tonic, tonic, tonic, tonic]);
    expect(engine.loop.chords[4]).toBe(-1);
    expect(engine.loop.lead[0]).toBe(60);
  });

  it("turns a lone D into Dm, and an audition into a chord without starting the tape", () => {
    const engine = new CassetteEngine(RATE);
    const scale = SCALES[0]!;
    engine.hear(69);
    expect(engine.playing).toBe(false);
    expect(engine.loop.chords[0]).toBe(-1);
    expect(engine.humDegree).toBe(triadForPad(scale, 3));

    engine.hear(null);
    engine.tempo = 240;
    engine.recording = true;
    engine.hear(62);
    render(engine, 0.3);
    const dm = scale.triads.findIndex((chord) => chord.numeral === "ii");
    expect(engine.loop.chords.slice(0, 4)).toEqual([dm, dm, dm, dm]);
  });

  it("lets a held key keep its chord while the hum still sings", () => {
    const engine = new CassetteEngine(RATE);
    engine.recording = true;
    engine.pressChord(1);
    engine.hear(64);
    expect(engine.loop.chords[0]).toBe(triadForPad(SCALES[0]!, 1));
    expect(engine.loop.lead[0]).toBe(64);
    render(engine, 0.3);
    expect(engine.loop.chords[0]).toBe(triadForPad(SCALES[0]!, 1));
  });

  it("tapping a drum with record off does not start the tape", () => {
    const engine = new CassetteEngine(RATE);
    engine.tapDrum("snare");
    const audio = render(engine, 0.05);
    expect(engine.playing).toBe(false);
    expect(engine.loop.snare[0]).toBe(0);
    expect(rms(audio, 0, audio.length)).toBeGreaterThan(0.01);
  });
});
