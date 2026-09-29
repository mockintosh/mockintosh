import { describe, expect, it } from "vitest";
import { defaultPatch, type Patch } from "../synth/params";
import { RHYTHMS } from "./drums";
import { ChordEngine, arpOrder } from "./engine";
import { Style } from "./settings";
import { SOUNDS, soundPatch } from "./sounds";

const RATE = 48000;

function render(engine: ChordEngine, frames: number, block = 128): [Float32Array, Float32Array] {
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

function peak(samples: Float32Array): number {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  return max;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** Notes gated at a frame, sorted. */
function heard(engine: ChordEngine, frame: number): number[] {
  const out = new Set<number>();
  engine.notes.at(frame, out);
  return [...out].sort((a, b) => a - b);
}

function organ(): Patch {
  return { ...defaultPatch(), attack: 0.001, sustain: 1, release: 0.05, reverb: 0, delayMix: 0, chorus: 0 };
}

const C_MAJOR = { bass: 48, notes: [55, 60, 64] };

describe("ChordEngine", () => {
  it("is silent until a chord is played", () => {
    const engine = new ChordEngine(RATE);
    const [left, right] = render(engine, 4800);
    expect(peak(left) + peak(right)).toBe(0);
  });

  it("plays a whole chord at once, and lets it ring out", () => {
    const engine = new ChordEngine(RATE);
    engine.patch = organ();
    engine.play(C_MAJOR, true);
    const [held] = render(engine, RATE / 4);
    expect(heard(engine, 10)).toEqual([48, 55, 60, 64]);
    expect(rms(held)).toBeGreaterThan(0.02);
    expect(peak(held)).toBeLessThanOrEqual(1);
    engine.release();
    render(engine, RATE / 2);
    const [after] = render(engine, 4800);
    expect(peak(after)).toBeLessThan(1e-3);
  });

  it("strums from the bass up, a string every 30 ms", () => {
    const engine = new ChordEngine(RATE);
    engine.patch = organ();
    engine.style = Style.Strum;
    engine.play(C_MAJOR, true);
    render(engine, RATE / 4);
    const gap = 0.03 * RATE;
    expect(heard(engine, 10)).toEqual([48]);
    expect(heard(engine, gap + 10)).toEqual([48, 55]);
    expect(heard(engine, 2 * gap + 10)).toEqual([48, 55, 60]);
    expect(heard(engine, 3 * gap + 10)).toEqual([48, 55, 60, 64]);
  });

  it("moves only the notes that change when the chord is recoloured", () => {
    const engine = new ChordEngine(RATE);
    engine.patch = organ();
    engine.play(C_MAJOR, true);
    render(engine, 1024);
    engine.play({ bass: 48, notes: [55, 59, 60, 64] }, false);
    render(engine, 1024);
    expect(heard(engine, engine.position)).toEqual([48, 55, 59, 60, 64]);
    engine.play({ bass: 48, notes: [55, 60, 63] }, false);
    render(engine, 1024);
    expect(heard(engine, engine.position)).toEqual([48, 55, 60, 63]);
  });

  it("arpeggiates the chord on sixteenths over the held bass", () => {
    const engine = new ChordEngine(RATE);
    engine.patch = organ();
    engine.tempo = 120;
    engine.style = Style.ArpUp;
    engine.play(C_MAJOR, true);
    render(engine, 6000 * 5);
    // 120 BPM: a sixteenth is 6000 frames.
    const steps = [0, 1, 2, 3, 4].map((k) => heard(engine, k * 6000 + 10));
    expect(steps).toEqual([
      [48, 55],
      [48, 60],
      [48, 64],
      [48, 67],
      [48, 72],
    ]);
    expect(arpOrder([55, 60, 64], Style.ArpBounce)).toEqual([55, 60, 64, 67, 72, 76, 72, 67, 64, 60]);
  });

  it("clocks the rhythm box on the sample and marks it stopped", () => {
    const engine = new ChordEngine(RATE);
    engine.tempo = 120;
    engine.rhythm = 0;
    engine.setRhythm(true);
    const [left] = render(engine, 6000 * 4 + 10);
    expect(engine.steps.at(0)).toBe(0);
    expect(engine.steps.at(5999)).toBe(0);
    expect(engine.steps.at(6000)).toBe(1);
    expect(engine.steps.at(18000)).toBe(3);
    expect(rms(left)).toBeGreaterThan(0.01);
    engine.setRhythm(false);
    const stoppedAt = engine.position;
    render(engine, 1024);
    expect(engine.steps.at(stoppedAt + 1)).toBe(-1);
  });

  it("starts the arpeggio on the rhythm box's grid", () => {
    const engine = new ChordEngine(RATE);
    engine.patch = organ();
    engine.tempo = 120;
    engine.style = Style.ArpUp;
    engine.setRhythm(true);
    render(engine, 3000);
    engine.play({ bass: null, notes: [60, 64, 67] }, true);
    render(engine, 6000);
    expect(heard(engine, 5990)).toEqual([]);
    expect(heard(engine, 6010)).toEqual([60]);
  });

  it.each(SOUNDS.map((s, i) => [s.name, i] as const))("renders %s over every rhythm cleanly", (_name, sound) => {
    for (let rhythm = 0; rhythm < RHYTHMS.length; rhythm++) {
      const engine = new ChordEngine(RATE);
      engine.patch = soundPatch({ sound, tone: 1, space: 0.6, volume: 1 });
      engine.rhythm = rhythm;
      engine.setRhythm(true);
      engine.play({ bass: 40, notes: [55, 59, 62, 65, 74] }, true);
      const [left, right] = render(engine, RATE / 2, 512);
      expect(left.every(Number.isFinite) && right.every(Number.isFinite)).toBe(true);
      expect(peak(left)).toBeLessThanOrEqual(1);
      expect(rms(left) + rms(right)).toBeGreaterThan(0.01);
    }
  });
});
