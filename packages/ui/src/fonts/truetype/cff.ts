/**
 * `CFF ` table reader: Type 2 charstrings → cubic contours.
 *
 * Covers name-keyed and CID-keyed fonts (FDArray / FDSelect), local and
 * global subroutines, and the flex operators. Stem hints are counted only
 * so `hintmask` skips the right number of bytes; `autohint.ts` grid-fits.
 */

import type { OutlinePoint } from "./sfnt";

export interface CffOutlines {
  glyph(gid: number): OutlinePoint[][];
}

interface Index {
  count: number;
  item(i: number): Uint8Array;
  end: number;
}

function readIndex(data: Uint8Array, offset: number): Index {
  const count = (data[offset]! << 8) | data[offset + 1]!;
  if (count === 0) return { count: 0, item: () => new Uint8Array(0), end: offset + 2 };
  const offSize = data[offset + 2]!;
  const offAt = (i: number): number => {
    let v = 0;
    const p = offset + 3 + i * offSize;
    for (let k = 0; k < offSize; k++) v = v * 256 + data[p + k]!;
    return v;
  };
  const base = offset + 2 + (count + 1) * offSize;
  return {
    count,
    item: (i) => data.subarray(base + offAt(i), base + offAt(i + 1)),
    end: base + offAt(count),
  };
}

type Dict = Map<number, number[]>;

function readReal(data: Uint8Array, p: number): { value: number; next: number } {
  let s = "";
  const map = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "E", "E-", "", "-", ""];
  for (;;) {
    const b = data[p++]!;
    const hi = b >> 4;
    const lo = b & 15;
    if (hi === 15) break;
    s += map[hi];
    if (lo === 15) break;
    s += map[lo];
  }
  return { value: Number.parseFloat(s) || 0, next: p };
}

function readDict(data: Uint8Array): Dict {
  const dict: Dict = new Map();
  let operands: number[] = [];
  let p = 0;
  while (p < data.length) {
    const b0 = data[p]!;
    if (b0 <= 21) {
      let op = b0;
      p++;
      if (b0 === 12) op = 1200 + data[p++]!;
      dict.set(op, operands);
      operands = [];
    } else if (b0 === 28) {
      operands.push(((data[p + 1]! << 24) >> 16) | data[p + 2]!);
      p += 3;
    } else if (b0 === 29) {
      operands.push((data[p + 1]! << 24) | (data[p + 2]! << 16) | (data[p + 3]! << 8) | data[p + 4]!);
      p += 5;
    } else if (b0 === 30) {
      const r = readReal(data, p + 1);
      operands.push(r.value);
      p = r.next;
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      p++;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + data[p + 1]! + 108);
      p += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - data[p + 1]! - 108);
      p += 2;
    } else p++;
  }
  return dict;
}

function subrBias(count: number): number {
  return count < 1240 ? 107 : count < 33900 ? 1131 : 32768;
}

interface PrivateInfo {
  subrs: Index | undefined;
}

function readPrivate(cff: Uint8Array, entry: number[] | undefined): PrivateInfo {
  if (!entry || entry.length < 2) return { subrs: undefined };
  const [size, offset] = entry as [number, number];
  const priv = readDict(cff.subarray(offset, offset + size));
  const subrsOff = priv.get(19)?.[0];
  return { subrs: subrsOff ? readIndex(cff, offset + subrsOff) : undefined };
}

export function readCffOutlines(cff: Uint8Array): CffOutlines {
  const hdrSize = cff[2]!;
  const names = readIndex(cff, hdrSize);
  const topDicts = readIndex(cff, names.end);
  const strings = readIndex(cff, topDicts.end);
  const gsubrs = readIndex(cff, strings.end);
  const top = readDict(topDicts.item(0));
  const charStrings = readIndex(cff, top.get(17)?.[0] ?? 0);

  let privates: PrivateInfo[];
  let fdOf: (gid: number) => number = () => 0;
  const fdArrayOff = top.get(1236)?.[0];
  if (fdArrayOff !== undefined) {
    const fdArray = readIndex(cff, fdArrayOff);
    privates = [];
    for (let i = 0; i < fdArray.count; i++) privates.push(readPrivate(cff, readDict(fdArray.item(i)).get(18)));
    const fdSelectOff = top.get(1237)?.[0] ?? 0;
    const format = cff[fdSelectOff]!;
    if (format === 0) fdOf = (gid) => cff[fdSelectOff + 1 + gid] ?? 0;
    else if (format === 3) {
      const n = (cff[fdSelectOff + 1]! << 8) | cff[fdSelectOff + 2]!;
      const ranges: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const r = fdSelectOff + 3 + i * 3;
        ranges.push([(cff[r]! << 8) | cff[r + 1]!, cff[r + 2]!]);
      }
      fdOf = (gid) => {
        let fd = 0;
        for (const [first, f] of ranges) {
          if (first > gid) break;
          fd = f;
        }
        return fd;
      };
    }
  } else {
    privates = [readPrivate(cff, top.get(18))];
  }

  const glyph = (gid: number): OutlinePoint[][] => {
    if (gid < 0 || gid >= charStrings.count) return [];
    const local = privates[fdOf(gid)]?.subrs;
    return runCharstring(charStrings.item(gid), gsubrs, local);
  };
  return { glyph };
}

function runCharstring(code: Uint8Array, gsubrs: Index, lsubrs: Index | undefined): OutlinePoint[][] {
  const contours: OutlinePoint[][] = [];
  let contour: OutlinePoint[] | null = null;
  const stack: number[] = [];
  let x = 0;
  let y = 0;
  let nStems = 0;
  let haveWidth = false;
  let done = false;
  const gBias = subrBias(gsubrs.count);
  const lBias = subrBias(lsubrs?.count ?? 0);

  const close = () => {
    if (contour && contour.length > 1) {
      const first = contour[0]!;
      const last = contour[contour.length - 1]!;
      if (last.on && last.x === first.x && last.y === first.y) contour.pop();
      contours.push(contour);
    }
    contour = null;
  };
  const moveTo = (dx: number, dy: number) => {
    close();
    x += dx;
    y += dy;
    contour = [{ x, y, on: true }];
  };
  const lineTo = (dx: number, dy: number) => {
    x += dx;
    y += dy;
    contour ??= [{ x: x - dx, y: y - dy, on: true }];
    contour.push({ x, y, on: true });
  };
  const curveTo = (dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number) => {
    contour ??= [{ x, y, on: true }];
    const x1 = x + dx1;
    const y1 = y + dy1;
    const x2 = x1 + dx2;
    const y2 = y1 + dy2;
    x = x2 + dx3;
    y = y2 + dy3;
    contour.push({ x: x1, y: y1, on: false, cubic: true }, { x: x2, y: y2, on: false, cubic: true }, { x, y, on: true });
  };
  /** Drop a leading width: `even` when the operator itself takes an even argument count. */
  const takeWidth = (even: boolean) => {
    if (!haveWidth && stack.length % 2 === (even ? 1 : 0)) stack.shift();
    haveWidth = true;
  };
  const stems = () => {
    takeWidth(true);
    nStems += stack.length >> 1;
    stack.length = 0;
  };

  const exec = (buf: Uint8Array, depth: number): void => {
    if (depth > 10) return;
    let p = 0;
    while (p < buf.length && !done) {
      const b0 = buf[p++]!;
      if (b0 >= 32) {
        if (b0 <= 246) stack.push(b0 - 139);
        else if (b0 <= 250) stack.push((b0 - 247) * 256 + buf[p++]! + 108);
        else if (b0 <= 254) stack.push(-(b0 - 251) * 256 - buf[p++]! - 108);
        else {
          const v = (buf[p]! << 24) | (buf[p + 1]! << 16) | (buf[p + 2]! << 8) | buf[p + 3]!;
          stack.push(v / 65536);
          p += 4;
        }
        continue;
      }
      if (b0 === 28) {
        stack.push(((buf[p]! << 24) >> 16) | buf[p + 1]!);
        p += 2;
        continue;
      }
      switch (b0) {
        case 1:
        case 3:
        case 18:
        case 23:
          stems();
          break;
        case 19:
        case 20:
          stems();
          p += (nStems + 7) >> 3;
          break;
        case 21:
          takeWidth(true);
          moveTo(stack[0] ?? 0, stack[1] ?? 0);
          stack.length = 0;
          break;
        case 22:
          takeWidth(false);
          moveTo(stack[0] ?? 0, 0);
          stack.length = 0;
          break;
        case 4:
          takeWidth(false);
          moveTo(0, stack[0] ?? 0);
          stack.length = 0;
          break;
        case 5:
          for (let i = 0; i + 1 < stack.length; i += 2) lineTo(stack[i]!, stack[i + 1]!);
          stack.length = 0;
          break;
        case 6:
        case 7: {
          let horizontal = b0 === 6;
          for (const d of stack) {
            if (horizontal) lineTo(d, 0);
            else lineTo(0, d);
            horizontal = !horizontal;
          }
          stack.length = 0;
          break;
        }
        case 8:
          for (let i = 0; i + 5 < stack.length; i += 6)
            curveTo(stack[i]!, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, stack[i + 4]!, stack[i + 5]!);
          stack.length = 0;
          break;
        case 24: {
          let i = 0;
          for (; i + 5 < stack.length - 2; i += 6)
            curveTo(stack[i]!, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, stack[i + 4]!, stack[i + 5]!);
          lineTo(stack[i] ?? 0, stack[i + 1] ?? 0);
          stack.length = 0;
          break;
        }
        case 25: {
          let i = 0;
          for (; i + 1 < stack.length - 6; i += 2) lineTo(stack[i]!, stack[i + 1]!);
          curveTo(stack[i]!, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, stack[i + 4]!, stack[i + 5]!);
          stack.length = 0;
          break;
        }
        case 26: {
          let i = 0;
          let dx1 = 0;
          if (stack.length % 2) dx1 = stack[i++]!;
          for (; i + 3 < stack.length; i += 4) {
            curveTo(dx1, stack[i]!, stack[i + 1]!, stack[i + 2]!, 0, stack[i + 3]!);
            dx1 = 0;
          }
          stack.length = 0;
          break;
        }
        case 27: {
          let i = 0;
          let dy1 = 0;
          if (stack.length % 2) dy1 = stack[i++]!;
          for (; i + 3 < stack.length; i += 4) {
            curveTo(stack[i]!, dy1, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, 0);
            dy1 = 0;
          }
          stack.length = 0;
          break;
        }
        case 30:
        case 31: {
          let horizontal = b0 === 31;
          for (let i = 0; i + 3 < stack.length; i += 4) {
            const last = i + 5 === stack.length ? stack[i + 4]! : 0;
            if (horizontal) curveTo(stack[i]!, 0, stack[i + 1]!, stack[i + 2]!, last, stack[i + 3]!);
            else curveTo(0, stack[i]!, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, last);
            horizontal = !horizontal;
          }
          stack.length = 0;
          break;
        }
        case 10: {
          const idx = (stack.pop() ?? 0) + lBias;
          if (lsubrs && idx >= 0 && idx < lsubrs.count) exec(lsubrs.item(idx), depth + 1);
          break;
        }
        case 29: {
          const idx = (stack.pop() ?? 0) + gBias;
          if (idx >= 0 && idx < gsubrs.count) exec(gsubrs.item(idx), depth + 1);
          break;
        }
        case 11:
          return;
        case 14:
          takeWidth(true);
          close();
          done = true;
          return;
        case 12: {
          const op = buf[p++]!;
          const s = stack;
          if (op === 35) {
            curveTo(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!);
            curveTo(s[6]!, s[7]!, s[8]!, s[9]!, s[10]!, s[11]!);
          } else if (op === 34) {
            curveTo(s[0]!, 0, s[1]!, s[2]!, s[3]!, 0);
            curveTo(s[4]!, 0, s[5]!, -s[2]!, s[6]!, 0);
          } else if (op === 36) {
            curveTo(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, 0);
            curveTo(s[5]!, 0, s[6]!, s[7]!, s[8]!, -(s[1]! + s[3]! + s[7]!));
          } else if (op === 37) {
            const dx = s[0]! + s[2]! + s[4]! + s[6]! + s[8]!;
            const dy = s[1]! + s[3]! + s[5]! + s[7]! + s[9]!;
            const startX = x;
            const startY = y;
            curveTo(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!);
            if (Math.abs(dx) > Math.abs(dy)) curveTo(s[6]!, s[7]!, s[8]!, s[9]!, s[10]!, startY - (y + s[7]! + s[9]!));
            else curveTo(s[6]!, s[7]!, s[8]!, s[9]!, startX - (x + s[6]! + s[8]!), s[10]!);
          }
          stack.length = 0;
          break;
        }
        default:
          stack.length = 0;
      }
    }
  };

  exec(code, 0);
  close();
  return contours;
}
