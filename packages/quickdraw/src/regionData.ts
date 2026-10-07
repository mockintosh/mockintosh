/**
 * Packed region stream helpers. The encoding is `V H…H 32767` rows
 * terminated by `V=32767` (`PackRgn.a:13-19`).
 */

import type { Point, Rect, Region, RgnHandle } from "./types";

export const RGN_END = 32767;

export const EMPTY_DATA = new Int16Array(0);

export function isRectRgn(rgn: Region): boolean {
  return rgn.rgnSize === 10;
}

export function rgnByteSize(data: Int16Array): number {
  return data.length === 0 ? 10 : 10 + data.length * 2;
}

/** Fake 18-byte expansion of a rectangle (`RgnOp.a:258-281`). */
export function expandRectData(bbox: Rect): Int16Array {
  return Int16Array.from([
    bbox.top,
    bbox.left,
    bbox.right,
    RGN_END,
    bbox.bottom,
    bbox.left,
    bbox.right,
    RGN_END,
    RGN_END,
  ]);
}

/** Region data pointer: rectangular regions expand; complex ones use `data`. */
export function regionStream(rgn: Region): Int16Array {
  if (isRectRgn(rgn)) return expandRectData(rgn.rgnBBox);
  return rgn.data;
}

export function emptyRegion(): Region {
  return {
    rgnSize: 10,
    rgnBBox: { top: 0, left: 0, bottom: 0, right: 0 },
    data: EMPTY_DATA,
  };
}

export function rectRegion(r: Rect): Region {
  const empty = r.left >= r.right || r.top >= r.bottom;
  return {
    rgnSize: 10,
    rgnBBox: empty
      ? { top: 0, left: 0, bottom: 0, right: 0 }
      : { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
    data: EMPTY_DATA,
  };
}

/**
 * Walk each stored row of a packed stream. `onRow(v, hs)` receives the
 * H list *without* the 32767 terminator.
 */
export function walkRows(data: Int16Array, onRow: (v: number, hs: number[]) => void): void {
  let i = 0;
  while (i < data.length) {
    const v = data[i++];
    if (v === RGN_END) return;
    const hs: number[] = [];
    while (i < data.length && data[i] !== RGN_END) hs.push(data[i++]);
    if (i < data.length && data[i] === RGN_END) i++;
    onRow(v, hs);
  }
}

/**
 * `PtInRgn` for the packed encoding: XOR-toggle every inversion with
 * `V ≤ pt.v` and `H ≤ pt.h` (`Regions.a` / plan §3.2).
 */
export function ptInPacked(rgn: Region, pt: Point): boolean {
  const b = rgn.rgnBBox;
  if (pt.v < b.top || pt.v >= b.bottom || pt.h < b.left || pt.h >= b.right) return false;
  if (isRectRgn(rgn)) return true;
  let inside = false;
  walkRows(rgn.data, (v, hs) => {
    if (v > pt.v) return;
    for (const h of hs) if (h <= pt.h) inside = !inside;
  });
  return inside;
}

export function cloneRegionInto(src: Region, dst: Region): void {
  dst.rgnSize = src.rgnSize;
  dst.rgnBBox.top = src.rgnBBox.top;
  dst.rgnBBox.left = src.rgnBBox.left;
  dst.rgnBBox.bottom = src.rgnBBox.bottom;
  dst.rgnBBox.right = src.rgnBBox.right;
  dst.data = src.data.length === 0 ? EMPTY_DATA : Int16Array.from(src.data);
}

export function ensureRegionData(rgn: RgnHandle): void {
  if (!rgn.rgn.data) rgn.rgn.data = EMPTY_DATA;
}
