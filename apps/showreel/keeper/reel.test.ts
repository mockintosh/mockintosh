import { describe, expect, it } from "vitest";
import { createFrame, fitStage, stageRect, type Frame } from "../painter";
import { NO_ASSETS, chapterAt } from "../reels";
import { KEEPER_CHAPTERS, KEEPER_DURATION, KEEPER_FPS, KEEPER_REEL } from "./reel";

function whitePixels(frame: Frame): number {
  let n = 0;
  for (const px of frame.pixels) if (px === 0) n++;
  return n;
}

describe("the keeper", () => {
  it("covers the running time with contiguous chapters", () => {
    expect(KEEPER_CHAPTERS[0]!.start).toBe(0);
    expect(KEEPER_CHAPTERS[KEEPER_CHAPTERS.length - 1]!.end).toBe(KEEPER_DURATION);
    for (let k = 1; k < KEEPER_CHAPTERS.length; k++) {
      expect(KEEPER_CHAPTERS[k]!.start).toBe(KEEPER_CHAPTERS[k - 1]!.end);
    }
    expect(chapterAt(KEEPER_REEL, 9).title).toBe("Below");
  });

  it.each([
    [400, 225],
    [512, 342],
  ])(
    "renders every frame at %i×%i and keeps the letterbox black",
    (width, height) => {
      const player = KEEPER_REEL.createPlayer(NO_ASSETS);
      const frame = createFrame(width, height);
      const rect = stageRect(fitStage(width, height));
      for (let f = 0; f < KEEPER_DURATION * KEEPER_FPS; f++) {
        player.render(frame, f / KEEPER_FPS);
        for (let y = 0; y < rect.y0; y++) {
          expect(frame.pixels.subarray(y * width, (y + 1) * width).every((px) => px === 1)).toBe(true);
        }
      }
    },
    60_000,
  );

  it("is animated on twos: each drawing is held for two frames", () => {
    const player = KEEPER_REEL.createPlayer(NO_ASSETS);
    const a = createFrame(320, 180);
    const b = createFrame(320, 180);
    for (const f of [60, 130, 200, 290]) {
      player.render(a, f / KEEPER_FPS);
      player.render(b, (f + 1) / KEEPER_FPS);
      expect(b.pixels).toEqual(a.pixels);
      player.render(b, (f + 2) / KEEPER_FPS);
      expect(b.pixels).not.toEqual(a.pixels);
    }
  });

  it("is a pure function of time, whatever the player drew before", () => {
    const warm = KEEPER_REEL.createPlayer(NO_ASSETS);
    const a = createFrame(320, 180);
    const b = createFrame(320, 180);
    for (const t of [1.9, 4.2, 6.3, 9.1, 11.7, 13.8]) {
      warm.render(a, t + 3.1);
      warm.render(a, t);
      KEEPER_REEL.createPlayer(NO_ASSETS).render(b, t);
      expect(a.pixels).toEqual(b.pixels);
    }
  });

  it("loops on black: the iris is shut at both ends", () => {
    const player = KEEPER_REEL.createPlayer(NO_ASSETS);
    const frame = createFrame(400, 225);
    player.render(frame, 0);
    expect(whitePixels(frame)).toBeLessThan(400 * 225 * 0.01);
    player.render(frame, KEEPER_DURATION - 1 / KEEPER_FPS);
    expect(whitePixels(frame)).toBeLessThan(400 * 225 * 0.01);
  });
});
