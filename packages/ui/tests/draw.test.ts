/**
 * Draw pass tests — verify that the pixel buffer is written correctly.
 *
 * These tests draw into a small packed BitMap and assert that specific
 * pixels are set after drawTree().
 */

import { describe, it, expect, beforeEach } from "vitest";
import { computeLayout } from "../src/layout";
import { createDrawContext, drawTree } from "../src/draw";
import { createNode } from "../src/nodes";
import type { MeasureFunc } from "../src/layout";
import { createFocusManager } from "../src/focus";
import type { BitMap } from "@mockintosh/quickdraw";
import { getBit, newBitMap, pixelsFromBitMap } from "@mockintosh/quickdraw/bits";
import { installFontBridge } from "../src/fonts/bridge";
import { createMeasureFunc } from "../src/measure";

const noMeasure: MeasureFunc = () => ({ width: 0, height: 0 });

const W = 32;
const H = 32;

function makeTestContext() {
  const screen = newBitMap(W, H);
  const ctx = createDrawContext(screen);
  const root = createNode("_root");
  root.style.width = W;
  root.style.height = H;
  root.layout = { x: 0, y: 0, width: W, height: H };
  ctx.focusManager = createFocusManager(root);
  return { screen, ctx, root };
}

function px(screen: BitMap, x: number, y: number): number {
  return getBit(screen, x, y);
}

describe("drawTree — background fill", () => {
  it("box with background=1 fills pixels black", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 8, height: 8 };
    child.props = { background: 1 };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    // Top-left region should be black
    expect(px(screen, 0, 0)).toBe(1);
    expect(px(screen, 7, 7)).toBe(1);
    // Area outside should be white
    expect(px(screen, 9, 0)).toBe(0);
  });

  it("box with background=0 keeps pixels white", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 8, height: 8 };
    child.props = { background: 0 };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(px(screen, 0, 0)).toBe(0);
    expect(px(screen, 7, 7)).toBe(0);
  });

  it("checker pattern alternates pixels", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 8, height: 8 };
    child.props = { background: "checker" };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    // Checker pattern: pixel (0,0) = black (0xAA byte, bit 7 set)
    expect(px(screen, 0, 0)).toBe(1); // black
    expect(px(screen, 1, 0)).toBe(0); // white
  });

  it("accepts a raw 8-byte QuickDraw pattern", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 8, height: 8 };
    child.props = { background: new Uint8Array([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]) };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(px(screen, 0, 0)).toBe(1);
    expect(px(screen, 1, 0)).toBe(0);
  });

  it("paints a size-dependent dithered gradient and keeps rounded corners cut", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 24, height: 24 };
    child.props = {
      background: { dither: "gradient", from: 0.15, to: 0.9, direction: "se" },
      borderRadius: 6,
    };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(px(screen, 0, 0)).toBe(0);
    expect(px(screen, 23, 23)).toBe(0);
    let tl = 0;
    let br = 0;
    for (let y = 2; y < 8; y++) {
      for (let x = 2; x < 8; x++) tl += px(screen, x, y);
    }
    for (let y = 16; y < 22; y++) {
      for (let x = 16; x < 22; x++) br += px(screen, x, y);
    }
    expect(br).toBeGreaterThan(tl);
  });
});

describe("drawTree — borderRadius", () => {
  it("strokes a thick rounded border with one PenSize FrameRoundRect", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 24, height: 20, borderWidth: 3 };
    child.props = { background: 0, borderColor: 1, borderRadius: 8 };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(px(screen, 0, 0)).toBe(0);
    expect(px(screen, 23, 0)).toBe(0);
    expect(px(screen, 12, 0)).toBe(1);
    expect(px(screen, 12, 1)).toBe(1);
    expect(px(screen, 12, 2)).toBe(1);
    expect(px(screen, 12, 3)).toBe(0);
    expect(px(screen, 12, 10)).toBe(0);
  });

  it("cuts the square corners of a filled box", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 12, height: 10 };
    child.props = { background: 1, borderRadius: 3 };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(px(screen, 0, 0)).toBe(0);
    expect(px(screen, 11, 0)).toBe(0);
    expect(px(screen, 0, 9)).toBe(0);
    expect(px(screen, 11, 9)).toBe(0);
    expect(px(screen, 5, 5)).toBe(1);
  });

  it("clips overflow children to the rounded well, not a square", () => {
    const { screen, ctx, root } = makeTestContext();
    const frame = createNode("box");
    frame.style = { width: 16, height: 16, borderWidth: 1, overflow: "hidden" };
    frame.props = { background: 0, borderColor: 1, borderRadius: 6 };
    const fill = createNode("box");
    fill.style = { position: "absolute", left: 0, top: 0, width: 16, height: 16 };
    fill.props = { background: 1 };
    fill.parent = frame;
    frame.children = [fill];
    frame.parent = root;
    root.children = [frame];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(px(screen, 0, 0)).toBe(0);
    expect(px(screen, 15, 0)).toBe(0);
    expect(px(screen, 0, 15)).toBe(0);
    expect(px(screen, 15, 15)).toBe(0);
    expect(px(screen, 8, 0)).toBe(1);
    expect(px(screen, 8, 8)).toBe(1);
  });
});

describe("drawTree — shadow", () => {
  it("paints a 1px L on the layout box and raises the face onto it", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 12, height: 10, marginLeft: 2, marginTop: 2 };
    child.props = { background: 0, borderColor: 1, shadow: true };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    // Face is 1px up-left of the layout box at (2, 2).
    expect(px(screen, 1, 1)).toBe(1);
    expect(px(screen, 2, 2)).toBe(0);
    // L hangs on the raised face, no gap.
    expect(px(screen, 2, 11)).toBe(1);
    expect(px(screen, 13, 11)).toBe(1);
    expect(px(screen, 13, 2)).toBe(1);
    expect(px(screen, 13, 10)).toBe(1);
    expect(px(screen, 12, 11)).toBe(1);
    expect(px(screen, 1, 11)).toBe(0);
    expect(px(screen, 13, 1)).toBe(0);
  });

  it("follows the face radius instead of painting a square L", () => {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode("box");
    child.style = { width: 20, height: 16, marginLeft: 2, marginTop: 2 };
    child.props = { background: 0, borderColor: 1, borderRadius: 6, shadow: true };
    child.parent = root;
    root.children = [child];

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    // Raised face at (1, 1). Mid-right / mid-bottom still have the 1px L.
    expect(px(screen, 21, 9)).toBe(1);
    expect(px(screen, 10, 17)).toBe(1);
    // Square L would stub a bar into the cut TR / BL corners.
    expect(px(screen, 21, 2)).toBe(0);
    expect(px(screen, 2, 17)).toBe(0);
  });
});

describe("drawTree — overflow scroll track", () => {
  function scrollPane(contentHeight: number, offset = 0) {
    const { screen, ctx, root } = makeTestContext();
    const pane = createNode("box");
    pane.style = { overflow: "scroll", width: 16, height: 16 };
    pane.props = { background: 0 };
    pane._scrollOffset = offset;
    const content = createNode("box");
    content.style = { width: 16, height: contentHeight };
    content.props = { background: 0 };
    content.parent = pane;
    pane.children = [content];
    pane.parent = root;
    root.children = [pane];
    computeLayout(root, W, H, noMeasure);
    // Layout sizes the child to the pane unless we keep the overflow height.
    content.layout = { ...content.layout, height: contentHeight };
    drawTree(root, ctx);
    return { screen, pane };
  }

  it("draws content that overflows a wrapper scrolled fully out of view", () => {
    const { screen, ctx, root } = makeTestContext();
    const pane = createNode("box");
    pane.style = { overflow: "scroll", width: 16, height: 16 };
    const wrapper = createNode("box");
    wrapper.style = { width: 16, height: 16 };
    const content = createNode("box");
    content.style = { width: 16, height: 64 };
    const mark = createNode("box");
    mark.style = { position: "absolute", left: 0, top: 40, width: 4, height: 4 };
    mark.props = { background: 1 };
    content.children = [mark];
    mark.parent = content;
    wrapper.children = [content];
    content.parent = wrapper;
    pane.children = [wrapper];
    wrapper.parent = pane;
    root.children = [pane];
    pane.parent = root;
    computeLayout(root, W, H, noMeasure);
    pane._scrollOffset = 36;
    drawTree(root, ctx);
    expect(px(screen, 1, 5)).toBe(1);
  });

  it("paints nothing on the right edge when content fits", () => {
    const { screen } = scrollPane(16);
    for (let y = 0; y < 16; y++) expect(px(screen, 15, y)).toBe(0);
  });

  it("paints a 3px checker thumb when it overflows", () => {
    const { screen } = scrollPane(48);
    expect(px(screen, 15, 2)).toBe(0);
    expect(px(screen, 12, 0)).toBe(0);
    expect(px(screen, 12, 5)).toBe(0);
    // Even row of the checker: black, white, black across the 3px thumb.
    expect(px(screen, 12, 2)).toBe(1);
    expect(px(screen, 13, 2)).toBe(0);
    expect(px(screen, 14, 2)).toBe(1);
    expect(px(screen, 12, 3)).toBe(0);
    expect(px(screen, 13, 3)).toBe(1);
  });

  it("slides the thumb down when the pane is scrolled", () => {
    const { screen } = scrollPane(48, 32);
    expect(px(screen, 12, 1)).toBe(0);
    expect(px(screen, 12, 15)).toBe(0);
    expect(px(screen, 12, 14)).toBe(1);
    expect(px(screen, 13, 14)).toBe(0);
    expect(px(screen, 14, 14)).toBe(1);
    expect(px(screen, 15, 14)).toBe(0);
  });
});

describe("drawTree — nested boxes", () => {
  it("inner box overwrites outer box pixels", () => {
    const { screen, ctx, root } = makeTestContext();

    const outer = createNode("box");
    outer.style = { width: 16, height: 16 };
    outer.props = { background: 0 };

    const inner = createNode("box");
    // Absolute position within outer
    inner.style = { position: "absolute", left: 4, top: 4, width: 8, height: 8 };
    inner.props = { background: 1 };

    outer.children = [inner];
    inner.parent = outer;
    root.children = [outer];
    outer.parent = root;

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(px(screen, 4, 4)).toBe(1);   // inner box start
    expect(px(screen, 11, 11)).toBe(1); // inner box end
    expect(px(screen, 0, 0)).toBe(0);   // outer box only (white)
    expect(px(screen, 16, 0)).toBe(0);  // outside both boxes
  });

  it("still paints an absolute child of an off-screen parent", () => {
    const { screen, ctx, root } = makeTestContext();
    const spacer = createNode("box");
    spacer.style = { width: 8, height: 40 };
    const parent = createNode("box");
    parent.style = { width: 8, height: 8 };
    parent.props = { background: 0 };
    const child = createNode("box");
    child.style = { position: "absolute", left: 0, top: -36, width: 8, height: 8 };
    child.props = { background: 1 };
    child.parent = parent;
    parent.children = [child];
    spacer.parent = root;
    parent.parent = root;
    root.children = [spacer, parent];
    root.style = { ...root.style, flexDirection: "column" };

    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);

    expect(parent.layout.y).toBeGreaterThanOrEqual(H);
    expect(px(screen, 0, 4)).toBe(1);
  });
});

describe("drawTree — overflow scroll text", () => {
  installFontBridge();
  const measure = createMeasureFunc();

  function paintScrolledText(offset: number) {
    const w = 96;
    const h = 48;
    const screen = newBitMap(w, h);
    const ctx = createDrawContext(screen);
    const root = createNode("_root");
    root.style = { width: w, height: h };
    const pane = createNode("box");
    pane.style = { overflow: "scroll", width: w, height: h, flexDirection: "column", paddingTop: 16 };
    pane.props = { background: 0 };
    pane._scrollOffset = offset;
    const label = createNode("text");
    label.props = { font: "body" };
    const content = createNode("_text_content");
    content.textContent = "Hello";
    content.parent = label;
    label.children = [content];
    label.parent = pane;
    pane.children = [label];
    pane.parent = root;
    root.children = [pane];
    computeLayout(root, w, h, measure);
    drawTree(root, ctx);
    const pixels = pixelsFromBitMap(screen);
    let ink = 0;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!pixels[y * w + x]) continue;
        ink++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    return { ink, minX, maxX, minY, maxY };
  }

  it("still inks glyphs when the scroll offset is a half pixel", () => {
    const whole = paintScrolledText(0);
    const half = paintScrolledText(0.5);
    expect(whole.ink).toBeGreaterThan(0);
    expect(half.ink).toBeGreaterThan(0);
    expect(half.maxX - half.minX).toBeLessThan(60);
    expect(Math.abs(half.minX - whole.minX)).toBeLessThan(4);
  });
});

describe("drawTree — DragGrayRgn outlines", () => {
  function drawChild(type: string, style: Record<string, number | string>, props: Record<string, unknown>) {
    const { screen, ctx, root } = makeTestContext();
    const child = createNode(type);
    child.style = style;
    child.props = props;
    child.parent = root;
    root.children = [child];
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    return screen;
  }

  it("frames a gray xor border on the gray pattern's white squares", () => {
    const screen = drawChild(
      "box",
      { position: "absolute", left: 3, top: 2, width: 10, height: 6 },
      { borderColor: 1, borderWidth: 1, borderStyle: "gray", penMode: "xor" },
    );
    for (let x = 3; x < 13; x++) expect(px(screen, x, 2)).toBe((x + 2) & 1);
    for (let y = 2; y < 8; y++) expect(px(screen, 3, y)).toBe((y + 3) & 1);
    expect(px(screen, 6, 5)).toBe(0);
  });

  it("inverts the screen under an xor image's black pixels", () => {
    const { screen, ctx, root } = makeTestContext();
    const ink = createNode("box");
    ink.style = { position: "absolute", left: 0, top: 0, width: 4, height: 1 };
    ink.props = { background: 1 };
    const image = createNode("image");
    image.style = { position: "absolute", left: 0, top: 0, width: 4, height: 1 };
    image.props = { src: { width: 4, height: 1, data: new Uint8Array([1, 0, 1, 0]) }, penMode: "xor" };
    root.children = [ink, image];
    for (const child of root.children) child.parent = root;
    computeLayout(root, W, H, noMeasure);
    drawTree(root, ctx);
    expect([0, 1, 2, 3].map((x) => px(screen, x, 0))).toEqual([0, 1, 0, 1]);
  });
});
