/**
 * `PROCEDURE DrText` — `DrawText.a`.
 *
 * Lays glyphs into a scratch bitmap, synthesises styles, then `StretchBits`
 * through clip/vis. `pnLoc.v` is the baseline. The common case (`srcOr`, no
 * style, 1:1, rectangular clip) writes glyphs straight into `portBits`
 * (`DrawText.a:223-289`). The 68k stack-split is omitted; pixels match.
 */

import type { BitMap, GrafPort, Point, Rect } from "./types";
import { asInt16, HiWord } from "./fixmath";
import { globals, requirePort } from "./globals";
import { MapRect } from "./rects";
import { rsect } from "./bitBltCore";
import { StretchBits } from "./stretchBits";
import { blitRowBits } from "./packedBits";
import { rectRegion } from "./regionData";
import { StdTxMeas } from "./txMeas";
import type { FMOutput, FontStrike } from "./fontManager";
import type { FontInfo } from "./types";
import { isRectRgn } from "./regionTypes";
import { TrimRect } from "./rgnOp";
import { withCursorShield } from "./cursors";
import { srcOr } from "./constants";
import { acquireBitRow } from "./scratch";

const RIGHT_MASKS = [
  0x0000, 0x8000, 0xc000, 0xe000, 0xf000, 0xf800, 0xfc00, 0xfe00, 0xff00, 0xff80,
  0xffc0, 0xffe0, 0xfff0, 0xfff8, 0xfffc, 0xfffe,
];

function clonePt(p: Point): Point {
  return { h: p.h, v: p.v };
}

function cloneR(r: Rect): Rect {
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}

/**
 * Each pixel ORs the original pixel to its left — same bits as
 * `ROXR.L #1` then `OR` across big-endian longs (`DrawText.a:664-674`).
 * Walks `longCount+1` longs so the carry lands in the pad long.
 */
function boldSmear(buf: Uint8Array, longCount: number): void {
  const bytes = Math.min((longCount + 1) * 4, buf.length);
  let carry = 0;
  for (let i = 0; i < bytes; i++) {
    const b = buf[i]!;
    buf[i] = (b | (b >> 1) | (carry << 7)) & 0xff;
    carry = b & 1;
  }
}

/** Italic shear from the bottom up, 1/16 px × `italic` per row (`DrawText.a:682-712`). */
function italicShear(
  buf: Uint8Array,
  bufRow: number,
  height: number,
  italic: number
): void {
  let offset = 0;
  for (let i = 0; i < height; i++) {
    offset += italic;
    const delta = offset >>> 4;
    const row = height - 2 - i;
    if (row < 0) break;
    shiftRowRight(buf, row * bufRow, bufRow, delta);
  }
}

function shiftRowRight(
  buf: Uint8Array,
  rowOff: number,
  rowBytes: number,
  pixels: number
): void {
  if (pixels <= 0 || rowBytes <= 0) return;
  const byteShift = pixels >>> 3;
  const bitShift = pixels & 7;
  if (byteShift > 0) {
    for (let i = rowBytes - 1; i >= 0; i--) {
      buf[rowOff + i] = i >= byteShift ? buf[rowOff + i - byteShift]! : 0;
    }
  }
  if (bitShift === 0) return;
  let carry = 0;
  for (let i = 0; i < rowBytes; i++) {
    const b = buf[rowOff + i]!;
    buf[rowOff + i] = ((b >>> bitShift) | (carry << (8 - bitShift))) & 0xff;
    carry = b & ((1 << bitShift) - 1);
  }
}

/**
 * Underline at baseline+1 with a 1-px halo from the glyph bits
 * (`DrawText.a:720-775`). `ulOffset` / `ulShadow` are unused here.
 */
function underlineBuffer(
  buf: Uint8Array,
  bufRow: number,
  ascent: number,
  descent: number,
  lastRightBuf: number,
  bufLeft: number,
  portLeft: number
): void {
  if ((descent | 0) < 2 || bufRow < 4) return;
  const longs = bufRow >> 2;
  const base = ascent * bufRow;
  const row1 = base + bufRow;
  const row2 = descent === 2 ? base : base + 2 * bufRow;
  if (row1 + bufRow > buf.length) return;

  const n = longs * 4;
  const halo = acquireBitRow(n, 0);
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const v = (buf[base + i]! | buf[row1 + i]! | buf[row2 + i]!) & 0xff;
    halo[i] = (v | (v >> 1) | (carry << 7)) & 0xff;
    carry = v & 1;
  }
  carry = 0;
  for (let i = n - 1; i >= 0; i--) {
    const t = halo[i]!;
    const smeared = ((t << 1) | carry) & 0xff;
    buf[row1 + i] = (buf[row1 + i]! | (~(t | smeared) & 0xff)) & 0xff;
    carry = (t >>> 7) & 1;
  }

  // Trim right: clear full words of overshoot, then AND RightMask (`DrawText.a:763-775`).
  let overshoot = ((bufRow << 3) - lastRightBuf - 1) >> 4;
  let wordOff = row1 + bufRow;
  while (overshoot >= 0) {
    wordOff -= 2;
    if (wordOff >= row1) {
      buf[wordOff] = 0;
      buf[wordOff + 1] = 0;
    }
    overshoot--;
  }
  const lastLocal = lastRightBuf + bufLeft;
  const mask = RIGHT_MASKS[(lastLocal - portLeft) & 0xf] ?? 0;
  wordOff -= 2;
  if (wordOff >= row1) {
    const w = ((buf[wordOff] ?? 0) << 8) | (buf[wordOff + 1] ?? 0);
    const trimmed = w & mask;
    buf[wordOff] = (trimmed >> 8) & 0xff;
    buf[wordOff + 1] = trimmed & 0xff;
  }
}

function strikeBitMap(strike: FontStrike): BitMap {
  return {
    baseAddr: strike.bitImage,
    rowBytes: strike.rowWords * 2,
    bounds: {
      top: 0,
      left: 0,
      bottom: strike.fRectHeight,
      right: strike.rowWords * 16,
    },
  };
}

function owAt(strike: FontStrike, index: number): number {
  return strike.owTable[index] ?? 0x8000;
}

function locAt(strike: FontStrike, index: number): number {
  return strike.locTable[index] ?? 0;
}

function charBlt(
  src: BitMap,
  dst: BitMap,
  srcLeft: number,
  dstLeft: number,
  dstRight: number,
  srcTop: number,
  destTop0: number,
  height: number,
  clip?: Rect
): void {
  if (height <= 0 || dstRight <= dstLeft) return;
  let destLeft = dst.bounds.left + dstLeft;
  let destRight = dst.bounds.left + dstRight;
  let destTop = destTop0;
  let destBot = destTop + height;
  let sLeft = srcLeft;
  let sTop = srcTop;

  if (clip) {
    if (destLeft < clip.left) {
      sLeft += clip.left - destLeft;
      destLeft = clip.left;
    }
    if (destRight > clip.right) destRight = clip.right;
    if (destTop < clip.top) {
      sTop += clip.top - destTop;
      destTop = clip.top;
    }
    if (destBot > clip.bottom) destBot = clip.bottom;
  }
  if (destLeft < dst.bounds.left) {
    sLeft += dst.bounds.left - destLeft;
    destLeft = dst.bounds.left;
  }
  if (destRight > dst.bounds.right) destRight = dst.bounds.right;
  if (destTop < dst.bounds.top) {
    sTop += dst.bounds.top - destTop;
    destTop = dst.bounds.top;
  }
  if (destBot > dst.bounds.bottom) destBot = dst.bounds.bottom;
  if (sLeft < src.bounds.left) {
    destLeft += src.bounds.left - sLeft;
    sLeft = src.bounds.left;
  }
  if (sTop < src.bounds.top) {
    destTop += src.bounds.top - sTop;
    sTop = src.bounds.top;
  }
  let width = destRight - destLeft;
  let rows = destBot - destTop;
  if (sLeft + width > src.bounds.right) width = src.bounds.right - sLeft;
  if (sTop + rows > src.bounds.bottom) rows = src.bounds.bottom - sTop;
  if (width <= 0 || rows <= 0) return;

  for (let row = 0; row < rows; row++) {
    blitRowBits(src, sTop + row, sLeft, dst, destTop + row, destLeft, width, srcOr);
  }
}

/**
 * Direct-to-screen when `srcOr`, no style, 1:1, rectangular clip
 * (`DrawText.a:223-256`). `"empty"` if TrimRect of vis is vacant.
 */
function textCanGoFast(
  port: GrafPort,
  fm: FMOutput,
  stretch: boolean,
  minRect: Rect
): boolean | "empty" {
  if (stretch) return false;
  if ((port.txMode & 7) !== srcOr) return false;
  if ((fm.bold & 0xff) !== 0) return false;
  if ((fm.italic & 0xff) !== 0) return false;
  if ((fm.ulThick & 0xff) !== 0) return false;
  if ((fm.shadow & 0xff) !== 0) return false;
  if (!isRectRgn(port.clipRgn.rgn)) return false;
  if (!isRectRgn(port.visRgn.rgn)) {
    const t = TrimRect(port.visRgn.rgn, minRect);
    if (t < 0) return "empty";
    if (t > 0) return false;
  }
  if (port.colrBit !== 0) {
    const d = (~(port.bkColor | 0) & (port.fgColor | 0)) >>> 0;
    if (((d >>> (port.colrBit & 31)) & 1) === 0) return false;
  }
  return true;
}

function paintGlyphs(
  dest: BitMap,
  bufLeft: number,
  clip: Rect | undefined,
  strike: FontStrike,
  widths: Int32Array,
  textAddr: number[],
  count: number,
  penLoc: Point,
  srcBits: BitMap,
  heightFlag: boolean,
  topHt: number,
  /** Added to `charTop` so the fast path can target port `y` while scratch uses `bounds.top`. */
  originTop: number
): number {
  const minCh = strike.firstChar | 0;
  const maxMin = (strike.lastChar - strike.firstChar) | 0;
  const spWidth = widths[32] ?? 0;
  let charLoc = (((penLoc.h + strike.kernMax - bufLeft) << 16) + 0x8000) | 0;
  let charTop = (strike.fRectHeight >> 8) & 0xff;
  let charHeight = strike.fRectHeight & 0xff;
  if (charHeight === 0 && strike.fRectHeight > 0) {
    charTop = 0;
    charHeight = strike.fRectHeight;
  }

  let i = 0;
  while (i < count) {
    const ch = (textAddr[i] ?? 0) & 0xff;
    if (ch === 32) {
      charLoc = (charLoc + spWidth) | 0;
      i++;
      continue;
    }
    const adv = widths[ch] ?? 0;
    let idx = (ch - minCh) | 0;
    if (idx < 0 || idx > maxMin) {
      idx = maxMin + 1;
      if (owAt(strike, idx) < 0) {
        i++;
        continue;
      }
    } else if (owAt(strike, idx) < 0) {
      idx = maxMin + 1;
      if (owAt(strike, idx) < 0) {
        i++;
        continue;
      }
    }
    const ow = owAt(strike, idx);
    const offsetByte = (ow >> 8) & 0xff;
    const dstLeft = (HiWord(charLoc) + offsetByte) | 0;
    charLoc = (charLoc + adv) | 0;
    const srcLeft = locAt(strike, idx);
    const srcRight = locAt(strike, idx + 1);
    const bitW = (srcRight - srcLeft) | 0;
    if (bitW <= 0) {
      i++;
      continue;
    }
    const dstRight = (dstLeft + bitW) | 0;
    if (heightFlag && strike.heightTable) {
      const ht = strike.heightTable[idx] ?? 0;
      charTop = (ht >> 8) & 0xff;
      charHeight = ht & 0xff;
    } else {
      charTop = (topHt >> 8) & 0xff;
      charHeight = topHt & 0xff;
      if (charHeight === 0 && strike.fRectHeight > 0) {
        charTop = 0;
        charHeight = strike.fRectHeight;
      }
    }
    charBlt(
      srcBits,
      dest,
      srcLeft,
      dstLeft,
      dstRight,
      charTop,
      dest.bounds.top + originTop + charTop,
      charHeight,
      clip
    );
    i++;
  }
  return (HiWord(charLoc) - strike.kernMax) | 0;
}

/**
 * `PROCEDURE DrText(count, textAddr, numer, denom)` (`DrawText.a:12-929`).
 */
export function DrText(
  count: number,
  textAddr: number[],
  numer: Point,
  denom: Point
): void {
  const port = requirePort();
  if ((count | 0) <= 0) return;

  const info: FontInfo = { ascent: 0, descent: 0, widMax: 0, leading: 0 };
  const numerV = { h: numer.h, v: numer.v };
  const denomV = { h: denom.h, v: denom.v };
  let width = StdTxMeas(count, textAddr, numerV, denomV, info) | 0;

  const fm = globals.fontPtr as FMOutput | null;
  if (!fm?.fontHandle) return; // Text.a:607-611 — nil font: no draw, no bump
  const strike = fm.fontHandle;
  const widths = fm.widthTable;
  const penLoc = clonePt(port.pnLoc);

  const textRect: Rect = {
    left: penLoc.h,
    right: penLoc.h + width,
    top: 0,
    bottom: 0,
  };
  const modeLow = port.txMode & 7;
  if (modeLow !== 0 && modeLow <= 3) {
    textRect.right += 32; // slop for italic/bold/overstrike (`DrawText.a:141-146`)
  }
  textRect.top = penLoc.v - strike.ascent;
  textRect.bottom = textRect.top + strike.fRectHeight;
  const textR2 = cloneR(textRect);

  const stretch = packEq(numerV, denomV) === false;
  const fromRect: Rect = {
    top: penLoc.v,
    left: penLoc.h,
    bottom: penLoc.v + asInt16(denomV.v),
    right: penLoc.h + asInt16(denomV.h),
  };
  const toRect: Rect = {
    top: penLoc.v,
    left: penLoc.h,
    bottom: penLoc.v + asInt16(numerV.v),
    right: penLoc.h + asInt16(numerV.h),
  };
  if (stretch) {
    width = ((width & 0xffff) * (asInt16(numerV.h) & 0xffff) / (asInt16(denomV.h) & 0xffff)) | 0;
    MapRect(textR2, fromRect, toRect);
  }

  port.pnLoc.h = (port.pnLoc.h + width) | 0;
  if ((port.pnVis | 0) < 0) return;

  const minRect = rsect([
    textR2,
    port.portBits.bounds,
    port.clipRgn.rgn.rgnBBox,
    port.visRgn.rgn.rgnBBox,
  ]);
  if (!minRect) return;

  const srcBits = strikeBitMap(strike);
  const height = strike.fRectHeight | 0;
  const heightFlag = (strike.fontType & 1) !== 0 && !!strike.heightTable;
  const topHt = strike.fRectHeight & 0xff;
  const portBounds = port.portBits.bounds;

  const fast = textCanGoFast(port, fm, stretch, minRect);
  if (fast === "empty") return;
  if (fast) {
    withCursorShield(minRect, { v: portBounds.top, h: portBounds.left }, () => {
      paintGlyphs(
        port.portBits,
        portBounds.left,
        minRect,
        strike,
        widths,
        textAddr,
        count,
        penLoc,
        srcBits,
        heightFlag,
        topHt,
        textRect.top - portBounds.top
      );
    });
    return;
  }

  const bufLeft =
    ((((textRect.left - portBounds.left) | 0) & ~0xf) - 32 + portBounds.left) | 0;
  const dotsWide = (textRect.right - bufLeft) | 0;
  const longsPerRow = (dotsWide >> 5) + 2;
  const bufRow = longsPerRow << 2;
  const bufSizeLongs = height * longsPerRow;
  const buf = new Uint8Array((bufSizeLongs + 2) * 4);

  const scratch: BitMap = {
    baseAddr: buf,
    rowBytes: bufRow,
    bounds: {
      top: textRect.top,
      left: bufLeft,
      bottom: textRect.bottom,
      right: bufLeft + (bufRow << 3),
    },
  };

  const lastRightBuf = paintGlyphs(
    scratch,
    bufLeft,
    undefined,
    strike,
    widths,
    textAddr,
    count,
    penLoc,
    srcBits,
    heightFlag,
    topHt,
    0
  );

  for (let b = fm.bold & 0xff; b > 0; b--) boldSmear(buf, bufSizeLongs);
  if ((fm.italic & 0xff) !== 0) {
    italicShear(buf, bufRow, height, fm.italic & 0xff);
  }
  if ((fm.ulThick & 0xff) !== 0) {
    underlineBuffer(
      buf,
      bufRow,
      strike.ascent,
      strike.descent,
      lastRightBuf,
      bufLeft,
      portBounds.left
    );
  }

  const fakeRgn = { rgn: rectRegion(portBounds) };
  const srcBM: BitMap = {
    baseAddr: buf,
    rowBytes: bufRow,
    bounds: {
      top: textRect.top,
      left: bufLeft,
      bottom: textRect.bottom,
      right: textRect.right,
    },
  };
  const dstBM: BitMap = {
    baseAddr: port.portBits.baseAddr,
    rowBytes: port.portBits.rowBytes,
    bounds: cloneR(port.portBits.bounds),
  };

  const shadow = fm.shadow & 0xff;
  if (shadow !== 0) {
    const sh = shadow & 3;
    const extraRows = 4;
    const buf2 = new Uint8Array(bufRow * (height + extraRows) + 8);
    // Copy buf1 into buf2 (top), leaving 4 extra scanlines at the bottom.
    buf2.set(buf.subarray(0, bufRow * height));
    for (let s = 0; s < sh; s++) boldSmear(buf2, ((height + extraRows) * longsPerRow) | 0);
    // Bold down: OR each row with the row above, `shadow` times (`DrawText.a:849-859`).
    for (let s = 0; s < sh; s++) {
      const last = bufRow * (height + extraRows);
      for (let i = last - 1; i >= bufRow; i--) {
        buf2[i] = (buf2[i]! | (buf2[i - bufRow] ?? 0)) & 0xff;
      }
    }
    const srcRect = cloneR(textRect);
    srcRect.bottom += 4;
    const dstRect = cloneR(srcRect);
    dstRect.top -= 1;
    dstRect.left -= 1;
    dstRect.bottom -= 1;
    dstRect.right -= 1;
    if (stretch) MapRect(dstRect, fromRect, toRect);
    const shadowSrc: BitMap = {
      baseAddr: buf2,
      rowBytes: bufRow,
      bounds: {
        top: textRect.top,
        left: bufLeft,
        bottom: textRect.bottom + 4,
        right: textRect.right,
      },
    };
    StretchBits(
      shadowSrc,
      dstBM,
      srcRect,
      dstRect,
      modeLow,
      port.clipRgn,
      port.visRgn,
      fakeRgn
    );
  }

  let blitMode = port.txMode;
  if (shadow !== 0) blitMode = 2; // srcXor (`DrawText.a:917-920`)
  blitMode &= 7;
  StretchBits(
    srcBM,
    dstBM,
    textRect,
    textR2,
    blitMode,
    port.clipRgn,
    port.visRgn,
    fakeRgn
  );
}

function packEq(a: Point, b: Point): boolean {
  return asInt16(a.h) === asInt16(b.h) && asInt16(a.v) === asInt16(b.v);
}
