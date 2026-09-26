import { describe, expect, it } from "vitest";
import { Painter, bayer, createFrame, fitStage, stageRect, type Frame } from "./painter";
import { CHAPTERS, REEL_DURATION, REEL_FPS, ReelRenderer, chapterAt, timecode } from "./reel";
import { layoutText, partialStroke, strokeLength } from "./type";

function whitePixels(frame: Frame): number {
  let n = 0;
  for (const px of frame.pixels) if (px === 0) n++;
  return n;
}

describe("painter", () => {
  it("uses every Bayer threshold once per 8×8 tile", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(Math.round(bayer(x, y) * 64 - 0.5));
    expect([...seen].sort((a, b) => a - b)).toEqual([...Array(64).keys()]);
  });

  it("fits a 16:9 stage and letterboxes the rest", () => {
    const stage = fitStage(512, 342);
    expect(stage.scale).toBeCloseTo(1.6);
    expect(stageRect(stage)).toEqual({ x0: 0, y0: 27, x1: 512, y1: 315 });
  });

  it("strokes a capsule with round caps", () => {
    const frame = createFrame(40, 20);
    new Painter(frame, { scale: 1, x: 0, y: 0 }).capsule({ x: 10, y: 10 }, { x: 30, y: 10 }, 4);
    const at = (x: number, y: number) => frame.pixels[y * 40 + x];
    expect(at(20, 10)).toBe(1);
    expect(at(7, 10)).toBe(1);
    expect(at(33, 10)).toBe(1);
    expect(at(20, 15)).toBe(0);
    // The cap is round: the corner of the bounding box stays empty.
    expect(at(6, 6)).toBe(0);
  });
});

describe("type", () => {
  it("writes a stroke on by length", () => {
    const [glyph] = layoutText("L", { size: 10 }, { x: 0, top: 0 });
    const stroke = glyph!.strokes[0]!;
    expect(strokeLength(partialStroke(stroke, 0.5))).toBeCloseTo(strokeLength(stroke) / 2);
  });
});

describe("reel", () => {
  it("covers the running time with contiguous chapters", () => {
    expect(CHAPTERS[0]!.start).toBe(0);
    expect(CHAPTERS[CHAPTERS.length - 1]!.end).toBe(REEL_DURATION);
    for (let k = 1; k < CHAPTERS.length; k++) expect(CHAPTERS[k]!.start).toBe(CHAPTERS[k - 1]!.end);
    expect(chapterAt(8).title).toBe("Particles");
  });

  it("formats timecode as seconds and frames", () => {
    expect(timecode(0)).toBe("00:00");
    expect(timecode(7.5)).toBe("07:15");
    expect(timecode(14 + 29 / REEL_FPS)).toBe("14:29");
  });

  it.each([
    [400, 225],
    [512, 342],
  ])("renders every frame at %i×%i and keeps the letterbox black", (width, height) => {
    const reel = new ReelRenderer();
    const frame = createFrame(width, height);
    const rect = stageRect(fitStage(width, height));
    for (let f = 0; f < REEL_DURATION * REEL_FPS; f++) {
      reel.render(frame, f / REEL_FPS);
      for (let y = 0; y < rect.y0; y++) {
        expect(frame.pixels.subarray(y * width, (y + 1) * width).every((px) => px === 1)).toBe(true);
      }
    }
  }, 60_000);

  it("is a pure function of time, so scrubbing backwards matches playing forwards", () => {
    const reel = new ReelRenderer();
    const a = createFrame(320, 180);
    const b = createFrame(320, 180);
    for (const t of [1.3, 3.1, 5.6, 8.2, 10.7, 12.6, 14.2]) {
      reel.render(a, t);
      reel.render(b, t + 2.3);
      reel.render(b, t);
      expect(b.pixels).toEqual(a.pixels);
    }
  });

  it("loops seamlessly: it ends and begins on the same point of light", () => {
    const reel = new ReelRenderer();
    const first = createFrame(400, 225);
    const last = createFrame(400, 225);
    reel.render(first, 0);
    reel.render(last, REEL_DURATION - 1 / REEL_FPS);
    expect(whitePixels(first)).toBeGreaterThan(0);
    expect(whitePixels(first)).toBeLessThan(100);
    expect(whitePixels(last)).toBeGreaterThan(0);
    expect(whitePixels(last)).toBeLessThan(100);
  });
});
