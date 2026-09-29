/**
 * MacPaint documents — `image/x-macpaint`, file type 'PNTG'.
 *
 * The layout is MacPaint 1.x's own (`MacPaint.p`, BlankDoc / ReadDoc /
 * WriteDoc): a 512-byte header whose first long is the version (2 when the
 * document carries its 38 fill patterns, which follow at byte 4), then 720
 * scan lines of 576 pixels, each packed separately with PackBits. Bits are
 * QuickDraw's: 1 is black, the high bit is the leftmost pixel.
 */
import { MIME, type FSFile, type NodeAttributes } from "@mockintosh/fs";
import type { ImageFrame, Sprite } from "@mockintosh/ui";
import type { AppFileSystem } from "./index";

export const PAINT_WIDTH = 576;
export const PAINT_HEIGHT = 720;
export const PAINT_ROW_BYTES = PAINT_WIDTH / 8;
export const PAINT_PATTERN_COUNT = 38;

const HEADER_BYTES = 512;
const PATTERN_OFFSET = 4;
const PATTERN_BYTES = PAINT_PATTERN_COUNT * 8;
const PATTERN_VERSION = 2;
const MACBINARY_HEADER = 128;

/** A whole MacPaint page. */
export interface PaintDocument {
  /** `PAINT_ROW_BYTES × PAINT_HEIGHT` packed bits, 1 = black. */
  bits: Uint8Array;
  /**
   * The document's fill patterns, 8 bytes each. `null` for version 0 files,
   * which leave the palette as the reader has it.
   */
  patterns: Uint8Array | null;
}

export function blankPaintDocument(patterns: Uint8Array | null = null): PaintDocument {
  return { bits: new Uint8Array(PAINT_ROW_BYTES * PAINT_HEIGHT), patterns };
}

/** Apple PackBits (`_PackBits`): runs of three or more repeat, the rest go literal. */
export function packBits(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 3) {
      out.push(257 - run, src[i]!);
      i += run;
      continue;
    }
    const start = i;
    while (i < src.length && i - start < 128) {
      if (i + 2 < src.length && src[i] === src[i + 1] && src[i] === src[i + 2]) break;
      i++;
    }
    out.push(i - start - 1);
    for (let k = start; k < i; k++) out.push(src[k]!);
  }
  return Uint8Array.from(out);
}

/**
 * `_UnpackBits` into `dst` from `src[offset]`. Returns the offset after the
 * last byte consumed; throws if `src` ends first.
 */
export function unpackBits(src: Uint8Array, offset: number, dst: Uint8Array): number {
  let p = offset;
  let o = 0;
  while (o < dst.length) {
    if (p >= src.length) throw new Error("The picture ends early.");
    const n = (src[p++]! << 24) >> 24;
    if (n >= 0) {
      const count = n + 1;
      if (p + count > src.length) throw new Error("The picture ends early.");
      for (let k = 0; k < count && o < dst.length; k++) dst[o++] = src[p + k]!;
      p += count;
    } else if (n !== -128) {
      const value = src[p++]!;
      for (let k = 0; k < 1 - n && o < dst.length; k++) dst[o++] = value;
    }
  }
  return p;
}

/** Files carried over from a real Mac often keep their 128-byte MacBinary wrapper. */
function hasMacBinaryHeader(bytes: Uint8Array): boolean {
  if (bytes.length < MACBINARY_HEADER + HEADER_BYTES || bytes[0] !== 0) return false;
  const type = String.fromCharCode(bytes[65]!, bytes[66]!, bytes[67]!, bytes[68]!);
  return type === "PNTG";
}

export function decodePaint(bytes: Uint8Array): PaintDocument {
  const start = hasMacBinaryHeader(bytes) ? MACBINARY_HEADER : 0;
  if (bytes.length < start + HEADER_BYTES) throw new Error("This is not a MacPaint document.");
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, HEADER_BYTES);
  const version = view.getUint32(0);
  const patterns =
    version >= PATTERN_VERSION
      ? bytes.slice(start + PATTERN_OFFSET, start + PATTERN_OFFSET + PATTERN_BYTES)
      : null;
  const bits = new Uint8Array(PAINT_ROW_BYTES * PAINT_HEIGHT);
  unpackBits(bytes, start + HEADER_BYTES, bits);
  return { bits, patterns };
}

/** Encode as MacPaint writes it: version 2, one PackBits run list per row, padded to a 512-byte block. */
export function encodePaint(doc: PaintDocument): Uint8Array {
  if (doc.bits.length !== PAINT_ROW_BYTES * PAINT_HEIGHT) {
    throw new Error(`A MacPaint page is ${PAINT_WIDTH}×${PAINT_HEIGHT}.`);
  }
  const rows: Uint8Array[] = [];
  let packed = 0;
  for (let v = 0; v < PAINT_HEIGHT; v++) {
    const row = packBits(doc.bits.subarray(v * PAINT_ROW_BYTES, (v + 1) * PAINT_ROW_BYTES));
    rows.push(row);
    packed += row.length;
  }
  const size = Math.ceil((HEADER_BYTES + packed) / HEADER_BYTES) * HEADER_BYTES;
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, doc.patterns ? PATTERN_VERSION : 0);
  if (doc.patterns) out.set(doc.patterns.subarray(0, PATTERN_BYTES), PATTERN_OFFSET);
  let o = HEADER_BYTES;
  for (const row of rows) {
    out.set(row, o);
    o += row.length;
  }
  return out;
}

/** The page as a sprite: one byte per pixel, 1 = black. */
export function paintToSprite(doc: PaintDocument): Sprite {
  const data = new Uint8Array(PAINT_WIDTH * PAINT_HEIGHT);
  for (let i = 0; i < data.length; i++) {
    data[i] = (doc.bits[i >> 3]! >> (7 - (i & 7))) & 1;
  }
  return { width: PAINT_WIDTH, height: PAINT_HEIGHT, data };
}

export function paintToImageFrame(doc: PaintDocument): ImageFrame {
  const rgba = new Uint8ClampedArray(PAINT_WIDTH * PAINT_HEIGHT * 4);
  for (let i = 0, o = 0; i < PAINT_WIDTH * PAINT_HEIGHT; i++, o += 4) {
    const v = (doc.bits[i >> 3]! >> (7 - (i & 7))) & 1 ? 0 : 255;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
  return { width: PAINT_WIDTH, height: PAINT_HEIGHT, rgba };
}

/** Decode a MacPaint file, or `null` if it cannot be read. */
export async function readPaintFile(fs: AppFileSystem, fileId: string): Promise<PaintDocument | null> {
  const bytes = await fs.readBytes(fileId);
  if (!bytes) return null;
  try {
    return decodePaint(bytes);
  } catch {
    return null;
  }
}

export interface WritePaintFileOptions {
  attributes?: NodeAttributes;
}

/** Write `doc` as a MacPaint file named `name` in `parentId`, replacing a file of that name. */
export function writePaintFile(
  fs: AppFileSystem,
  parentId: string,
  name: string,
  doc: PaintDocument,
  options: WritePaintFileOptions = {},
): Promise<FSFile> {
  return fs.writeFile(parentId, name, encodePaint(doc), { type: MIME.paint, attributes: options.attributes });
}
