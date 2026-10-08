import { describe, expect, it } from "vitest";
import { getBit, newBitMap, setBit } from "@mockintosh/quickdraw/bits";
import { cursorFromFace, cursorFromFaceCached } from "../src/cursorFace";
import {
  copyBitMapBytes,
  cursorStampRect,
  moveSoftwareCursor,
} from "../src/cursorComposite";
import { MAC_CURSOR_FACES } from "../src/cursors/mac";

function paintChecker(bm: ReturnType<typeof newBitMap>): void {
  const w = bm.bounds.right;
  const h = bm.bounds.bottom;
  for (let v = 0; v < h; v++) {
    for (let hpx = 0; hpx < w; hpx++) {
      setBit(bm, hpx, v, (hpx + v) & 1);
    }
  }
}

function bitsEqual(a: ReturnType<typeof newBitMap>, b: ReturnType<typeof newBitMap>): boolean {
  return a.baseAddr.every((byte, i) => byte === b.baseAddr[i]);
}

describe("moveSoftwareCursor", () => {
  it("stamps without mutating the clean frame", () => {
    const clean = newBitMap(48, 32);
    paintChecker(clean);
    const before = new Uint8Array(clean.baseAddr);
    const dest = newBitMap(48, 32);
    copyBitMapBytes(clean, dest);

    const cursor = cursorFromFace(MAC_CURSOR_FACES.arrow);
    const rect = moveSoftwareCursor(clean, dest, null, cursor, 20, 12);

    expect(rect).toEqual(cursorStampRect(20, 12, cursor.hotSpot));
    expect([...clean.baseAddr]).toEqual([...before]);
    expect(bitsEqual(clean, dest)).toBe(false);
    expect(getBit(dest, 20, 12)).toBe(1);
  });

  it("restores the previous stamp from the clean frame", () => {
    const clean = newBitMap(48, 32);
    paintChecker(clean);
    const dest = newBitMap(48, 32);
    copyBitMapBytes(clean, dest);
    const cursor = cursorFromFace(MAC_CURSOR_FACES.arrow);

    const first = moveSoftwareCursor(clean, dest, null, cursor, 10, 8);
    moveSoftwareCursor(clean, dest, first, cursor, 28, 16);

    const firstRect = cursorStampRect(10, 8, cursor.hotSpot);
    for (let v = firstRect.top; v < firstRect.bottom; v++) {
      for (let h = firstRect.left; h < firstRect.right; h++) {
        if (h < 0 || v < 0 || h >= 48 || v >= 32) continue;
        expect(getBit(dest, h, v), `restored (${h}, ${v})`).toBe(getBit(clean, h, v));
      }
    }
  });

  it("clears the stamp when the cursor is gone", () => {
    const clean = newBitMap(48, 32);
    paintChecker(clean);
    const dest = newBitMap(48, 32);
    copyBitMapBytes(clean, dest);
    const cursor = cursorFromFace(MAC_CURSOR_FACES.watch);
    const prev = moveSoftwareCursor(clean, dest, null, cursor, 16, 16);
    expect(moveSoftwareCursor(clean, dest, prev, undefined, 0, 0)).toBeNull();
    expect(bitsEqual(clean, dest)).toBe(true);
  });
});

describe("inverting cursors", () => {
  it("shows the I-beam white over black and black over white", () => {
    const face = MAC_CURSOR_FACES.iBeam;
    const cursor = cursorFromFace(face);
    // A pixel on the I-beam's stem, relative to the hot spot.
    const stem = { h: 7 - face.hotSpot.h, v: 6 - face.hotSpot.v };

    const white = newBitMap(32, 32);
    const onWhite = newBitMap(32, 32);
    moveSoftwareCursor(white, onWhite, null, cursor, 16, 16);
    expect(getBit(onWhite, 16 + stem.h, 16 + stem.v)).toBe(1);

    const black = newBitMap(32, 32);
    black.baseAddr.fill(0xff);
    const onBlack = newBitMap(32, 32);
    copyBitMapBytes(black, onBlack);
    moveSoftwareCursor(black, onBlack, null, cursor, 16, 16);
    expect(getBit(onBlack, 16 + stem.h, 16 + stem.v)).toBe(0);
    // Off the shape, the screen is untouched.
    expect(getBit(onBlack, 16 + stem.h - 3, 16 + stem.v)).toBe(1);
  });
});

describe("cursorFromFaceCached", () => {
  it("reuses the packed Cursor for a face", () => {
    const face = MAC_CURSOR_FACES.iBeam;
    expect(cursorFromFaceCached(face)).toBe(cursorFromFaceCached(face));
  });
});
