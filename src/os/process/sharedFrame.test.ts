import { describe, expect, it } from "vitest";
import { rowBytesFor } from "@mockintosh/quickdraw/bits";
import { publishSharedFrame, readSharedFrame, sharedFrameBytes, sharedFrameCount } from "./sharedFrame";

describe("shared frames", () => {
  it("hands the OS each picture the worker publishes, alternating slots", () => {
    const buffer = new SharedArrayBuffer(sharedFrameBytes(64, 20));
    expect(sharedFrameCount(buffer)).toBe(0);

    const rowBytes = rowBytesFor(20);
    const first = new Uint8Array(rowBytes * 10).fill(0xaa);
    publishSharedFrame(buffer, first, 20, 10, rowBytes, 7);
    expect(sharedFrameCount(buffer)).toBe(1);
    const a = readSharedFrame(buffer);
    expect(a.seq).toBe(7);
    expect(a.bits.bounds).toEqual({ top: 0, left: 0, bottom: 10, right: 20 });
    expect(Array.from(a.bits.baseAddr)).toEqual(Array.from(first));

    const second = new Uint8Array(rowBytesFor(64) * 20).fill(0x0f);
    publishSharedFrame(buffer, second, 64, 20, rowBytesFor(64), 9);
    const b = readSharedFrame(buffer);
    expect(sharedFrameCount(buffer)).toBe(2);
    expect(b.seq).toBe(9);
    expect(b.bits.bounds.right).toBe(64);
    expect(Array.from(b.bits.baseAddr)).toEqual(Array.from(second));
    // The first read was a copy: publishing again didn't change it.
    expect(a.bits.baseAddr[0]).toBe(0xaa);
  });
});
