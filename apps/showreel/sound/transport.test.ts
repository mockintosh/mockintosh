import { describe, expect, it } from "vitest";
import type { AudioRenderBlock } from "@mockintosh/sdk";
import type { ReelSoundtrack } from "../reels";
import { Transport } from "./transport";

const SR = 1000;

/** A soundtrack whose sample is the reel time it was asked for, so tests can read the timeline back. */
class Timeline implements ReelSoundtrack {
  readonly calls: { offset: number; frames: number; t0: number }[] = [];
  constructor(private readonly value?: number) {}
  render(out: readonly Float32Array[], offset: number, frames: number, t0: number, sampleRate: number): void {
    this.calls.push({ offset, frames, t0 });
    for (const ch of out) for (let i = 0; i < frames; i++) ch[offset + i] = this.value ?? (t0 + i / sampleRate) / 100;
  }
}

function block(position: number, frames = 100): AudioRenderBlock {
  return { sampleRate: SR, frames, position, channels: [new Float32Array(frames), new Float32Array(frames)] };
}

describe("Transport", () => {
  it("holds the picture at a cue until the sound reaches it, then follows the stream clock", () => {
    const tr = new Transport(SR, 10);
    tr.render(block(0), null);
    tr.cue(3, true); // takes effect at frame 100, the next block
    expect(tr.timeAt(50).time).toBe(3);
    expect(tr.timeAt(100).time).toBe(3);
    expect(tr.timeAt(350).time).toBeCloseTo(3.25);
  });

  it("holds while paused and replaces a cue given before the next block", () => {
    const tr = new Transport(SR, 10);
    tr.cue(1, true);
    tr.cue(4, false);
    expect(tr.timeAt(500).time).toBe(4);
    const track = new Timeline();
    const b = block(0);
    tr.render(b, track);
    expect(track.calls).toHaveLength(0);
    expect(b.channels[0]!.every((v) => v === 0)).toBe(true);
  });

  it("renders from the cued time", () => {
    const tr = new Transport(SR, 10);
    tr.cue(2, true);
    const track = new Timeline();
    tr.render(block(0), track);
    tr.render(block(100), track);
    expect(track.calls.map((c) => c.t0)).toEqual([2, 2.1]);
  });

  it("splits a block at the loop point and wraps the clock", () => {
    const tr = new Transport(SR, 1);
    tr.cue(0.95, true);
    const track = new Timeline();
    tr.render(block(0), track);
    expect(track.calls).toEqual([
      { offset: 0, frames: 50, t0: 0.95 },
      { offset: 50, frames: 50, t0: 0 },
    ]);
    expect(tr.timeAt(80).time).toBeCloseTo(0.03);
    expect(tr.timeAt(80).ended).toBe(false);
  });

  it("stops at the end when not looping", () => {
    const tr = new Transport(SR, 1, false);
    tr.cue(0.95, true);
    const track = new Timeline(0.5);
    const b = block(0);
    tr.render(b, track);
    expect(track.calls).toEqual([{ offset: 0, frames: 50, t0: 0.95 }]);
    expect(b.channels[0]![49]).not.toBe(0);
    expect(b.channels[0]![50]).toBe(0);
    expect(tr.timeAt(80)).toEqual({ time: 1, ended: true });
  });

  it("keeps the clock but renders silence while muted", () => {
    const tr = new Transport(SR, 10);
    tr.muted = true;
    tr.cue(0, true);
    const b = block(0);
    tr.render(b, new Timeline(0.5));
    expect(b.channels[0]!.every((v) => v === 0)).toBe(true);
    expect(tr.timeAt(200).time).toBeCloseTo(0.2);
  });

  it("soft-clips a hot mix into −1…1", () => {
    const tr = new Transport(SR, 10);
    tr.cue(0, true);
    const b = block(0);
    tr.render(b, new Timeline(40));
    for (const v of b.channels[0]!) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    expect(b.channels[0]![0]).toBe(1);
  });
});
