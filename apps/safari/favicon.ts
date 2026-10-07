import { parseUrl, type ImageFrame } from "@mockintosh/sdk";

/**
 * Where a site keeps its big icon. Most sites answer
 * `/apple-touch-icon.png` with a square PNG; the rest name one.
 */
export function faviconUrl(siteUrl: string, icon?: string): string | null {
  if (icon) return icon;
  const url = parseUrl(siteUrl);
  if (!url || !/^https?$/.test(url.scheme) || !url.hostname) return null;
  return `${url.scheme}://${url.hostname}${url.port ? `:${url.port}` : ""}/apple-touch-icon.png`;
}

/**
 * Luminance `size`×`size`, 0 black to 255 white: transparency over white,
 * the picture fitted inside the square and centred, each pixel the average
 * of the source pixels it covers.
 */
export function iconLuminance(frame: ImageFrame, size: number): Float32Array {
  const scale = Math.min(size / frame.width, size / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const left = (size - width) / 2;
  const top = (size - height) / 2;
  const sum = new Float32Array(size * size);
  const area = new Float32Array(size * size);
  for (let sy = 0; sy < frame.height; sy++) {
    const y0 = top + sy * scale;
    for (let sx = 0; sx < frame.width; sx++) {
      const at = (sy * frame.width + sx) * 4;
      const alpha = frame.rgba[at + 3] / 255;
      const lum = frame.rgba[at] * 0.299 + frame.rgba[at + 1] * 0.587 + frame.rgba[at + 2] * 0.114;
      const value = lum * alpha + 255 * (1 - alpha);
      const x0 = left + sx * scale;
      // The source pixel covers [x0, x0 + scale) × [y0, y0 + scale); share it out by overlap.
      for (let dy = Math.floor(y0); dy < Math.min(size, Math.ceil(y0 + scale)); dy++) {
        const h = Math.min(dy + 1, y0 + scale) - Math.max(dy, y0);
        if (h <= 0) continue;
        for (let dx = Math.floor(x0); dx < Math.min(size, Math.ceil(x0 + scale)); dx++) {
          const w = Math.min(dx + 1, x0 + scale) - Math.max(dx, x0);
          if (w <= 0) continue;
          sum[dy * size + dx] += value * w * h;
          area[dy * size + dx] += w * h;
        }
      }
    }
  }
  return sum.map((total, at) => total + 255 * (1 - area[at]));
}

/**
 * The cut that best splits these values into two groups (Otsu's method).
 * Icons are mostly a few flat colours, so this finds the line between
 * the mark and its ground wherever their colours fall.
 */
export function otsuThreshold(values: Float32Array): number {
  const histogram = new Float64Array(256);
  for (const value of values) histogram[Math.max(0, Math.min(255, Math.round(value)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let level = 0; level < 256; level++) sumAll += level * histogram[level];
  let below = 0;
  let sumBelow = 0;
  let best = -1;
  let cut = 128;
  for (let level = 0; level < 256; level++) {
    below += histogram[level];
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    sumBelow += level * histogram[level];
    const meanBelow = sumBelow / below;
    const meanAbove = (sumAll - sumBelow) / above;
    const spread = below * above * (meanBelow - meanAbove) ** 2;
    if (spread > best) {
      best = spread;
      cut = level + 1;
    }
  }
  return best > 0 ? cut : 128;
}

/**
 * A site icon as `size`×`size` `<bitmap>` pixels (`1` is black). Darker
 * than the cut is ink, so a white mark on a coloured square stays white on
 * black, the way the Finder draws an icon.
 */
export function faviconBits(frame: ImageFrame, size: number): Uint8Array {
  const lum = iconLuminance(frame, size);
  const cut = otsuThreshold(lum);
  return Uint8Array.from(lum, (value) => (value < cut ? 1 : 0));
}

/** Site icons at one size, as `faviconCache` keeps them. */
export interface FaviconLoader {
  /** The icon's pixels, or `null` when there is none. */
  load(src: string): Promise<Uint8Array | null>;
  /** What `load` already found; `undefined` while it hasn't. */
  peek(src: string): Uint8Array | null | undefined;
}

/**
 * Site icons by URL, read once per Safari. `load` resolves the picture's
 * pixels (through the server; sites don't allow other origins), or `null`.
 */
export function faviconCache(load: (src: string) => Promise<ImageFrame | null>, size: number): FaviconLoader {
  const icons = new Map<string, Promise<Uint8Array | null>>();
  const found = new Map<string, Uint8Array | null>();
  return {
    load(src) {
      let icon = icons.get(src);
      if (!icon) {
        icon = load(src)
          .then(
            (frame) => (frame && frame.width > 0 && frame.height > 0 ? faviconBits(frame, size) : null),
            () => null,
          )
          .then((bits) => {
            found.set(src, bits);
            return bits;
          });
        icons.set(src, icon);
      }
      return icon;
    },
    peek: (src) => found.get(src),
  };
}
