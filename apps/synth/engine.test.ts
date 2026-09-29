import { describe, expect, it } from "vitest";
import { SynthEngine } from "./engine";
import { defaultPatch, type Patch } from "./params";
import { DEMO_SONGS, FACTORY_PATCHES } from "./presets";
import { parsePattern } from "./sequencer";

const RATE = 48000;

function render(engine: SynthEngine, frames: number, block = 512): [Float32Array, Float32Array] {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let done = 0;
  while (done < frames) {
    const n = Math.min(block, frames - done);
    const channels = [new Float32Array(n), new Float32Array(n)];
    engine.render({ sampleRate: RATE, frames: n, channels, position: engine.position });
    left.set(channels[0]!, done);
    right.set(channels[1]!, done);
    done += n;
  }
  return [left, right];
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

function peak(samples: Float32Array): number {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  return max;
}

/** A plain sine through an open filter, no effects: for measuring pitch. */
function sinePatch(): Patch {
  return {
    ...defaultPatch(),
    osc1Wave: 3,
    osc2Level: 0,
    osc1Level: 1,
    filterType: 1,
    cutoff: 18000,
    filterEnv: 0,
    keyTrack: 0,
    resonance: 0,
    drive: 0,
    reverb: 0,
    spread: 0,
    attack: 0.001,
    sustain: 1,
  };
}

describe("SynthEngine", () => {
  it("is silent until a note is played", () => {
    const engine = new SynthEngine(RATE);
    const [left, right] = render(engine, 4800);
    expect(peak(left)).toBe(0);
    expect(peak(right)).toBe(0);
  });

  it("plays a note at its pitch", () => {
    const engine = new SynthEngine(RATE);
    engine.patch = sinePatch();
    engine.noteOn(69);
    const [left] = render(engine, RATE);
    const settled = left.subarray(RATE / 2);
    let crossings = 0;
    for (let i = 1; i < settled.length; i++) if (settled[i - 1]! < 0 && settled[i]! >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(219);
    expect(crossings).toBeLessThanOrEqual(221);
  });

  it("stays in range and fades out after release", () => {
    const engine = new SynthEngine(RATE);
    engine.patch = { ...defaultPatch(), release: 0.1, reverb: 0 };
    for (const note of [48, 55, 60, 64, 67, 72]) engine.noteOn(note, 1);
    const [held] = render(engine, RATE / 2);
    expect(rms(held)).toBeGreaterThan(0.05);
    expect(peak(held)).toBeLessThanOrEqual(1);
    expect(held.every(Number.isFinite)).toBe(true);
    for (const note of [48, 55, 60, 64, 67, 72]) engine.noteOff(note);
    render(engine, RATE / 2);
    const [after] = render(engine, 4800);
    expect(peak(after)).toBeLessThan(1e-3);
  });

  it("clocks sequencer steps on the sample, with swing on the off-beats", () => {
    const engine = new SynthEngine(RATE);
    engine.pattern = parsePattern("0 0 0 0 0 0 0 0");
    engine.performance = { ...engine.performance, tempo: 120, length: 8 };
    engine.setPlaying(true);
    render(engine, 6000 * 4 + 10, 128);
    // 120 BPM: a sixteenth is 6000 frames.
    expect(engine.steps.at(0)).toBe(0);
    expect(engine.steps.at(5999)).toBe(0);
    expect(engine.steps.at(6000)).toBe(1);
    expect(engine.steps.at(18000)).toBe(3);

    const swung = new SynthEngine(RATE);
    swung.pattern = parsePattern("0 0 0 0");
    swung.performance = { ...swung.performance, tempo: 120, length: 4, swing: 0.5 };
    swung.setPlaying(true);
    render(swung, 6000 * 3, 128);
    expect(swung.steps.at(8999)).toBe(0);
    expect(swung.steps.at(9000)).toBe(1);
    expect(swung.steps.at(12000)).toBe(2);
  });

  it("marks the transport stopped", () => {
    const engine = new SynthEngine(RATE);
    engine.pattern = parsePattern("0 3 7");
    engine.setPlaying(true);
    render(engine, 2048);
    engine.setPlaying(false);
    const stoppedAt = engine.position;
    render(engine, 2048);
    expect(engine.steps.at(stoppedAt + 1)).toBe(-1);
  });

  it("arpeggiates held keys in order", () => {
    const engine = new SynthEngine(RATE);
    engine.performance = { ...engine.performance, tempo: 120, arpMode: 1, arpOctaves: 1 };
    engine.noteOn(64);
    engine.noteOn(60);
    engine.noteOn(67);
    render(engine, 6000 * 4, 128);
    const heard = [0, 6000, 12000, 18000].map((frame) => {
      const notes = new Set<number>();
      engine.notes.at(frame + 10, notes);
      return [...notes];
    });
    expect(heard).toEqual([[60], [64], [67], [60]]);
  });

  it("plays legato in mono mode and returns to the held note", () => {
    const engine = new SynthEngine(RATE);
    engine.patch = { ...sinePatch(), voiceMode: 1 };
    engine.noteOn(60);
    render(engine, 1024);
    engine.noteOn(67);
    render(engine, 1024);
    const notes = new Set<number>();
    engine.notes.at(engine.position, notes);
    expect([...notes]).toEqual([67]);
    engine.noteOff(67);
    render(engine, 1024);
    engine.notes.at(engine.position, notes);
    expect([...notes]).toEqual([60]);
  });

  it("follows a stream that restarts its clock", () => {
    const engine = new SynthEngine(RATE);
    engine.pattern = parsePattern("0 0 0 0");
    engine.setPlaying(true);
    render(engine, 3000);
    const channels = [new Float32Array(512), new Float32Array(512)];
    engine.render({ sampleRate: RATE, frames: 512, channels, position: 0 });
    expect(engine.position).toBe(512);
    render(engine, 6000);
    expect(engine.steps.at(engine.position - 1)).toBeGreaterThanOrEqual(0);
  });

  it("records what it plays", () => {
    const engine = new SynthEngine(RATE);
    engine.startRecording();
    engine.noteOn(60);
    render(engine, 1000, 256);
    const take = engine.stopRecording();
    expect(take).not.toBeNull();
    expect(take![0]!.length).toBe(1000);
    expect(peak(take![0]!)).toBeGreaterThan(0);
  });

  it.each(FACTORY_PATCHES.map((p) => [p.name, p] as const))("renders %s cleanly", (_name, preset) => {
    const engine = new SynthEngine(RATE);
    engine.patch = preset.patch;
    engine.pattern = DEMO_SONGS[0]!.pattern;
    engine.setPlaying(true);
    for (const note of [48, 60, 63, 67]) engine.noteOn(note, 1);
    const [left, right] = render(engine, RATE);
    expect(left.every(Number.isFinite) && right.every(Number.isFinite)).toBe(true);
    expect(peak(left)).toBeLessThanOrEqual(1);
    expect(rms(left) + rms(right)).toBeGreaterThan(0.01);
  });
});
