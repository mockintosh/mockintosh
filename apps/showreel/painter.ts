/**
 * A small 1-bit vector painter. Every shape is reduced to horizontal spans
 * sampled at pixel centres, and every span goes through one `Paint`, so the
 * same circle can be solid, XORed, or a Bayer-dithered tone. Shapes are given
 * in *stage* units (a 320 × 180 design space); `Stage` maps them onto the
 * device pixels of whatever frame is being rendered, so the reel is
 * resolution-independent and a zoom is just a different `Stage`.
 *
 * Kept free of QuickDraw and the DOM so frames render headless in tests.
 */

/** 1 byte per pixel, `0` = white, `1` = black: the `blitPixels` contract. */
export interface Frame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export type Ink = 0 | 1;

export interface Vec {
  x: number;
  y: number;
}

/** How a covered pixel changes: given its device position and current ink. */
export type Paint = (x: number, y: number, current: Ink) => Ink;

/** The design space every scene draws in. */
export const STAGE_W = 320;
export const STAGE_H = 180;

/** Stage units → device pixels: `device = stage * scale + origin`. */
export interface Stage {
  scale: number;
  x: number;
  y: number;
}

/** A device-pixel rectangle, half-open on the right and bottom. */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function createFrame(width: number, height: number): Frame {
  return { width, height, pixels: new Uint8Array(Math.max(0, width * height)) };
}

/** The largest 16:9 stage that fits the frame, centred (letterboxed). */
export function fitStage(width: number, height: number): Stage {
  const scale = Math.min(width / STAGE_W, height / STAGE_H);
  return {
    scale,
    x: Math.round((width - STAGE_W * scale) / 2),
    y: Math.round((height - STAGE_H * scale) / 2),
  };
}

export function stageRect(stage: Stage): PixelRect {
  return {
    x0: stage.x,
    y0: stage.y,
    x1: Math.round(stage.x + STAGE_W * stage.scale),
    y1: Math.round(stage.y + STAGE_H * stage.scale),
  };
}

/** The same stage magnified `k` times about the stage point `focus`. */
export function zoomStage(stage: Stage, focus: Vec, k: number): Stage {
  return {
    scale: stage.scale * k,
    x: stage.x + focus.x * stage.scale * (1 - k),
    y: stage.y + focus.y * stage.scale * (1 - k),
  };
}

// ── Paints ────────────────────────────────────────────────────────────────

const BAYER8 = (() => {
  const m = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Bit-reversed interleave of x and x^y: the recursive Bayer matrix.
      const v = x ^ y;
      const b =
        ((v & 1) << 5) | ((x & 1) << 4) | ((v & 2) << 2) | ((x & 2) << 1) | ((v & 4) >> 1) | ((x & 4) >> 2);
      m[y * 8 + x] = (b + 0.5) / 64;
    }
  }
  return m;
})();

/** Ordered-dither threshold in `(0, 1)` for a device pixel. */
export function bayer(x: number, y: number): number {
  return BAYER8[((y & 7) << 3) | (x & 7)]!;
}

export const INK: Paint = () => 1;
export const PAPER: Paint = () => 0;
export const XOR: Paint = (_x, _y, current) => (current ^ 1) as Ink;

/** An opaque tone: `level` is the fraction of pixels that are black. */
export function tone(level: number): Paint {
  return (x, y) => (bayer(x, y) < level ? 1 : 0);
}

/** A translucent tone: adds black where the dither says so, keeps the rest. */
export function toneOver(level: number): Paint {
  return (x, y, current) => (bayer(x, y) < level ? 1 : current);
}

/** A translucent tone in white: erases where the dither says so. */
export function toneUnder(level: number): Paint {
  return (x, y, current) => (bayer(x, y) < level ? 0 : current);
}

// ── Painter ───────────────────────────────────────────────────────────────

export class Painter {
  readonly frame: Frame;
  stage: Stage;
  paint: Paint = INK;
  clip: PixelRect;

  constructor(frame: Frame, stage: Stage, clip?: PixelRect) {
    this.frame = frame;
    this.stage = stage;
    this.clip = clip ?? { x0: 0, y0: 0, x1: frame.width, y1: frame.height };
  }

  /** Run `draw` with a temporary paint and/or stage, then restore. */
  with(options: { paint?: Paint; stage?: Stage }, draw: () => void): void {
    const { paint, stage } = this;
    if (options.paint) this.paint = options.paint;
    if (options.stage) this.stage = options.stage;
    try {
      draw();
    } finally {
      this.paint = paint;
      this.stage = stage;
    }
  }

  dx(x: number): number {
    return x * this.stage.scale + this.stage.x;
  }

  dy(y: number): number {
    return y * this.stage.scale + this.stage.y;
  }

  /** Device pixels covered by `[xa, xb)` on row `y`, by pixel centre. */
  span(y: number, xa: number, xb: number): void {
    const { clip, frame, paint } = this;
    if (y < clip.y0 || y >= clip.y1) return;
    const x0 = Math.max(clip.x0, Math.ceil(xa - 0.5));
    const x1 = Math.min(clip.x1, Math.ceil(xb - 0.5));
    const row = y * frame.width;
    const px = frame.pixels;
    for (let x = x0; x < x1; x++) px[row + x] = paint(x, y, px[row + x] as Ink);
  }

  /** Paint one device pixel. */
  pixel(x: number, y: number): void {
    const { clip, frame } = this;
    if (x < clip.x0 || y < clip.y0 || x >= clip.x1 || y >= clip.y1) return;
    const i = y * frame.width + x;
    frame.pixels[i] = this.paint(x, y, frame.pixels[i] as Ink);
  }

  /** Fill the whole clip. */
  fill(): void {
    for (let y = this.clip.y0; y < this.clip.y1; y++) this.span(y, this.clip.x0, this.clip.x1);
  }

  /** Rows whose centres fall in `[top, bottom)`, in device space, clipped. */
  private rows(top: number, bottom: number): [number, number] {
    return [Math.max(this.clip.y0, Math.ceil(top - 0.5)), Math.min(this.clip.y1, Math.ceil(bottom - 0.5))];
  }

  rect(x: number, y: number, w: number, h: number): void {
    const xa = this.dx(x);
    const xb = this.dx(x + w);
    const [y0, y1] = this.rows(this.dy(y), this.dy(y + h));
    for (let row = y0; row < y1; row++) this.span(row, xa, xb);
  }

  circle(cx: number, cy: number, r: number): void {
    if (r <= 0) return;
    const x = this.dx(cx);
    const y = this.dy(cy);
    const R = r * this.stage.scale;
    const [y0, y1] = this.rows(y - R, y + R);
    for (let row = y0; row < y1; row++) {
      const d = row + 0.5 - y;
      const half = Math.sqrt(Math.max(0, R * R - d * d));
      this.span(row, x - half, x + half);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number): void {
    if (rx <= 0 || ry <= 0) return;
    const x = this.dx(cx);
    const y = this.dy(cy);
    const RX = rx * this.stage.scale;
    const RY = ry * this.stage.scale;
    const [y0, y1] = this.rows(y - RY, y + RY);
    for (let row = y0; row < y1; row++) {
      const d = (row + 0.5 - y) / RY;
      const half = RX * Math.sqrt(Math.max(0, 1 - d * d));
      this.span(row, x - half, x + half);
    }
  }

  /** An annulus of the given outer radius and band width. */
  ring(cx: number, cy: number, r: number, width: number): void {
    if (r <= 0 || width <= 0) return;
    const x = this.dx(cx);
    const y = this.dy(cy);
    const R = r * this.stage.scale;
    const Ri = Math.max(0, r - width) * this.stage.scale;
    const [y0, y1] = this.rows(y - R, y + R);
    for (let row = y0; row < y1; row++) {
      const d = row + 0.5 - y;
      const outer = Math.sqrt(Math.max(0, R * R - d * d));
      if (Math.abs(d) < Ri) {
        const inner = Math.sqrt(Ri * Ri - d * d);
        this.span(row, x - outer, x - inner);
        this.span(row, x + inner, x + outer);
      } else {
        this.span(row, x - outer, x + outer);
      }
    }
  }

  /** Even-odd fill; several contours in one call punch holes in each other. */
  polygon(...contours: readonly (readonly Vec[])[]): void {
    const edges: number[] = [];
    let top = Infinity;
    let bottom = -Infinity;
    for (const points of contours) {
      for (let k = 0; k < points.length; k++) {
        const p = points[k]!;
        const q = points[(k + 1) % points.length]!;
        const ax = this.dx(p.x);
        const ay = this.dy(p.y);
        const bx = this.dx(q.x);
        const by = this.dy(q.y);
        edges.push(ax, ay, bx, by);
        top = Math.min(top, ay);
        bottom = Math.max(bottom, ay);
      }
    }
    const [y0, y1] = this.rows(top, bottom);
    const xs: number[] = [];
    for (let row = y0; row < y1; row++) {
      const cy = row + 0.5;
      xs.length = 0;
      for (let e = 0; e < edges.length; e += 4) {
        const ay = edges[e + 1]!;
        const by = edges[e + 3]!;
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
          const ax = edges[e]!;
          xs.push(ax + ((cy - ay) / (by - ay)) * (edges[e + 2]! - ax));
        }
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) this.span(row, xs[k]!, xs[k + 1]!);
    }
  }

  /** Every point within `r` of the segment `ab`: a stroke with round caps. */
  capsule(a: Vec, b: Vec, r: number): void {
    const s = this.stage.scale;
    const ax = this.dx(a.x);
    const ay = this.dy(a.y);
    const bx = this.dx(b.x);
    const by = this.dy(b.y);
    const R = Math.max(0.5, r * s);
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const [y0, y1] = this.rows(Math.min(ay, by) - R, Math.max(ay, by) + R);
    for (let row = y0; row < y1; row++) {
      const cy = row + 0.5;
      let lo = Infinity;
      let hi = -Infinity;
      // The caps.
      for (const [px, py] of [[ax, ay], [bx, by]] as const) {
        const d = cy - py;
        if (Math.abs(d) < R) {
          const half = Math.sqrt(R * R - d * d);
          lo = Math.min(lo, px - half);
          hi = Math.max(hi, px + half);
        }
      }
      // The swept band: |cross(p - a, v)| ≤ R |v| with 0 ≤ dot(p - a, v) ≤ |v|².
      if (len2 > 1e-9) {
        const len = Math.sqrt(len2);
        let bandLo = -Infinity;
        let bandHi = Infinity;
        const cross0 = -(cy - ay) * vx;
        // cross(p - a, v) = (px - ax) vy - (cy - ay) vx, linear in px.
        if (Math.abs(vy) > 1e-9) {
          const e0 = (-R * len - cross0) / vy + ax;
          const e1 = (R * len - cross0) / vy + ax;
          bandLo = Math.max(bandLo, Math.min(e0, e1));
          bandHi = Math.min(bandHi, Math.max(e0, e1));
        } else if (Math.abs(cross0) > R * len) {
          bandLo = Infinity;
        }
        // dot(p - a, v) = (px - ax) vx + (cy - ay) vy.
        const dot0 = (cy - ay) * vy;
        if (Math.abs(vx) > 1e-9) {
          const e0 = -dot0 / vx + ax;
          const e1 = (len2 - dot0) / vx + ax;
          bandLo = Math.max(bandLo, Math.min(e0, e1));
          bandHi = Math.min(bandHi, Math.max(e0, e1));
        } else if (dot0 < 0 || dot0 > len2) {
          bandLo = Infinity;
        }
        if (bandLo < bandHi) {
          lo = Math.min(lo, bandLo);
          hi = Math.max(hi, bandHi);
        }
      }
      if (lo < hi) this.span(row, lo, hi);
    }
  }

  /** A polyline of round-capped, round-joined segments `width` wide. */
  stroke(points: readonly Vec[], width: number): void {
    const r = width / 2;
    if (points.length === 1) this.circle(points[0]!.x, points[0]!.y, r);
    for (let k = 0; k + 1 < points.length; k++) this.capsule(points[k]!, points[k + 1]!, r);
  }

  /** A one-device-pixel line, Bresenham. */
  line(a: Vec, b: Vec): void {
    this.deviceLine(this.dx(a.x), this.dy(a.y), this.dx(b.x), this.dy(b.y));
  }

  deviceLine(ax: number, ay: number, bx: number, by: number): void {
    let x0 = Math.floor(ax);
    let y0 = Math.floor(ay);
    const x1 = Math.floor(bx);
    const y1 = Math.floor(by);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    if (Math.max(dx, -dy) > 4 * (this.frame.width + this.frame.height)) return;
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.pixel(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
}

// ── Whole-frame operations ────────────────────────────────────────────────

/** Invert every pixel inside `rect`. */
export function invertRect(frame: Frame, rect: PixelRect): void {
  for (let y = rect.y0; y < rect.y1; y++) {
    const row = y * frame.width;
    for (let x = rect.x0; x < rect.x1; x++) frame.pixels[row + x] ^= 1;
  }
}

/** Copy `rect` of `src` into the same place in `dst`. */
function copyRect(src: Frame, dst: Frame, rect: PixelRect): void {
  for (let y = rect.y0; y < rect.y1; y++) {
    const row = y * src.width;
    dst.pixels.set(src.pixels.subarray(row + rect.x0, row + rect.x1), row + rect.x0);
  }
}

/**
 * Scale the picture inside `rect` about its centre (nearest neighbour),
 * filling what's uncovered with `background`. `sx`/`sy` of 0 collapse it.
 */
export function squeeze(frame: Frame, scratch: Frame, rect: PixelRect, sx: number, sy: number, background: Ink): void {
  copyRect(frame, scratch, rect);
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  for (let y = rect.y0; y < rect.y1; y++) {
    const srcY = sy > 0 ? Math.floor(cy + (y + 0.5 - cy) / sy) : -1;
    const row = y * frame.width;
    const srcRow = srcY * frame.width;
    const rowInside = srcY >= rect.y0 && srcY < rect.y1;
    for (let x = rect.x0; x < rect.x1; x++) {
      const srcX = sx > 0 ? Math.floor(cx + (x + 0.5 - cx) / sx) : -1;
      frame.pixels[row + x] =
        rowInside && srcX >= rect.x0 && srcX < rect.x1 ? scratch.pixels[srcRow + srcX]! : background;
    }
  }
}

/** Mirror the left half of `rect` onto the right, and the top onto the bottom. */
export function kaleidoscope(frame: Frame, rect: PixelRect): void {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  for (let y = rect.y0; y < rect.y1; y++) {
    const srcY = y - rect.y0 < h / 2 ? y : rect.y1 - 1 - (y - rect.y0);
    const row = y * frame.width;
    const srcRow = srcY * frame.width;
    for (let x = rect.x0; x < rect.x1; x++) {
      const srcX = x - rect.x0 < w / 2 ? x : rect.x1 - 1 - (x - rect.x0);
      frame.pixels[row + x] = frame.pixels[srcRow + srcX]!;
    }
  }
}
