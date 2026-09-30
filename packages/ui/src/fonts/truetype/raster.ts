/**
 * The scaler's scan converter: a pixel is on when its centre is inside the
 * outline (non-zero winding), the rule the original Font Manager used.
 *
 * Dropout control (TrueType SCANTYPE 1): when a span between two edges
 * contains no pixel centre, a stem thinner than a pixel would vanish;
 * the pixel nearest the span's midpoint is turned on instead. Runs
 * horizontally (vertical stems) and vertically (crossbars).
 */

import type { OutlinePoint } from "./sfnt";

/** Pixel-space outline: y grows **up**, baseline at 0. */
export type PixelContour = OutlinePoint[];

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const FLATNESS = 0.08;

function flattenQuad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, out: number[]): void {
  const dx = x0 - 2 * x1 + x2;
  const dy = y0 - 2 * y1 + y2;
  const dd = Math.sqrt(dx * dx + dy * dy);
  const n = Math.max(1, Math.ceil(Math.sqrt(dd / (4 * FLATNESS))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    out.push(mt * mt * x0 + 2 * mt * t * x1 + t * t * x2, mt * mt * y0 + 2 * mt * t * y1 + t * t * y2);
  }
}

function flattenCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  out: number[],
): void {
  const ddx = Math.max(Math.abs(x0 - 2 * x1 + x2), Math.abs(x1 - 2 * x2 + x3));
  const ddy = Math.max(Math.abs(y0 - 2 * y1 + y2), Math.abs(y1 - 2 * y2 + y3));
  const dd = Math.sqrt(ddx * ddx + ddy * ddy);
  const n = Math.max(1, Math.ceil(Math.sqrt((3 * dd) / (4 * FLATNESS))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
  }
}

/** Closed polyline `[x0, y0, x1, y1, …]` for one contour. */
function flattenContour(contour: PixelContour): number[] {
  const n = contour.length;
  if (n === 0) return [];
  // Start on an on-curve point (TrueType may start on an implied one).
  let start = contour.findIndex((p) => p.on);
  let first: OutlinePoint;
  if (start < 0) {
    const a = contour[0]!;
    const b = contour[n - 1]!;
    first = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true };
    start = 0;
  } else {
    first = contour[start]!;
  }
  const pts: OutlinePoint[] = [];
  for (let i = 0; i < n; i++) pts.push(contour[(start + i) % n]!);
  if (pts[0] === first) pts.shift();
  pts.push(first);

  const out = [first.x, first.y];
  let cx = first.x;
  let cy = first.y;
  for (let i = 0; i < pts.length; ) {
    const p = pts[i]!;
    if (p.on) {
      out.push(p.x, p.y);
      cx = p.x;
      cy = p.y;
      i++;
    } else if (p.cubic) {
      const c2 = pts[i + 1] ?? first;
      const end = pts[i + 2] ?? first;
      flattenCubic(cx, cy, p.x, p.y, c2.x, c2.y, end.x, end.y, out);
      cx = end.x;
      cy = end.y;
      i += 3;
    } else {
      const next = pts[i + 1] ?? first;
      const end = next.on ? next : { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2, on: true };
      flattenQuad(cx, cy, p.x, p.y, end.x, end.y, out);
      cx = end.x;
      cy = end.y;
      i += next.on ? 2 : 1;
    }
  }
  return out;
}

export interface RasterTarget {
  width: number;
  height: number;
  /** Pixel column of the glyph origin. */
  originX: number;
  /** Pixel row of the baseline (rows grow down). */
  baseline: number;
}

export interface RasterOptions {
  dropout: boolean;
}

/** Fill pixel-space contours into a `width × height` 0/1 bitmap. */
export function scanConvert(contours: PixelContour[], target: RasterTarget, options: RasterOptions): Uint8Array {
  const { width, height, originX, baseline } = target;
  const bits = new Uint8Array(width * height);
  const edges: Edge[] = [];
  for (const contour of contours) {
    const poly = flattenContour(contour);
    for (let i = 0; i + 3 < poly.length; i += 2) {
      const x0 = poly[i]! + originX;
      const y0 = baseline - poly[i + 1]!;
      const x1 = poly[i + 2]! + originX;
      const y1 = baseline - poly[i + 3]!;
      if (x0 === x1 && y0 === y1) continue;
      edges.push({ x0, y0, x1, y1 });
    }
  }
  if (edges.length === 0) return bits;

  const hits: { at: number; w: number }[] = [];
  // Rows: sample at y + 0.5 for vertical-ish edges.
  for (let y = 0; y < height; y++) {
    const scan = y + 0.5;
    hits.length = 0;
    for (const e of edges) {
      if (e.y0 === e.y1) continue;
      const lo = Math.min(e.y0, e.y1);
      const hi = Math.max(e.y0, e.y1);
      if (scan < lo || scan >= hi) continue;
      const t = (scan - e.y0) / (e.y1 - e.y0);
      hits.push({ at: e.x0 + t * (e.x1 - e.x0), w: e.y1 > e.y0 ? 1 : -1 });
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a.at - b.at);
    let winding = 0;
    let enter = 0;
    const row = y * width;
    for (const hit of hits) {
      const before = winding;
      winding += hit.w;
      if (before === 0 && winding !== 0) enter = hit.at;
      else if (before !== 0 && winding === 0) {
        const x0 = Math.max(0, Math.ceil(enter - 0.5));
        const x1 = Math.min(width, Math.ceil(hit.at - 0.5));
        if (x1 > x0) bits.fill(1, row + x0, row + x1);
        else if (options.dropout) {
          const x = Math.floor((enter + hit.at) / 2);
          if (x >= 0 && x < width) bits[row + x] = 1;
        }
      }
    }
  }

  if (!options.dropout) return bits;
  // Columns: sample at x + 0.5 so thin horizontal strokes keep a pixel.
  for (let x = 0; x < width; x++) {
    const scan = x + 0.5;
    hits.length = 0;
    for (const e of edges) {
      if (e.x0 === e.x1) continue;
      const lo = Math.min(e.x0, e.x1);
      const hi = Math.max(e.x0, e.x1);
      if (scan < lo || scan >= hi) continue;
      const t = (scan - e.x0) / (e.x1 - e.x0);
      hits.push({ at: e.y0 + t * (e.y1 - e.y0), w: e.x1 > e.x0 ? 1 : -1 });
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a.at - b.at);
    let winding = 0;
    let enter = 0;
    for (const hit of hits) {
      const before = winding;
      winding += hit.w;
      if (before === 0 && winding !== 0) enter = hit.at;
      else if (before !== 0 && winding === 0) {
        const y0 = Math.ceil(enter - 0.5);
        const y1 = Math.ceil(hit.at - 0.5);
        if (y1 > y0) continue;
        const y = Math.floor((enter + hit.at) / 2);
        if (y >= 0 && y < height) bits[y * width + x] = 1;
      }
    }
  }
  return bits;
}

/** Box-filter an oversampled 0/1 bitmap down by `factor`, then threshold (0–255). */
export function downsample(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  factor: number,
  threshold: number,
): { width: number; height: number; pixels: Uint8Array } {
  const width = Math.max(1, Math.ceil(srcW / factor));
  const height = Math.max(1, Math.ceil(srcH / factor));
  const pixels = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= srcH) continue;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx < srcW && src[sy * srcW + sx]) sum += 255;
        }
      }
      pixels[y * width + x] = sum / area >= threshold ? 1 : 0;
    }
  }
  return { width, height, pixels };
}
