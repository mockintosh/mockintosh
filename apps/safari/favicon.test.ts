import { describe, expect, it } from "vitest";
import type { ImageFrame } from "@mockintosh/sdk";
import { faviconBits, faviconUrl, otsuThreshold } from "./favicon";

function frame(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): ImageFrame {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, rgba };
}

const rows = (bits: Uint8Array, size: number) =>
  Array.from({ length: size }, (_, y) => Array.from(bits.subarray(y * size, (y + 1) * size), (bit) => (bit ? "#" : ".")).join(""));

describe("faviconUrl", () => {
  it("asks the site for its touch icon unless the bookmark names one", () => {
    expect(faviconUrl("https://news.ycombinator.com/item?id=1")).toBe("https://news.ycombinator.com/apple-touch-icon.png");
    expect(faviconUrl("http://localhost:8080/")).toBe("http://localhost:8080/apple-touch-icon.png");
    expect(faviconUrl("https://text.npr.org/", "https://media.npr.org/icon.png")).toBe("https://media.npr.org/icon.png");
    expect(faviconUrl("about:start")).toBeNull();
  });
});

describe("faviconBits", () => {
  it("keeps a light mark on a coloured square light, and the square dark", () => {
    // HN: a white bar across an orange square. Orange is lighter than mid-grey.
    const hn = frame(8, 8, (_, y) => (y === 3 || y === 4 ? [255, 255, 255, 255] : [255, 102, 0, 255]));
    expect(rows(faviconBits(hn, 4), 4)).toEqual(["####", "....", "....", "####"]);
  });

  it("draws transparency as white paper", () => {
    const dot = frame(4, 4, (x, y) => (x === 1 && y === 1 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(rows(faviconBits(dot, 4), 4)).toEqual(["....", ".#..", "....", "...."]);
  });

  it("fits a wide picture inside the square, centred, on white", () => {
    const bar = frame(8, 4, () => [0, 0, 0, 255]);
    expect(rows(faviconBits(bar, 4), 4)).toEqual(["....", "####", "####", "...."]);
  });

  it("splits a blank picture at mid-grey", () => {
    expect(otsuThreshold(new Float32Array([200, 200, 200]))).toBe(128);
  });
});
