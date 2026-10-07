/**
 * A 1-bit drawing surface for the map: pattern-filled polygons, lines of any
 * width, dashes and discs, into an unpacked buffer (`0` = white, `1` =
 * black) that `RasterSurface.blitPixels` takes as it is. QuickDraw has all of
 * this, but a city tile is tens of thousands of shapes, and plain scanlines
 * over bytes keep a tile to a few milliseconds.
 *
 * Coordinates are continuous: pixel (x, y) covers [x, x + 1) × [y, y + 1)
 * and is inked when its centre is inside the shape.
 *
 * A bitmap made with `fills` keeps, instead of each pixel's ink, which fill
 * it has (`fillOf`): the tilted view lays such a map on the ground and only
 * then turns fills into ink, on the screen (`inkFills`), so a hatch stays a
 * hatch however far off it lies, rather than its dots being squeezed into
 * noise.
 */

/** An 8×8 pattern, QuickDraw's `Pattern`: a byte per row, high bit leftmost, 1 = black. */
export type Pattern = readonly number[];

/**
 * How a pattern lands. `copy` paints its white bits too, so a fill hides
 * what was under it; `or` only adds its black bits.
 */
export type PaintMode = "copy" | "or";

export interface Paint {
  pattern: Pattern;
  mode?: PaintMode;
}

export const BLACK: Paint = { pattern: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] };
export const WHITE: Paint = { pattern: [0, 0, 0, 0, 0, 0, 0, 0] };

/** Fills by number: 0 white, 1 black, the rest each a pattern, or patterns over one another, as they're met. */
const fillRows: Uint8Array[] = [new Uint8Array(8), new Uint8Array(8).fill(0xff)];
const fillIds = new Map<string, number>([["0,0,0,0,0,0,0,0", 0], ["255,255,255,255,255,255,255,255", 1]]);
const overIds = new Map<number, number>();

/** The number of the fill whose rows are `rows`. */
function fillWithRows(rows: ArrayLike<number>): number {
  const key = Array.from(rows).join(",");
  let id = fillIds.get(key);
  if (id === undefined) {
    // Past 255 fills (not seen in practice) the rest come out black.
    if (fillRows.length > 255) return 1;
    id = fillRows.length;
    fillRows.push(Uint8Array.from(rows));
    fillIds.set(key, id);
  }
  return id;
}

/** The number of `pattern` as a fill. */
export function fillOf(pattern: Pattern): number {
  return fillWithRows(pattern);
}

/** The fill of pattern `over` laid with `or` on fill `under`: both their inks. */
function fillOver(under: number, over: number): number {
  if (under === 0 || under === over) return over;
  const key = under * 256 + over;
  let id = overIds.get(key);
  if (id === undefined) {
    const a = fillRows[under]!;
    const b = fillRows[over]!;
    id = fillWithRows(Array.from(a, (row, k) => row | b[k]!));
    overIds.set(key, id);
  }
  return id;
}

/**
 * Turn a fills bitmap's pixels into ink, each fill's pattern lined up with
 * the pixel grid of `pixels`; `swap` inks some fills as others.
 */
export function inkFills(pixels: Uint8Array, width: number, swap?: ReadonlyMap<number, number>): void {
  for (let i = 0, y = 0, x = 0; i < pixels.length; i++) {
    const id = swap?.get(pixels[i]!) ?? pixels[i]!;
    pixels[i] = id < 2 ? id : (fillRows[id]![y & 7]! >> (7 - (x & 7))) & 1;
    if (++x === width) {
      x = 0;
      y++;
    }
  }
}

export class Bitmap {
  readonly pixels: Uint8Array;
  /** Added to x and y before a pattern is indexed, so patterns line up across tiles. */
  phaseX = 0;
  phaseY = 0;

  // Scratch for `fillPath`, grown as needed and reused between shapes.
  private edgeX = new Float64Array(64);
  private edgeSlope = new Float64Array(64);
  private edgeTop = new Int32Array(64);
  private edgeBottom = new Int32Array(64);
  private edgeOrder = new Int32Array(64);
  private readonly quadX = new Float64Array(4);
  private readonly quadY = new Float64Array(4);
  private readonly active: number[] = [];
  private crossings = new Float64Array(64);
  private orderKeys = new Float64Array(64);

  constructor(
    readonly width: number,
    readonly height: number,
    pixels?: Uint8Array,
    /** Keep each pixel's fill, not its ink (see above). */
    readonly fills = false,
  ) {
    this.pixels = pixels ?? new Uint8Array(width * height);
  }

  fill(paint: Paint): void {
    for (let y = 0; y < this.height; y++) this.span(y, 0, this.width, paint);
  }

  /** Paint row `y` from column `x0` up to, not including, `x1`. */
  span(y: number, x0: number, x1: number, paint: Paint): void {
    if (y < 0 || y >= this.height) return;
    const from = Math.max(0, x0);
    const to = Math.min(this.width, x1);
    if (from >= to) return;
    const base = y * this.width;
    const px = this.pixels;
    if (this.fills) {
      const id = fillOf(paint.pattern);
      if (paint.mode !== "or") px.fill(id, base + from, base + to);
      else if (id !== 0) for (let i = base + from; i < base + to; i++) px[i] = fillOver(px[i]!, id);
      return;
    }
    const row = paint.pattern[(y + this.phaseY) & 7]!;
    if (row === 0xff || row === 0) {
      if (row === 0 && paint.mode === "or") return;
      px.fill(row ? 1 : 0, base + from, base + to);
      return;
    }
    const phase = this.phaseX;
    if (paint.mode === "or") {
      for (let x = from; x < to; x++) if ((row >> (7 - ((x + phase) & 7))) & 1) px[base + x] = 1;
    } else {
      for (let x = from; x < to; x++) px[base + x] = (row >> (7 - ((x + phase) & 7))) & 1;
    }
  }

  plot(x: number, y: number, paint: Paint): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (this.fills) {
      const i = y * this.width + x;
      const id = fillOf(paint.pattern);
      if (paint.mode !== "or") this.pixels[i] = id;
      else if (id !== 0) this.pixels[i] = fillOver(this.pixels[i]!, id);
      return;
    }
    const bit = (paint.pattern[(y + this.phaseY) & 7]! >> (7 - ((x + this.phaseX) & 7))) & 1;
    if (bit || paint.mode !== "or") this.pixels[y * this.width + x] = bit;
  }

  /**
   * Fill the rings `parts[i]` to `parts[i + 1]` (point indices into `xs` /
   * `ys`) by the even-odd rule, which is how holes in a polygon stay open.
   */
  fillPath(
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    parts: ArrayLike<number>,
    paint: Paint,
  ): void {
    this.scanPath(xs, ys, parts, (y, x0, x1) => this.span(y, x0, x1, paint));
  }

  /**
   * The rows of what `fillPath` would fill, without filling them: `inside`
   * gets each row `y` from column `x0` up to `x1`, which may run past the
   * bitmap's sides.
   */
  scanPath(
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    parts: ArrayLike<number>,
    inside: (y: number, x0: number, x1: number) => void,
  ): void {
    let n = 0;
    let firstRow = this.height;
    let lastRow = 0;
    for (let p = 0; p + 1 < parts.length; p++) {
      const start = parts[p]!;
      const end = parts[p + 1]!;
      if (end - start < 3) continue;
      for (let i = start; i < end; i++) {
        const j = i + 1 < end ? i + 1 : start;
        let x0 = xs[i]!, y0 = ys[i]!, x1 = xs[j]!, y1 = ys[j]!;
        if (y0 === y1) continue;
        if (y0 > y1) {
          const tx = x0; x0 = x1; x1 = tx;
          const ty = y0; y0 = y1; y1 = ty;
        }
        // Rows whose centres lie in [y0, y1).
        const top = Math.max(0, Math.ceil(y0 - 0.5));
        const bottom = Math.min(this.height, Math.ceil(y1 - 0.5));
        if (top >= bottom) continue;
        if (n === this.edgeX.length) this.growEdges();
        const slope = (x1 - x0) / (y1 - y0);
        this.edgeX[n] = x0 + (top + 0.5 - y0) * slope;
        this.edgeSlope[n] = slope;
        this.edgeTop[n] = top;
        this.edgeBottom[n] = bottom;
        this.edgeOrder[n] = n;
        if (top < firstRow) firstRow = top;
        if (bottom > lastRow) lastRow = bottom;
        n++;
      }
    }
    if (n < 2) return;
    // Edges by the row they start on: each key is that row, then the edge,
    // so a plain numeric sort (no comparator, which is slow) orders them.
    const tops = this.edgeTop;
    if (this.orderKeys.length < n) this.orderKeys = new Float64Array(this.edgeX.length);
    const keys = this.orderKeys.subarray(0, n);
    for (let e = 0; e < n; e++) keys[e] = tops[e]! * EDGE_KEY + e;
    keys.sort();
    const order = this.edgeOrder;
    for (let k = 0; k < n; k++) order[k] = keys[k]! % EDGE_KEY;

    const active = this.active;
    active.length = 0;
    if (this.crossings.length < n) this.crossings = new Float64Array(this.edgeX.length);
    const crossings = this.crossings;
    let next = 0;
    for (let y = firstRow; y < lastRow; y++) {
      while (next < n && tops[order[next]!]! <= y) active.push(order[next++]!);
      let count = 0;
      let kept = 0;
      for (let k = 0; k < active.length; k++) {
        const e = active[k]!;
        if (this.edgeBottom[e]! <= y) continue;
        active[kept++] = e;
        crossings[count++] = this.edgeX[e]! + (y - tops[e]!) * this.edgeSlope[e]!;
      }
      active.length = kept;
      if (count < 2) continue;
      if (count === 2) {
        // Most rows of most shapes: one span, no sorting needed.
        const a = crossings[0]!;
        const b = crossings[1]!;
        inside(y, Math.ceil(Math.min(a, b) - 0.5), Math.ceil(Math.max(a, b) - 0.5));
        continue;
      }
      if (count <= 16) {
        for (let i = 1; i < count; i++) {
          const v = crossings[i]!;
          let j = i - 1;
          while (j >= 0 && crossings[j]! > v) {
            crossings[j + 1] = crossings[j]!;
            j--;
          }
          crossings[j + 1] = v;
        }
      } else {
        crossings.subarray(0, count).sort();
      }
      for (let k = 0; k + 1 < count; k += 2) {
        inside(y, Math.ceil(crossings[k]! - 0.5), Math.ceil(crossings[k + 1]! - 0.5));
      }
    }
  }

  /** A disc of radius `r` centred on (cx, cy). */
  disc(cx: number, cy: number, r: number, paint: Paint): void {
    const top = Math.max(0, Math.ceil(cy - r - 0.5));
    const bottom = Math.min(this.height - 1, Math.floor(cy + r - 0.5));
    for (let y = top; y <= bottom; y++) {
      const dy = y + 0.5 - cy;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      this.span(y, Math.ceil(cx - half - 0.5), Math.floor(cx + half - 0.5) + 1, paint);
    }
  }

  /** A one-pixel line through the pixels under (x0, y0) and (x1, y1). */
  hairline(x0: number, y0: number, x1: number, y1: number, paint: Paint): void {
    const clipped = clipSegment(x0, y0, x1, y1, -1, -1, this.width + 1, this.height + 1);
    if (!clipped) return;
    let x = Math.floor(clipped[0]);
    let y = Math.floor(clipped[1]);
    const xEnd = Math.floor(clipped[2]);
    const yEnd = Math.floor(clipped[3]);
    const dx = Math.abs(xEnd - x);
    const dy = -Math.abs(yEnd - y);
    const sx = x < xEnd ? 1 : -1;
    const sy = y < yEnd ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.plot(x, y, paint);
      if (x === xEnd && y === yEnd) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  /** One straight piece of a line `width` pixels wide, without its ends rounded. */
  segment(x0: number, y0: number, x1: number, y1: number, width: number, paint: Paint): void {
    if (width < 1.5) {
      this.hairline(x0, y0, x1, y1, paint);
      return;
    }
    const half = width / 2;
    const clipped = clipSegment(x0, y0, x1, y1, -half - 1, -half - 1, this.width + half + 1, this.height + half + 1);
    if (!clipped) return;
    [x0, y0, x1, y1] = clipped;
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) return;
    const nx = (-(y1 - y0) / length) * half;
    const ny = ((x1 - x0) / length) * half;
    const qx = this.quadX;
    const qy = this.quadY;
    qx[0] = x0 + nx; qy[0] = y0 + ny;
    qx[1] = x1 + nx; qy[1] = y1 + ny;
    qx[2] = x1 - nx; qy[2] = y1 - ny;
    qx[3] = x0 - nx; qy[3] = y0 - ny;
    this.fillPath(qx, qy, QUAD_PARTS, paint);
  }

  /**
   * The line through points `start` to `end` of `xs` / `ys`, `width` pixels
   * wide with round joins and ends. `dash` alternates drawn and skipped
   * lengths along it.
   */
  stroke(
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    start: number,
    end: number,
    width: number,
    paint: Paint,
    dash?: readonly number[],
  ): void {
    if (end - start < 2) return;
    const round = width >= 2;
    if (!dash) {
      for (let i = start; i + 1 < end; i++) this.segment(xs[i]!, ys[i]!, xs[i + 1]!, ys[i + 1]!, width, paint);
      if (round) for (let i = start; i < end; i++) this.joint(xs[i]!, ys[i]!, width, paint);
      return;
    }
    walkDashes(xs, ys, start, end, dash, (ax, ay, bx, by) => {
      this.segment(ax, ay, bx, by, width, paint);
      if (round) {
        this.joint(ax, ay, width, paint);
        this.joint(bx, by, width, paint);
      }
    });
  }

  private joint(x: number, y: number, width: number, paint: Paint): void {
    const r = width / 2;
    if (x < -r || y < -r || x > this.width + r || y > this.height + r) return;
    this.disc(x, y, r, paint);
  }

  private growEdges(): void {
    const size = this.edgeX.length * 2;
    const grow = <T extends Float64Array | Int32Array>(old: T, make: (n: number) => T): T => {
      const next = make(size);
      next.set(old);
      return next;
    };
    this.edgeX = grow(this.edgeX, (k) => new Float64Array(k));
    this.edgeSlope = grow(this.edgeSlope, (k) => new Float64Array(k));
    this.edgeTop = grow(this.edgeTop, (k) => new Int32Array(k));
    this.edgeBottom = grow(this.edgeBottom, (k) => new Int32Array(k));
    this.edgeOrder = grow(this.edgeOrder, (k) => new Int32Array(k));
  }
}

const QUAD_PARTS = [0, 4] as const;
/** Edge sort keys are row × this + edge: room for a million edges in a shape. */
const EDGE_KEY = 1 << 20;

const clipped: [number, number, number, number] = [0, 0, 0, 0];

/**
 * The part of a segment inside a box (Liang–Barsky), or `null`. The result
 * is shared between calls: read it before clipping again.
 */
export function clipSegment(
  x0: number, y0: number, x1: number, y1: number,
  xMin: number, yMin: number, xMax: number, yMax: number,
): [number, number, number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges = [-dx, x0 - xMin, dx, xMax - x0, -dy, y0 - yMin, dy, yMax - y0];
  for (let k = 0; k < 8; k += 2) {
    const p = edges[k]!;
    const q = edges[k + 1]!;
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  clipped[0] = x0 + t0 * dx;
  clipped[1] = y0 + t0 * dy;
  clipped[2] = x0 + t1 * dx;
  clipped[3] = y0 + t1 * dy;
  return clipped;
}

/** Call `draw` for each drawn stretch of a dashed line. */
export function walkDashes(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  start: number,
  end: number,
  dash: readonly number[],
  draw: (x0: number, y0: number, x1: number, y1: number) => void,
): void {
  let k = 0;
  let left = dash[0]!;
  for (let i = start; i + 1 < end; i++) {
    let x0 = xs[i]!;
    let y0 = ys[i]!;
    const x1 = xs[i + 1]!;
    const y1 = ys[i + 1]!;
    let length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) continue;
    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    while (length > 0) {
      const step = Math.min(left, length);
      const x = x0 + ux * step;
      const y = y0 + uy * step;
      if (k % 2 === 0) draw(x0, y0, x, y);
      x0 = x;
      y0 = y;
      length -= step;
      left -= step;
      if (left <= 1e-9) {
        k = (k + 1) % dash.length;
        left = dash[k]!;
      }
    }
  }
}

/**
 * Call `mark` every `spacing` pixels along a line, starting half a spacing
 * in, with the point and the line's direction there (a unit vector).
 */
export function walkMarks(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  start: number,
  end: number,
  spacing: number,
  mark: (x: number, y: number, ux: number, uy: number) => void,
): void {
  let until = spacing / 2;
  for (let i = start; i + 1 < end; i++) {
    const x0 = xs[i]!;
    const y0 = ys[i]!;
    const length = Math.hypot(xs[i + 1]! - x0, ys[i + 1]! - y0);
    if (length === 0) continue;
    const ux = (xs[i + 1]! - x0) / length;
    const uy = (ys[i + 1]! - y0) / length;
    while (until <= length) {
      mark(x0 + ux * until, y0 + uy * until, ux, uy);
      until += spacing;
    }
    until -= length;
  }
}
