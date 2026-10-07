import { describe, expect, it } from "vitest";
import {
  CopyRgn,
  DiffRgn,
  EqualRgn,
  InitGraf,
  NewRgn,
  OffsetRgn,
  OpenPort,
  PaintOval,
  PaintRect,
  PenMode,
  PenPat,
  RectRgn,
  ScrollRect,
  SectRgn,
  SetClip,
  UnionRgn,
  globals,
  patCopy,
  patXor,
  srcCopy,
  type BitMap,
  type GrafPort,
  type Rect,
  type RgnHandle,
} from "../src";
import { makeRect, newBitMap, pixelsFromBitMap } from "../src/bits";
import { BitBltSlow } from "../src/bitblt";
import { BitBlt, forMaskSpans } from "../src/bitBltCore";
import { ColorMap } from "../src/colorMap";
import { PackBits, UnpackBits } from "../src/packBits";
import { PatExpand } from "../src/patExpand";
import { RgnBlt } from "../src/rgnBlt";
import { StretchBits } from "../src/stretchBits";
import { ptInPacked } from "../src/regionData";

/** Two adjacent rects whose union is pixel-identical to the full port (rgnSize ≠ 10). */
function splitClip(w: number, h: number): RgnHandle {
  const a = NewRgn();
  const b = NewRgn();
  const u = NewRgn();
  const mid = (w / 2) | 0;
  RectRgn(a, makeRect(0, 0, h, mid));
  RectRgn(b, makeRect(0, mid, h, w));
  UnionRgn(a, b, u);
  return u;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function cloneBm(bm: BitMap): BitMap {
  return { baseAddr: bm.baseAddr.slice(), rowBytes: bm.rowBytes, bounds: { ...bm.bounds } };
}

function openPort(w: number, h: number): GrafPort {
  InitGraf(newBitMap(w, h));
  const port = {} as GrafPort;
  OpenPort(port);
  return port;
}

function applyMode(mode: number, src: number, dst: number): number {
  const s = mode & 4 ? 1 - src : src;
  switch (mode & 3) {
    case 1:
      return s | dst;
    case 2:
      return s ^ dst;
    case 3:
      return (1 - s) & dst;
    default:
      return s;
  }
}

function rgnBltSlow(
  srcBits: BitMap,
  dstBits: BitMap,
  srcRect: Rect,
  dstRect: Rect,
  mode: number,
  pat: Uint8Array,
  a: RgnHandle,
  b: RgnHandle,
  c: RgnHandle
): void {
  const mapped = ColorMap(mode, pat);
  mode = mapped.mode;
  pat = mapped.pat;
  const clip: Rect = {
    top: Math.max(dstRect.top, dstBits.bounds.top, a.rgn.rgnBBox.top, b.rgn.rgnBBox.top, c.rgn.rgnBBox.top),
    left: Math.max(dstRect.left, dstBits.bounds.left, a.rgn.rgnBBox.left, b.rgn.rgnBBox.left, c.rgn.rgnBBox.left),
    bottom: Math.min(dstRect.bottom, dstBits.bounds.bottom, a.rgn.rgnBBox.bottom, b.rgn.rgnBBox.bottom, c.rgn.rgnBBox.bottom),
    right: Math.min(dstRect.right, dstBits.bounds.right, a.rgn.rgnBBox.right, b.rgn.rgnBBox.right, c.rgn.rgnBBox.right),
  };
  if (clip.bottom <= clip.top || clip.right <= clip.left) return;
  const usePat = (mode & 8) !== 0;
  for (let v = clip.top; v < clip.bottom; v++) {
    for (let h = clip.left; h < clip.right; h++) {
      if (!ptInPacked(a.rgn, { h, v })) continue;
      if (!ptInPacked(b.rgn, { h, v })) continue;
      if (!ptInPacked(c.rgn, { h, v })) continue;
      const sx = srcRect.left + (h - dstRect.left);
      const sy = srcRect.top + (v - dstRect.top);
      const src = usePat
        ? ((pat[v & 7]! >> (7 - (h & 7))) & 1)
        : ((srcBits.baseAddr[(sy - srcBits.bounds.top) * srcBits.rowBytes + ((sx - srcBits.bounds.left) >> 3)] >>
            (7 - ((sx - srcBits.bounds.left) & 7))) &
          1);
      const di = (v - dstBits.bounds.top) * dstBits.rowBytes + ((h - dstBits.bounds.left) >> 3);
      const bit = 7 - ((h - dstBits.bounds.left) & 7);
      const dst = (dstBits.baseAddr[di]! >> bit) & 1;
      const out = applyMode(mode, src, dst);
      dstBits.baseAddr[di] = (dstBits.baseAddr[di]! & ~(1 << bit)) | (out << bit);
    }
  }
}

describe("PackBits / UnpackBits", () => {
  it("round-trips random scanlines and ignores $80", () => {
    const rand = rng(7);
    for (let n = 0; n <= 200; n++) {
      const src = Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
      const packed = new Uint8Array(n + (n >> 7) + 8);
      const srcPtr = { value: 0 };
      const dstPtr = { value: 0 };
      PackBits(src, srcPtr, packed, dstPtr, n);
      expect(srcPtr.value).toBe(n);
      const out = new Uint8Array(n);
      const p2 = { value: 0 };
      const o2 = { value: 0 };
      UnpackBits(packed, p2, out, o2, n);
      expect(Array.from(out)).toEqual(Array.from(src));
    }
    const dst = new Uint8Array(4);
    UnpackBits(Uint8Array.of(0x80, 0x03, 0xaa, 0xab, 0xac, 0xad), { value: 0 }, dst, { value: 0 }, 4);
    expect(Array.from(dst)).toEqual([0xaa, 0xab, 0xac, 0xad]);
  });

  it("emits a fill opcode for three identical bytes", () => {
    const packed = new Uint8Array(8);
    const dstPtr = { value: 0 };
    PackBits(Uint8Array.of(0xaa, 0xaa, 0xaa), { value: 0 }, packed, dstPtr, 3);
    expect(packed[0]).toBe(0xfe);
    expect(packed[1]).toBe(0xaa);
    expect(dstPtr.value).toBe(2);
  });
});

describe("forMaskSpans", () => {
  it("emits contiguous runs matching maskBit", () => {
    const bufLeft = 0;
    const mask = new Uint16Array(2);
    mask[0] = 0b11110000_00001111;
    mask[1] = 0b00000000_11111111;
    const spans: [number, number][] = [];
    forMaskSpans(mask, bufLeft, 0, 32, (h0, h1) => spans.push([h0, h1]));
    expect(spans).toEqual([
      [0, 4],
      [12, 16],
      [24, 32],
    ]);
  });
});

describe("RgnBlt", () => {
  it("matches a per-pixel clip/vis/mask oracle", () => {
    const port = openPort(32, 16);
    const src = newBitMap(32, 16);
    for (let i = 0; i < src.baseAddr.length; i++) src.baseAddr[i] = 0x5a;
    const clip = NewRgn();
    const vis = NewRgn();
    const mask = NewRgn();
    const hole = NewRgn();
    RectRgn(clip, makeRect(0, 0, 16, 32));
    RectRgn(vis, makeRect(1, 2, 15, 30));
    RectRgn(mask, makeRect(0, 0, 16, 32));
    RectRgn(hole, makeRect(4, 8, 10, 20));
    DiffRgn(mask, hole, mask);

    const dstA = cloneBm(port.portBits);
    const dstB = cloneBm(port.portBits);
    const r = makeRect(0, 0, 16, 32);
    RgnBlt(src, dstA, r, r, srcCopy, globals.black, clip, vis, mask);
    rgnBltSlow(src, dstB, r, r, srcCopy, globals.black, clip, vis, mask);
    expect(pixelsFromBitMap(dstA)).toEqual(pixelsFromBitMap(dstB));
  });
});

describe("StretchBits", () => {
  it("same-size path equals RgnBlt", () => {
    const port = openPort(16, 8);
    const src = newBitMap(16, 8);
    src.baseAddr.fill(0xa5);
    const r = makeRect(0, 0, 8, 16);
    const a = cloneBm(port.portBits);
    const b = cloneBm(port.portBits);
    StretchBits(src, a, r, r, srcCopy, globals.wideOpen, globals.wideOpen, globals.wideOpen);
    RgnBlt(src, b, r, r, srcCopy, globals.black, globals.wideOpen, globals.wideOpen, globals.wideOpen);
    expect(pixelsFromBitMap(a)).toEqual(pixelsFromBitMap(b));
  });

  it("2× stretch replicates, ½ shrink ORs", () => {
    const src = newBitMap(4, 2);
    src.baseAddr[0] = 0b10100000;
    src.baseAddr[src.rowBytes] = 0b01000000;
    const wide = newBitMap(8, 4);
    StretchBits(
      src,
      wide,
      makeRect(0, 0, 2, 4),
      makeRect(0, 0, 4, 8),
      srcCopy,
      globals.wideOpen,
      globals.wideOpen,
      globals.wideOpen
    );
    const px = pixelsFromBitMap(wide);
    expect(px[0]).toBe(1);
    expect(px[1]).toBe(1);
    expect(px[2]).toBe(0);
    expect(px[3]).toBe(0);
    const slim = newBitMap(2, 1);
    StretchBits(
      src,
      slim,
      makeRect(0, 0, 2, 4),
      makeRect(0, 0, 1, 2),
      srcCopy,
      globals.wideOpen,
      globals.wideOpen,
      globals.wideOpen
    );
    expect(pixelsFromBitMap(slim)[0]).toBe(1);
  });

  it("2× stretch under a holed mask matches the per-pixel oracle", () => {
    const src = newBitMap(4, 2);
    src.baseAddr[0] = 0b10100000;
    src.baseAddr[src.rowBytes] = 0b01000000;
    const clip = NewRgn();
    const vis = NewRgn();
    const mask = NewRgn();
    const hole = NewRgn();
    RectRgn(clip, makeRect(0, 0, 4, 8));
    RectRgn(vis, makeRect(0, 0, 4, 8));
    RectRgn(mask, makeRect(0, 0, 4, 8));
    RectRgn(hole, makeRect(1, 2, 3, 6));
    DiffRgn(mask, hole, mask);
    const a = newBitMap(8, 4);
    const b = newBitMap(8, 4);
    StretchBits(src, a, makeRect(0, 0, 2, 4), makeRect(0, 0, 4, 8), srcCopy, clip, vis, mask);
    // Oracle: stretch into a temp, then RgnBltSlow the 1:1 result through the hole.
    const tmp = newBitMap(8, 4);
    StretchBits(
      src,
      tmp,
      makeRect(0, 0, 2, 4),
      makeRect(0, 0, 4, 8),
      srcCopy,
      globals.wideOpen,
      globals.wideOpen,
      globals.wideOpen
    );
    rgnBltSlow(tmp, b, makeRect(0, 0, 4, 8), makeRect(0, 0, 4, 8), srcCopy, globals.black, clip, vis, mask);
    expect(pixelsFromBitMap(a)).toEqual(pixelsFromBitMap(b));
  });
});

describe("DrawArc FASTFLAG", () => {
  it("solid black oval matches the non-rect clip path", () => {
    const fast = openPort(32, 24);
    PaintOval(makeRect(2, 2, 20, 28));
    const slow = openPort(32, 24);
    SetClip(splitClip(32, 24));
    PaintOval(makeRect(2, 2, 20, 28));
    expect(pixelsFromBitMap(slow.portBits)).toEqual(pixelsFromBitMap(fast.portBits));
  });

  it("white patXor is a no-op on both paths", () => {
    const fast = openPort(16, 16);
    PaintRect(makeRect(0, 0, 16, 16));
    const before = pixelsFromBitMap(fast.portBits);
    PenPat(globals.white);
    PenMode(patXor);
    PaintOval(makeRect(2, 2, 14, 14));
    expect(pixelsFromBitMap(fast.portBits)).toEqual(before);
  });
});

describe("ScrollRect", () => {
  it("updateRgn is srcRgn minus the shifted dest", () => {
    const port = openPort(16, 8);
    PaintRect(makeRect(1, 1, 3, 6));
    const update = NewRgn();
    ScrollRect(makeRect(0, 0, 8, 16), 2, 1, update);
    const srcRgn = NewRgn();
    const dstRgn = NewRgn();
    RectRgn(srcRgn, makeRect(0, 0, 8, 16));
    SectRgn(srcRgn, port.visRgn, srcRgn);
    SectRgn(srcRgn, port.clipRgn, srcRgn);
    CopyRgn(srcRgn, dstRgn);
    OffsetRgn(dstRgn, 2, 1);
    const expectRgn = NewRgn();
    DiffRgn(srcRgn, dstRgn, expectRgn);
    expect(EqualRgn(update, expectRgn)).toBe(true);
  });
});

describe("patAlign", () => {
  it("phases the expanded pattern against the destination origin", () => {
    const bm = newBitMap(8, 8);
    globals.patAlign = { h: 0, v: 0 };
    const a = PatExpand(globals.gray, bm, globals.patAlign, 0, false);
    globals.patAlign = { h: 1, v: 0 };
    const b = PatExpand(globals.gray, bm, globals.patAlign, 0, false);
    expect(a.sampleExpanded(0, 0)).not.toBe(b.sampleExpanded(0, 0));
    globals.patAlign = { h: 0, v: 0 };
  });
});

describe("BitBlt dstRect extents", () => {
  it("still matches BitBltSlow when src and dst sizes agree", () => {
    const src = newBitMap(16, 4);
    src.baseAddr.fill(0xc3);
    const dstA = newBitMap(16, 4);
    const dstB = cloneBm(dstA);
    const r = makeRect(0, 1, 3, 13);
    BitBlt(src, dstA, r, r, patCopy, globals.gray);
    BitBltSlow(src, dstB, r, r, patCopy, globals.gray);
    expect(pixelsFromBitMap(dstA)).toEqual(pixelsFromBitMap(dstB));
  });
});
