/**
 * BitBlt — rectangular transfer with no clipping.
 * `BitBlt.a:10-352`.
 *
 * Extents come from `dstRect` only. Overlap direction uses *memory* row
 * (`top - bounds.top`) and memory left. Negative mode quits. Combination
 * is `packedBits.combineByte`.
 */
import type { BitMap, Pattern, Rect } from "./types";
import { globals } from "./globals";
import { blitRowBits, combineByte, fillRowBits, getBit } from "./packedBits";
import { PatExpand } from "./patExpand";

/** Intersect any number of rects. Empty → null. `Rects.a:465-512` (RSECT). */
export function rsect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let top = rects[0]!.top | 0;
  let left = rects[0]!.left | 0;
  let bottom = rects[0]!.bottom | 0;
  let right = rects[0]!.right | 0;
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i]!;
    if (top < r.top) top = r.top | 0;
    if (left < r.left) left = r.left | 0;
    if (bottom > r.bottom) bottom = r.bottom | 0;
    if (right > r.right) right = r.right | 0;
    if (bottom <= top || right <= left) return null; // Rects.a:488-491
  }
  return { top, left, bottom, right };
}

/**
 * Test bit `h` in a SeekRgn/RgnBlt scan buffer (word 0 at `bufLeft`,
 * bit 15 = leftmost pixel of the word). `SeekRgn.a:128-142` / `Util.a:266-269`.
 */
export function maskBit(buf: Uint16Array, bufLeft: number, h: number): boolean {
  const rel = (h - bufLeft) | 0;
  if (rel < 0) return false;
  const word = rel >>> 4;
  if (word >= buf.length) return false;
  return ((buf[word]! >>> (15 - (rel & 15))) & 1) !== 0;
}

/** Apply one source pixel under `mode` (`mode & 4` inverts). */
export function applyPixel(dst: BitMap, h: number, v: number, src: 0 | 1, mode: number): void {
  const x = h - dst.bounds.left;
  const i = (v - dst.bounds.top) * dst.rowBytes + (x >> 3);
  combineByte(dst.baseAddr, i, src ? 0xff : 0x00, 0x80 >> (x & 7), mode);
}

/**
 * Right-mask table, bit 15 = leftmost. `Util.a:266-269`.
 * XorSlab uses NOT MaskTab[left&15] / MaskTab[right&15]. `Util.a:569-605`.
 */
const MASKTAB = [
  0x0000, 0x8000, 0xc000, 0xe000, 0xf000, 0xf800, 0xfc00, 0xfe00, 0xff00, 0xff80, 0xffc0, 0xffe0,
  0xfff0, 0xfff8, 0xfffc, 0xfffe,
];

/**
 * Walk set bits in a SeekRgn scan buffer over `[left, right)` and call
 * `span(h0, h1)` for each contiguous run. Word 0 starts at `bufLeft`;
 * bit 15 is the leftmost pixel of the word (`SeekRgn.a:128-142`).
 */
export function forMaskSpans(
  mask: Uint16Array,
  bufLeft: number,
  left: number,
  right: number,
  span: (h0: number, h1: number) => void
): void {
  if (right <= left) return;
  let runStart = -1;
  const lastH = right;
  let w = ((left - bufLeft) >> 4) | 0;
  if (w < 0) w = 0;
  for (; ; w++) {
    const wordLeft = bufLeft + (w << 4);
    if (wordLeft >= lastH) break;
    if (w >= mask.length) {
      if (runStart >= 0) {
        span(runStart, lastH);
        runStart = -1;
      }
      break;
    }
    const bits = mask[w]!;
    const lo = left > wordLeft ? left : wordLeft;
    const hi = lastH < wordLeft + 16 ? lastH : wordLeft + 16;
    if (bits === 0) {
      if (runStart >= 0) {
        span(runStart, wordLeft > left ? wordLeft : left);
        runStart = -1;
      }
      continue;
    }
    if (bits === 0xffff && lo === wordLeft && hi === wordLeft + 16) {
      if (runStart < 0) runStart = lo;
      continue;
    }
    for (let x = lo; x < hi; x++) {
      const on = (bits >>> (15 - (x - wordLeft))) & 1;
      if (on) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        span(runStart, x);
        runStart = -1;
      }
    }
  }
  if (runStart >= 0) span(runStart, lastH);
}

/** XOR `[left, right)` (buffer-relative) into a word scan buffer. `Util.a:547-605`. */
export function xorSlab(buf: Uint16Array, left: number, right: number): void {
  const leftMask = ~MASKTAB[left & 0xf]! & 0xffff;
  const rightMask = MASKTAB[right & 0xf]!;
  const leftWord = left >> 4; // ASR #4. Util.a:583
  let wordCount = (right >> 4) - leftWord;
  let p = leftWord;
  if (wordCount <= 0) {
    buf[p] = (buf[p]! ^ (leftMask & rightMask)) & 0xffff;
    return;
  }
  buf[p] = (buf[p]! ^ leftMask) & 0xffff;
  p++;
  wordCount -= 2;
  while (wordCount > 0) {
    buf[p] = ~buf[p]! & 0xffff;
    p++;
    buf[p] = ~buf[p]! & 0xffff;
    p++;
    wordCount -= 2;
  }
  if (wordCount === 0) {
    buf[p] = ~buf[p]! & 0xffff;
    p++;
  }
  buf[p] = (buf[p]! ^ rightMask) & 0xffff;
}

/**
 * `PROCEDURE BitBlt(srcBits, dstBits, srcRect, dstRect, mode, pat)`.
 *
 * Height and width from `dstRect` only (`BitBlt.a:102-105`, `256-258`).
 * Negative mode quits. Pattern invert is applied in `PatExpand`; source
 * invert is `combineByte`'s `mode & 4`.
 */
export function BitBlt(
  srcBits: BitMap,
  dstBits: BitMap,
  srcRect: Rect,
  dstRect: Rect,
  mode: number,
  pat: Pattern
): void {
  const m = mode | 0;
  if (m < 0) return;

  const height = (dstRect.bottom - dstRect.top) | 0;
  if (height <= 0) return; // BitBlt.a:102-104
  const width = (dstRect.right - dstRect.left) | 0;
  if (width <= 0) return; // BitBlt.a:256-258

  const usePat = (m & 8) !== 0; // BitBlt.a:135
  const invert = (m & 4) !== 0;

  let srcTop = srcRect.top | 0;
  let dstTop = dstRect.top | 0;
  let vStep = 1;

  if (!usePat && srcBits.baseAddr === dstBits.baseAddr) {
    // Memory row, not local top. BitBlt.a:167-193
    const srcV = (srcRect.top - srcBits.bounds.top) | 0;
    const dstV = (dstRect.top - dstBits.bounds.top) | 0;
    if (srcV < dstV) {
      srcTop = (srcTop + height - 1) | 0;
      dstTop = (dstTop + height - 1) | 0;
      vStep = -1;
    }
  }

  if (usePat) {
    // Invert goes into PatExpand; mode loops mask it off. BitBlt.a:130-159, 316
    const exp = PatExpand(
      pat,
      dstBits,
      globals.patAlign,
      globals.thePort ? globals.thePort.patStretch : 0,
      invert
    );
    const op = m & 3;
    const dstLeft = dstRect.left | 0;
    const dstRight = (dstLeft + width) | 0;
    for (let i = 0; i < height; i++) {
      const dy = dstTop + i * vStep;
      if (exp.width === 8) {
        fillRowBits(dstBits, dy, dstLeft, dstRight, (exp.rows[dy & 15]! >>> 8) & 0xff, op);
      } else {
        for (let col = 0; col < width; col++) {
          const dx = dstLeft + col;
          applyPixel(dstBits, dx, dy, exp.sampleExpanded(dx, dy), op);
        }
      }
    }
    return;
  }

  const op = m & 7;
  const srcLeft = srcRect.left | 0;
  const dstLeft = dstRect.left | 0;
  for (let i = 0; i < height; i++) {
    const dy = dstTop + i * vStep;
    const sy = srcTop + i * vStep;
    blitRowBits(srcBits, sy, srcLeft, dstBits, dy, dstLeft, width, op);
  }
}

/** Source pixel at `(h, v)` — 0 if the byte is missing. */
export function srcPixel(src: BitMap, h: number, v: number): 0 | 1 {
  return getBit(src, h, v);
}
