/**
 * The OS cursor compositor: QuickDraw owns *which* cursor is current;
 * `drawCursor` paints it mask-then-data like the ROM's VBL task did.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  GetPixel,
  HideCursor,
  InitCursor,
  InitGraf,
  OpenPort,
  PaintRect,
  SetCursor,
  ShowCursor,
  type GrafPort,
} from "@mockintosh/quickdraw";
import { makeRect, newBitMap } from "@mockintosh/quickdraw/bits";
import { drawCursor, liveCursor } from "./cursor";
import { cursors } from "./cursors";

const WIDTH = 64;
const HEIGHT = 48;

function bit(words: Uint16Array, v: number, h: number): boolean {
  return ((words[v] >> (15 - h)) & 1) === 1;
}

describe("drawCursor", () => {
  let port: GrafPort;

  beforeEach(() => {
    InitGraf(newBitMap(WIDTH, HEIGHT));
    port = {} as GrafPort;
    OpenPort(port);
    InitCursor();
  });

  it("draws the arrow with its hot spot at the pointer, mask punching out a black background", () => {
    PaintRect(makeRect(0, 0, HEIGHT, WIDTH));
    const x = 20;
    const y = 10;
    drawCursor(port, x, y);

    const { data, mask, hotSpot } = cursors.arrow;
    for (let v = 0; v < 16; v++) {
      for (let h = 0; h < 16; h++) {
        const sx = x - hotSpot.h + h;
        const sy = y - hotSpot.v + v;
        // Inside the mask: exactly the data bits. Outside: the black background survives.
        const expected = bit(mask, v, h) ? bit(data, v, h) : true;
        expect(GetPixel(sx, sy), `pixel (${sx}, ${sy})`).toBe(expected);
      }
    }
  });

  it("paints whatever SetCursor selected", () => {
    SetCursor(cursors.watch);
    drawCursor(port, 16, 16);
    const { data, hotSpot } = cursors.watch;
    let drewSomething = false;
    for (let v = 0; v < 16; v++) {
      for (let h = 0; h < 16; h++) {
        if (!bit(data, v, h)) continue;
        drewSomething = true;
        expect(GetPixel(16 - hotSpot.h + h, 16 - hotSpot.v + v)).toBe(true);
      }
    }
    expect(drewSomething).toBe(true);
  });

  it("clips at the screen edge instead of wrapping", () => {
    drawCursor(port, WIDTH - 2, HEIGHT - 2);
    // Nothing may appear on the far side of the screen.
    for (let v = 0; v < HEIGHT; v++) expect(GetPixel(0, v)).toBe(false);
    for (let h = 0; h < WIDTH; h++) expect(GetPixel(h, 0)).toBe(false);
  });

  it("honors HideCursor / ShowCursor", () => {
    HideCursor();
    expect(liveCursor()).toBeUndefined();
    drawCursor(port, 20, 20);
    for (let v = 0; v < HEIGHT; v++) for (let h = 0; h < WIDTH; h++) expect(GetPixel(h, v)).toBe(false);

    ShowCursor();
    expect(liveCursor()).toBeDefined();
    drawCursor(port, 20, 20);
    expect(GetPixel(20, 20)).toBe(true);
  });
});
