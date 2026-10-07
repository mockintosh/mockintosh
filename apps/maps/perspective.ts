/**
 * The map seen at a slant, from a camera facing `bearing` (0 north, a
 * quarter turn east) tilted `pitch` from straight down: the flat map laid on
 * the ground in perspective, and buildings raised on it to their mapped
 * heights.
 *
 * Distances are world pixels at the map's zoom, measured from the point the
 * camera looks at (the middle of the view): x east, y south, z up. The
 * camera stands as far from that point as its focal length, so the point
 * keeps the flat map's scale, and at a pitch of 0 the view is the flat map.
 *
 * `orthographic` looks the same way from infinitely far, the way a drafted
 * axonometric does: everything at the flat map's scale, near or far, and
 * parallel edges staying parallel.
 */
import { BLACK, Bitmap, WHITE, clipSegment, type Paint } from "./bitmap";
import type { BuildingBlock } from "./generalize";
import type { TileFeature, VectorTile } from "./mvt";

/** How far the 3D view tilts from looking straight down. */
export const PITCH_3D = (45 * Math.PI) / 180;
/** How far the view may tilt: enough to see buildings stand up, short of the horizon. */
export const MIN_PITCH = (15 * Math.PI) / 180;
export const MAX_PITCH = (65 * Math.PI) / 180;
/** The camera's field of view, top to bottom. */
const FOV = (36 * Math.PI) / 180;
/** Ground farther than this many times the camera's distance is left out: the view is near the horizon there. */
const FARTHEST = 6;

export class Perspective {
  /** Focal length, in screen pixels; also the camera's distance from the point it looks at. */
  readonly focal: number;
  private readonly sin: number;
  private readonly cos: number;
  /** The bearing's sine and cosine: turning the ground so the way the camera faces is up. */
  private readonly turnSin: number;
  private readonly turnCos: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly pitch: number,
    readonly bearing = 0,
    readonly orthographic = false,
  ) {
    this.focal = height / 2 / Math.tan(FOV / 2);
    this.sin = Math.sin(pitch);
    this.cos = Math.cos(pitch);
    this.turnSin = Math.sin(bearing);
    this.turnCos = Math.cos(bearing);
  }

  /** Point (x, y) on the map, turned so the camera faces up: x right, y towards the camera. */
  private turned(x: number, y: number): [number, number] {
    return [x * this.turnCos + y * this.turnSin, y * this.turnCos - x * this.turnSin];
  }

  /** A turned point back on the map. */
  private unturned(x: number, y: number): [number, number] {
    return [x * this.turnCos - y * this.turnSin, x * this.turnSin + y * this.turnCos];
  }

  /** How high above the ground the camera is, in map pixels (orthographic: above everything). */
  cameraHeight(): number {
    return this.orthographic ? Infinity : this.focal * this.cos;
  }

  /** Where the camera stands, seen from above, from the point it looks at. */
  camera(): [number, number] {
    return this.unturned(0, this.focal * this.sin);
  }

  /**
   * Whether a wall at (x, y) whose outward normal is (nx, ny) faces the
   * camera: towards where it stands or, orthographic, the way it looks from.
   */
  faces(nx: number, ny: number, x: number, y: number): boolean {
    if (this.orthographic) {
      const [towardsX, towardsY] = this.unturned(0, 1);
      return nx * towardsX + ny * towardsY > 0;
    }
    const [cx, cy] = this.camera();
    return nx * (cx - x) + ny * (cy - y) > 0;
  }

  /** How far in front of the camera a point is; at or below 0 it's behind (orthographic: only ever compared). */
  depth(x: number, y: number, z = 0): number {
    const [, ty] = this.turned(x, y);
    return (this.orthographic ? 0 : this.focal) - ty * this.sin - z * this.cos;
  }

  /**
   * Whether a point at `depth` is in front of the camera. Orthographic,
   * depth only orders points, measured from the middle of the view, and
   * everything is in front.
   */
  inFront(depth: number): boolean {
    return this.orthographic || depth > 1;
  }

  /** Screen pixels per world pixel, at `depth`. */
  scaleAt(depth: number): number {
    return this.orthographic ? 1 : this.focal / depth;
  }

  /**
   * A measure of nearness that runs evenly across a flat surface on the
   * screen, for the depth buffer: 1 / depth in perspective, where depth
   * doesn't run evenly; depth itself, turned round, orthographic.
   */
  nearness(depth: number): number {
    return this.orthographic ? ORTHO_FAR - depth : 1 / depth;
  }

  /** A nearness a hair nearer: for an edge, over the surface it edges. */
  edgeNearness(nearness: number): number {
    return this.orthographic ? nearness + ORTHO_EDGE : nearness * PERSPECTIVE_EDGE;
  }

  /** Where point (x, y, z) shows on the screen, or `null` when it's behind the camera. */
  project(x: number, y: number, z = 0): [number, number] | null {
    const at = this.projectDepth(x, y, z);
    return at && [at[0], at[1]];
  }

  /**
   * `projectDepth` into `xs[i]`, `ys[i]` and `ds[i]`, making nothing: for
   * the many corners of the buildings in a frame. `false` when the point
   * is behind the camera.
   */
  projectInto(x: number, y: number, z: number, xs: Float64Array, ys: Float64Array, ds: Float64Array, i: number): boolean {
    const tx = x * this.turnCos + y * this.turnSin;
    const ty = y * this.turnCos - x * this.turnSin;
    if (this.orthographic) {
      xs[i] = this.width / 2 + tx;
      ys[i] = this.height / 2 + ty * this.cos - z * this.sin;
      ds[i] = -ty * this.sin - z * this.cos;
      return true;
    }
    const depth = this.focal - ty * this.sin - z * this.cos;
    if (depth <= 1) return false;
    const k = this.focal / depth;
    xs[i] = this.width / 2 + tx * k;
    ys[i] = this.height / 2 + (ty * this.cos - z * this.sin) * k;
    ds[i] = depth;
    return true;
  }

  /** `project`, and how far in front of the camera the point is. */
  projectDepth(x: number, y: number, z = 0): [number, number, number] | null {
    const [tx, ty] = this.turned(x, y);
    if (this.orthographic) return [this.width / 2 + tx, this.height / 2 + ty * this.cos - z * this.sin, -ty * this.sin - z * this.cos];
    const depth = this.focal - ty * this.sin - z * this.cos;
    if (depth <= 1) return null;
    const k = this.focal / depth;
    return [this.width / 2 + tx * k, this.height / 2 + (ty * this.cos - z * this.sin) * k, depth];
  }

  /** The point on the ground under screen point (sx, sy), or `null` above the horizon. */
  ground(sx: number, sy: number): [number, number] | null {
    const at = this.groundTurned(sx, sy);
    return at && this.unturned(at[0], at[1]);
  }

  /** `ground`, before turning back to the map: x right, y towards the camera. */
  private groundTurned(sx: number, sy: number): [number, number] | null {
    if (this.orthographic) return [sx - this.width / 2, (sy - this.height / 2) / this.cos];
    const u = (sx - this.width / 2) / this.focal;
    const v = (this.height / 2 - sy) / this.focal;
    const below = this.cos - v * this.sin;
    if (below <= 0) return null;
    const t = Math.min((this.focal * this.cos) / below, FARTHEST * this.focal);
    return [t * u, this.focal * this.sin - t * (this.sin + v * this.cos)];
  }

  /** The part of the ground the view shows: `[x0, y0, x1, y1]` around the point looked at. */
  groundBox(): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [this.width, 0], [0, this.height], [this.width, this.height]] as const) {
      // Above the horizon, the farthest ground still drawn.
      const at = this.ground(sx, sy) ?? this.ground(sx, this.horizon() + 1)!;
      x0 = Math.min(x0, at[0]);
      x1 = Math.max(x1, at[0]);
      y0 = Math.min(y0, at[1]);
      y1 = Math.max(y1, at[1]);
    }
    return [Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(x1) + 2, Math.ceil(y1) + 2];
  }

  /** The screen row of the horizon (negative when it's above the view). */
  horizon(): number {
    return this.height / 2 - (this.focal * this.cos) / this.sin;
  }

  /**
   * Lay `flat`, a flat map whose top-left is (left, top) from the point
   * looked at, on the ground in `target`. Above the horizon stays white.
   */
  warp(flat: Bitmap, left: number, top: number, target: Bitmap): void {
    const { width, height, focal } = this;
    const out = target.pixels;
    const src = flat.pixels;
    for (let sy = 0; sy < height; sy++) {
      const row = sy * width;
      // Along a row the ground runs evenly: `step` per pixel across the
      // camera's view, `ty` towards it, turned onto the map.
      let step: number;
      let ty: number;
      if (this.orthographic) {
        step = 1;
        ty = (sy + 0.5 - height / 2) / this.cos;
      } else {
        const v = (height / 2 - (sy + 0.5)) / focal;
        const below = this.cos - v * this.sin;
        const t = (focal * this.cos) / below;
        if (below <= 0 || t > FARTHEST * focal) {
          out.fill(0, row, row + width);
          continue;
        }
        step = t / focal;
        ty = focal * this.sin - t * (this.sin + v * this.cos);
      }
      const [x0, y0] = this.unturned((0.5 - width / 2) * step, ty);
      const [dx, dy] = this.unturned(step, 0);
      let gx = x0 - left;
      let gy = y0 - top;
      const fw = flat.width;
      const fh = flat.height;
      for (let sx = 0; sx < width; sx++, gx += dx, gy += dy) {
        const x = Math.floor(gx);
        const y = Math.floor(gy);
        out[row + sx] = x >= 0 && x < fw && y >= 0 && y < fh ? src[y * fw + x]! : 0;
      }
    }
  }
}

/** A building's outline, in its tile's units, and how tall it stands. */
export interface Building {
  xs: Float64Array;
  ys: Float64Array;
  /** Edge `i` (from point `i` to the next) is a real wall, not where the tile cut the building. */
  walls: Uint8Array;
  /** Roof and base above the ground, in metres. */
  height: number;
  base: number;
  cx: number;
  cy: number;
  /** Its outline's longer side, in tile units. */
  size: number;
}

/** A building with no height mapped stands this tall, in metres. */
const DEFAULT_HEIGHT = 8;

/**
 * The buildings in one data tile, in its own units: the same at every
 * zoom, so they're read once per tile and placed when drawn
 * (`BuildingGroup`).
 */
export function collectBuildings(tile: VectorTile): Building[] {
  const layer = tile.get("building");
  if (!layer) return [];
  const extent = layer.extent;
  const out: Building[] = [];
  for (const f of layer.features) {
    if (f.type !== 3 || f.get("hide_3d") === true) continue;
    const height = numberOr(f, "render_height", DEFAULT_HEIGHT);
    const base = numberOr(f, "render_min_height", 0);
    if (height <= base) continue;
    const g = f.geometry();
    for (let p = 0; p + 1 < g.parts.length; p++) {
      const start = g.parts[p]!;
      const end = g.parts[p + 1]!;
      let n = end - start;
      // A closed ring repeats its first point.
      if (n > 1 && g.coords[2 * start] === g.coords[2 * (end - 1)] && g.coords[2 * start + 1] === g.coords[2 * (end - 1) + 1]) n--;
      if (n < 3) continue;
      let area = 0;
      for (let i = 0; i < n; i++) {
        const a = start + i;
        const b = start + ((i + 1) % n);
        area += g.coords[2 * a]! * g.coords[2 * b + 1]! - g.coords[2 * b]! * g.coords[2 * a + 1]!;
      }
      // An outline runs clockwise on the tile (y down), a hole the other way;
      // a courtyard needs no roof of its own.
      if (area <= 0) continue;
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      const walls = new Uint8Array(n);
      let cx = 0, cy = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const a = start + i;
        const b = start + ((i + 1) % n);
        const ax = g.coords[2 * a]!, ay = g.coords[2 * a + 1]!;
        const bx = g.coords[2 * b]!, by = g.coords[2 * b + 1]!;
        xs[i] = ax;
        ys[i] = ay;
        cx += xs[i]!;
        cy += ys[i]!;
        minX = Math.min(minX, ax); maxX = Math.max(maxX, ax);
        minY = Math.min(minY, ay); maxY = Math.max(maxY, ay);
        // The tile clips buildings a little outside its edge; that cut is no wall.
        const cut = (ax < 0 && bx < 0) || (ax > extent && bx > extent) || (ay < 0 && by < 0) || (ay > extent && by > extent);
        walls[i] = cut ? 0 : 1;
      }
      out.push({ xs, ys, walls, height, base, cx: cx / n, cy: cy / n, size: Math.max(maxX - minX, maxY - minY) });
    }
  }
  return out;
}

function numberOr(f: TileFeature, key: string, fallback: number): number {
  const value = f.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Walls in three light shades by which way they face, lit from the
 * south-west, and roofs white: no darker than half gray, so a street of
 * towers stays readable rather than going black.
 */
export const LIGHT: Paint = { pattern: [0x88, 0x00, 0x22, 0x00, 0x88, 0x00, 0x22, 0x00] };
export const QUARTER: Paint = { pattern: [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22] };
export const HALF: Paint = { pattern: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55] };
/** Walls meeting straighter than this (the cosine of their turn) show no corner between them. */
export const CORNER = Math.cos((30 * Math.PI) / 180);
const LIGHT_X = -0.6;
const LIGHT_Y = 0.8;

/** A wall's shade, by the way its outline runs (dirX, dirY), a unit vector. */
export function wallPaint(dirX: number, dirY: number): Paint {
  const lit = dirY * LIGHT_X - dirX * LIGHT_Y;
  return lit > 0.4 ? LIGHT : lit > -0.4 ? QUARTER : HALF;
}

/**
 * The nearest surface drawn so far at each pixel, by its inverse depth
 * (0: nothing yet). Buildings overlap in ways no back-to-front order of
 * whole buildings gets right — a ring of parts of different heights, one
 * inside another — so each pixel keeps whichever surface is nearest.
 */
class DepthBuffer {
  private readonly near: Float64Array;
  private readonly pixels: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  // The polygon being filled: its inverse-depth plane and pattern. Kept
  // here so filling a row needs no closure made per polygon.
  private a = 0;
  private b = 0;
  private c = 0;
  private pattern: readonly number[] = [];
  /** The surface just filled had a plane (it wasn't seen edge on): its edges can be drawn. */
  private planar = false;
  private readonly row = (y: number, x0: number, x1: number) => this.fillRow(y, x0, x1);

  constructor(
    private readonly target: Bitmap,
    private readonly view: Perspective,
  ) {
    this.near = new Float64Array(target.width * target.height);
    this.pixels = target.pixels;
    this.width = target.width;
    this.height = target.height;
  }

  /**
   * Fill the flat polygon (xs, ys) on the screen, its first `n` corners,
   * whose corners are `depths[k]` from the camera, where it's nearest.
   */
  fill(xs: ArrayLike<number>, ys: ArrayLike<number>, depths: ArrayLike<number>, n: number, paint: Paint): void {
    this.planar = flatPlane(xs, ys, this.nearnesses(depths, n), n, PLANE);
    if (!this.planar) return;
    this.a = PLANE[0]!;
    this.b = PLANE[1]!;
    this.c = PLANE[2]!;
    this.pattern = paint.pattern;
    PARTS[1] = n;
    this.target.scanPath(xs, ys, PARTS, this.row);
  }

  /**
   * `fill` for a convex polygon, as every wall is on the screen: each row
   * is one span between its leftmost and rightmost crossing, found without
   * the general scanner's sorting.
   */
  fillConvex(xs: ArrayLike<number>, ys: ArrayLike<number>, depths: ArrayLike<number>, n: number, paint: Paint): void {
    this.planar = flatPlane(xs, ys, this.nearnesses(depths, n), n, PLANE);
    if (!this.planar) return;
    this.a = PLANE[0]!;
    this.b = PLANE[1]!;
    this.c = PLANE[2]!;
    this.pattern = paint.pattern;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      if (ys[k]! < minY) minY = ys[k]!;
      if (ys[k]! > maxY) maxY = ys[k]!;
    }
    // Rows whose centres lie inside, as `scanPath` counts them.
    const first = Math.max(0, Math.ceil(minY - 0.5));
    const last = Math.min(this.height, Math.ceil(maxY - 0.5));
    for (let y = first; y < last; y++) {
      const cy = y + 0.5;
      let left = Infinity;
      let right = -Infinity;
      for (let k = 0; k < n; k++) {
        const j = k + 1 < n ? k + 1 : 0;
        const y0 = ys[k]!, y1 = ys[j]!;
        if (y0 === y1 || (cy < y0 && cy < y1) || (cy >= y0 && cy >= y1)) continue;
        const x = xs[k]! + ((cy - y0) * (xs[j]! - xs[k]!)) / (y1 - y0);
        if (x < left) left = x;
        if (x > right) right = x;
      }
      if (left < right) this.fillRow(y, Math.ceil(left - 0.5), Math.ceil(right - 0.5));
    }
  }

  /** The view's nearness at each of the first `n` depths, into scratch. */
  private nearnesses(depths: ArrayLike<number>, n: number): Float64Array {
    if (NEAR.length < n) NEAR = new Float64Array(Math.max(n, NEAR.length * 2));
    for (let k = 0; k < n; k++) NEAR[k] = this.view.nearness(depths[k]!);
    return NEAR;
  }

  private fillRow(y: number, x0: number, x1: number): void {
    if (y < 0 || y >= this.height) return;
    const from = Math.max(0, x0);
    const to = Math.min(this.width, x1);
    if (from >= to) return;
    const near = this.near;
    const pixels = this.pixels;
    const bits = this.pattern[(y + this.target.phaseY) & 7]!;
    const phase = this.target.phaseX;
    const a = this.a;
    let inverse = a * (from + 0.5) + this.b * (y + 0.5) + this.c;
    for (let x = from, i = y * this.width + from; x < to; x++, i++, inverse += a) {
      if (inverse <= near[i]!) continue;
      near[i] = inverse;
      pixels[i] = (bits >> (7 - ((x + phase) & 7))) & 1;
    }
  }

  /**
   * A black edge from (x0, y0) to (x1, y1) of the surface just filled,
   * where nothing nearer is drawn. Each pixel is tested at its centre on
   * that surface's own plane, as the surface's pixels were, a hair nearer:
   * a slanted surface's depth changes a lot across a pixel, and an edge
   * tested anywhere else would lose every other pixel to it.
   */
  edge(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.planar) return;
    const { near, pixels, width, height, a, b, c, view } = this;
    // Only what's on the screen is stepped along: an edge cut at the near plane can run far off it.
    const clipped = clipSegment(x0, y0, x1, y1, -1, -1, width + 1, height + 1);
    if (!clipped) return;
    [x0, y0, x1, y1] = clipped;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    const dx = (x1 - x0) / steps;
    const dy = (y1 - y0) / steps;
    let x = x0;
    let y = y0;
    for (let k = 0; k <= steps; k++, x += dx, y += dy) {
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = py * width + px;
      const nearness = view.edgeNearness(a * (px + 0.5) + b * (py + 0.5) + c);
      if (nearness < near[i]!) continue;
      pixels[i] = 1;
      // Kept, so the next wall along, meeting this one here, doesn't paint over it.
      near[i] = nearness;
    }
  }
}

/** How far in front of the camera a surface passing it is cut. */
const NEAR_CUT = 2;

/**
 * Building `b`, some of whose corners are behind the camera, drawn as
 * `drawBuildings` draws one, each surface cut at `NEAR_CUT` first. Its roof
 * shows only when it's below the camera; above, it's seen from beneath.
 */
function drawCut(
  depthBuffer: DepthBuffer,
  view: Perspective,
  b: Building,
  scale: number,
  ox: number,
  oy: number,
  h0: number,
  h: number,
  small: boolean,
  corner: (k: number) => boolean,
): void {
  const n = b.xs.length;
  const x = (i: number) => ox + b.xs[i]! * scale;
  const y = (i: number) => oy + b.ys[i]! * scale;
  const edge = (i: number, zi: number, j: number, zj: number) => {
    const cut = cutEdge(view, x(i), y(i), zi, x(j), y(j), zj);
    if (cut) depthBuffer.edge(cut[0], cut[1], cut[2], cut[3]);
  };
  if (h < view.cameraHeight()) {
    reserveCut(n);
    for (let i = 0; i < n; i++) {
      CUT_IN_X[i] = x(i);
      CUT_IN_Y[i] = y(i);
      CUT_IN_Z[i] = h;
    }
    const m = cutPolygon(view, n);
    if (m >= 3) {
      depthBuffer.fill(CUT_X, CUT_Y, CUT_D, m, WHITE);
      for (let i = 0; i < n; i++) if (b.walls[i]) edge(i, h, (i + 1) % n, h);
    }
  }
  reserveCut(4);
  for (let i = 0; i < n; i++) {
    if (!facing[i]) continue;
    const j = (i + 1) % n;
    CUT_IN_X[0] = x(i); CUT_IN_Y[0] = y(i); CUT_IN_Z[0] = h0;
    CUT_IN_X[1] = x(j); CUT_IN_Y[1] = y(j); CUT_IN_Z[1] = h0;
    CUT_IN_X[2] = x(j); CUT_IN_Y[2] = y(j); CUT_IN_Z[2] = h;
    CUT_IN_X[3] = x(i); CUT_IN_Y[3] = y(i); CUT_IN_Z[3] = h;
    const m = cutPolygon(view, 4);
    if (m < 3) continue;
    depthBuffer.fillConvex(CUT_X, CUT_Y, CUT_D, m, wallPaint(dirX[i]!, dirY[i]!));
    if (small) continue;
    edge(i, h0, j, h0);
    if (corner(i)) edge(i, h0, i, h);
    if (corner(j)) edge(j, h0, j, h);
  }
}

/** Where the line from a to b shows, cut at `NEAR_CUT`; `null` when it's all behind. */
function cutEdge(view: Perspective, ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number, number] | null {
  const da = view.depth(ax, ay, az) - NEAR_CUT;
  const db = view.depth(bx, by, bz) - NEAR_CUT;
  if (da < 0 && db < 0) return null;
  if (da < 0 || db < 0) {
    const t = da / (da - db);
    const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t, cz = az + (bz - az) * t;
    if (da < 0) [ax, ay, az] = [cx, cy, cz];
    else [bx, by, bz] = [cx, cy, cz];
  }
  const a = view.project(ax, ay, az);
  const b = view.project(bx, by, bz);
  return a && b ? [a[0], a[1], b[0], b[1]] : null;
}

/**
 * The polygon of the first `n` points of `CUT_IN_*` (map pixels and height),
 * cut at `NEAR_CUT` and projected into `CUT_X` / `CUT_Y` / `CUT_D`; returns
 * how many corners it has left.
 */
function cutPolygon(view: Perspective, n: number): number {
  let m = 0;
  const emit = (x: number, y: number, z: number) => {
    if (view.projectInto(x, y, z, CUT_X, CUT_Y, CUT_D, m)) m++;
  };
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const xi = CUT_IN_X[i]!, yi = CUT_IN_Y[i]!, zi = CUT_IN_Z[i]!;
    const xj = CUT_IN_X[j]!, yj = CUT_IN_Y[j]!, zj = CUT_IN_Z[j]!;
    const di = view.depth(xi, yi, zi) - NEAR_CUT;
    const dj = view.depth(xj, yj, zj) - NEAR_CUT;
    if (di >= 0) emit(xi, yi, zi);
    if (di >= 0 !== dj >= 0) {
      const t = di / (di - dj);
      emit(xi + (xj - xi) * t, yi + (yj - yi) * t, zi + (zj - zi) * t);
    }
  }
  return m;
}

/** Scratch for `cutPolygon`: a polygon in, and out cut (up to twice the corners). */
let CUT_IN_X = new Float64Array(8), CUT_IN_Y = new Float64Array(8), CUT_IN_Z = new Float64Array(8);
let CUT_X = new Float64Array(16), CUT_Y = new Float64Array(16), CUT_D = new Float64Array(16);

function reserveCut(n: number): void {
  if (n <= CUT_IN_X.length) return;
  CUT_IN_X = new Float64Array(n); CUT_IN_Y = new Float64Array(n); CUT_IN_Z = new Float64Array(n);
  CUT_X = new Float64Array(2 * n); CUT_Y = new Float64Array(2 * n); CUT_D = new Float64Array(2 * n);
}

/** Scratch for one polygon: a single ring of `PARTS[1]` points, and its plane. */
const PARTS = [0, 0];
const PLANE = new Float64Array(3);

const AT_X = new Float64Array(1);
const AT_Y = new Float64Array(1);
const AT_D = new Float64Array(1);
const QUAD_X = new Float64Array(4);
const QUAD_Y = new Float64Array(4);
const QUAD_D = new Float64Array(4);

/** How much nearer an edge is drawn than the surface it edges: a share of its nearness in perspective, pixels orthographic. */
export const PERSPECTIVE_EDGE = 1.0005;
export const ORTHO_EDGE = 0.05;
/** Orthographic nearness is this less depth: always positive, as an empty pixel's 0 must be farther than anything. */
export const ORTHO_FAR = 1e5;
let NEAR = new Float64Array(64);

/**
 * Nearness over the screen for a flat polygon of `n` corners, from each
 * corner's (it runs evenly on the screen), into `out` as `[a, b, c]` with
 * nearness = a·x + b·y + c; `false` when it's seen edge on.
 */
function flatPlane(xs: ArrayLike<number>, ys: ArrayLike<number>, nears: ArrayLike<number>, n: number, out: Float64Array): boolean {
  // The three corners spanning the most, for the steadiest sum.
  let j = 1;
  for (let k = 2; k < n; k++) if (Math.hypot(xs[k]! - xs[0]!, ys[k]! - ys[0]!) > Math.hypot(xs[j]! - xs[0]!, ys[j]! - ys[0]!)) j = k;
  let best = 0;
  let m = -1;
  for (let k = 1; k < n; k++) {
    const area = Math.abs((xs[j]! - xs[0]!) * (ys[k]! - ys[0]!) - (xs[k]! - xs[0]!) * (ys[j]! - ys[0]!));
    if (area > best) {
      best = area;
      m = k;
    }
  }
  if (m < 0 || best < 0.5) return false;
  const x0 = xs[0]!, y0 = ys[0]!, v0 = nears[0]!;
  const dx1 = xs[j]! - x0, dy1 = ys[j]! - y0, dv1 = nears[j]! - v0;
  const dx2 = xs[m]! - x0, dy2 = ys[m]! - y0, dv2 = nears[m]! - v0;
  const det = dx1 * dy2 - dx2 * dy1;
  const a = (dv1 * dy2 - dv2 * dy1) / det;
  const b = (dx1 * dv2 - dx2 * dv1) / det;
  out[0] = a;
  out[1] = b;
  out[2] = v0 - a * x0 - b * y0;
  return true;
}

/** Scratch for a building's corners, grown as needed and reused between buildings and frames. */
let scratchSize = 0;
let baseX = new Float64Array(0), baseY = new Float64Array(0), baseD = new Float64Array(0);
let topX = new Float64Array(0), topY = new Float64Array(0), topD = new Float64Array(0);
let dirX = new Float64Array(0), dirY = new Float64Array(0);
let facing = new Uint8Array(0);

function reserve(n: number): void {
  if (n <= scratchSize) return;
  scratchSize = Math.max(n, scratchSize * 2, 64);
  baseX = new Float64Array(scratchSize); baseY = new Float64Array(scratchSize); baseD = new Float64Array(scratchSize);
  topX = new Float64Array(scratchSize); topY = new Float64Array(scratchSize); topD = new Float64Array(scratchSize);
  dirX = new Float64Array(scratchSize); dirY = new Float64Array(scratchSize);
  facing = new Uint8Array(scratchSize);
}

/**
 * A building whose walls would stand less than this many pixels tall is
 * left as its footprint on the ground: from afar a city of low buildings
 * would otherwise be a smudge of tiny boxes.
 */
export const LOWEST = 3;
/** A building less than this many pixels across is drawn without its upright edges: its shading tells its sides apart. */
export const SMALL = 8;

/** A tile's buildings, and where the tile lies: world pixel = (x, y) + tile unit × `scale`. */
export interface BuildingGroup {
  /** Buildings drawn as they are. */
  buildings: readonly Building[];
  /** Buildings joined into blocks (`generalize`): a block stands in for them where they'd be only a few pixels across. */
  blocks?: readonly BuildingBlock[];
  scale: number;
  x: number;
  y: number;
}

/**
 * A block stands in for its buildings once a typical one would be less
 * than this many pixels across: smaller, a row of houses is only edges.
 */
export const BLOCK_BELOW = 9;

/**
 * Raise the buildings of `groups` on the ground, each surface hiding
 * what's behind it. (camX, camY) is the point the camera looks at, in
 * world pixels; `pxPerMetre` turns heights into world pixels there.
 */
export function drawBuildings(target: Bitmap, view: Perspective, groups: readonly BuildingGroup[], camX: number, camY: number, pxPerMetre: number): void {
  const margin = 64;
  const near: Array<{ b: Building; depth: number; scale: number; ox: number; oy: number; small: boolean }> = [];
  for (const { buildings, blocks, scale, x, y } of groups) {
    // The tile's units, from the point the camera looks at.
    const ox = x - camX;
    const oy = y - camY;
    const add = (b: Building) => {
      if (!view.projectInto(ox + b.cx * scale, oy + b.cy * scale, 0, AT_X, AT_Y, AT_D, 0)) return;
      const sx = AT_X[0]!, sy = AT_Y[0]!, depth = AT_D[0]!;
      const off = (x: number, y: number) => x < -margin || x > view.width + margin || y < -margin * 4 || y > view.height + margin;
      // Off the view at its foot, a tall building may still rise into it: kept unless its top is off the view too.
      if (off(sx, sy) && view.projectInto(ox + b.cx * scale, oy + b.cy * scale, b.height * pxPerMetre, AT_X, AT_Y, AT_D, 0) && off(AT_X[0]!, AT_Y[0]!)) return;
      // Too far, or too low, to stand up from the ground in a pixel or two: the flat map shows it.
      const k = view.scaleAt(depth);
      if (b.height * pxPerMetre * k < LOWEST) return;
      near.push({ b, depth, scale, ox, oy, small: b.size * scale * k < SMALL });
    };
    for (const b of buildings) add(b);
    for (const { block, members, memberSize } of blocks ?? []) {
      // From where the block stands, how big would one of its buildings look?
      const depth = view.depth(ox + block.cx * scale, oy + block.cy * scale);
      if (view.inFront(depth) && memberSize * scale * view.scaleAt(depth) < BLOCK_BELOW) add(block);
      else for (const b of members) add(b);
    }
  }
  // Nearest first: what they hide is then never drawn at all.
  near.sort((a, b) => a.depth - b.depth);

  const depthBuffer = new DepthBuffer(target, view);
  const qx = QUAD_X;
  const qy = QUAD_Y;
  const qd = QUAD_D;
  for (const { b, scale, ox, oy, small } of near) {
    const n = b.xs.length;
    const h = b.height * pxPerMetre;
    const h0 = b.base * pxPerMetre;
    reserve(n);
    let behind = false;
    for (let i = 0; i < n; i++) {
      const x = ox + b.xs[i]! * scale;
      const y = oy + b.ys[i]! * scale;
      if (!view.projectInto(x, y, h0, baseX, baseY, baseD, i) || !view.projectInto(x, y, h, topX, topY, topD, i)) behind = true;
    }

    /** Whether point `k`, between the walls before and after it, is a corner to draw. */
    const corner = (k: number) => {
      const before = (k + n - 1) % n;
      if (!facing[before] || !facing[k]) return true;
      return dirX[before]! * dirX[k]! + dirY[before]! * dirY[k]! <= CORNER;
    };
    // Which walls face the camera, and how lit each is.
    facing.fill(0, 0, n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = b.xs[j]! - b.xs[i]!;
      const ey = b.ys[j]! - b.ys[i]!;
      const length = Math.hypot(ex, ey);
      dirX[i] = 0;
      dirY[i] = 0;
      if (length === 0) continue;
      dirX[i] = ex / length;
      dirY[i] = ey / length;
      if (!b.walls[i]) continue;
      // Outward, for an outline running clockwise on the map (y down).
      const nx = dirY[i]!;
      const ny = -dirX[i]!;
      const midX = ox + ((b.xs[i]! + b.xs[j]!) / 2) * scale;
      const midY = oy + ((b.ys[i]! + b.ys[j]!) / 2) * scale;
      // Walls facing the camera show.
      if (view.faces(nx, ny, midX, midY)) facing[i] = 1;
    }
    if (behind) {
      // A tower rising past the camera: its surfaces cut where they pass it.
      drawCut(depthBuffer, view, b, scale, ox, oy, h0, h, small, corner);
      continue;
    }
    // The roof first: nearest the camera of all a building's surfaces, it then hides its own far walls' edges.
    depthBuffer.fill(topX, topY, topD, n, WHITE);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (b.walls[i]) depthBuffer.edge(topX[i]!, topY[i]!, topX[j]!, topY[j]!);
    }
    for (let i = 0; i < n; i++) {
      if (!facing[i]) continue;
      const j = (i + 1) % n;
      qx[0] = baseX[i]!; qy[0] = baseY[i]!; qd[0] = baseD[i]!;
      qx[1] = baseX[j]!; qy[1] = baseY[j]!; qd[1] = baseD[j]!;
      qx[2] = topX[j]!; qy[2] = topY[j]!; qd[2] = topD[j]!;
      qx[3] = topX[i]!; qy[3] = topY[i]!; qd[3] = topD[i]!;
      depthBuffer.fillConvex(qx, qy, qd, 4, wallPaint(dirX[i]!, dirY[i]!));
      if (small) continue;
      depthBuffer.edge(qx[0], qy[0], qx[1], qy[1]);
      // Upright edges only at corners and where the building's side turns
      // out of sight: a round tower drawn in many short walls stays smooth.
      if (corner(i)) depthBuffer.edge(qx[0], qy[0], qx[3], qy[3]);
      if (corner(j)) depthBuffer.edge(qx[1], qy[1], qx[2], qy[2]);
    }
  }
}
