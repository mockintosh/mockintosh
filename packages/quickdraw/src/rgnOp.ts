/**
 * Boolean and inset operations on packed regions — from `RgnOp.a`
 * and `TrimRect` in `Regions.a:1006-1072`.
 *
 * Scans are sorted inversion lists terminated by 32767. RgnOp walks A and B
 * by next-V, XOR-updates each region's current scan, then emits only the
 * changes versus the previous output row.
 */

import type { Point, Rect } from "./types";
import { asInt16 } from "./fixmath";
import { PackRgn } from "./packRgn";
import { RGN_END, type RegionData } from "./regionTypes";

/** `RgnOp.a:19-23`. */
export const OP_SECT = 0;
export const OP_DIFF = 2;
export const OP_UNION = 4;
export const OP_XOR = 6;
export const OP_INSET = 8;

function scanWord(src: ArrayLike<number>, i: number): number {
  return i < src.length ? src[i]! | 0 : RGN_END;
}

/** Expand a rectangular region to an 18-byte inversion stream. `RgnOp.a:263-281`. */
function expand(rgn: RegionData): number[] {
  if (rgn.rgnSize !== 10) {
    const d = rgn.data;
    const out = new Array<number>(d.length);
    for (let i = 0; i < d.length; i++) out[i] = d[i]! | 0;
    return out;
  }
  const b = rgn.rgnBBox;
  return [
    b.top | 0,
    b.left | 0,
    b.right | 0,
    RGN_END,
    b.bottom | 0,
    b.left | 0,
    b.right | 0,
    RGN_END,
    RGN_END,
  ];
}

/**
 * `XorScan(srcA, srcB, dstC)` — merge two scans, cancelling equal pairs.
 * Returns the srcA index after the terminator (for walking region data).
 * `RgnOp.a:415-441`.
 */
export function XorScan(
  srcA: ArrayLike<number>,
  srcB: ArrayLike<number>,
  dst: number[],
  aStart = 0,
  bStart = 0
): number {
  dst.length = 0;
  let i = aStart;
  let j = bStart;
  let nextA = scanWord(srcA, i++);
  let nextB = scanWord(srcB, j++);
  for (;;) {
    if (nextA === nextB) {
      if (nextA === RGN_END) {
        dst.push(RGN_END);
        return i;
      }
      nextA = scanWord(srcA, i++);
      nextB = scanWord(srcB, j++);
    } else if (asInt16(nextA) < asInt16(nextB)) {
      dst.push(nextA);
      nextA = scanWord(srcA, i++);
    } else {
      dst.push(nextB);
      nextB = scanWord(srcB, j++);
    }
  }
}

/**
 * Shared loop for Sect / Diff / Union. `RgnOp.a:313-349`.
 * Initial states: SECT (0,0), DIFF (0,-1), UNION (-1,-1).
 */
function combineScan(
  srcA: ArrayLike<number>,
  srcB: ArrayLike<number>,
  dst: number[],
  aState: number,
  bState: number
): void {
  dst.length = 0;
  let i = 0;
  let j = 0;
  let nextA = scanWord(srcA, i++);
  let nextB = scanWord(srcB, j++);
  for (;;) {
    if (nextA === nextB) {
      if (nextA === RGN_END) break;
      if (aState === bState) dst.push(nextA);
      nextA = scanWord(srcA, i++);
      aState = ~aState | 0;
      nextB = scanWord(srcB, j++);
      bState = ~bState | 0;
    } else if (asInt16(nextA) < asInt16(nextB)) {
      if (bState) dst.push(nextA);
      nextA = scanWord(srcA, i++);
      aState = ~aState | 0;
    } else {
      if (aState) dst.push(nextB);
      nextB = scanWord(srcB, j++);
      bState = ~bState | 0;
    }
  }
  dst.push(RGN_END);
}

/** `PROCEDURE SectScan(srcA,srcB,dstC)`. `RgnOp.a:313-315`. */
export function SectScan(
  srcA: ArrayLike<number>,
  srcB: ArrayLike<number>,
  dst: number[]
): void {
  combineScan(srcA, srcB, dst, 0, 0);
}

/** `PROCEDURE DiffScan` — A minus B. `RgnOp.a:316-317`. */
export function DiffScan(
  srcA: ArrayLike<number>,
  srcB: ArrayLike<number>,
  dst: number[]
): void {
  combineScan(srcA, srcB, dst, 0, -1);
}

/** `PROCEDURE UnionScan`. `RgnOp.a:318-319`. */
export function UnionScan(
  srcA: ArrayLike<number>,
  srcB: ArrayLike<number>,
  dst: number[]
): void {
  combineScan(srcA, srcB, dst, -1, -1);
}

/**
 * `PROCEDURE InsetScan(src,dst,dh)`. Negative `dh` takes the OUTSET path
 * and merges overlapping spans. `RgnOp.a:352-410`.
 */
export function InsetScan(src: ArrayLike<number>, dst: number[], dh: number): void {
  dst.length = 0;
  const d = dh | 0;
  if (d < 0) {
    // OUTSET — merge if left <= oldRight. RgnOp.a:393-407
    let oldRight = -32767;
    let i = 0;
    while (scanWord(src, i) !== RGN_END) {
      const left = asInt16(scanWord(src, i++) + d);
      const right = asInt16(scanWord(src, i++) - d);
      if (asInt16(left) <= asInt16(oldRight)) {
        if (dst.length > 0) dst.length--;
      } else {
        dst.push(left);
      }
      dst.push(right);
      oldRight = right;
    }
  } else {
    // INSET — drop pairs that cross. RgnOp.a:376-386
    let i = 0;
    while (scanWord(src, i) !== RGN_END) {
      const left = asInt16(scanWord(src, i++) + d);
      const right = asInt16(scanWord(src, i++) - d);
      if (asInt16(left) >= asInt16(right)) continue;
      dst.push(left);
      dst.push(right);
    }
  }
  dst.push(RGN_END);
}

function applyOp(
  op: number,
  scanA: number[],
  scanB: number[],
  dst: number[],
  dh: number
): void {
  // Case jump. RgnOp.a:81-94
  if (op === OP_SECT) SectScan(scanA, scanB, dst);
  else if (op === OP_DIFF) DiffScan(scanA, scanB, dst);
  else if (op === OP_UNION) UnionScan(scanA, scanB, dst);
  else if (op === OP_XOR) XorScan(scanA, scanB, dst);
  else InsetScan(scanA, dst, dh);
}

/**
 * `FUNCTION RgnOp(rgnA,rgnB,bufHandle,maxBytes,op,dh,okGrow): INTEGER`.
 * Short form `(rgnA, rgnB, op, dh)` grows as needed and returns the points.
 * `RgnOp.a:3-292`.
 */
export function RgnOp(rgnA: RegionData, rgnB: RegionData, op: number, dh?: number): Point[];
export function RgnOp(
  rgnA: RegionData,
  rgnB: RegionData,
  buf: Point[],
  maxBytes: number,
  op: number,
  dh: number,
  okGrow: boolean
): number;
export function RgnOp(
  rgnA: RegionData,
  rgnB: RegionData,
  bufOrOp: Point[] | number,
  maxBytesOrDh?: number,
  opArg?: number,
  dhArg?: number,
  okGrowArg?: boolean
): Point[] | number {
  if (typeof bufOrOp === "number") {
    const buf: Point[] = [];
    const op = bufOrOp;
    const dh = maxBytesOrDh ?? 0;
    const maxBytes = ((rgnA.rgnSize + rgnB.rgnSize) * 2) | 0;
    rgnOpCore(rgnA, rgnB, buf, maxBytes || 256, op, dh, true);
    return buf;
  }
  return rgnOpCore(rgnA, rgnB, bufOrOp, maxBytesOrDh ?? 0, opArg ?? 0, dhArg ?? 0, !!okGrowArg);
}

function rgnOpCore(
  rgnA: RegionData,
  rgnB: RegionData,
  buf: Point[],
  maxBytes: number,
  op: number,
  dh: number,
  okGrow: boolean
): number {
  const dataA = expand(rgnA);
  const dataB = expand(rgnB);
  let aPos = 0;
  let bPos = 0;
  let nextA = dataA[aPos++] | 0;
  let nextB = dataB[bPos++] | 0;
  if (op === OP_INSET) nextB = RGN_END; // RgnOp.a:149-151

  let scanA: number[] = [RGN_END];
  let scanB: number[] = [RGN_END];
  let scanC: number[] = [RGN_END];
  let temp: number[] = [RGN_END];
  const output: number[] = [];

  buf.length = 0;
  // Truncate to a multiple of 8 bytes (even point count). RgnOp.a:132
  let limitPts = ((maxBytes | 0) & 0xfff8) >> 2;
  let vert = 0;

  const swap = (x: number[], y: number[]): [number[], number[]] => [y, x];

  const updateA = (): void => {
    vert = nextA;
    aPos = XorScan(dataA, scanA, temp, aPos, 0);
    nextA = dataA[aPos++] | 0;
    [scanA, temp] = swap(scanA, temp);
  };

  const updateB = (): void => {
    vert = nextB;
    bPos = XorScan(dataB, scanB, temp, bPos, 0);
    nextB = dataB[bPos++] | 0;
    [scanB, temp] = swap(scanB, temp);
  };

  const emitChanges = (): boolean => {
    // XorScan(temp, scanC, output); swap temp/scanC. RgnOp.a:200-204
    XorScan(temp, scanC, output, 0, 0);
    [temp, scanC] = swap(temp, scanC);

    // OUTTEST then pairs until 32767. RgnOp.a:210-253
    let k = 0;
    for (;;) {
      if (buf.length >= limitPts) {
        if (!okGrow) return false;
        limitPts += 64; // +256 bytes. RgnOp.a:233
      }
      if ((output[k] | 0) === RGN_END) return true;
      const leftH = output[k++] | 0;
      const rightH = output[k++] | 0;
      buf.push({ v: vert | 0, h: leftH });
      buf.push({ v: vert | 0, h: rightH });
    }
  };

  // NXTVERT — merge on next V. RgnOp.a:152-157
  nxtvert: for (;;) {
    if (nextA === nextB) {
      if (nextA === RGN_END) break nxtvert;
      updateA();
      updateB();
    } else if (asInt16(nextA) > asInt16(nextB)) {
      updateB();
    } else {
      updateA();
    }
    applyOp(op, scanA, scanB, temp, dh);
    if (!emitChanges()) break nxtvert;
  }

  return buf.length;
}

/**
 * `FUNCTION TrimRect(rgn: RgnHandle; VAR dstRect: Rect): CCR`.
 * RgnOp with maxBytes=24, okGrow=false. `Regions.a:1006-1072`.
 *
 * Returns `0` if the intersection is rectangular (`dstRect` updated),
 * `< 0` if empty, `> 0` if non-rectangular (`dstRect` unchanged).
 */
export function TrimRect(rgn: RegionData, dstRect: Rect): number {
  const rectRgn: RegionData = {
    rgnSize: 10,
    rgnBBox: {
      top: dstRect.top | 0,
      left: dstRect.left | 0,
      bottom: dstRect.bottom | 0,
      right: dstRect.right | 0,
    },
    data: new Int16Array(0),
  };
  const buf: Point[] = [];
  // RgnOp(rgn, rectRgn, buf, 24, SECT, 0, FALSE). Regions.a:1052-1061
  const ptCount = rgnOpCore(rgn, rectRgn, buf, 24, OP_SECT, 0, false);
  if (ptCount !== 4) {
    // CMP #4 → CCR < or >. Regions.a:1063-1064
    return (ptCount - 4) | 0;
  }
  dstRect.top = buf[0]!.v | 0;
  dstRect.left = buf[0]!.h | 0;
  dstRect.bottom = buf[3]!.v | 0;
  dstRect.right = buf[3]!.h | 0;
  return 0;
}

/**
 * RgnOp then PackRgn into `dst`. Used by DoRgnOp (`Regions.a:817-833`).
 */
export function packOp(
  rgnA: RegionData,
  rgnB: RegionData,
  dst: RegionData,
  op: number,
  dh = 0
): void {
  const pts = RgnOp(rgnA, rgnB, op, dh);
  PackRgn(pts, dst);
}
