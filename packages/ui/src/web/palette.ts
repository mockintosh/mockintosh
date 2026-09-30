import type { BitMap } from "@mockintosh/quickdraw";

/** 8-bit channel triple used by the web host when expanding 1-bit ink. */
export interface Rgb8 {
  r: number;
  g: number;
  b: number;
}

/**
 * How the web host presents packed bits.
 * `foreground` is ink (bit 1); `background` is paper (bit 0).
 */
export interface HostPalette {
  foreground: Rgb8;
  background: Rgb8;
}

export const DEFAULT_HOST_PALETTE: HostPalette = {
  foreground: { r: 0, g: 0, b: 0 },
  background: { r: 255, g: 255, b: 255 },
};

export function clampRgb8(value: Rgb8): Rgb8 {
  return {
    r: clampChannel(value.r),
    g: clampChannel(value.g),
    b: clampChannel(value.b),
  };
}

export function copyHostPalette(palette: HostPalette): HostPalette {
  return {
    foreground: clampRgb8(palette.foreground),
    background: clampRgb8(palette.background),
  };
}

export function hostPalettesEqual(a: HostPalette, b: HostPalette): boolean {
  return rgbEqual(a.foreground, b.foreground) && rgbEqual(a.background, b.background);
}

export function formatRgb8(value: Rgb8): string {
  const c = clampRgb8(value);
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** `#rgb`, `#rrggbb`, or the same without `#`. */
export function parseRgb8(input: string): Rgb8 | null {
  const hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

/**
 * Expand a rectangle of a packed BitMap into an RGBA buffer.
 * `rgba` is `width × height`; (`left`, `top`) is in that space.
 */
export function paintBitMapRgbaRect(
  source: BitMap,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  left: number,
  top: number,
  rectWidth: number,
  rectHeight: number,
  palette: HostPalette = DEFAULT_HOST_PALETTE,
): void {
  const { baseAddr, rowBytes } = source;
  const x0 = Math.max(0, left | 0);
  const y0 = Math.max(0, top | 0);
  const x1 = Math.min(width, x0 + Math.max(0, rectWidth | 0));
  const y1 = Math.min(height, y0 + Math.max(0, rectHeight | 0));
  if (x1 <= x0 || y1 <= y0) return;
  if (rgba.byteOffset % 4 !== 0) {
    paintBytewise(source, rgba, width, x0, y0, x1, y1, palette);
    return;
  }
  // One 32-bit store per pixel, and one table read per source byte: the
  // table holds each byte's 8 pixels already in the palette's colours.
  const { ink, paper, pixels } = byteTable(palette);
  const out = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
  for (let y = y0; y < y1; y++) {
    const row = y * rowBytes;
    let j = y * width + x0;
    let x = x0;
    // Up to the first whole source byte.
    for (; x < x1 && (x & 7) !== 0; x++, j++) {
      out[j] = (baseAddr[row + (x >> 3)] >> (7 - (x & 7))) & 1 ? ink : paper;
    }
    for (let i = row + (x >> 3), end = row + (x1 >> 3); i < end; i++, j += 8, x += 8) {
      const k = baseAddr[i] << 3;
      out[j] = pixels[k];
      out[j + 1] = pixels[k + 1];
      out[j + 2] = pixels[k + 2];
      out[j + 3] = pixels[k + 3];
      out[j + 4] = pixels[k + 4];
      out[j + 5] = pixels[k + 5];
      out[j + 6] = pixels[k + 6];
      out[j + 7] = pixels[k + 7];
    }
    // What's left of the last byte.
    for (; x < x1; x++, j++) {
      out[j] = (baseAddr[row + (x >> 3)] >> (7 - (x & 7))) & 1 ? ink : paper;
    }
  }
}

/** Whether a `Uint32Array` over RGBA bytes reads them as `0xAABBGGRR`. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** An opaque colour as one `Uint32Array` element over RGBA bytes. */
function rgbaWord(c: Rgb8): number {
  return LITTLE_ENDIAN
    ? ((255 << 24) | (c.b << 16) | (c.g << 8) | c.r) >>> 0
    : ((c.r << 24) | (c.g << 16) | (c.b << 8) | 255) >>> 0;
}

interface ByteTable {
  ink: number;
  paper: number;
  /** 256 × 8: source byte `b`'s pixels, leftmost first, at `b * 8`. */
  pixels: Uint32Array;
}

/** Built for the last palette used; the palette changes only when the user picks new colours. */
let cachedTable: ByteTable | null = null;

function byteTable(palette: HostPalette): ByteTable {
  const ink = rgbaWord(clampRgb8(palette.foreground));
  const paper = rgbaWord(clampRgb8(palette.background));
  if (cachedTable && cachedTable.ink === ink && cachedTable.paper === paper) return cachedTable;
  const pixels = new Uint32Array(256 * 8);
  for (let b = 0; b < 256; b++) {
    for (let k = 0; k < 8; k++) pixels[b * 8 + k] = (b >> (7 - k)) & 1 ? ink : paper;
  }
  cachedTable = { ink, paper, pixels };
  return cachedTable;
}

/** Byte-at-a-time expansion, for an RGBA view that a `Uint32Array` can't alias. */
function paintBytewise(
  source: BitMap,
  rgba: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  palette: HostPalette,
): void {
  const ink = clampRgb8(palette.foreground);
  const paper = clampRgb8(palette.background);
  const { baseAddr, rowBytes } = source;
  for (let y = y0; y < y1; y++) {
    const row = y * rowBytes;
    let j = (y * width + x0) * 4;
    for (let x = x0; x < x1; x++, j += 4) {
      const c = (baseAddr[row + (x >> 3)] >> (7 - (x & 7))) & 1 ? ink : paper;
      rgba[j] = c.r;
      rgba[j + 1] = c.g;
      rgba[j + 2] = c.b;
      rgba[j + 3] = 255;
    }
  }
}

/** Expand a packed BitMap into an RGBA buffer using the host palette. */
export function paintBitMapRgba(
  source: BitMap,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: HostPalette = DEFAULT_HOST_PALETTE,
): void {
  paintBitMapRgbaRect(source, rgba, width, height, 0, 0, width, height, palette);
}

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, n | 0));
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function rgbEqual(a: Rgb8, b: Rgb8): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}
