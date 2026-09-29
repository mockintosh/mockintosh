import { describe, expect, it } from "vitest";
import { fromGrid } from "@mockintosh/sdk";
import { cutEnd, editAt } from "../footage";
import { createFrame, fitStage, stageRect, type Frame } from "../painter";
import { NO_ASSETS, chapterAt, type ReelAssets } from "../reels";
import { syntheticFootage } from "../syntheticFootage";
import { ALERTS, BANNERS, CARD_AT, CRASH, CUTS, FOOTAGE, HAMMER_DURATION, HAMMER_FPS, IMPACT, LOGO_AT, RUNNER_SHOTS, SHOTS } from "./edit";
import { HAMMER_CHAPTERS, HAMMER_REEL } from "./reel";

const FOOTAGE_ASSETS: ReelAssets = { ...NO_ASSETS, footage: syntheticFootage(FOOTAGE) };

function whitePixels(frame: Frame): number {
  let n = 0;
  for (const px of frame.pixels) if (px === 0) n++;
  return n;
}

function frameAt(assets: ReelAssets, t: number, width = 400, height = 225): Frame {
  const frame = createFrame(width, height);
  HAMMER_REEL.createPlayer(assets).render(frame, t);
  return frame;
}

describe("a lot like 1984", () => {
  it("covers the running time with contiguous chapters", () => {
    expect(HAMMER_CHAPTERS[0]!.start).toBe(0);
    expect(HAMMER_CHAPTERS[HAMMER_CHAPTERS.length - 1]!.end).toBe(HAMMER_DURATION);
    for (let k = 1; k < HAMMER_CHAPTERS.length; k++) expect(HAMMER_CHAPTERS[k]!.start).toBe(HAMMER_CHAPTERS[k - 1]!.end);
    expect(chapterAt(HAMMER_REEL, IMPACT).title).toBe("Impact");
  });

  it("cuts the footage end to end up to the card, and never into Apple's closing titles", () => {
    expect(CUTS[0]!.at).toBe(0);
    for (let k = 1; k < CUTS.length; k++) expect(CUTS[k]!.at).toBeCloseTo(cutEnd(CUTS[k - 1]!), 9);
    expect(cutEnd(CUTS[CUTS.length - 1]!)).toBeCloseTo(CARD_AT, 9);
    for (const cut of CUTS) expect(cut.range.to).toBeLessThan(49.3);
    expect(FOOTAGE.ranges).toEqual(CUTS.map((c) => c.range));
    expect(editAt(CUTS, IMPACT)!.source).toBeCloseTo(46.08, 6);
  });

  it("times every overlay inside the shot it dresses", () => {
    for (const cue of ALERTS) expect(cue.at).toBeLessThan(cue.until);
    const faces = [SHOTS.faceOne, SHOTS.faceTwo];
    for (const cue of ALERTS) expect(faces.some((s) => cue.at >= s.from && cue.until <= s.to)).toBe(true);
    for (const b of BANNERS) expect(b.at).toBeGreaterThanOrEqual(SHOTS.faceThree.from);
    expect(CRASH.at).toBeGreaterThan(IMPACT);
    expect(CRASH.until).toBeLessThanOrEqual(CARD_AT);
  });

  it.each([
    [400, 225],
    [512, 342],
    [1024, 684],
  ])(
    "renders every frame at %i×%i and keeps the letterbox black",
    (width, height) => {
      const player = HAMMER_REEL.createPlayer(FOOTAGE_ASSETS);
      const frame = createFrame(width, height);
      const rect = stageRect(fitStage(width, height));
      for (let f = 0; f < HAMMER_DURATION * HAMMER_FPS; f++) {
        player.render(frame, f / HAMMER_FPS);
        for (let y = 0; y < rect.y0; y++) {
          expect(frame.pixels.subarray(y * width, (y + 1) * width).every((px) => px === 1)).toBe(true);
        }
      }
    },
    180_000,
  );

  it("waits on a quiet placeholder while the footage is missing", () => {
    const missing = frameAt(NO_ASSETS, 20);
    const shown = frameAt(FOOTAGE_ASSETS, 20);
    expect(whitePixels(missing)).toBeGreaterThan(0);
    expect(whitePixels(missing)).toBeLessThan(whitePixels(shown) / 10);
  });

  it("selects the runner when the key finds her, and only in her shots", () => {
    const inShot = (RUNNER_SHOTS[1].from + RUNNER_SHOTS[1].to) / 2;
    const plain: ReelAssets = { ...NO_ASSETS, footage: syntheticFootage({ ...FOOTAGE, chroma: false }) };
    expect(frameAt(FOOTAGE_ASSETS, inShot).pixels).not.toEqual(frameAt(plain, inShot).pixels);
    const outOfShot = (SHOTS.boots.from + SHOTS.boots.to) / 2;
    expect(frameAt(FOOTAGE_ASSETS, outOfShot).pixels).toEqual(frameAt(plain, outOfShot).pixels);
  });

  it("shows the machine's own Happy Mac on the card when it has one", () => {
    const solid = fromGrid(
      32,
      32,
      Array.from({ length: 32 }, () => "#".repeat(32)),
    );
    expect(whitePixels(frameAt({ sprite: () => solid }, LOGO_AT + 1))).not.toBe(whitePixels(frameAt(NO_ASSETS, LOGO_AT + 1)));
  });

  it("is a pure function of time", () => {
    const warm = HAMMER_REEL.createPlayer(FOOTAGE_ASSETS);
    const a = createFrame(320, 180);
    for (const t of [1.1, 9.0, 19.3, 28.4, 33.6, IMPACT + 0.3, CRASH.at + 0.5, LOGO_AT + 1]) {
      warm.render(a, t + 1.7);
      warm.render(a, t);
      expect(a.pixels).toEqual(frameAt(FOOTAGE_ASSETS, t, 320, 180).pixels);
    }
  });

  it("loops on black: fades up from it and back down to it", () => {
    expect(whitePixels(frameAt(FOOTAGE_ASSETS, 0))).toBe(0);
    expect(whitePixels(frameAt(FOOTAGE_ASSETS, HAMMER_DURATION - 1 / HAMMER_FPS))).toBe(0);
  });
});
