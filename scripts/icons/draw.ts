/**
 * A 1-bit drawing surface for constructing icons from shapes — circles that
 * are round and symmetric, straight diagonals — before finishing them by hand
 * as a `fromGrid` grid. Integer pixel coordinates; (0, 0) is the top left.
 *
 *   const c = new IconCanvas(32);
 *   c.fillEllipse(16, 16, 14, 14, "paper");
 *   c.ellipse(16, 16, 14, 14);
 *   console.log(c.toGridSource("GLOBE"));
 */
import { fromGrid, type Sprite } from "@mockintosh/ui";

/** `ink` black, `paper` opaque white, `clear` transparent. */
export type Pen = "ink" | "paper" | "clear";

const CHAR: Record<Pen, string> = { ink: "#", paper: "o", clear: "." };

export class IconCanvas {
  readonly width: number;
  readonly height: number;
  private readonly px: Pen[];

  constructor(width: number, height = width) {
    this.width = width;
    this.height = height;
    this.px = new Array<Pen>(width * height).fill("clear");
  }

  /** Start from an existing grid (`#` ink, `.` clear, anything else paper). */
  static fromRows(rows: string[]): IconCanvas {
    const c = new IconCanvas(rows[0]?.length ?? 0, rows.length);
    rows.forEach((row, y) => [...row].forEach((ch, x) => c.set(x, y, ch === "#" ? "ink" : ch === "." ? "clear" : "paper")));
    return c;
  }

  get(x: number, y: number): Pen | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    return this.px[y * this.width + x];
  }

  set(x: number, y: number, pen: Pen = "ink"): this {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.px[y * this.width + x] = pen;
    return this;
  }

  /** Bresenham: one pixel per step, no doubled corners. */
  line(x0: number, y0: number, x1: number, y1: number, pen: Pen = "ink"): this {
    [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, pen);
      if (x0 === x1 && y0 === y1) return this;
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

  /** Outline of the inclusive box from (x0, y0) to (x1, y1). */
  rect(x0: number, y0: number, x1: number, y1: number, pen: Pen = "ink"): this {
    return this.line(x0, y0, x1, y0, pen).line(x1, y0, x1, y1, pen).line(x1, y1, x0, y1, pen).line(x0, y1, x0, y0, pen);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, pen: Pen = "ink"): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, pen);
    return this;
  }

  /**
   * Is (x, y) inside the ellipse centred on (cx, cy)? Centres may sit on
   * half pixels: an even-width circle in a 32 grid is centred on 15.5.
   */
  private inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
    const nx = (x - cx) / (rx + 0.5);
    const ny = (y - cy) / (ry + 0.5);
    return nx * nx + ny * ny <= 1;
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, pen: Pen = "ink"): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) if (this.inEllipse(x, y, cx, cy, rx, ry)) this.set(x, y, pen);
    }
    return this;
  }

  /** A 1px outline: the filled ellipse's pixels that touch its outside (4-connected). */
  ellipse(cx: number, cy: number, rx: number, ry: number, pen: Pen = "ink"): this {
    const inside = (x: number, y: number) => this.inEllipse(x, y, cx, cy, rx, ry);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!inside(x, y)) continue;
        if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) this.set(x, y, pen);
      }
    }
    return this;
  }

  /** Closed polygon outline through integer points. */
  polygon(points: [number, number][], pen: Pen = "ink"): this {
    points.forEach(([x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length];
      this.line(x, y, nx, ny, pen);
    });
    return this;
  }

  /** Even-odd fill of a polygon, sampled at pixel centres. */
  fillPolygon(points: [number, number][], pen: Pen = "ink"): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i];
          const [xj, yj] = points[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.set(x, y, pen);
      }
    }
    return this.polygon(points, pen);
  }

  /** Flood the 4-connected region of (x, y)'s pen with `pen`. */
  flood(x: number, y: number, pen: Pen): this {
    const from = this.get(x, y);
    if (from === undefined || from === pen) return this;
    const stack: [number, number][] = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop()!;
      if (this.get(px, py) !== from) continue;
      this.set(px, py, pen);
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    return this;
  }

  /**
   * Fill the region of (x, y) with a repeating pattern, rows of `#` / `o`
   * (e.g. ["#o", "o#"] for 50% gray). Patterns belong at 32×32 only.
   */
  pattern(x: number, y: number, rows: string[]): this {
    const from = this.get(x, y);
    if (from === undefined) return this;
    const region = new IconCanvas(this.width, this.height);
    const stack: [number, number][] = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop()!;
      if (this.get(px, py) !== from || region.get(px, py) === "ink") continue;
      region.set(px, py, "ink");
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    for (let py = 0; py < this.height; py++) {
      for (let px = 0; px < this.width; px++) {
        if (region.get(px, py) !== "ink") continue;
        const row = rows[py % rows.length];
        this.set(px, py, row[px % row.length] === "#" ? "ink" : "paper");
      }
    }
    return this;
  }

  /** Mirror the left half onto the right, for symmetric shapes. */
  mirrorX(): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width / 2; x++) this.set(this.width - 1 - x, y, this.get(x, y));
    }
    return this;
  }

  /** Every clear pixel touching the shape becomes ink: a 1px outline around it. */
  outline(pen: Pen = "ink"): this {
    const hits: [number, number][] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) !== "clear") continue;
        const n = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)];
        if (n.some((p) => p !== undefined && p !== "clear")) hits.push([x, y]);
      }
    }
    for (const [x, y] of hits) this.set(x, y, pen);
    return this;
  }

  rows(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.height; y++) {
      out.push(this.px.slice(y * this.width, (y + 1) * this.width).map((p) => CHAR[p]).join(""));
    }
    return out;
  }

  toSprite(): Sprite {
    return fromGrid(this.width, this.height, this.rows());
  }

  /** `const NAME = [ ...rows ];`, ready to paste into an icons module. */
  toGridSource(name: string): string {
    return `const ${name} = [\n${this.rows().map((r) => `  "${r}",`).join("\n")}\n];`;
  }
}
