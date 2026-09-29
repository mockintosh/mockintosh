/**
 * 1-bit cursor faces — sprite + hot spot.
 *
 * Widgets still declare a name. Hosts look up a face and either blit it
 * (OS / `cursors: "mac"`) or turn it into a CSS `url()` (`cssCursorFromFace`).
 */

import {
  CopyBits,
  SetPort,
  srcBic,
  srcXor,
  type BitMap,
  type Cursor,
  type GrafPort,
  type Point,
} from "@mockintosh/quickdraw";
import { makeRect } from "@mockintosh/quickdraw/bits";
import { encodeBase64 } from "./base64";
import type { CursorSpec, NamedCursor } from "./cursor";
import { encodePngRgba } from "./png";
import type { Sprite } from "./sprite";

/**
 * A cursor as the ROM draws it: `(screen AND NOT mask) XOR data`. So a pixel
 * with `data` set where the sprite's `mask` is clear inverts what is under it
 * — MacPaint's crosshairs and brush shapes rely on that.
 */
export interface CursorFace {
  sprite: Sprite;
  hotSpot: Point;
}

export type CursorFaceTable = Partial<Record<NamedCursor, CursorFace>>;

export const CURSOR_SIZE = 16;
const CURSOR_RECT = makeRect(0, 0, CURSOR_SIZE, CURSOR_SIZE);
const faceCursors = new WeakMap<CursorFace, Cursor>();
const faceCss = new WeakMap<CursorFace, string>();

export function isCursorFace(value: unknown): value is CursorFace {
  if (typeof value !== "object" || value === null) return false;
  const face = value as Partial<CursorFace>;
  return typeof face.sprite === "object" && face.sprite !== null && typeof face.hotSpot === "object";
}

/** Pack a sprite of at most 16×16 into a QuickDraw `Cursor`. */
export function cursorFromFace(face: CursorFace): Cursor {
  const { sprite, hotSpot } = face;
  if (sprite.width > CURSOR_SIZE || sprite.height > CURSOR_SIZE) {
    throw new Error(`Cursors are at most 16×16; got ${sprite.width}×${sprite.height}`);
  }
  const data = new Uint16Array(CURSOR_SIZE);
  const mask = new Uint16Array(CURSOR_SIZE);
  for (let v = 0; v < sprite.height; v++) {
    let d = 0;
    let m = 0;
    for (let h = 0; h < sprite.width; h++) {
      const i = v * sprite.width + h;
      const bit = 0x8000 >> h;
      const opaque = sprite.mask ? sprite.mask[i] !== 0 : true;
      if (opaque) m |= bit;
      if (sprite.data[i]) d |= bit;
    }
    data[v] = d;
    mask[v] = m;
  }
  return { data, mask, hotSpot: { h: hotSpot.h, v: hotSpot.v } };
}

/** Inverse of {@link cursorFromFace} — used to lift QuickDraw's ROM arrow. */
export function faceFromCursor(cursor: Cursor): CursorFace {
  const data = new Uint8Array(CURSOR_SIZE * CURSOR_SIZE);
  const mask = new Uint8Array(CURSOR_SIZE * CURSOR_SIZE);
  for (let v = 0; v < CURSOR_SIZE; v++) {
    for (let h = 0; h < CURSOR_SIZE; h++) {
      const bit = 0x8000 >> h;
      const i = v * CURSOR_SIZE + h;
      mask[i] = cursor.mask[v] & bit ? 1 : 0;
      data[i] = cursor.data[v] & bit ? 1 : 0;
    }
  }
  return {
    sprite: { width: CURSOR_SIZE, height: CURSOR_SIZE, data, mask },
    hotSpot: { h: cursor.hotSpot.h, v: cursor.hotSpot.v },
  };
}

function packBits16(words: Uint16Array): { baseAddr: Uint8Array; rowBytes: number; bounds: ReturnType<typeof makeRect> } {
  const bytes = new Uint8Array(CURSOR_SIZE * 2);
  for (let v = 0; v < CURSOR_SIZE; v++) {
    bytes[v * 2] = words[v] >> 8;
    bytes[v * 2 + 1] = words[v] & 0xff;
  }
  return { baseAddr: bytes, rowBytes: 2, bounds: CURSOR_RECT };
}

const packed = new WeakMap<Cursor, { data: ReturnType<typeof packBits16>; mask: ReturnType<typeof packBits16> }>();

function packedCursor(cursor: Cursor) {
  let entry = packed.get(cursor);
  if (!entry) {
    entry = { data: packBits16(cursor.data), mask: packBits16(cursor.mask) };
    packed.set(cursor, entry);
  }
  return entry;
}

/** Packed QuickDraw cursor for a face. Faces are treated as immutable. */
export function cursorFromFaceCached(face: CursorFace): Cursor {
  let cursor = faceCursors.get(face);
  if (!cursor) {
    cursor = cursorFromFace(face);
    faceCursors.set(face, cursor);
  }
  return cursor;
}

function stampCursorBits(dest: BitMap, cursor: Cursor, x: number, y: number): void {
  const { data, mask } = packedCursor(cursor);
  const top = y - cursor.hotSpot.v;
  const left = x - cursor.hotSpot.h;
  const dst = makeRect(top, left, top + CURSOR_SIZE, left + CURSOR_SIZE);
  CopyBits(mask, dest, CURSOR_RECT, dst, srcBic, null);
  CopyBits(data, dest, CURSOR_RECT, dst, srcXor, null);
}

/**
 * Paint a QuickDraw cursor into `port` with its hot spot at (`x`, `y`).
 * Mask `srcBic`, then data `srcXor` — the ROM VBL order.
 */
export function blitQuickdrawCursor(port: GrafPort, cursor: Cursor, x: number, y: number): void {
  SetPort(port);
  stampCursorBits(port.portBits, cursor, x, y);
}

/** Same stamp as {@link blitQuickdrawCursor}, onto a raw `BitMap` (no port clip). */
export function blitQuickdrawCursorBits(dest: BitMap, cursor: Cursor, x: number, y: number): void {
  stampCursorBits(dest, cursor, x, y);
}

export function blitCursorFace(port: GrafPort, face: CursorFace, x: number, y: number): void {
  blitQuickdrawCursor(port, cursorFromFaceCached(face), x, y);
}

function spriteToRgba(sprite: Sprite): Uint8Array {
  const rgba = new Uint8Array(sprite.width * sprite.height * 4);
  for (let i = 0; i < sprite.width * sprite.height; i++) {
    const opaque = sprite.mask ? sprite.mask[i] !== 0 : true;
    // CSS cannot invert; an XOR pixel shows black.
    if (!opaque && !sprite.data[i]) continue;
    const ink = sprite.data[i] ? 0 : 255;
    const o = i * 4;
    rgba[o] = ink;
    rgba[o + 1] = ink;
    rgba[o + 2] = ink;
    rgba[o + 3] = 255;
  }
  return rgba;
}

/** CSS `cursor` value for a 1-bit face (`url(png) hx hy, fallback`). */
export function cssCursorFromFace(face: CursorFace, fallback = "default"): string {
  const { sprite, hotSpot } = face;
  const png = encodePngRgba(spriteToRgba(sprite), sprite.width, sprite.height);
  return `url("data:image/png;base64,${encodeBase64(png)}") ${hotSpot.h} ${hotSpot.v}, ${fallback}`;
}

/** {@link cssCursorFromFace} with the default fallback, encoded once per face. */
export function cssCursorFromFaceCached(face: CursorFace): string {
  let css = faceCss.get(face);
  if (css === undefined) {
    css = cssCursorFromFace(face);
    faceCss.set(face, css);
  }
  return css;
}

export function cssTableFromFaces(
  faces: CursorFaceTable,
  fallbacks?: Partial<Record<NamedCursor, string>>,
): Partial<Record<NamedCursor, string>> {
  const out: Partial<Record<NamedCursor, string>> = {};
  for (const [name, face] of Object.entries(faces) as [NamedCursor, CursorFace | undefined][]) {
    if (!face) continue;
    out[name] = cssCursorFromFace(face, fallbacks?.[name] ?? "default");
  }
  return out;
}

export function resolveCursorFace(
  spec: CursorSpec,
  faces: CursorFaceTable,
): CursorFace | undefined {
  if (isCursorFace(spec)) return spec;
  if (spec === "none") return undefined;
  const named = Object.prototype.hasOwnProperty.call(faces, spec)
    ? faces[spec as NamedCursor]
    : undefined;
  return named ?? faces.default ?? faces.arrow;
}
