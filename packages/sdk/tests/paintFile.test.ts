import { describe, expect, it } from "vitest";
import {
  PAINT_HEIGHT,
  PAINT_ROW_BYTES,
  blankPaintDocument,
  decodePaint,
  encodePaint,
  packBits,
  paintToSprite,
  unpackBits,
} from "../src/paintFile";

describe("PackBits", () => {
  it("round-trips runs and literals", () => {
    const src = Uint8Array.from([1, 1, 1, 1, 2, 3, 4, 4, 5, 5, 5, ...new Array(200).fill(9), 7]);
    const packed = packBits(src);
    const out = new Uint8Array(src.length);
    expect(unpackBits(packed, 0, out)).toBe(packed.length);
    expect(out).toEqual(src);
  });

  it("packs a blank MacPaint row as BlankDoc does: fill 72 of zero", () => {
    expect(Array.from(packBits(new Uint8Array(PAINT_ROW_BYTES)))).toEqual([0xb9, 0]);
  });
});

describe("MacPaint documents", () => {
  it("round-trip bits and patterns", () => {
    const patterns = new Uint8Array(38 * 8).map((_, i) => i);
    const doc = blankPaintDocument(patterns);
    doc.bits[0] = 0x80;
    doc.bits[PAINT_ROW_BYTES * PAINT_HEIGHT - 1] = 0x01;
    const bytes = encodePaint(doc);
    expect(bytes.length % 512).toBe(0);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 0, 0, 2]);
    const back = decodePaint(bytes);
    expect(back.bits).toEqual(doc.bits);
    expect(back.patterns).toEqual(patterns);
    const sprite = paintToSprite(back);
    expect(sprite.data[0]).toBe(1);
    expect(sprite.data[1]).toBe(0);
    expect(sprite.data[sprite.data.length - 1]).toBe(1);
  });

  it("reads version 0 files as having no patterns", () => {
    const bytes = encodePaint(blankPaintDocument());
    expect(decodePaint(bytes).patterns).toBeNull();
  });

  it("skips a MacBinary wrapper", () => {
    const inner = encodePaint(blankPaintDocument());
    const wrapped = new Uint8Array(128 + inner.length);
    wrapped.set([..."PNTG"].map((c) => c.charCodeAt(0)), 65);
    wrapped.set(inner, 128);
    expect(decodePaint(wrapped).bits.every((b) => b === 0)).toBe(true);
  });

  it("rejects a truncated file", () => {
    expect(() => decodePaint(new Uint8Array(100))).toThrow();
  });
});
