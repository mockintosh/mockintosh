import { describe, expect, it } from "vitest";
import { REELS } from "../catalog";
import { NO_ASSETS, type ReelAssets, type ReelDefinition } from "../reels";
import { syntheticFootage } from "../syntheticFootage";
import { Transport } from "./transport";

const SR = 16000;
const BLOCK = 256;

/** What a machine that can decode video would lend the reel. */
function assetsFor(reel: ReelDefinition): ReelAssets {
  return reel.footage ? { ...NO_ASSETS, footage: syntheticFootage(reel.footage) } : NO_ASSETS;
}

/** The whole reel through the transport, as the speaker would get it. */
function renderReel(reel: ReelDefinition): [Float32Array, Float32Array] {
  const track = reel.createSoundtrack(assetsFor(reel));
  const tr = new Transport(SR, reel.duration, false);
  tr.cue(0, true);
  const total = Math.round(reel.duration * SR);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let p = 0; p < total; p += BLOCK) {
    const channels = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    tr.render({ sampleRate: SR, frames: BLOCK, channels, position: p }, track);
    const n = Math.min(BLOCK, total - p);
    left.set(channels[0]!.subarray(0, n), p);
    right.set(channels[1]!.subarray(0, n), p);
  }
  return [left, right];
}

function rms(ch: Float32Array, from: number, to: number): number {
  let e = 0;
  const a = Math.round(from * SR);
  const b = Math.round(to * SR);
  for (let i = a; i < b; i++) e += ch[i]! ** 2;
  return Math.sqrt(e / (b - a));
}

describe.each(REELS.map((reel) => [reel.title, reel] as const))("%s soundtrack", (_title, reel) => {
  const [left, right] = renderReel(reel);

  it("is finite, within −1…1 and never pinned at the clipper", () => {
    let peak = 0;
    for (const ch of [left, right]) {
      for (const v of ch) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
    }
    expect(peak).toBeLessThan(0.999);
    expect(peak).toBeGreaterThan(0.2);
  });

  it("is heard in every chapter", () => {
    for (const chapter of reel.chapters) expect(rms(left, chapter.start, chapter.end), chapter.title).toBeGreaterThan(0.005);
  });

  it("is stereo", () => {
    let diff = 0;
    for (let i = 0; i < left.length; i++) diff += Math.abs(left[i]! - right[i]!);
    expect(diff / left.length).toBeGreaterThan(1e-4);
  });

  it("is a pure function of reel time, whatever the block boundaries", () => {
    const track = reel.createSoundtrack(assetsFor(reel));
    const at = reel.duration / 2;
    const whole = [new Float32Array(300), new Float32Array(300)];
    track.render(whole, 0, 300, at, SR);
    const pieces = [new Float32Array(300), new Float32Array(300)];
    track.render(pieces, 0, 123, at, SR);
    track.render(pieces, 123, 177, at + 123 / SR, SR);
    for (let i = 0; i < 300; i++) expect(pieces[0]![i]).toBeCloseTo(whole[0]![i]!, 5);
  });
});
