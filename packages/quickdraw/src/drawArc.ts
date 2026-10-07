/**
 * Oval / RoundRect / Arc rasteriser — `reference/QuickDraw/DrawArc.a`.
 *
 * `StdRRect` / `StdOval` are one `DrawArc` pass (`RRects.a:82-84`,
 * `Ovals.a:76-78`): `DrawArc(r, hollow, ovWd, ovHt, mode, pat, 0, 360)`.
 */

import type { BitMap, Pattern, Rect } from "./types";
import { globals, requirePort } from "./globals";
import { asInt16, FixMul, FixRatio, HiWord, LongMul, type Fixed } from "./fixmath";
import { SlopeFromAngle } from "./angles";
import { ColorMap } from "./colorMap";
import { RgnBlt } from "./rgnBlt";
import { isRectRgn, type RegionData } from "./regionTypes";
import { TrimRect } from "./rgnOp";
import { fillRowBits } from "./packedBits";
import { withCursorShield } from "./cursors";
import { rsect } from "./bitBltCore";

const ONEHALF: Fixed = 0x00008000;

/** Oval state record (`DrawArc.a:14-24`). */
export interface OvalRec {
  ovalTop: number;
  ovalBot: number;
  ovalY: number;
  rsqysq: number;
  squareHi: number;
  squareLo: number;
  oddNumHi: number;
  oddNumLo: number;
  oddBumpHi: number;
  oddBumpLo: number;
  leftEdge: Fixed;
  rightEdge: Fixed;
  oneHalf: Fixed;
}

export function newOvalRec(): OvalRec {
  return {
    ovalTop: 0,
    ovalBot: 0,
    ovalY: 0,
    rsqysq: 0,
    squareHi: 0,
    squareLo: 0,
    oddNumHi: 0,
    oddNumLo: 0,
    oddBumpHi: 0,
    oddBumpLo: 0,
    leftEdge: 0,
    rightEdge: 0,
    oneHalf: ONEHALF,
  };
}

function add64(
  hi: number,
  lo: number,
  addHi: number,
  addLo: number
): { hi: number; lo: number } {
  const sumLo = (lo + addLo) | 0;
  const carry = (lo >>> 0) + (addLo >>> 0) > 0xffffffff ? 1 : 0;
  return { hi: (hi + addHi + carry) | 0, lo: sumLo };
}

/** SUBX borrow is computed from the operands *before* the subtraction. */
function sub64(
  hi: number,
  lo: number,
  subHi: number,
  subLo: number
): { hi: number; lo: number } {
  const borrow = (lo >>> 0) < (subLo >>> 0) ? 1 : 0; // DrawArc.a:1069-1072
  return { hi: (hi - subHi - borrow) | 0, lo: (lo - subLo) | 0 };
}

/**
 * `PROCEDURE InitOval(dstRect; VAR oval; ovalWidth, ovalHeight)`
 * (`DrawArc.a:898-998`).
 *
 * Edges: `left + ovWd/2`, `right − ovWd/2 + 1/2` (`DrawArc.a:947-959`).
 * `LSR.L #1` keeps the 0.5 fraction when `ovWd` is odd.
 */
export function InitOval(
  dstRect: Rect,
  oval: OvalRec,
  ovalWidth: number,
  ovalHeight: number
): void {
  oval.ovalTop = asInt16(dstRect.top);
  oval.ovalBot = asInt16(dstRect.bottom);

  let ovWd = asInt16(ovalWidth);
  let ovHt = asInt16(ovalHeight);
  if (ovWd < 0) ovWd = 0; // DrawArc.a:924-926
  if (ovHt < 0) ovHt = 0; // DrawArc.a:927-929

  const dstWidth = asInt16(asInt16(dstRect.right) - asInt16(dstRect.left));
  const dstHeight = asInt16(asInt16(dstRect.bottom) - asInt16(dstRect.top));
  if (ovWd > dstWidth) ovWd = dstWidth; // DrawArc.a:936-938
  if (ovHt > dstHeight) ovHt = dstHeight; // DrawArc.a:941-943

  // DrawArc.a:947-959 — left + ovWd/2, right − ovWd/2 + ½.
  let leftEdge = (asInt16(dstRect.left) << 16) | 0;
  let rightEdge = (asInt16(dstRect.right) << 16) | 0;
  const halfWd = ((ovWd << 16) >>> 1) | 0; // LSR.L #1
  leftEdge = (leftEdge + halfWd) | 0;
  rightEdge = (rightEdge - halfWd) | 0;
  rightEdge = (rightEdge + ONEHALF) | 0;
  oval.leftEdge = leftEdge;
  oval.rightEdge = rightEdge;
  oval.oneHalf = ONEHALF;

  oval.ovalY = asInt16(1 - ovHt); // DrawArc.a:963-965
  oval.rsqysq = ((ovHt << 1) - 1) | 0; // DrawArc.a:969-973
  oval.squareHi = 0;
  oval.squareLo = 0;

  const aspect = FixRatio(ovHt, ovWd);
  const { hiLong, loLong } = LongMul(aspect, aspect); // DrawArc.a:986-988
  oval.oddNumHi = hiLong;
  oval.oddNumLo = loLong;
  const hiCarry = loLong >>> 0 >= 0x80000000 ? 1 : 0; // ADDX (`DrawArc.a:992-997`)
  oval.oddBumpLo = (loLong << 1) | 0;
  oval.oddBumpHi = ((hiLong << 1) + hiCarry) | 0;
}

/**
 * `PROCEDURE BumpOval(VAR oval; vert)` (`DrawArc.a:1003-1081`).
 * Square compares use the signed high long only (`CMP.L D1,D2`).
 */
export function BumpOval(oval: OvalRec, vert: number): void {
  const v = asInt16(vert);
  if (v < oval.ovalTop || v >= oval.ovalBot) return; // DrawArc.a:1022-1025
  const ovalY = oval.ovalY;
  oval.ovalY = asInt16(ovalY + 2);

  let rsqysq = oval.rsqysq;
  let squareHi = oval.squareHi;
  let squareLo = oval.squareLo;
  let oddNumHi = oval.oddNumHi;
  let oddNumLo = oval.oddNumLo;
  const oddBumpHi = oval.oddBumpHi;
  const oddBumpLo = oval.oddBumpLo;
  let leftEdge = oval.leftEdge;
  let rightEdge = oval.rightEdge;

  // WHILE SQUARE.hi < RSQYSQ: grow (`DrawArc.a:1052-1059`).
  while (squareHi < rsqysq) {
    rightEdge = (rightEdge + ONEHALF) | 0;
    leftEdge = (leftEdge - ONEHALF) | 0;
    const sq = add64(squareHi, squareLo, oddNumHi, oddNumLo);
    squareHi = sq.hi;
    squareLo = sq.lo;
    const od = add64(oddNumHi, oddNumLo, oddBumpHi, oddBumpLo);
    oddNumHi = od.hi;
    oddNumLo = od.lo;
  }
  // WHILE SQUARE.hi > RSQYSQ: shrink; borrow before SUB (`DrawArc.a:1067-1074`).
  while (squareHi > rsqysq) {
    rightEdge = (rightEdge - ONEHALF) | 0;
    leftEdge = (leftEdge + ONEHALF) | 0;
    const od = sub64(oddNumHi, oddNumLo, oddBumpHi, oddBumpLo);
    oddNumHi = od.hi;
    oddNumLo = od.lo;
    const sq = sub64(squareHi, squareLo, oddNumHi, oddNumLo);
    squareHi = sq.hi;
    squareLo = sq.lo;
  }

  const oy1 = asInt16(asInt16(ovalY) + 1);
  rsqysq = (rsqysq - ((oy1 << 2) | 0)) | 0; // DrawArc.a:1076-1079
  oval.rsqysq = rsqysq;
  oval.squareHi = squareHi;
  oval.squareLo = squareLo;
  oval.oddNumHi = oddNumHi;
  oval.oddNumLo = oddNumLo;
  oval.leftEdge = leftEdge;
  oval.rightEdge = rightEdge;
}

/** Mode 8..15: `(mode & ~7) === 8` (`DrawArc.a:118-121`, `AND #-8; CMP #8`). */
function isPatMode(mode: number): boolean {
  return (mode & ~7) === 8;
}

/** Black / xor / white / nop. `DrawArc.a:198-202` MODEMAP. */
const MODEMAP = [0, 0, 1, 2, 2, 255, 255, 255];

/** All-0 or all-1 8-byte pattern, else null. `DrawArc.a:183-191`. */
function solidPat(pat: Pattern): 0 | 1 | null {
  const a =
    (((pat[0] ?? 0) & 0xff) << 24) |
    (((pat[1] ?? 0) & 0xff) << 16) |
    (((pat[2] ?? 0) & 0xff) << 8) |
    ((pat[3] ?? 0) & 0xff);
  const b =
    (((pat[4] ?? 0) & 0xff) << 24) |
    (((pat[5] ?? 0) & 0xff) << 16) |
    (((pat[6] ?? 0) & 0xff) << 8) |
    ((pat[7] ?? 0) & 0xff);
  if (a !== b) return null;
  if (a === 0) return 0;
  if ((a >>> 0) === 0xffffffff) return 1;
  return null;
}

/**
 * FASTFLAG: rect clip (and vis, or TrimRect), solid black/white pattern.
 * Returns `0` black / `1` xor / `2` white, `"nop"` to quit, `null` for RgnBlt.
 * `DrawArc.a:165-202`. Mutates `minRect` when TrimRect tightens it.
 */
function resolveFastArc(
  clip: RegionData,
  vis: RegionData,
  minRect: Rect,
  mode: number,
  pat: Pattern
): 0 | 1 | 2 | "nop" | null {
  if (!isRectRgn(clip)) return null;
  if (!isRectRgn(vis)) {
    const t = TrimRect(vis, minRect);
    if (t < 0) return "nop";
    if (t > 0) return null;
  }
  const solid = solidPat(pat);
  if (solid === null) return null;
  let m = mode;
  if (solid === 0) m ^= 4; // white → invert mode bit 2. DrawArc.a:191
  const mapped = MODEMAP[m & 7] ?? 255;
  if (mapped === 255) return "nop";
  return mapped as 0 | 1 | 2;
}

function paintFastSlab(
  dst: BitMap,
  minRect: Rect,
  kind: 0 | 1 | 2,
  left: number,
  right: number,
  v: number
): void {
  if (v < minRect.top || v >= minRect.bottom) return;
  const h0 = left < minRect.left ? minRect.left : left;
  const h1 = right > minRect.right ? minRect.right : right;
  if (h1 <= h0) return;
  if (kind === 0) fillRowBits(dst, v, h0, h1, 0xff, 0);
  else if (kind === 2) fillRowBits(dst, v, h0, h1, 0x00, 0);
  else fillRowBits(dst, v, h0, h1, 0xff, 2);
}

/**
 * One horizontal slab via `RgnBlt` of a 1-high rect (`DrawArc.a:766-774` ONESLAB).
 */
export function drawSlab(
  left: number,
  right: number,
  v: number,
  mode: number,
  pat: Pattern
): void {
  drawRectRgnBlt({ top: v, left, bottom: asInt16(v + 1), right }, mode, pat);
}

/** Full-rect `RgnBlt` (`Rects.a:187-217` DrawRect, minus the `pnVis` check). */
export function drawRectRgnBlt(r: Rect, mode: number, pat: Pattern): void {
  const port = requirePort();
  RgnBlt(
    port.portBits,
    port.portBits,
    r,
    r,
    mode,
    pat,
    port.clipRgn,
    port.visRgn,
    globals.wideOpen
  );
}

/**
 * 16×16 partial product used for `LINE1`/`LINE2` at the top of `dstRect`
 * (`DrawArc.a:312-320`): `MULU` of slope.lo plus `ADD.W` of `MULS` slope.hi.
 */
function slopeTimesHalfHt(slope: Fixed, halfHt: number): Fixed {
  const loPartial = ((slope & 0xffff) * (halfHt & 0xffff)) >>> 0;
  let acc = loPartial | 0;
  const hiPartial = (HiWord(slope) * asInt16(halfHt)) | 0;
  acc = (acc + ((hiPartial & 0xffff) << 16)) | 0;
  return acc;
}

function edgeFlag(ang: number): number {
  // DrawArc.a:337-344 / 346-353: <180 → ang−90; ≥180 → 270−ang.
  return ang < 180 ? asInt16(ang - 90) : asInt16(270 - ang);
}

function bothActive(flag1: number, flag2: number): boolean {
  // AND; BPL → not both negative (`DrawArc.a:735-737`, `:786-788`).
  return flag1 < 0 && flag2 < 0;
}

/**
 * `PROCEDURE DrawArc(dstRect, hollow, ovalWidth, ovalHeight, mode, pat,
 * startAngle, arcAngle)` (`DrawArc.a:28-843`).
 */
export function DrawArc(
  dstRect: Rect,
  hollow: boolean,
  ovalWidth: number,
  ovalHeight: number,
  mode: number,
  pat: Pattern,
  startAngle: number,
  arcAngle: number
): void {
  const port = requirePort();
  if (port.pnVis < 0) return; // DrawArc.a:109-110
  if (!isPatMode(mode)) return; // DrawArc.a:118-121

  if (port.colrBit !== 0) {
    const mapped = ColorMap(mode, pat); // DrawArc.a:128-134
    mode = mapped.mode;
    pat = mapped.pat;
  }

  const minRect = rsect([
    dstRect,
    port.portBits.bounds,
    port.clipRgn.rgn.rgnBBox,
    port.visRgn.rgn.rgnBBox,
  ]);
  if (!minRect) return; // DrawArc.a:153-160 — no portRect

  const fastKind = resolveFastArc(port.clipRgn.rgn, port.visRgn.rgn, minRect, mode, pat);
  if (fastKind === "nop") return;

  const slab = (left: number, right: number, v: number): void => {
    if (fastKind !== null) {
      paintFastSlab(port.portBits, minRect, fastKind, left, right, v);
    } else {
      drawSlab(left, right, v, mode, pat);
    }
  };

  let aa = asInt16(arcAngle);
  if (aa === 0) return; // DrawArc.a:213-214
  let sa = asInt16(startAngle);
  if (aa < 0) {
    sa = asInt16(sa + aa); // DrawArc.a:216
    aa = asInt16(-aa);
  }
  const isArc = aa < 360; // SLT ARCFLAG (`DrawArc.a:219-220`)

  let slope1: Fixed = 0;
  let slope2: Fixed = 0;
  let line1: Fixed = 0;
  let line2: Fixed = 0;
  let flag1 = 0;
  let flag2 = 0;
  let skipFlag = false;
  let midVert = 0;

  if (isArc) {
    sa = sa % 360;
    if (sa < 0) sa += 360; // DrawArc.a:230-237
    let stop = asInt16(sa + aa);
    if (stop >= 360) stop = asInt16(stop - 360); // DrawArc.a:239-243

    midVert = asInt16(asInt16(dstRect.top) + asInt16(dstRect.bottom)) >> 1;
    const midHoriz = asInt16(asInt16(dstRect.left) + asInt16(dstRect.right)) >> 1;
    const width = asInt16(asInt16(dstRect.right) - asInt16(dstRect.left));
    const height = asInt16(asInt16(dstRect.bottom) - asInt16(dstRect.top));
    const aspect = FixRatio(width, height); // DrawArc.a:264-268
    slope1 = FixMul(SlopeFromAngle(sa), aspect);
    slope2 = FixMul(SlopeFromAngle(stop), aspect);

    const midH64 = (midHoriz << 16) | 0;
    const halfHt = (height & 0xffff) >>> 1; // LSR #1 (`DrawArc.a:309-310`)
    line1 = (midH64 - slopeTimesHalfHt(slope1, halfHt)) | 0;
    line2 = (midH64 - slopeTimesHalfHt(slope2, halfHt)) | 0;

    flag1 = edgeFlag(sa);
    flag2 = edgeFlag(stop);

    if (aa > 180) {
      skipFlag = false; // DrawArc.a:360-361
    } else if (aa < 180) {
      skipFlag = flag1 >= 0 && flag2 >= 0; // DrawArc.a:366-368
    } else {
      skipFlag = sa === 90; // DrawArc.a:363-364
    }
  }

  const outer = newOvalRec();
  InitOval(dstRect, outer, ovalWidth, ovalHeight);

  // skipTop/skipBot use the *raw* ovalHeight parameter (`DrawArc.a:385-394`).
  const skipTop = asInt16(outer.ovalTop + (asInt16(ovalHeight) >> 1));
  const skipBot = asInt16(
    asInt16(
      asInt16(skipTop + asInt16(dstRect.bottom)) - asInt16(dstRect.top)
    ) - asInt16(ovalHeight)
  );

  let inner: OvalRec | null = null;
  if (hollow) {
    const pw = asInt16(port.pnSize.h); // raw — no Math.max(1)
    const ph = asInt16(port.pnSize.v);
    const iLeft = asInt16(asInt16(dstRect.left) + pw);
    const iRight = asInt16(asInt16(dstRect.right) - pw);
    const iTop = asInt16(asInt16(dstRect.top) + ph);
    const iBot = asInt16(asInt16(dstRect.bottom) - ph);
    if (iLeft < iRight && iTop < iBot) {
      // DrawArc.a:425-432 — inner size = outer − 2·pen.
      inner = newOvalRec();
      InitOval(
        { top: iTop, left: iLeft, bottom: iBot, right: iRight },
        inner,
        asInt16(asInt16(asInt16(ovalWidth) - pw) - pw),
        asInt16(asInt16(asInt16(ovalHeight) - ph) - ph)
      );
    }
  }

  const runRows = (): void => {
  let vert = outer.ovalTop;
  while (vert < minRect.bottom) {
    if (vert < skipTop || vert >= skipBot) {
      BumpOval(outer, vert);
      if (inner) BumpOval(inner, vert);
    }

    if (isArc && vert === midVert) {
      flag1 = asInt16(-flag1); // DrawArc.a:619-620
      flag2 = asInt16(-flag2);
      skipFlag = false;
      if (aa > 180) {
        // keep going
      } else if (aa < 180) {
        if (flag1 >= 0 && flag2 >= 0) break; // DrawArc.a:632-634
      } else if (sa === 270) {
        break; // DrawArc.a:629-631
      }
      const tFlag = flag1;
      flag1 = flag2;
      flag2 = tFlag;
      const tLine = line1;
      line1 = line2;
      line2 = tLine;
      const tSlope = slope1;
      slope1 = slope2;
      slope2 = tSlope;
    }

    if (vert >= minRect.top && !skipFlag) {
      const oL = HiWord(outer.leftEdge);
      const oR = HiWord(outer.rightEdge);
      const line1Int = HiWord(line1);
      const line2Int = HiWord(line2);

      if (!isArc) {
        if (!inner || vert < inner.ovalTop || vert >= inner.ovalBot) {
          // Hollow rows outside the inner range are solid (`DrawArc.a:667-669`).
          slab(oL, oR, vert);
        } else {
          slab(oL, HiWord(inner.leftEdge), vert); // DrawArc.a:802-804
          slab(HiWord(inner.rightEdge), oR, vert);
        }
      } else {
        let outerLeft = oL;
        let outerRight = oR;
        if (flag1 < 0 && line1Int > outerLeft) outerLeft = line1Int; // DrawArc.a:678-682
        if (flag2 < 0 && line2Int < outerRight) outerRight = line2Int; // DrawArc.a:686-690

        const useInner =
          inner !== null && vert >= inner.ovalTop && vert < inner.ovalBot;

        if (!useInner) {
          if (outerLeft < outerRight) {
            slab(outerLeft, outerRight, vert); // DrawArc.a:781-782
          } else if (bothActive(flag1, flag2) && aa > 180) {
            slab(oL, outerRight, vert); // DrawArc.a:791-795
            slab(outerLeft, oR, vert);
          }
        } else if (inner) {
          let innerLeft = HiWord(inner.leftEdge);
          let innerRight = HiWord(inner.rightEdge);
          if (flag2 < 0 && line2Int < innerLeft) innerLeft = line2Int; // DrawArc.a:704-708
          if (flag1 < 0 && line1Int > innerRight) innerRight = line1Int; // DrawArc.a:712-716

          if (outerLeft < outerRight) {
            // Two-way if (`DrawArc.a:724-730`).
            slab(outerLeft, innerLeft, vert);
            slab(innerRight, outerRight, vert);
          } else if (bothActive(flag1, flag2) && aa > 180) {
            // else-if wrap (`DrawArc.a:735-759`).
            if (innerLeft === outerRight) {
              slab(outerLeft, HiWord(inner.leftEdge), vert);
            } else if (outerLeft === innerRight) {
              slab(HiWord(inner.rightEdge), outerRight, vert);
            }
            slab(oL, innerLeft, vert);
            slab(innerRight, oR, vert);
          }
        }
      }
    }

    if (isArc) {
      line1 = (line1 + slope1) | 0; // DrawArc.a:831-834
      line2 = (line2 + slope2) | 0;
    }
    vert += 1;
  }
  };

  if (fastKind !== null) {
    withCursorShield(minRect, { v: port.portBits.bounds.top, h: port.portBits.bounds.left }, runRows);
  } else {
    runRows();
  }
}

/**
 * `StdRRect` / `StdOval` body: one `DrawArc` over 0..360
 * (`RRects.a:76-84`, `Ovals.a:68-78`).
 */
export function DrawRRect(
  r: Rect,
  hollow: boolean,
  ovWd: number,
  ovHt: number,
  mode: number,
  pat: Pattern
): void {
  DrawArc(r, hollow, ovWd, ovHt, mode, pat, 0, 360);
}
