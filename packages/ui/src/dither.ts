/**
 * RGBA → 1-byte-per-pixel (`0` = white, `1` = black) — the `<bitmap>` /
 * `blitPixels` contract. Atkinson, Bayer, Thermal, and ASCII are the Photo
 * Booth converters; threshold is the simple luminance cut.
 */

import { asciiToBits, createAsciiDitherer, type AsciiDitherOptions } from "./asciiDither.ts";
import { SHADE_PATTERNS, shadeLevel } from "./shadePatterns.ts";

/** Decoded raster: 8-bit RGBA, row-major, as `ImageData` but without the DOM. */
export interface ImageFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/**
 * `thermal` is a clustered-dot halftone for thermal printers (see `CLUSTER_MAP`).
 * `pattern` posterizes into the 33-step `SHADE_PATTERNS` ramp: flat areas of
 * a classic fill pattern, and nothing crawls when the picture moves.
 */
export type DitherMode = "threshold" | "atkinson" | "bayer" | "thermal" | "pattern" | "ascii";

export interface DitherOptions extends AsciiDitherOptions {
  /** Luminance cut for `threshold` and Bayer (default 128). */
  threshold?: number;
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function thresholdTo1bit(rgba: Uint8ClampedArray, len: number, out: Uint8Array, cut: number): void {
  for (let i = 0; i < len; i++) {
    const ri = i << 2;
    out[i] = luminance(rgba[ri], rgba[ri + 1], rgba[ri + 2]) < cut ? 1 : 0;
  }
}

function atkinsonTo1bit(rgba: Uint8ClampedArray, w: number, h: number, out: Uint8Array, lum: Float32Array): void {
  const len = w * h;
  for (let i = 0; i < len; i++) {
    const ri = i << 2;
    lum[i] = luminance(rgba[ri], rgba[ri + 1], rgba[ri + 2]);
  }
  for (let i = 0; i < len; i++) {
    const val = lum[i];
    const bit = val < 129 ? 1 : 0;
    out[i] = bit;
    const err = (val - (bit ? 0 : 255)) / 8;
    lum[i + 1] += err;
    lum[i + 2] += err;
    lum[i + w - 1] += err;
    lum[i + w] += err;
    lum[i + w + 1] += err;
    lum[i + (w << 1)] += err;
  }
}

const BAYER_MAP = [
  [15, 135, 45, 165],
  [195, 75, 225, 105],
  [60, 180, 30, 150],
  [240, 120, 210, 90],
];

function bayerTo1bit(rgba: Uint8ClampedArray, w: number, h: number, out: Uint8Array, cut: number): void {
  const len = w * h;
  for (let i = 0; i < len; i++) {
    const ri = i << 2;
    const lum = luminance(rgba[ri], rgba[ri + 1], rgba[ri + 2]);
    const x = i % w;
    const y = (i / w) | 0;
    const mapped = (lum + BAYER_MAP[x & 3][y & 3]) >> 1;
    out[i] = mapped < cut ? 1 : 0;
  }
}

/**
 * Clustered-dot halftone order for a 4×4 cell: ink grows outward from the
 * centre as a solid clump instead of scattering single dots. Thermal heads
 * barely mark an isolated dot, but a clump heats itself and prints, so more
 * grey levels survive on receipt paper.
 */
const CLUSTER_MAP = [
  [12, 5, 6, 13],
  [4, 0, 1, 7],
  [11, 3, 2, 8],
  [15, 10, 9, 14],
];

function thermalTo1bit(rgba: Uint8ClampedArray, w: number, h: number, out: Uint8Array): void {
  for (let y = 0; y < h; y++) {
    const row = CLUSTER_MAP[y & 3];
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ri = i << 2;
      const ink = 255 - luminance(rgba[ri], rgba[ri + 1], rgba[ri + 2]);
      out[i] = ink > (row[x & 3] + 0.5) * 16 ? 1 : 0;
    }
  }
}

function patternTo1bit(rgba: Uint8ClampedArray, w: number, h: number, out: Uint8Array): void {
  for (let y = 0; y < h; y++) {
    const row = y & 7;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ri = i << 2;
      const level = shadeLevel(luminance(rgba[ri], rgba[ri + 1], rgba[ri + 2]) / 255);
      out[i] = (SHADE_PATTERNS[level][row] >> (7 - (x & 7))) & 1 ? 0 : 1;
    }
  }
}

function apply(
  frame: ImageFrame,
  mode: Exclude<DitherMode, "ascii">,
  out: Uint8Array,
  lum: Float32Array | undefined,
  options?: DitherOptions,
): void {
  const cut = options?.threshold ?? 128;
  const len = frame.width * frame.height;
  if (mode === "atkinson") atkinsonTo1bit(frame.rgba, frame.width, frame.height, out, lum!);
  else if (mode === "bayer") bayerTo1bit(frame.rgba, frame.width, frame.height, out, cut);
  else if (mode === "thermal") thermalTo1bit(frame.rgba, frame.width, frame.height, out);
  else if (mode === "pattern") patternTo1bit(frame.rgba, frame.width, frame.height, out);
  else thresholdTo1bit(frame.rgba, len, out, cut);
}

/** RGBA → 1 byte per pixel, 0 = white, 1 = black — the `<bitmap pixels>` format. */
export function toBits(frame: ImageFrame, mode: DitherMode = "threshold", options?: DitherOptions): Uint8Array {
  if (mode === "ascii") return asciiToBits(frame, options);
  const out = new Uint8Array(frame.width * frame.height);
  const lum = mode === "atkinson" ? new Float32Array(frame.width * frame.height) : undefined;
  apply(frame, mode, out, lum, options);
  return out;
}

/** Same conversion, reusing a caller-owned buffer and error rows for per-frame use. */
export function createDitherer(
  width: number,
  height: number,
  mode: DitherMode,
  options?: DitherOptions,
): (frame: ImageFrame, out: Uint8Array) => void {
  if (mode === "ascii") return createAsciiDitherer(width, height, options);
  const lum = mode === "atkinson" ? new Float32Array(width * height) : undefined;
  return (frame, out) => {
    if (frame.width !== width || frame.height !== height) {
      throw new Error(`Ditherer is ${width}×${height}, frame is ${frame.width}×${frame.height}`);
    }
    if (mode === "atkinson") lum!.fill(0);
    apply(frame, mode, out, lum, options);
  };
}

export interface CoverFrameOptions {
  /** Flip horizontally — the usual selfie preview. */
  mirror?: boolean;
}

/**
 * Already-dithered 1-bit picture (`0` = white, `1` = black). Build-time
 * `?dither=` imports produce this so the browser never sees the JPEG.
 */
export interface DitheredAsset {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function isImageFrame(value: unknown): value is ImageFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as ImageFrame;
  return typeof frame.width === "number" && typeof frame.height === "number" && frame.rgba instanceof Uint8ClampedArray;
}

export function isDitheredAsset(value: unknown): value is DitheredAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as DitheredAsset;
  return (
    typeof asset.width === "number" &&
    typeof asset.height === "number" &&
    asset.pixels instanceof Uint8Array &&
    !("rgba" in asset)
  );
}

/** Cover-crop `src` into `width`×`height` and dither to `<bitmap>` pixels. */
export function rasterizeFrame(
  src: ImageFrame,
  width: number,
  height: number,
  mode: DitherMode = "threshold",
  options?: DitherOptions & CoverFrameOptions,
): Uint8Array {
  const dest: ImageFrame = {
    width,
    height,
    rgba: new Uint8ClampedArray(width * height * 4),
  };
  coverFrame(src, dest, options);
  return toBits(dest, mode, options);
}

/**
 * Center-crop `src` to `dest`'s aspect (CSS `object-fit: cover`) and
 * nearest-neighbour scale into `dest`. Photo Booth uses this so a typical
 * landscape camera fills the viewfinder instead of being blit 1:1 and clipped.
 */
export function coverFrame(src: ImageFrame, dest: ImageFrame, options?: CoverFrameOptions): void {
  const srcW = src.width;
  const srcH = src.height;
  const dstW = dest.width;
  const dstH = dest.height;
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return;

  let cropW: number;
  let cropH: number;
  let cropX: number;
  let cropY: number;
  if (srcW * dstH > dstW * srcH) {
    cropH = srcH;
    cropW = Math.max(1, Math.floor((srcH * dstW) / dstH));
    cropX = (srcW - cropW) >> 1;
    cropY = 0;
  } else {
    cropW = srcW;
    cropH = Math.max(1, Math.floor((srcW * dstH) / dstW));
    cropX = 0;
    cropY = (srcH - cropH) >> 1;
  }

  const mirror = options?.mirror === true;
  const srcRgba = src.rgba;
  const dstRgba = dest.rgba;
  for (let y = 0; y < dstH; y++) {
    const sy = cropY + Math.min(cropH - 1, Math.floor((y * cropH) / dstH));
    const srcRow = sy * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = cropX + Math.min(cropW - 1, Math.floor((x * cropW) / dstW));
      const dx = mirror ? dstW - 1 - x : x;
      const si = (srcRow + sx) << 2;
      const di = (dstRow + dx) << 2;
      dstRgba[di] = srcRgba[si];
      dstRgba[di + 1] = srcRgba[si + 1];
      dstRgba[di + 2] = srcRgba[si + 2];
      dstRgba[di + 3] = srcRgba[si + 3];
    }
  }
}
