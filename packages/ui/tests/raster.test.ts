import { describe, it, expect } from "vitest";
import { computeLayout } from "../src/layout";
import { createDrawContext, drawTree } from "../src/draw";
import { createNode } from "../src/nodes";
import type { MeasureFunc } from "../src/layout";
import { newBitMap, pixelsFromBitMap } from "@mockintosh/quickdraw/bits";

const noMeasure: MeasureFunc = () => ({ width: 0, height: 0 });
const W = 16;
const H = 16;

describe("raster onPaint", () => {
  it("invokes onPaint with the laid-out rect and writes pixels", () => {
    const screen = newBitMap(W, H);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style = { width: W, height: H };
    const raster = createNode("raster");
    raster.style = { position: "absolute", left: 2, top: 3, width: 4, height: 5 };
    raster.props.onPaint = (surface) => {
      expect(surface.rect).toEqual({ x: 2, y: 3, width: 4, height: 5 });
      surface.fill(1);
      // Out-of-range writes are clipped, not wrapped into neighbouring rows.
      surface.setPixel(-1, 0, 1);
      surface.setPixel(4, 0, 1);
    };
    raster.parent = root;
    root.children = [raster];
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    const pixels = pixelsFromBitMap(screen);
    expect(pixels[3 * W + 2]).toBe(1);
    expect(pixels[7 * W + 5]).toBe(1);
    expect(pixels[0]).toBe(0);
    expect(pixels[3 * W + 1]).toBe(0);
    expect(pixels[3 * W + 6]).toBe(0);
  });

  it("blitPixels copies a 1-byte-per-pixel buffer, clipped to the raster", () => {
    const screen = newBitMap(W, H);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style = { width: W, height: H };
    const raster = createNode("raster");
    raster.style = { position: "absolute", left: 4, top: 4, width: 4, height: 4 };
    raster.props.onPaint = (surface) => {
      // 3×3 checker placed at (2, 2): its lower-right spills past the raster.
      const src = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1]);
      surface.blitPixels(src, 3, 3, 2, 2);
    };
    raster.parent = root;
    root.children = [raster];
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    const pixels = pixelsFromBitMap(screen);
    expect(pixels[6 * W + 6]).toBe(1);
    expect(pixels[6 * W + 7]).toBe(0);
    expect(pixels[7 * W + 7]).toBe(1);
    expect(pixels[8 * W + 8]).toBe(0); // clipped
    expect(pixels[6 * W + 8]).toBe(0); // clipped
  });

  it("is clipped by a parent overflow=hidden, not by its own onPaint rect", () => {
    const screen = newBitMap(W, H);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style = { width: W, height: H };
    const frame = createNode("box");
    frame.style = { width: 6, height: 6, overflow: "hidden" };
    const raster = createNode("raster");
    raster.style = { width: 12, height: 12 };
    raster.props.onPaint = (surface) => surface.fill(1);
    raster.parent = frame;
    frame.children = [raster];
    frame.parent = root;
    root.children = [frame];
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    const pixels = pixelsFromBitMap(screen);
    expect(pixels[0]).toBe(1);
    expect(pixels[5 * W + 5]).toBe(1);
    expect(pixels[6 * W + 6]).toBe(0);
  });
});

describe("border protection", () => {
  it("overflow=hidden clips children to the padding box, so the border survives", () => {
    const screen = newBitMap(W, H);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style = { width: W, height: H };
    const frame = createNode("box");
    frame.style = { width: 10, height: 10, borderWidth: 1, overflow: "hidden" };
    frame.props.borderColor = 1;
    frame.props.background = 0;
    // Child tries to paint white over the whole frame, including the border.
    const child = createNode("box");
    child.style = { position: "absolute", left: -1, top: -1, width: 12, height: 12 };
    child.props.background = 0;
    child.parent = frame;
    frame.children = [child];
    frame.parent = root;
    root.children = [frame];
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    const pixels = pixelsFromBitMap(screen);
    // Border pixels intact
    expect(pixels[0]).toBe(1);           // top-left corner
    expect(pixels[5]).toBe(1);           // top edge
    expect(pixels[5 * W + 0]).toBe(1);   // left edge
    expect(pixels[9 * W + 9]).toBe(1);   // bottom-right corner
    // Interior is white
    expect(pixels[5 * W + 5]).toBe(0);
  });

  it("a child at left=0 in a bordered box does not cover the border", () => {
    const screen = newBitMap(W, H);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style = { width: W, height: H };
    const frame = createNode("box");
    frame.style = { width: 10, height: 10, borderWidth: 1 };
    frame.props.borderColor = 1;
    const child = createNode("box");
    child.style = { position: "absolute", left: 0, top: 0, width: 8, height: 8 };
    child.props.background = 0;
    child.parent = frame;
    frame.children = [child];
    frame.parent = root;
    root.children = [frame];
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    const pixels = pixelsFromBitMap(screen);
    expect(pixels[0]).toBe(1);
    expect(pixels[1 * W + 0]).toBe(1);
    expect(pixels[1 * W + 1]).toBe(0);
  });
});

describe("ink fill", () => {
  it("paints a black box as 1s and leaves the rest white", () => {
    const screen = newBitMap(W, H);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style = { width: W, height: H };
    const box = createNode("box");
    box.style = { width: 4, height: 4 };
    box.props.background = 1;
    box.parent = root;
    root.children = [box];
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    const pixels = pixelsFromBitMap(screen);
    expect(pixels[0]).toBe(1);
    expect(pixels[3 * W + 3]).toBe(1);
    expect(pixels[5]).toBe(0);
    // Strictly 1-bit: nothing but 0 and 1 ever lands in the buffer.
    expect(pixels.every((p) => p === 0 || p === 1)).toBe(true);
  });
});

describe("bitmap under a rounded clip", () => {
  it("draws exactly the pixels inside the clip region", () => {
    const size = 40;
    const screen = newBitMap(size, size);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style.width = size;
    root.style.height = size;
    root.layout = { x: 0, y: 0, width: size, height: size };
    const clip = createNode("box");
    clip.style = { width: size, height: size, overflow: "hidden" };
    clip.props = { borderRadius: size / 2 };
    clip.parent = root;
    root.children = [clip];
    const bitmap = createNode("bitmap");
    bitmap.style = { width: size, height: size };
    bitmap.props = { pixels: new Uint8Array(size * size).fill(1) };
    bitmap.parent = clip;
    clip.children = [bitmap];
    computeLayout(root, size, size, () => ({ width: 0, height: 0 }));
    drawTree(root, ctx);

    // The clip is the filled round rect: the same shape PaintRoundRect inks.
    const expected = newBitMap(size, size);
    const reference = createDrawContext(expected);
    const disc = createNode("box");
    disc.style = { width: size, height: size };
    disc.props = { background: 1, borderRadius: size / 2 };
    disc.parent = root;
    root.children = [disc];
    computeLayout(root, size, size, () => ({ width: 0, height: 0 }));
    drawTree(root, reference);

    const drawn = pixelsFromBitMap(screen);
    expect(drawn).toEqual(pixelsFromBitMap(expected));
    expect(drawn[0]).toBe(0);
    expect(drawn[(size / 2) * size + size / 2]).toBe(1);
  });
});
