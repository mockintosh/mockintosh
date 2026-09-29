/**
 * A luminance buffer that behaves like the phosphor on a tube: scenes add
 * light to it, it fades on its own, and `develop` orders-dithers it into one
 * bit. Light is 0 (dark) … 1 (white); values above 1 are allowed and read as
 * white, so bright overlaps saturate instead of wrapping.
 */
import { bayer, type Frame } from "../showreel/painter";

export class Phosphor {
  width = 0;
  height = 0;
  light = new Float32Array(0);
  private spare = new Float32Array(0);

  /** Match `frame`'s size; returns true (and starts dark) when it changed. */
  fit(frame: { width: number; height: number }): boolean {
    if (frame.width === this.width && frame.height === this.height) return false;
    this.width = frame.width;
    this.height = frame.height;
    this.light = new Float32Array(this.width * this.height);
    this.spare = new Float32Array(this.width * this.height);
    return true;
  }

  clear(value = 0): void {
    this.light.fill(value);
  }

  /** Multiply every value by `k`: the afterglow of the last frame. */
  decay(k: number): void {
    const light = this.light;
    for (let i = 0; i < light.length; i++) light[i]! *= k;
  }

  /** Add `v` at a point, spread bilinearly over the four pixels around it. */
  add(x: number, y: number, v: number): void {
    const x0 = Math.floor(x - 0.5);
    const y0 = Math.floor(y - 0.5);
    const fx = x - 0.5 - x0;
    const fy = y - 0.5 - y0;
    this.addPixel(x0, y0, v * (1 - fx) * (1 - fy));
    this.addPixel(x0 + 1, y0, v * fx * (1 - fy));
    this.addPixel(x0, y0 + 1, v * (1 - fx) * fy);
    this.addPixel(x0 + 1, y0 + 1, v * fx * fy);
  }

  addPixel(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.light[y * this.width + x]! += v;
  }

  /** Raise a pixel to at least `v`. */
  lift(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    if (this.light[i]! < v) this.light[i] = v;
  }

  /** A beam drawn from a to b: `v` of light per pixel of length, sub-pixel placed. */
  line(ax: number, ay: number, bx: number, by: number, v: number): void {
    const len = Math.hypot(bx - ax, by - ay);
    if (len > 4 * (this.width + this.height)) return;
    const steps = Math.max(1, Math.ceil(len));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      this.add(ax + (bx - ax) * t, ay + (by - ay) * t, v);
    }
  }

  /** A soft round spot of radius `r`, brightest at the centre. */
  spot(cx: number, cy: number, r: number, v: number): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
        if (d2 < r2) this.light[y * this.width + x]! += v * (1 - d2 / r2);
      }
    }
  }

  /**
   * Replace the picture with itself seen through `map`: for each pixel,
   * `map` names the source point it shows (nearest neighbour), times `k`.
   * The feedback loop behind zooms and swirls.
   */
  warp(map: (x: number, y: number, out: { x: number; y: number }) => void, k: number): void {
    const { width, height, light } = this;
    const out = { x: 0, y: 0 };
    const next = this.spare;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        map(x + 0.5, y + 0.5, out);
        const sx = Math.floor(out.x);
        const sy = Math.floor(out.y);
        next[y * width + x] = sx >= 0 && sy >= 0 && sx < width && sy < height ? light[sy * width + sx]! * k : 0;
      }
    }
    this.spare = light;
    this.light = next;
  }

  /** Ordered-dither the light into `frame`: lit pixels white, the rest black. */
  develop(frame: Frame, gain = 1): void {
    const { width, height, light } = this;
    const px = frame.pixels;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) px[row + x] = light[row + x]! * gain > bayer(x, y) ? 0 : 1;
    }
  }
}
