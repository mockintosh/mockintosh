/**
 * PaintAsm.a — MacPaint's hand-written 68000 routines. The page buffers
 * (`mainBuf`, `altBuf`, the mask and the screen) are all 416×240 at 52
 * rowBytes; FatBits is 52×30 at 8 rowBytes with a border row and column.
 * Coordinates handed to the `*Buf` routines are buffer-relative rows, as in
 * the original.
 */

import type { BitMap, Pattern, Rect } from "@mockintosh/quickdraw";
import { newBits, rect } from "./bits";

export const BUF_ROW = 52;
export const BUF_WIDTH = 416;
export const BUF_HEIGHT = 240;
export const FAT_WIDTH = 52;
export const FAT_HEIGHT = 30;

/** A page-window buffer over `bounds` (416×240). */
export function newBuf(bounds: Rect): BitMap {
  return newBits(bounds, BUF_ROW);
}

/** `fatBuf`: 32 rows of 8 bytes — the 30 fat rows, the bottom border and a spare. */
export function newFatBits(bounds: Rect): BitMap {
  return { baseAddr: new Uint8Array(8 * 32), rowBytes: 8, bounds: { ...bounds } };
}

function rol8(b: number, n: number): number {
  n &= 7;
  return ((b << n) | (b >> (8 - n))) & 0xff;
}

function ror8(b: number, n: number): number {
  n &= 7;
  return ((b >> n) | (b << (8 - n))) & 0xff;
}

const SYM_TABLE = [0x80, 0xc0, 0xa0, 0xf0, 0x88, 0xff, 0xff, 0xff, 0x81, 0xff, 0xff, 0xff, 0x99, 0xff, 0xff, 0xff];

/**
 * `MapSym`: the four mirror flags as a byte naming which of the eight
 * symmetric positions `SymBrush` plots. Bit 7 (the brush itself) is always
 * set; `0x80` means no mirrors.
 */
export function mapSym(hSym: boolean, vSym: boolean, hvSym: boolean, vhSym: boolean): number {
  const index = (vhSym ? 8 : 0) + (hvSym ? 4 : 0) + (vSym ? 2 : 0) + (hSym ? 1 : 0);
  return SYM_TABLE[index]!;
}

/** `GetSelPat`: the marching-ants stripe for phase `patIndex`. */
export function getSelPat(patIndex: number): Pattern {
  const pat = new Uint8Array(8);
  let b = ror8(0xf8, patIndex);
  for (let i = 0; i < 8; i++) {
    pat[i] = b;
    b = rol8(b, 1);
  }
  return pat;
}

/**
 * `DrawBrush`: stamp the 16×16 `brush` centred on `(hCenter, vCenter)` into
 * `dst`, clipped to `clip`. Pattern alignment follows local coordinates
 * (`ExpandPat` pre-rotates by `dst.bounds.left`). `orMode` ORs the pattern
 * in; otherwise the brush's pixels take the pattern.
 */
export function drawBrush(
  brush: Uint16Array,
  pat: Pattern,
  hCenter: number,
  vCenter: number,
  dst: BitMap,
  clip: Rect,
  orMode: boolean,
): void {
  const left = hCenter - 8;
  const top = vCenter - 8;
  const { bounds, rowBytes, baseAddr } = dst;
  const x0 = Math.max(left, clip.left, bounds.left);
  const x1 = Math.min(left + 16, clip.right, bounds.right);
  const y0 = Math.max(top, clip.top, bounds.top);
  const y1 = Math.min(top + 16, clip.bottom, bounds.bottom);
  for (let y = y0; y < y1; y++) {
    const word = brush[y - top]!;
    if (word === 0) continue;
    const patRow = pat[y & 7]!;
    const rowBase = (y - bounds.top) * rowBytes;
    for (let x = x0; x < x1; x++) {
      if (((word >> (15 - (x - left))) & 1) === 0) continue;
      const ink = (patRow >> (7 - (x & 7))) & 1;
      const bx = x - bounds.left;
      const i = rowBase + (bx >> 3);
      const bit = 0x80 >> (bx & 7);
      if (ink) baseAddr[i] = baseAddr[i]! | bit;
      else if (!orMode) baseAddr[i] = baseAddr[i]! & ~bit;
    }
  }
}

/**
 * `CalcEdges`: the outline of `src` (a lasso mask) — pixels set in `src`
 * whose 3×3 neighbourhood is not — ANDed into `dst` over `height` rows from
 * buffer row `topVert`. With `lassoBlack` the destination is inverted first,
 * so the edges keep the white pixels of an inverted selection.
 */
export function calcEdges(src: BitMap, dst: BitMap, topVert: number, height: number, lassoBlack: boolean): void {
  const row = src.rowBytes;
  const s = src.baseAddr;
  const d = dst.baseAddr;
  const rows = s.length / row;
  const invert = lassoBlack ? 0xff : 0;
  const v = new Uint8Array(row);
  const h = new Uint8Array(row);
  for (let y = topVert; y < topVert + height; y++) {
    if (y < 0 || y >= rows) continue;
    const base = y * row;
    for (let i = 0; i < row; i++) {
      const above = y > 0 ? s[base - row + i]! : 0;
      const below = y + 1 < rows ? s[base + row + i]! : 0;
      v[i] = s[base + i]! & above & below;
    }
    for (let i = 0; i < row; i++) {
      const shifted = (v[i]! >> 1) | (i > 0 ? (v[i - 1]! & 1) << 7 : 0);
      h[i] = v[i]! & shifted;
    }
    for (let i = 0; i < row; i++) {
      const shifted = ((h[i]! << 1) & 0xff) | (i + 1 < row ? h[i + 1]! >> 7 : 0);
      const inset = h[i]! & shifted;
      const edge = ~inset & s[base + i]! & 0xff;
      d[base + i] = (d[base + i]! ^ invert) & edge;
    }
  }
}

/**
 * `AntsToScrn`: show the edges in `edgeBuf` on the screen as marching ants
 * over buffer-relative `maskRect` rows, at phase `patIndex`.
 */
export function antsToScrn(edgeBuf: BitMap, scrn: BitMap, maskRect: Rect, patIndex: number): void {
  const row = edgeBuf.rowBytes;
  const e = edgeBuf.baseAddr;
  const sc = scrn.baseAddr;
  let pat = ror8(0x07, patIndex);
  for (let y = Math.max(0, maskRect.top); y < Math.min(BUF_HEIGHT, maskRect.bottom); y++) {
    const base = y * row;
    for (let i = 0; i < row; i++) {
      sc[base + i] = ((sc[base + i]! ^ pat) | e[base + i]!) ^ pat;
    }
    pat = rol8(pat, 1);
  }
}

/** `ZeroFat`: clear FatBits and install its right and bottom borders. */
export function zeroFat(fat: BitMap): void {
  const f = fat.baseAddr;
  f.fill(0);
  for (let r = 0; r < 30; r++) f[r * 8 + 6] = 0x08;
  f.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf8, 0x00], 30 * 8);
}

/**
 * `FatToScrn`: FatBits blown up 8× (a 7×7 dot per pixel) over the whole
 * window, with the actual-size 56×32 preview in its top-left corner.
 */
export function fatToScrn(fat: BitMap, scrn: BitMap): void {
  const f = fat.baseAddr;
  const sc = scrn.baseAddr;
  const row = scrn.rowBytes;
  for (let r = 0; r < 32; r++) {
    for (let i = 0; i < 7; i++) sc[r * row + i] = f[r * 8 + i]!;
  }
  for (let fy = 0; fy < FAT_HEIGHT; fy++) {
    for (let fx = 0; fx < FAT_WIDTH; fx++) {
      if (fy < 4 && fx < 7) continue;
      const on = (f[fy * 8 + (fx >> 3)]! >> (7 - (fx & 7))) & 1;
      const b = on ? 0xfe : 0;
      for (let k = 0; k < 7; k++) sc[(fy * 8 + k) * row + fx] = b;
      sc[(fy * 8 + 7) * row + fx] = 0;
    }
  }
}

/**
 * `CalcMask`: the 4-connected region of `src` pixels matching the one at
 * `firstPt`, written into `dst` (zeroed first). Confined to `limitRect`'s
 * rows and its columns rounded out to whole words. `invertDst` complements
 * the result inside that area — the lasso's "everything not reachable from
 * the corner".
 */
export function calcMask(
  src: BitMap,
  dst: BitMap,
  limitRect: Rect,
  firstPt: { h: number; v: number },
  firstBlack: boolean,
  invertDst: boolean,
): void {
  const row = dst.rowBytes;
  const s = src.baseAddr;
  const d = dst.baseAddr;
  d.fill(0);
  const dh = -dst.bounds.left;
  const dv = -dst.bounds.top;
  const top = Math.max(0, limitRect.top + dv);
  const bottom = Math.min(BUF_HEIGHT, limitRect.bottom + dv);
  const left = Math.max(0, (limitRect.left + dh) & ~15);
  const right = Math.min(BUF_WIDTH, (limitRect.right + dh + 15) & ~15);
  const fx = firstPt.h + dh;
  const fy = firstPt.v + dv;
  const want = firstBlack ? 1 : 0;
  const srcBit = (x: number, y: number): number => (s[y * row + (x >> 3)]! >> (7 - (x & 7))) & 1;
  const dstBit = (x: number, y: number): number => (d[y * row + (x >> 3)]! >> (7 - (x & 7))) & 1;

  if (fx >= left && fx < right && fy >= top && fy < bottom && srcBit(fx, fy) === want) {
    const stack: number[] = [fx, fy];
    while (stack.length > 0) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      if (dstBit(x, y) || srcBit(x, y) !== want) continue;
      let x0 = x;
      while (x0 > left && srcBit(x0 - 1, y) === want && !dstBit(x0 - 1, y)) x0--;
      let x1 = x;
      while (x1 + 1 < right && srcBit(x1 + 1, y) === want && !dstBit(x1 + 1, y)) x1++;
      for (let xi = x0; xi <= x1; xi++) {
        d[y * row + (xi >> 3)] = d[y * row + (xi >> 3)]! | (0x80 >> (xi & 7));
        if (y > top && srcBit(xi, y - 1) === want && !dstBit(xi, y - 1)) stack.push(xi, y - 1);
        if (y + 1 < bottom && srcBit(xi, y + 1) === want && !dstBit(xi, y + 1)) stack.push(xi, y + 1);
      }
    }
  }

  if (invertDst) {
    for (let y = top; y < bottom; y++) {
      for (let i = left >> 3; i < right >> 3; i++) d[y * row + i] = ~d[y * row + i]! & 0xff;
    }
  }
}

/**
 * `TrimBBox`: shrink buffer-relative `r` to the set pixels inside it (whole
 * words across); an empty rect when there are none.
 */
export function trimBBox(buf: BitMap, r: Rect): Rect {
  const row = buf.rowBytes;
  const b = buf.baseAddr;
  const top0 = Math.max(0, r.top);
  const bottom0 = Math.min(BUF_HEIGHT, r.bottom);
  const left0 = Math.max(0, r.left & ~15);
  const right0 = Math.min(BUF_WIDTH, (r.right + 15) & ~15);
  let top = -1;
  let bottom = -1;
  let left = right0;
  let right = left0;
  for (let y = top0; y < bottom0; y++) {
    for (let x = left0; x < right0; x++) {
      if ((b[y * row + (x >> 3)]! >> (7 - (x & 7))) & 1) {
        if (top < 0) top = y;
        bottom = y + 1;
        if (x < left) left = x;
        if (x + 1 > right) right = x + 1;
      }
    }
  }
  return top < 0 ? rect(0, 0, 0, 0) : rect(left, top, right, bottom);
}

/** `VFlipBuf`: `dst` is `src` upside down (all 240 rows). */
export function vFlipBuf(src: BitMap, dst: BitMap): void {
  const row = src.rowBytes;
  for (let y = 0; y < BUF_HEIGHT; y++) {
    dst.baseAddr.set(src.baseAddr.subarray((BUF_HEIGHT - 1 - y) * row, (BUF_HEIGHT - y) * row), y * row);
  }
}

function reverseByte(b: number): number {
  b = ((b & 0xf0) >> 4) | ((b & 0x0f) << 4);
  b = ((b & 0xcc) >> 2) | ((b & 0x33) << 2);
  return ((b & 0xaa) >> 1) | ((b & 0x55) << 1);
}

/** `HFlipBuf`: rows `top..bot-1` of `src`, mirrored left to right, into `dst`. */
export function hFlipBuf(src: BitMap, dst: BitMap, top: number, bot: number): void {
  const row = src.rowBytes;
  for (let y = Math.max(0, top); y < Math.min(BUF_HEIGHT, bot); y++) {
    const base = y * row;
    for (let i = 0; i < row; i++) dst.baseAddr[base + i] = reverseByte(src.baseAddr[base + row - 1 - i]!);
  }
}

/**
 * `RotBuf`: rotate the top-left 240-wide strip of `src`, `height` rows
 * (rounded up to 16), a quarter turn counter-clockwise into `dst`, which
 * the caller has cleared: `dst(r, 239 - x) = src(x, r)`.
 */
export function rotBuf(src: BitMap, dst: BitMap, height: number): void {
  if (height <= 0) return;
  const row = src.rowBytes;
  const rows = Math.min(BUF_HEIGHT, ((height + 15) >> 4) << 4);
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < 240; x++) {
      if ((src.baseAddr[r * row + (x >> 3)]! >> (7 - (x & 7))) & 1) {
        const y = BUF_HEIGHT - 1 - x;
        dst.baseAddr[y * row + (r >> 3)] = dst.baseAddr[y * row + (r >> 3)]! | (0x80 >> (r & 7));
      }
    }
  }
}
