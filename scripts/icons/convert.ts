import sharp from "sharp";
import type { ConvertedSprite, ConvertMode } from "./types";

const BLACK = 1;
const WHITE = 0;

function packSprite(data: Uint8Array, mask: Uint8Array): string {
  const packed = new Uint8Array((data.length + 3) >> 2);
  for (let i = 0; i < data.length; i++) {
    const val = mask[i] === 0 ? 0 : data[i] === BLACK ? 0b10 : 0b01;
    packed[i >> 2] |= val << (6 - (i & 3) * 2);
  }
  return Buffer.from(packed).toString("base64");
}

function atkinsonBits(
  rgba: Uint8Array,
  width: number,
  height: number,
  channels: number,
  out: Uint8Array
): void {
  const len = width * height;
  const lum = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const ri = i * channels;
    if (rgba[ri + 3] < 128) {
      lum[i] = 255;
      continue;
    }
    lum[i] = rgba[ri] * 0.299 + rgba[ri + 1] * 0.587 + rgba[ri + 2] * 0.114;
  }
  for (let i = 0; i < len; i++) {
    const val = lum[i];
    const bit = val < 129 ? BLACK : WHITE;
    out[i] = bit;
    const err = (val - (bit ? 0 : 255)) / 8;
    lum[i + 1] += err;
    lum[i + 2] += err;
    lum[i + width - 1] += err;
    lum[i + width] += err;
    lum[i + width + 1] += err;
    lum[i + (width << 1)] += err;
  }
}

export function rgbaToSprite(
  rgba: Uint8Array,
  width: number,
  height: number,
  channels: number,
  mode: ConvertMode
): ConvertedSprite {
  const total = width * height;
  const data = new Uint8Array(total);
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    mask[i] = rgba[i * channels + 3] >= 128 ? 1 : 0;
  }
  if (mode === "dither") {
    atkinsonBits(rgba, width, height, channels, data);
  } else {
    for (let i = 0; i < total; i++) {
      const ri = i * channels;
      const avg = (rgba[ri] + rgba[ri + 1] + rgba[ri + 2]) / 3;
      data[i] = avg < 128 ? BLACK : WHITE;
    }
  }
  let blackPixels = 0;
  let opaquePixels = 0;
  for (let i = 0; i < total; i++) {
    if (mask[i] === 0) {
      data[i] = WHITE;
      continue;
    }
    opaquePixels++;
    if (data[i] === BLACK) blackPixels++;
  }
  return {
    width,
    height,
    b64: packSprite(data, mask),
    data,
    mask,
    blackPixels,
    opaquePixels,
  };
}

export function isWashout(sprite: ConvertedSprite): boolean {
  return sprite.opaquePixels > 0 && sprite.blackPixels / sprite.opaquePixels < 0.05;
}

export async function pngBufferToSprite(
  png: Buffer,
  mode: ConvertMode
): Promise<ConvertedSprite> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return rgbaToSprite(data, info.width, info.height, info.channels, mode);
}

