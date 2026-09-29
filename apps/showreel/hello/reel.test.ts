import { describe, expect, it } from "vitest";
import { fromGrid } from "@mockintosh/sdk";
import { createFrame, fitStage, stageRect, type Frame } from "../painter";
import { NO_ASSETS, chapterAt } from "../reels";
import { HELLO_CHAPTERS, HELLO_DURATION, HELLO_FPS, HELLO_REEL } from "./reel";

function whitePixels(frame: Frame): number {
  let n = 0;
  for (const px of frame.pixels) if (px === 0) n++;
  return n;
}

describe("hello, mockintosh", () => {
  it("covers the running time with contiguous chapters", () => {
    expect(HELLO_CHAPTERS[0]!.start).toBe(0);
    expect(HELLO_CHAPTERS[HELLO_CHAPTERS.length - 1]!.end).toBe(HELLO_DURATION);
    for (let k = 1; k < HELLO_CHAPTERS.length; k++) {
      expect(HELLO_CHAPTERS[k]!.start).toBe(HELLO_CHAPTERS[k - 1]!.end);
    }
    expect(chapterAt(HELLO_REEL, 5).title).toBe("Windows");
  });

  it.each([
    [400, 225],
    [512, 342],
    [1024, 684],
  ])(
    "renders every frame at %i×%i and keeps the letterbox black",
    (width, height) => {
      const player = HELLO_REEL.createPlayer(NO_ASSETS);
      const frame = createFrame(width, height);
      const rect = stageRect(fitStage(width, height));
      for (let f = 0; f < HELLO_DURATION * HELLO_FPS; f++) {
        player.render(frame, f / HELLO_FPS);
        for (let y = 0; y < rect.y0; y++) {
          expect(frame.pixels.subarray(y * width, (y + 1) * width).every((px) => px === 1)).toBe(true);
        }
      }
    },
    60_000,
  );

  it("casts the machine's own icons when it has them", () => {
    const solid = fromGrid(
      32,
      32,
      Array.from({ length: 32 }, () => "#".repeat(32)),
    );
    const bare = createFrame(400, 225);
    const cast = createFrame(400, 225);
    HELLO_REEL.createPlayer(NO_ASSETS).render(bare, 11);
    HELLO_REEL.createPlayer({ sprite: () => solid }).render(cast, 11);
    expect(whitePixels(cast)).toBeLessThan(whitePixels(bare));
  });

  it("is a pure function of time", () => {
    const warm = HELLO_REEL.createPlayer(NO_ASSETS);
    const a = createFrame(320, 180);
    const b = createFrame(320, 180);
    for (const t of [0.4, 3.1, 5.9, 8.3, 11.4, 14.2]) {
      warm.render(a, t + 1.7);
      warm.render(a, t);
      HELLO_REEL.createPlayer(NO_ASSETS).render(b, t);
      expect(a.pixels).toEqual(b.pixels);
    }
  });

  it("loops on a dark screen: powered off at both ends", () => {
    const player = HELLO_REEL.createPlayer(NO_ASSETS);
    const frame = createFrame(400, 225);
    player.render(frame, 0);
    expect(whitePixels(frame)).toBe(0);
    player.render(frame, HELLO_DURATION - 1 / HELLO_FPS);
    expect(whitePixels(frame)).toBe(0);
  });
});
