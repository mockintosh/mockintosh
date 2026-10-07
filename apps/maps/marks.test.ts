import { describe, expect, it } from "vitest";
import { InitGraf, OpenPort, PaintRect, RectRgn, type GrafPort } from "@mockintosh/quickdraw";
import { getBit, newBitMap } from "@mockintosh/quickdraw/bits";
import { drawCompass } from "./marks";

describe("drawCompass", () => {
  /** A port over a bitmap `size` square, all black: what's under the compass. */
  function blackPort(size: number) {
    const bits = newBitMap(size, size);
    InitGraf(bits);
    const port = {} as GrafPort;
    OpenPort(port);
    port.portBits = bits;
    port.portRect = { ...bits.bounds };
    RectRgn(port.visRgn, bits.bounds);
    RectRgn(port.clipRgn, bits.bounds);
    PaintRect(bits.bounds);
    return { bits, port };
  }

  it("draws only the dial: outside its ring, what's under it shows", () => {
    const { bits, port } = blackPort(21);
    drawCompass(port, 0, 0, 21, 0);
    // The corners are still the black under it.
    for (const [x, y] of [[0, 0], [20, 0], [0, 20], [20, 20], [1, 1], [19, 19]] as const) expect(getBit(bits, x, y), `${x},${y}`).toBe(1);
    // Inside the ring it's white, but for the needle.
    expect(getBit(bits, 4, 10)).toBe(0);
    expect(getBit(bits, 16, 10)).toBe(0);
    // Facing north, the needle's black half points up the middle, its outlined half down.
    expect(getBit(bits, 10, 4)).toBe(1);
    expect(getBit(bits, 10, 14)).toBe(0);
  });

  it("turns its needle with the view", () => {
    const { bits, port } = blackPort(21);
    // Turned a quarter clockwise, north is to the left on the screen.
    drawCompass(port, 0, 0, 21, Math.PI / 2);
    expect(getBit(bits, 4, 10)).toBe(1);
    expect(getBit(bits, 10, 4)).toBe(0);
  });
});
