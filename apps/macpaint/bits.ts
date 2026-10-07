/**
 * The small PaintAsm.a / MyTools.a utilities MacPaint.p leaned on beside
 * QuickDraw: rect and point arithmetic, whole-buffer operations
 * (`BufToBuf`, `BufOrBuf`, …) and bitmap allocation.
 */

import { MapPt, MapRect, type BitMap, type Pattern, type Point, type Rect } from "@mockintosh/quickdraw";

export function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { top, left, bottom, right };
}

export function pt(h: number, v: number): Point {
  return { h, v };
}

export function copyRect(r: Rect): Rect {
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}

export function copyPt(p: Point): Point {
  return { h: p.h, v: p.v };
}

export function equalPt(a: Point, b: Point): boolean {
  return a.h === b.h && a.v === b.v;
}

export function equalRect(a: Rect, b: Rect): boolean {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}

export function emptyRect(r: Rect): boolean {
  return r.bottom <= r.top || r.right <= r.left;
}

export function offsetRect(r: Rect, dh: number, dv: number): Rect {
  return { top: r.top + dv, left: r.left + dh, bottom: r.bottom + dv, right: r.right + dh };
}

export function insetRect(r: Rect, dh: number, dv: number): Rect {
  return { top: r.top + dv, left: r.left + dh, bottom: r.bottom - dv, right: r.right - dh };
}

/** `SectRect`: the intersection, or `(0,0,0,0)` when they don't meet. */
export function sectRect(a: Rect, b: Rect): Rect {
  const r = rect(Math.max(a.left, b.left), Math.max(a.top, b.top), Math.min(a.right, b.right), Math.min(a.bottom, b.bottom));
  return emptyRect(r) ? rect(0, 0, 0, 0) : r;
}

export function ptInRect(p: Point, r: Rect): boolean {
  return p.h >= r.left && p.h < r.right && p.v >= r.top && p.v < r.bottom;
}

/** `Pt2Rect`: the rectangle with `a` and `b` at opposite corners. */
export function pt2Rect(a: Point, b: Point): Rect {
  return rect(Math.min(a.h, b.h), Math.min(a.v, b.v), Math.max(a.h, b.h), Math.max(a.v, b.v));
}

/** `MapPt`, returning a new point. */
export function mapPt(p: Point, src: Rect, dst: Rect): Point {
  const out = copyPt(p);
  MapPt(out, src, dst);
  return out;
}

/** `MapRect`, returning a new rect. */
export function mapRect(r: Rect, src: Rect, dst: Rect): Rect {
  const out = copyRect(r);
  MapRect(out, src, dst);
  return out;
}

/** `Trunc8`: truncate toward zero to a multiple of 8. */
export function trunc8(i: number): number {
  return i < 0 ? -((-i) & ~7) : i & ~7;
}

/** Pascal `DIV`: integer division truncating toward zero. */
export function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

export function pinWord(i: number, min: number, max: number): number {
  return i < min ? min : i > max ? max : i;
}

/** `PinPt`: keep `p` inside `r` (right and bottom inclusive, as MyTools does). */
export function pinPt(p: Point, r: Rect): Point {
  return pt(pinWord(p.h, r.left, r.right), pinWord(p.v, r.top, r.bottom));
}

/** `NearPt`: both coordinates closer than `tol`. */
export function nearPt(a: Point, b: Point, tol: number): boolean {
  return Math.abs(a.h - b.h) < tol && Math.abs(a.v - b.v) < tol;
}

// ---------------------------------------------------------------------------
// Bitmaps
// ---------------------------------------------------------------------------

/** A zeroed bitmap over `bounds`; rows are word-aligned like the Toolbox's. */
export function newBits(bounds: Rect, rowBytes = ((bounds.right - bounds.left + 15) >> 4) << 1): BitMap {
  return { baseAddr: new Uint8Array(rowBytes * (bounds.bottom - bounds.top)), rowBytes, bounds: copyRect(bounds) };
}

/** `PixelTrue(h, v, bits)`: the pixel at local `(h, v)`; false outside `bounds`. */
export function pixelTrue(h: number, v: number, bits: BitMap): boolean {
  const { bounds } = bits;
  if (h < bounds.left || h >= bounds.right || v < bounds.top || v >= bounds.bottom) return false;
  const x = h - bounds.left;
  return ((bits.baseAddr[(v - bounds.top) * bits.rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1) === 1;
}

export function zeroBuf(bits: BitMap): void {
  bits.baseAddr.fill(0);
}

export function invertBuf(bits: BitMap): void {
  const a = bits.baseAddr;
  for (let i = 0; i < a.length; i++) a[i] = ~a[i]! & 0xff;
}

export function bufToBuf(src: BitMap, dst: BitMap): void {
  dst.baseAddr.set(src.baseAddr);
}

export function bufOrBuf(src: BitMap, dst: BitMap): void {
  const s = src.baseAddr;
  const d = dst.baseAddr;
  for (let i = 0; i < d.length; i++) d[i] = d[i]! | s[i]!;
}

export function bufXorBuf(src: BitMap, dst: BitMap): void {
  const s = src.baseAddr;
  const d = dst.baseAddr;
  for (let i = 0; i < d.length; i++) d[i] = d[i]! ^ s[i]!;
}

export function bufAndBuf(src: BitMap, dst: BitMap): void {
  const s = src.baseAddr;
  const d = dst.baseAddr;
  for (let i = 0; i < d.length; i++) d[i] = d[i]! & s[i]!;
}

/** `SwapBuf`: exchange the pixels of two same-sized buffers. */
export function swapBuf(a: BitMap, b: BitMap): void {
  const tmp = a.baseAddr.slice();
  a.baseAddr.set(b.baseAddr);
  b.baseAddr.set(tmp);
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export function patternFromHex(hex: string): Pattern {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const white: Pattern = patternFromHex("0000000000000000");
export const gray: Pattern = patternFromHex("aa55aa55aa55aa55");
export const ltGray: Pattern = patternFromHex("8822882288228822");

export function equalPattern(a: Pattern, b: Pattern): boolean {
  for (let i = 0; i < 8; i++) if (a[i] !== b[i]) return false;
  return true;
}
