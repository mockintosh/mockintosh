import { describe, expect, it } from "vitest";
import { bitMapWidth, newBitMap, pixelsFromBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";

describe("<text bold> / <text italic> / <text outline>", () => {
  it("lays out one extra pixel per glyph for bold and italic", () => {
    const ui = createUI({ screen: newBitMap(200, 80) });
    ui.render(() => (
      <box flexDirection="column" alignItems="flex-start">
        <text font="mono" semantic={{ name: "plain" }}>
          Hi
        </text>
        <text font="mono" bold semantic={{ name: "heavy" }}>
          Hi
        </text>
        <text font="mono" italic semantic={{ name: "slant" }}>
          Hi
        </text>
      </box>
    ));
    ui.frame();
    const plain = ui.inspect().find((n) => n.name === "plain")!.bounds;
    const heavy = ui.inspect().find((n) => n.name === "heavy")!.bounds;
    const slant = ui.inspect().find((n) => n.name === "slant")!.bounds;
    expect(heavy.width).toBe(plain.width + 2);
    expect(slant.width).toBe(plain.width + 2);
  });

  it("shears Geneva 9 italic so the top ink sits right of the stem", () => {
    const screen = newBitMap(64, 24);
    const ui = createUI({ screen });
    ui.render(() => (
      <text font="body" italic>
        I
      </text>
    ));
    ui.frame();
    const width = bitMapWidth(screen);
    const pixels = pixelsFromBitMap(screen);
    let minY = 24;
    let maxY = -1;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x]) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    expect(maxY).toBeGreaterThan(minY);
    const firstInk = (y: number): number => {
      for (let x = 0; x < width; x++) if (pixels[y * width + x]) return x;
      return -1;
    };
    expect(firstInk(minY)).toBeGreaterThan(firstInk(maxY));
  });

  it("lays out two extra pixels per glyph for outline", () => {
    const ui = createUI({ screen: newBitMap(200, 80) });
    ui.render(() => (
      <box flexDirection="column" alignItems="flex-start">
        <text font="mono" semantic={{ name: "plain" }}>
          Hi
        </text>
        <text font="mono" outline semantic={{ name: "ring" }}>
          Hi
        </text>
      </box>
    ));
    ui.frame();
    const plain = ui.inspect().find((n) => n.name === "plain")!.bounds;
    const ring = ui.inspect().find((n) => n.name === "ring")!.bounds;
    expect(ring.width).toBe(plain.width + 4);
    expect(ring.height).toBe(plain.height + 2);
  });

  it("paints a 1px hollow ring around I, not a bold smear", () => {
    const boxOf = (screen: ReturnType<typeof newBitMap>) => {
      const W = bitMapWidth(screen);
      const H = 32;
      const pixels = pixelsFromBitMap(screen);
      let minX = W;
      let maxX = -1;
      let minY = H;
      let maxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!pixels[y * W + x]) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, pixels, W };
    };

    const plainScreen = newBitMap(48, 32);
    const ringScreen = newBitMap(48, 32);
    const boldScreen = newBitMap(48, 32);
    const plainUi = createUI({ screen: plainScreen });
    const ringUi = createUI({ screen: ringScreen });
    const boldUi = createUI({ screen: boldScreen });
    plainUi.render(() => <text font="genova12">I</text>);
    ringUi.render(() => (
      <text font="genova12" outline>
        I
      </text>
    ));
    boldUi.render(() => (
      <text font="genova12" bold>
        I
      </text>
    ));
    plainUi.frame();
    ringUi.frame();
    boldUi.frame();

    const plain = boxOf(plainScreen);
    const ring = boxOf(ringScreen);
    const heavy = boxOf(boldScreen);
    expect(ring.w).toBe(plain.w + 2);
    expect(ring.h).toBe(plain.h + 2);
    expect(heavy.w).toBe(plain.w + 1);
    const cx = Math.floor((ring.minX + ring.maxX) / 2);
    const cy = Math.floor((ring.minY + ring.maxY) / 2);
    const at = (x: number, y: number) => ring.pixels[y * ring.W + x]!;
    expect(at(cx, cy)).toBe(0);
    expect(at(cx, ring.minY)).toBe(1);
    expect(at(cx, ring.maxY)).toBe(1);
    expect(at(ring.minX, cy)).toBe(1);
    expect(at(ring.maxX, cy)).toBe(1);
  });

  it("fills the stem with the inverse of the text color", () => {
    const screen = newBitMap(48, 32);
    const ui = createUI({ screen });
    ui.render(() => (
      <box background={1} padding={4}>
        <text font="genova12" outline color={0} semantic={{ name: "ghost" }}>
          I
        </text>
      </box>
    ));
    ui.frame();
    const node = ui.inspect().find((n) => n.name === "ghost")!.bounds;
    const W = bitMapWidth(screen);
    const pixels = pixelsFromBitMap(screen);
    let minX = node.x + node.width;
    let maxX = node.x - 1;
    let minY = node.y + node.height;
    let maxY = node.y - 1;
    for (let y = node.y; y < node.y + node.height; y++) {
      for (let x = node.x; x < node.x + node.width; x++) {
        if (pixels[y * W + x] !== 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    expect(maxX).toBeGreaterThan(minX + 1);
    expect(maxY).toBeGreaterThan(minY + 1);
    const cx = Math.floor((minX + maxX) / 2);
    const cy = Math.floor((minY + maxY) / 2);
    expect(pixels[cy * W + cx]).toBe(1);
    expect(pixels[minY * W + cx]).toBe(0);
    expect(pixels[maxY * W + cx]).toBe(0);
    expect(pixels[cy * W + minX]).toBe(0);
    expect(pixels[cy * W + maxX]).toBe(0);
  });

  it("lays out a south-east drop for shadow, alone and with outline", () => {
    const ui = createUI({ screen: newBitMap(220, 80) });
    ui.render(() => (
      <box flexDirection="column" alignItems="flex-start">
        <text font="mono" semantic={{ name: "plain" }}>
          Hi
        </text>
        <text font="mono" shadow semantic={{ name: "drop" }}>
          Hi
        </text>
        <text font="mono" outline shadow semantic={{ name: "ringDrop" }}>
          Hi
        </text>
        <text font="mono" bold italic outline shadow semantic={{ name: "all" }}>
          Hi
        </text>
      </box>
    ));
    ui.frame();
    const plain = ui.inspect().find((n) => n.name === "plain")!.bounds;
    const drop = ui.inspect().find((n) => n.name === "drop")!.bounds;
    const ringDrop = ui.inspect().find((n) => n.name === "ringDrop")!.bounds;
    const all = ui.inspect().find((n) => n.name === "all")!.bounds;
    expect(drop.width).toBe(plain.width + 6);
    expect(drop.height).toBe(plain.height + 3);
    expect(ringDrop.width).toBe(plain.width + 6);
    expect(ringDrop.height).toBe(plain.height + 3);
    expect(all.width).toBe(plain.width + 10);
    expect(all.height).toBe(plain.height + 3);
  });

  it("paints shadow as outline plus a 1px south-east drop", () => {
    const ringScreen = newBitMap(48, 32);
    const dropScreen = newBitMap(48, 32);
    const ringUi = createUI({ screen: ringScreen });
    const dropUi = createUI({ screen: dropScreen });
    ringUi.render(() => (
      <text font="genova12" outline>
        I
      </text>
    ));
    dropUi.render(() => (
      <text font="genova12" shadow>
        I
      </text>
    ));
    ringUi.frame();
    dropUi.frame();
    const boxOf = (screen: ReturnType<typeof newBitMap>) => {
      const W = bitMapWidth(screen);
      const pixels = pixelsFromBitMap(screen);
      let minX = W;
      let maxX = -1;
      let minY = 32;
      let maxY = -1;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < W; x++) {
          if (!pixels[y * W + x]) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, pixels, W };
    };
    const ring = boxOf(ringScreen);
    const drop = boxOf(dropScreen);
    expect(drop.minX).toBe(ring.minX);
    expect(drop.minY).toBe(ring.minY);
    expect(drop.w).toBe(ring.w + 1);
    expect(drop.h).toBe(ring.h + 1);
    const cx = Math.floor((drop.minX + drop.maxX) / 2);
    const cy = Math.floor((drop.minY + drop.maxY) / 2);
    expect(drop.pixels[cy * drop.W + cx]).toBe(0);
  });
});
