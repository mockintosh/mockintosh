import { describe, expect, it } from "vitest";
import { noteHz } from "../synth/dsp";
import { PADS, PAD_COUNT } from "./drums";
import { Op1Engine } from "./engine";
import { FX, FxKind, FxRack } from "./fx";
import { defaultQuad, nudge, sanitizeQuad } from "./params";
import { FACTORY_SOUNDS, LfoTarget, sanitizeKit, sanitizeSound, type SynthSound } from "./sounds";
import { SYNTHS } from "./synths";

const RATE = 48000;

function render(engine: Op1Engine, frames: number, block = 480): [Float32Array, Float32Array] {
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

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

function finite(samples: Float32Array): boolean {
  return samples.every((s) => Number.isFinite(s) && Math.abs(s) <= 1);
}

/** The period between 50 Hz and 1 kHz, by autocorrelation: the shortest lag nearly as strong as the best. */
function autocorrelationHz(samples: Float32Array, from: number, length = 4096): number {
  const lags: number[] = [];
  const sums: number[] = [];
  for (let lag = Math.floor(RATE / 1000); lag <= RATE / 50; lag++) {
    let sum = 0;
    for (let i = from; i < from + length; i++) sum += samples[i]! * samples[i + lag]!;
    lags.push(lag);
    sums.push(sum);
  }
  const best = Math.max(...sums);
  for (let k = 1; k < sums.length - 1; k++) {
    if (sums[k]! >= best * 0.95 && sums[k]! >= sums[k - 1]! && sums[k]! >= sums[k + 1]!) return RATE / lags[k]!;
  }
  return 0;
}

/** Positive-going zero crossings per second: the pitch of a clean tone. */
function crossingsHz(samples: Float32Array, from: number): number {
  let count = 0;
  let first = -1;
  let last = -1;
  for (let i = from + 1; i < samples.length; i++) {
    if (samples[i - 1]! < 0 && samples[i]! >= 0) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  }
  return ((count - 1) * RATE) / (last - first);
}

/** A sound with no effect and a plain envelope, on engine `synth`. */
function dry(synth: number, engine?: readonly [number, number, number, number]): SynthSound {
  const base = FACTORY_SOUNDS[0]!;
  const nitro = [...base.fxParams];
  nitro[FxKind.Nitro] = [16000, 0, 0, 0];
  const engines = [...base.engines];
  if (engine) engines[synth] = engine;
  return { ...base, synth, engines, env: [0.001, 0.5, 1, 0.05], fx: FxKind.Nitro, fxParams: nitro, lfo: [1, 0, 0, 0] };
}

describe("Op1Engine", () => {
  it("is silent until something is played", () => {
    const engine = new Op1Engine(RATE);
    const [left, right] = render(engine, 4800);
    expect(rms(left)).toBe(0);
    expect(rms(right)).toBe(0);
  });

  it.each(SYNTHS.map((s, i) => [s.name, i] as const))("plays the %s engine, bounded, and lets it ring out", (_name, synth) => {
    const engine = new Op1Engine(RATE);
    engine.sound = dry(synth);
    engine.noteOn(57);
    const [held] = render(engine, RATE / 2);
    engine.noteOff(57);
    const [after] = render(engine, RATE);
    expect(finite(held) && finite(after)).toBe(true);
    expect(rms(held, 2400)).toBeGreaterThan(0.01);
    expect(rms(after, RATE / 2)).toBeLessThan(1e-3);
  });

  it("keeps the pulse and string engines in tune", () => {
    for (const synth of [2, 3]) {
      const engine = new Op1Engine(RATE);
      const values = synth === 3 ? ([1, 0, 0, 1] as const) : ([0.9, 1, 0.1, 0] as const);
      engine.sound = dry(synth, values);
      engine.noteOn(57);
      const [left] = render(engine, RATE / 2);
      const measured = autocorrelationHz(left, 4800);
      expect(Math.abs(1200 * Math.log2(measured / noteHz(57))), SYNTHS[synth]!.name).toBeLessThan(10);
    }
  });

  it("plays every factory sound without blowing up", () => {
    for (const sound of FACTORY_SOUNDS) {
      const engine = new Op1Engine(RATE);
      engine.sound = sound;
      engine.noteOn(60);
      engine.noteOn(64);
      engine.noteOn(67);
      const [left, right] = render(engine, RATE / 2);
      expect(finite(left) && finite(right), sound.name).toBe(true);
      expect(rms(left), sound.name).toBeGreaterThan(0.005);
    }
  });

  it("vibrato moves the pitch", () => {
    const engine = new Op1Engine(RATE);
    // A 1 Hz square: up three semitones for half a second, then down three.
    engine.sound = { ...dry(3, [1, 0, 0, 1]), lfo: [1, 0.5, 2, LfoTarget.Pitch] };
    engine.noteOn(57);
    const [left] = render(engine, RATE);
    const up = crossingsHz(left.subarray(2400, 2400 + 12000), 0);
    const down = crossingsHz(left.subarray(26400, 26400 + 12000), 0);
    expect(up).toBeCloseTo(noteHz(60), -0.5);
    expect(down).toBeCloseTo(noteHz(54), -0.5);
  });

  it("strikes every pad, and a closed hat chokes the open one", () => {
    for (let pad = 0; pad < PAD_COUNT; pad++) {
      const engine = new Op1Engine(RATE);
      engine.hitPad(pad);
      const [left, right] = render(engine, 4800);
      expect(finite(left) && finite(right), PADS[pad]!.name).toBe(true);
      expect(rms(left) + rms(right), PADS[pad]!.name).toBeGreaterThan(0.001);
    }
    const open = PADS.findIndex((p) => p.name === "O.HAT");
    const closed = PADS.findIndex((p) => p.name === "C.HAT");
    const ringing = new Op1Engine(RATE);
    ringing.kit = { ...ringing.kit, fx: FxKind.Nitro, fxParams: FX.map((f) => defaultQuad(f.defs)).map((q, i) => (i === FxKind.Nitro ? [16000, 0, 0, 0] : q)) };
    const choked = new Op1Engine(RATE);
    choked.kit = ringing.kit;
    ringing.hitPad(open);
    choked.hitPad(open);
    render(ringing, 480);
    render(choked, 480);
    choked.hitPad(closed);
    const [a] = render(ringing, 9600);
    const [b] = render(choked, 9600);
    expect(rms(b, 4800)).toBeLessThan(rms(a, 4800) * 0.2);
  });

  it("records what is played onto the tape and plays it back", () => {
    const engine = new Op1Engine(RATE);
    const tape = engine.tape;
    tape.track = 2;
    tape.setRecording(true);
    tape.play();
    engine.hitPad(0);
    render(engine, RATE / 2);
    tape.stop();
    expect(tape.hasAudio(2)).toBe(true);
    expect(tape.hasAudio(0)).toBe(false);

    tape.rewind();
    tape.play();
    const [left] = render(engine, RATE / 2);
    expect(rms(left, 0, 4800)).toBeGreaterThan(0.01);
  });

  it("lets every effect pass signal", () => {
    for (let kind = 0; kind < FX.length; kind++) {
      const rack = new FxRack(RATE);
      const left = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i * 0.05) * 0.3);
      const right = left.slice();
      rack.process(kind, defaultQuad(FX[kind]!.defs), left, right, left.length, 6000);
      expect(finite(left) && finite(right), FX[kind]!.name).toBe(true);
      expect(rms(left), FX[kind]!.name).toBeGreaterThan(0.01);
    }
  });
});

describe("OP-1 parameters", () => {
  it("nudges continuous values by a hundredth and stepped ones by a step", () => {
    const [attack] = [SYNTHS[0]!.defs[0]];
    expect(nudge(attack, 0.5, 1)).toBeCloseTo(0.51);
    expect(nudge(attack, 1, 5)).toBe(1);
    const time = FX[FxKind.Delay]!.defs[0];
    expect(nudge(time, 3, 1)).toBe(4);
    expect(nudge(time, 5, 1)).toBe(5);
  });

  it("sanitizes saved sounds and kits field by field", () => {
    const base = FACTORY_SOUNDS[1]!;
    const saved = sanitizeSound({ name: "mine", synth: 99, env: [0, "x", 2, 1], lfo: null }, base);
    expect(saved.name).toBe("MINE");
    expect(saved.synth).toBe(base.synth);
    expect(saved.env[0]).toBeGreaterThan(0);
    expect(saved.env[2]).toBe(1);
    expect(saved.engines).toHaveLength(SYNTHS.length);
    expect(sanitizeQuad(SYNTHS[0]!.defs, "nope")).toEqual(defaultQuad(SYNTHS[0]!.defs));
    expect(sanitizeKit({ pads: [[40, 1, 0, 1]] }).pads[0]![0]).toBe(12);
  });
});
