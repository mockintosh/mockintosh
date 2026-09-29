import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "@mockintosh/sdk";
import { TAU, noteHz } from "../synth/dsp";
import { Op1Engine } from "./engine";
import {
  MonitorTap,
  SAMPLE_ROOT,
  SAMPLE_SECONDS,
  SampleRecorder,
  factorySample,
  sampleFromWav,
  samplePeaks,
  sampleToWav,
  type MonitorSource,
  type Sample,
} from "./sampler";
import { factorySound, type SynthSound } from "./sounds";
import { SAMPLER_ENGINE, SYNTHS, samplerSpan } from "./synths";

const SR = 48000;

function sine(hz: number, seconds: number, sampleRate = SR, level = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((TAU * hz * i) / sampleRate) * level;
  return out;
}

/** Fundamental by autocorrelation between 60 Hz and 2 kHz. */
function pitchOf(x: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 2000);
  const maxLag = Math.floor(sampleRate / 60);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i]! * x[i + lag]!;
    scores[lag] = s;
  }
  const best = Math.max(...scores.filter((s) => s !== undefined));
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const s = scores[lag]!;
    if (s >= 0.95 * best && s >= scores[lag - 1]! && s >= scores[lag + 1]!) {
      const a = scores[lag - 1]!;
      const c = scores[lag + 1]!;
      return sampleRate / (lag + (0.5 * (a - c)) / (a - 2 * s + c));
    }
  }
  return 0;
}

const cents = (hz: number, target: number) => 1200 * Math.log2(hz / target);

function samplerSound(engine: readonly number[] = [0, 1, 0, 0.5]): SynthSound {
  const base = factorySound(0);
  return {
    ...base,
    synth: SAMPLER_ENGINE,
    engines: base.engines.map((q, i) => (i === SAMPLER_ENGINE ? ([...engine] as unknown as typeof q) : q)),
    env: [0.001, 0.5, 1, 0.05],
    fx: 0,
    fxParams: base.fxParams.map((q, i) => (i === 0 ? ([q[0], 0, 0, 0] as typeof q) : q)),
    lfo: [1, 0, 0, 0],
  };
}

function play(engine: Op1Engine, note: number, frames: number): Float32Array {
  engine.noteOn(note, 1);
  const left = new Float32Array(frames);
  engine.render({ sampleRate: SR, frames, channels: [left, new Float32Array(frames)], position: engine.position });
  return left;
}

describe("the SAMPLER engine", () => {
  it("is the last engine and plays a sample at its pitch on middle C, an octave up an octave higher", () => {
    expect(SYNTHS[SAMPLER_ENGINE]!.name).toBe("SAMPLER");
    const tone: Sample = { data: sine(noteHz(SAMPLE_ROOT), 1, 44100), sampleRate: 44100 };
    for (const note of [SAMPLE_ROOT, SAMPLE_ROOT + 12, SAMPLE_ROOT - 7]) {
      const engine = new Op1Engine(SR);
      engine.sound = samplerSound();
      engine.sample = tone;
      const out = play(engine, note, 12000);
      expect(Math.abs(cents(pitchOf(out.subarray(2000, 10000), SR), noteHz(note)))).toBeLessThan(5);
    }
  });

  it("plays once and stops, or loops the stretch between START and END", () => {
    const short: Sample = { data: sine(440, 0.1), sampleRate: SR };
    const once = new Op1Engine(SR);
    once.sound = samplerSound([0, 1, 0, 0.5]);
    once.sample = short;
    const a = play(once, SAMPLE_ROOT, 24000);
    expect(a.subarray(0, 4000).some((s) => Math.abs(s) > 0.01)).toBe(true);
    expect(a.subarray(8000).every((s) => Math.abs(s) < 1e-3)).toBe(true);
    expect(once.samplerHead).toBe(-1);

    const looped = new Op1Engine(SR);
    looped.sound = samplerSound([0.2, 0.8, 1, 0.5]);
    looped.sample = short;
    const b = play(looped, SAMPLE_ROOT, 24000);
    expect(b.subarray(20000).some((s) => Math.abs(s) > 0.01)).toBe(true);
    expect(looped.samplerHead).toBeGreaterThanOrEqual(0.2);
    expect(looped.samplerHead).toBeLessThanOrEqual(0.8);
  });

  it("is silent without a sample, and never plays a stretch shorter than a few frames", () => {
    const engine = new Op1Engine(SR);
    engine.sound = samplerSound();
    engine.sample = null;
    const out = play(engine, SAMPLE_ROOT, 2000);
    expect(out.every((s) => s === 0)).toBe(true);
    const span = samplerSpan(1000, 0.5, 0.5);
    expect(span.to - span.from).toBe(64);
    expect(samplerSpan(1000, 0.9, 0.1)).toEqual({ from: 100, to: 899 });
  });

  it("has a factory sample that sings at middle C", () => {
    const aah = factorySample(SR);
    expect(aah.data.length).toBeGreaterThan(SR);
    const peak = Math.max(...aah.data.map(Math.abs));
    expect(peak).toBeCloseTo(0.8, 2);
    expect(Math.abs(cents(pitchOf(aah.data.subarray(4800, 14400), SR), noteHz(SAMPLE_ROOT)))).toBeLessThan(15);
  });
});

describe("SampleRecorder", () => {
  it("waits for sound, keeps it, and stops when full", () => {
    const rec = new SampleRecorder();
    rec.arm(1000);
    const quiet = new Float32Array(100);
    rec.write(quiet, quiet, 0, 100);
    expect(rec.state).toBe("armed");
    const loud = new Float32Array(10000).fill(0.5);
    rec.write(loud, loud, 0, 3000);
    expect(rec.state).toBe("recording");
    expect(rec.length).toBe(3000);
    rec.write(loud, loud, 0, 10000);
    expect(rec.state).toBe("full");
    expect(rec.length).toBe(SAMPLE_SECONDS * 1000);
    const take = rec.finish()!;
    expect(take.data.length).toBe(SAMPLE_SECONDS * 1000);
    expect(take.data[0]).toBeCloseTo(0.9, 5);
    expect(take.data.at(-1)).toBe(0);
    expect(rec.state).toBe("idle");
  });

  it("gives nothing for a take that never started", () => {
    const rec = new SampleRecorder();
    rec.arm(1000);
    expect(rec.finish()).toBeNull();
  });

  it("records the OP-1's own output", () => {
    const engine = new Op1Engine(SR);
    const rec = new SampleRecorder();
    rec.arm(SR);
    engine.sampling = rec;
    engine.hitPad(0);
    const frames = 4800;
    engine.render({ sampleRate: SR, frames, channels: [new Float32Array(frames), new Float32Array(frames)], position: 0 });
    expect(rec.state).toBe("recording");
    expect(rec.length).toBeGreaterThan(4000);
  });
});

describe("samples as files", () => {
  it("survive a round trip through WAV", () => {
    const tone: Sample = { data: sine(300, 0.05, 22050), sampleRate: 22050 };
    const back = sampleFromWav(sampleToWav(tone))!;
    expect(back.sampleRate).toBe(22050);
    expect(back.data.length).toBe(tone.data.length);
    for (let i = 0; i < tone.data.length; i += 37) expect(back.data[i]).toBeCloseTo(tone.data[i]!, 3);
  });

  it("mix stereo to mono and cut long files", () => {
    const left = new Float32Array(SAMPLE_SECONDS * 1000 + 500).fill(0.5);
    const right = new Float32Array(left.length).fill(-0.25);
    const sample = sampleFromWav(encodeWav([left, right], 1000))!;
    expect(sample.data.length).toBe(SAMPLE_SECONDS * 1000);
    expect(sample.data[10]).toBeCloseTo(0.125, 3);
    expect(sampleFromWav(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("decodes 24-bit and float WAVE files", () => {
    const wav = (format: number, bits: number, samples: number[]) => {
      const width = bits / 8;
      const bytes = new Uint8Array(44 + samples.length * width);
      const view = new DataView(bytes.buffer);
      const ascii = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
      ascii(0, "RIFF");
      view.setUint32(4, 36 + samples.length * width, true);
      ascii(8, "WAVE");
      ascii(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, format, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true);
      view.setUint16(34, bits, true);
      ascii(36, "data");
      view.setUint32(40, samples.length * width, true);
      samples.forEach((s, i) => {
        const at = 44 + i * width;
        if (format === 3) view.setFloat32(at, s, true);
        else {
          const v = Math.round(s * 0x7fffff);
          bytes[at] = v & 0xff;
          bytes[at + 1] = (v >> 8) & 0xff;
          bytes[at + 2] = (v >> 16) & 0xff;
        }
      });
      return bytes;
    };
    expect([...decodeWav(wav(1, 24, [0.5, -0.5]))!.channels[0]!].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.5, -0.5]);
    expect([...decodeWav(wav(3, 32, [0.25, -1]))!.channels[0]!]).toEqual([0.25, -1]);
  });

  it("draw as one peak per column", () => {
    const data = new Float32Array(100);
    data[10] = -0.7;
    data[90] = 0.3;
    expect([...samplePeaks({ data, sampleRate: 100 }, 2)].map((v) => Math.round(v * 10) / 10)).toEqual([0.7, 0.3]);
  });
});

describe("MonitorTap", () => {
  /** A monitor over a known signal, showing the `capacity` frames before `now`. */
  function fakeMonitor(signal: Float32Array, capacity = 4096): MonitorSource & { now: number } {
    return {
      sampleRate: SR,
      capacity,
      now: 0,
      read(left, right) {
        for (let i = 0; i < capacity; i++) {
          const at = this.now - capacity + i;
          const v = at >= 0 && at < signal.length ? signal[at]! : 0;
          left[i] = v;
          right[i] = v;
        }
      },
    };
  }

  function stitch(signal: Float32Array, steps: readonly number[], clockError: (k: number) => number): Float32Array {
    const monitor = fakeMonitor(signal);
    const tap = new MonitorTap(monitor);
    const out: number[] = [];
    let ms = 0;
    for (const [k, frames] of steps.entries()) {
      monitor.now += frames;
      ms += (frames / SR) * 1000 + clockError(k);
      const fresh = tap.pull(ms);
      for (let i = monitor.capacity - fresh; i < monitor.capacity; i++) out.push(tap.left[i]!);
    }
    return Float32Array.from(out);
  }

  it("turns overlapping looks into one unbroken recording despite a jittery clock", () => {
    const signal = new Float32Array(SR);
    let phase = 0;
    for (let i = 0; i < signal.length; i++) {
      phase += (220 + 200 * Math.sin(i / 3000)) / SR;
      signal[i] = Math.sin(TAU * phase) * 0.5 + Math.sin(i * 0.37) * 0.1;
    }
    const steps = Array.from({ length: 50 }, (_, k) => 600 + ((k * 137) % 500));
    const got = stitch(signal, steps, (k) => ((k * 7919) % 11) - 5);
    const first = steps[0]!;
    const expected = signal.subarray(first, first + got.length);
    expect(got.length).toBe(steps.slice(1).reduce((a, b) => a + b, 0));
    let worst = 0;
    for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i]! - expected[i]!));
    expect(worst).toBeLessThan(1e-6);
  });

  it("trusts the clock in silence", () => {
    const got = stitch(new Float32Array(SR), [800, 800, 800], () => 0);
    expect(got.length).toBe(1600);
  });
});
