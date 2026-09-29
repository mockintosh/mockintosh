import { describe, expect, it } from "vitest";
import type { AudioRenderBlock } from "@mockintosh/sdk";
import { MAX_SHUTTLE_RATE, PEAK_BLOCK, Take, Tp7Engine, makeTape, mixToMono, shuttleRate } from "./engine";

const RATE = 48000;

/** Render `frames` from the engine in 512-frame blocks, returning the left channel. */
function render(engine: Tp7Engine, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let done = 0; done < frames; done += 512) {
    const n = Math.min(512, frames - done);
    const left = new Float32Array(n);
    const block: AudioRenderBlock = { sampleRate: RATE, frames: n, channels: [left, new Float32Array(n)], position: engine.position };
    engine.render(block);
    out.set(left, done);
  }
  return out;
}

/** A tape whose sample value is its own position, scaled, so the head can be read back from the output. */
function rampTape(seconds: number, rate = RATE) {
  const frames = Math.round(seconds * rate);
  return makeTape(Float32Array.from({ length: frames }, (_, i) => i / frames), rate);
}

describe("Take", () => {
  it("collects audio across chunks, keeps peaks, and stops at capacity", () => {
    const take = new Take(1000);
    const burst = Float32Array.from({ length: 1500 }, (_, i) => (i === 1200 ? -0.9 : 0.1));
    expect(take.append(burst)).toBe(1500);
    expect(take.samples()).toEqual(burst);
    expect(take.peaks[Math.floor(1200 / PEAK_BLOCK)]).toBeCloseTo(0.9);
    expect(take.peaks[0]).toBeCloseTo(0.1);

    const rest = new Float32Array(take.capacity);
    expect(take.append(rest)).toBe(take.capacity - 1500);
    expect(take.full).toBe(true);
    expect(take.append(rest)).toBe(0);
  });
});

describe("Tp7Engine", () => {
  it("plays at normal speed once the motor is up, and stops at the end", () => {
    const engine = new Tp7Engine();
    engine.volume = 1;
    engine.load(rampTape(1));
    engine.play();
    render(engine, RATE / 2);
    // The motor spins up over a few tens of milliseconds, so the head trails real time a little.
    expect(engine.head).toBeGreaterThan(RATE * 0.4);
    expect(engine.head).toBeLessThan(RATE * 0.5);
    expect(engine.rate).toBe(1);
    render(engine, RATE);
    expect(engine.playing).toBe(false);
    expect(engine.ended).toBe(true);
    expect(engine.head).toBe(RATE - 1);
  });

  it("plays a tape recorded at another rate at its own pitch", () => {
    const engine = new Tp7Engine();
    engine.load(rampTape(1, RATE / 2));
    engine.play();
    render(engine, RATE);
    expect(engine.head).toBeGreaterThan((RATE / 2) * 0.9);
    expect(engine.head).toBeLessThan(RATE / 2);
  });

  it("stops under a held platter, follows it when turned, and lets the motor back in", () => {
    const engine = new Tp7Engine();
    engine.load(rampTape(4));
    engine.play();
    render(engine, RATE * 1.5);
    engine.grab();
    render(engine, RATE / 4);
    const held = engine.head;
    expect(engine.drive).toBe("platter");
    render(engine, RATE / 4);
    expect(Math.abs(engine.head - held)).toBeLessThan(RATE * 0.01);
    expect(Math.abs(engine.rate)).toBeLessThan(0.05);

    // Turn it back half a second: the tape runs backwards to meet it.
    engine.turnPlatter(-RATE / 2);
    render(engine, RATE / 2);
    expect(engine.head).toBeCloseTo(held - RATE / 2, -2);

    engine.release();
    expect(engine.drive).toBe("motor");
    render(engine, RATE / 2);
    expect(engine.rate).toBe(1);
  });

  it("winds with the shuttle ring, both ways, and silences a stopped tape", () => {
    expect(shuttleRate(1)).toBe(MAX_SHUTTLE_RATE);
    expect(shuttleRate(-1)).toBe(-MAX_SHUTTLE_RATE);
    expect(shuttleRate(0.2)).toBeGreaterThan(0);

    const engine = new Tp7Engine();
    engine.load(rampTape(10));
    engine.shuttle(1);
    render(engine, RATE / 2);
    expect(engine.head).toBeGreaterThan(RATE * 3);
    expect(engine.drive).toBe("ring");
    const forward = engine.head;
    engine.shuttle(-0.5);
    render(engine, RATE / 2);
    expect(engine.head).toBeLessThan(forward);

    engine.shuttle(0);
    render(engine, RATE);
    expect(engine.rate).toBe(0);
    const quiet = render(engine, 4096);
    expect(Math.max(...quiet.map(Math.abs))).toBe(0);
  });

  it("records what the microphone hears and meters it", () => {
    const engine = new Tp7Engine();
    engine.startRecording(RATE);
    const heard = Float32Array.from({ length: 512 }, (_, i) => (i === 10 ? 1 : 0.25));
    engine.capture({ sampleRate: RATE, frames: 512, channels: [heard], position: 0 });
    expect(engine.inputLevel).toBe(1);
    expect(engine.clipHold).toBeGreaterThan(0);
    expect(engine.headAt(0)).toBe(512);
    const take = engine.stopRecording()!;
    expect(take.samples()).toEqual(heard);
    expect(engine.take).toBeNull();
  });

  it("mixes stereo to mono", () => {
    expect(mixToMono([Float32Array.of(1, 0), Float32Array.of(0, 1)])).toEqual(Float32Array.of(0.5, 0.5));
  });
});
