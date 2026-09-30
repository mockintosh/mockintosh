import { describe, it, expect } from "vitest";
import { newBitMap, setBit } from "@mockintosh/quickdraw/bits";
import {
  DEFAULT_HOST_PALETTE,
  formatRgb8,
  hostPalettesEqual,
  paintBitMapRgba,
  paintBitMapRgbaRect,
  parseRgb8,
} from "../src/web/palette";

describe("parseRgb8 / formatRgb8", () => {
  it("reads #rgb and #rrggbb", () => {
    expect(parseRgb8("#0f8")).toEqual({ r: 0, g: 255, b: 136 });
    expect(parseRgb8("112233")).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
    expect(parseRgb8("  #AaBbCc  ")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it("rejects junk", () => {
    expect(parseRgb8("")).toBeNull();
    expect(parseRgb8("#12")).toBeNull();
    expect(parseRgb8("#gg0000")).toBeNull();
  });

  it("round-trips clamped channels", () => {
    expect(formatRgb8({ r: 0, g: 16, b: 255 })).toBe("#0010ff");
  });
});

describe("paintBitMapRgba", () => {
  it("maps ink and paper through the palette", () => {
    const src = newBitMap(2, 1);
    setBit(src, 0, 0, 1);
    const rgba = new Uint8ClampedArray(8);
    paintBitMapRgba(
      src,
      rgba,
      2,
      1,
      { foreground: { r: 10, g: 20, b: 30 }, background: { r: 200, g: 210, b: 220 } },
    );
    expect(Array.from(rgba.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(rgba.subarray(4, 8))).toEqual([200, 210, 220, 255]);
  });

  it("defaults to black ink on white paper", () => {
    const src = newBitMap(1, 1);
    setBit(src, 0, 0, 1);
    const rgba = new Uint8ClampedArray(4);
    paintBitMapRgba(src, rgba, 1, 1);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255]);
    expect(hostPalettesEqual(DEFAULT_HOST_PALETTE, DEFAULT_HOST_PALETTE)).toBe(true);
  });

  it("paints a dirty rect without touching the rest of the buffer", () => {
    const src = newBitMap(4, 2);
    setBit(src, 2, 1, 1);
    const rgba = new Uint8ClampedArray(4 * 2 * 4);
    rgba.fill(7);
    paintBitMapRgbaRect(
      src,
      rgba,
      4,
      2,
      2,
      1,
      1,
      1,
      { foreground: { r: 9, g: 8, b: 7 }, background: { r: 1, g: 2, b: 3 } },
    );
    expect(Array.from(rgba.subarray(0, 4))).toEqual([7, 7, 7, 7]);
    expect(Array.from(rgba.subarray((1 * 4 + 2) * 4, (1 * 4 + 3) * 4))).toEqual([9, 8, 7, 255]);
  });
});

describe("paintBitMapRgbaRect matches a pixel-by-pixel expansion", () => {
  /** The obvious implementation: one bit test and four byte writes per pixel. */
  function reference(
    src: ReturnType<typeof newBitMap>,
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    left: number,
    top: number,
    w: number,
    h: number,
    palette: typeof DEFAULT_HOST_PALETTE,
  ): void {
    // As the original: the start clamps to 0 and the size counts from there.
    const x0 = Math.max(0, left);
    const y0 = Math.max(0, top);
    for (let y = y0; y < Math.min(height, y0 + h); y++) {
      for (let x = x0; x < Math.min(width, x0 + w); x++) {
        const bit = (src.baseAddr[y * src.rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const c = bit ? palette.foreground : palette.background;
        rgba.set([c.r, c.g, c.b, 255], (y * width + x) * 4);
      }
    }
  }

  /** Deterministic, so a failure reproduces. */
  function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  }

  it("for random bitmaps, rects and palettes", () => {
    const next = random(1984);
    const int = (n: number) => Math.floor(next() * n);
    for (let trial = 0; trial < 200; trial++) {
      const width = 1 + int(70);
      const height = 1 + int(12);
      const src = newBitMap(width, height);
      for (let i = 0; i < src.baseAddr.length; i++) src.baseAddr[i] = int(256);
      const left = int(width + 4) - 2;
      const top = int(height + 2) - 1;
      const w = int(width + 10);
      const h = int(height + 3);
      const palette = {
        foreground: { r: int(256), g: int(256), b: int(256) },
        background: { r: int(256), g: int(256), b: int(256) },
      };
      const expected = new Uint8ClampedArray(width * height * 4).fill(7);
      const actual = new Uint8ClampedArray(width * height * 4).fill(7);
      reference(src, expected, width, height, left, top, w, h, palette);
      paintBitMapRgbaRect(src, actual, width, height, left, top, w, h, palette);
      expect(actual, `trial ${trial}: ${width}×${height} rect ${left},${top} ${w}×${h}`).toEqual(expected);
    }
  });

  it("for an RGBA view a Uint32Array can't alias", () => {
    const src = newBitMap(19, 3);
    for (let i = 0; i < src.baseAddr.length; i++) src.baseAddr[i] = (i * 37) & 255;
    const palette = { foreground: { r: 1, g: 2, b: 3 }, background: { r: 250, g: 240, b: 230 } };
    const expected = new Uint8ClampedArray(19 * 3 * 4);
    const actual = new Uint8ClampedArray(new ArrayBuffer(19 * 3 * 4 + 1), 1, 19 * 3 * 4);
    reference(src, expected, 19, 3, 0, 0, 19, 3, palette);
    paintBitMapRgbaRect(src, actual, 19, 3, 0, 0, 19, 3, palette);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });
});
