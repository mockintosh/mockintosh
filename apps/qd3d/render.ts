/**
 * The renderer, after PlayDators: every visible face of every instance is
 * shaded flat (wrapped diffuse), sorted far to near, and filled with one step
 * of the `SHADE_PATTERNS` ramp; then its outline edges are drawn in black on
 * top. No z-buffer: painter's order is enough for a field of solid objects,
 * and the patterns belong to the screen, so a turning face changes its
 * pattern without the dots crawling.
 *
 * Writes the `blitPixels` buffer (1 byte per pixel, 1 = black) and nothing
 * else: no DOM, no QuickDraw, so frames render headless in tests.
 */
import { SHADE_PATTERNS, shadeLevel } from "@mockintosh/ui";
import type { Mesh, Vec3 } from "./mesh";

/** 1 byte per pixel, 0 = white, 1 = black. */
export interface Target {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Fill faces with a shade pattern. Without it a mesh draws only its edges. */
export const SOLID = 1;
/** Shade faces by the light; without it every face has the instance's shade. */
export const LIGHTING = 2;
/** Outline where a face meets the sky: an open edge or a neighbour facing away. */
export const SILHOUETTE = 4;
/** Also outline where two visible faces meet at an angle. */
export const CREASES = 8;
/** Every edge, hidden or not: a wireframe. */
export const WIRE = 16;

export interface Instance {
  mesh: Mesh;
  position: Vec3;
  /** Turn about y, then tip about x, then roll about z, in radians. */
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  /** Brightness multiplier, 0…1. */
  shade: number;
  flags: number;
}

export function instance(mesh: Mesh, init: Partial<Omit<Instance, "mesh">> = {}): Instance {
  return {
    mesh,
    position: init.position ?? [0, 0, 0],
    yaw: init.yaw ?? 0,
    pitch: init.pitch ?? 0,
    roll: init.roll ?? 0,
    scale: init.scale ?? 1,
    shade: init.shade ?? 1,
    flags: init.flags ?? SOLID | LIGHTING | SILHOUETTE | CREASES,
  };
}

/**
 * Yaw 0 looks down −z; positive yaw turns right; positive pitch looks up.
 * `fov` is the vertical field of view in radians.
 */
export interface Camera {
  position: Vec3;
  yaw: number;
  pitch: number;
  fov: number;
  near: number;
  far: number;
}

export interface RenderOptions {
  /** Direction toward the light, in the world. */
  light: Vec3;
  /** Ink for edges: 1 = black (default), 0 = white. */
  edgeInk?: 0 | 1;
}

interface Basis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

function basis(camera: Camera): Basis {
  const sy = Math.sin(camera.yaw);
  const cy = Math.cos(camera.yaw);
  const sp = Math.sin(camera.pitch);
  const cp = Math.cos(camera.pitch);
  return {
    right: [cy, 0, sy],
    up: [-sy * sp, cp, cy * sp],
    forward: [sy * cp, sp, -cy * cp],
  };
}

/** Pixels per unit of view-space x/z at the given target height. */
export function focalLength(camera: Camera, height: number): number {
  return height / 2 / Math.tan(camera.fov / 2);
}

/** Screen row of the horizon (the plane y = camera height, far away). */
export function horizonY(camera: Camera, height: number): number {
  return height / 2 + focalLength(camera, height) * Math.tan(camera.pitch);
}

/** Where a world point lands on the target, or null when it is behind the camera. */
export function project(camera: Camera, target: { width: number; height: number }, point: Vec3): { x: number; y: number; z: number } | null {
  const { right, up, forward } = basis(camera);
  const dx = point[0] - camera.position[0];
  const dy = point[1] - camera.position[1];
  const dz = point[2] - camera.position[2];
  const z = dx * forward[0] + dy * forward[1] + dz * forward[2];
  if (z < camera.near) return null;
  const f = focalLength(camera, target.height);
  return {
    x: target.width / 2 + ((dx * right[0] + dy * right[1] + dz * right[2]) * f) / z,
    y: target.height / 2 - ((dx * up[0] + dy * up[1] + dz * up[2]) * f) / z,
    z,
  };
}

/** One face waiting for its turn: its clipped outline on screen, its pattern, and the edges to ink after it. */
interface Face {
  depth: number;
  level: number;
  /** Screen x, y pairs; empty when only edges are drawn. */
  polygon: number[];
  /** View-space segments, six numbers each. */
  edges: number[];
}

/** Reused between frames so a steady scene allocates nothing big. */
export class Renderer {
  private view = new Float32Array(0);
  private world = new Float32Array(0);
  private visible = new Uint8Array(0);
  private faces: Face[] = [];

  render(target: Target, camera: Camera, instances: readonly Instance[], options: RenderOptions): void {
    const { right, up, forward } = basis(camera);
    const [cx, cy, cz] = camera.position;
    const f = focalLength(camera, target.height);
    const halfW = target.width / 2;
    const halfH = target.height / 2;
    const tanX = halfW / f;
    const tanY = halfH / f;
    const light = normalize(options.light);
    const faces = this.faces;
    faces.length = 0;

    for (const inst of instances) {
      const mesh = inst.mesh;
      // Whole-instance cull against the view: behind, too far, or off to a side.
      const ox = inst.position[0] - cx;
      const oy = inst.position[1] - cy;
      const oz = inst.position[2] - cz;
      const r = mesh.radius * inst.scale;
      const vz = ox * forward[0] + oy * forward[1] + oz * forward[2];
      if (vz + r < camera.near || vz - r > camera.far) continue;
      const vx = ox * right[0] + oy * right[1] + oz * right[2];
      const vy = ox * up[0] + oy * up[1] + oz * up[2];
      const slack = r * 1.5;
      if (Math.abs(vx) - slack > Math.max(vz, 0) * tanX || Math.abs(vy) - slack > Math.max(vz, 0) * tanY) continue;

      const vertices = mesh.positions.length / 3;
      if (this.view.length < vertices * 3) {
        this.view = new Float32Array(vertices * 3);
        this.world = new Float32Array(vertices * 3);
      }
      const view = this.view;
      const world = this.world;
      const m = rotation(inst.yaw, inst.pitch, inst.roll, inst.scale);
      for (let v = 0; v < vertices; v++) {
        const px = mesh.positions[v * 3]!;
        const py = mesh.positions[v * 3 + 1]!;
        const pz = mesh.positions[v * 3 + 2]!;
        const wx = m[0] * px + m[1] * py + m[2] * pz + inst.position[0];
        const wy = m[3] * px + m[4] * py + m[5] * pz + inst.position[1];
        const wz = m[6] * px + m[7] * py + m[8] * pz + inst.position[2];
        world[v * 3] = wx;
        world[v * 3 + 1] = wy;
        world[v * 3 + 2] = wz;
        const dx = wx - cx;
        const dy = wy - cy;
        const dz = wz - cz;
        view[v * 3] = dx * right[0] + dy * right[1] + dz * right[2];
        view[v * 3 + 1] = dx * up[0] + dy * up[1] + dz * up[2];
        view[v * 3 + 2] = dx * forward[0] + dy * forward[1] + dz * forward[2];
      }

      // Which faces look at the camera; silhouettes need the neighbours' answers too.
      const count = mesh.tris.length / 3;
      if (this.visible.length < count) this.visible = new Uint8Array(count * 2);
      const visible = this.visible;
      const normals: number[] = [];
      for (let t = 0; t < count; t++) {
        const a = mesh.tris[t * 3]! * 3;
        const b = mesh.tris[t * 3 + 1]! * 3;
        const c = mesh.tris[t * 3 + 2]! * 3;
        const ux = world[b]! - world[a]!;
        const uy = world[b + 1]! - world[a + 1]!;
        const uz = world[b + 2]! - world[a + 2]!;
        const wx = world[c]! - world[a]!;
        const wy = world[c + 1]! - world[a + 1]!;
        const wz = world[c + 2]! - world[a + 2]!;
        const nx = uy * wz - uz * wy;
        const ny = uz * wx - ux * wz;
        const nz = ux * wy - uy * wx;
        normals.push(nx, ny, nz);
        visible[t] = nx * (cx - world[a]!) + ny * (cy - world[a + 1]!) + nz * (cz - world[a + 2]!) > 0 ? 1 : 0;
      }

      const solid = (inst.flags & SOLID) !== 0;
      const lighting = (inst.flags & LIGHTING) !== 0;
      const wire = (inst.flags & WIRE) !== 0;
      const silhouette = (inst.flags & SILHOUETTE) !== 0;
      const creases = (inst.flags & CREASES) !== 0;
      for (let t = 0; t < count; t++) {
        if (!visible[t] && !wire) continue;
        const ia = mesh.tris[t * 3]! * 3;
        const ib = mesh.tris[t * 3 + 1]! * 3;
        const ic = mesh.tris[t * 3 + 2]! * 3;
        const depth = (view[ia + 2]! + view[ib + 2]! + view[ic + 2]!) / 3;
        if (Math.max(view[ia + 2]!, view[ib + 2]!, view[ic + 2]!) < camera.near) continue;

        const edges: number[] = [];
        for (let e = 0; e < 3; e++) {
          const adj = mesh.adjacency[t * 3 + e]!;
          const draw = wire || (silhouette && (adj < 0 || !visible[adj])) || (creases && adj >= 0 && visible[adj] === 1 && mesh.creases[t * 3 + e] === 1);
          if (!draw) continue;
          const p = mesh.tris[t * 3 + e]! * 3;
          const q = mesh.tris[t * 3 + ((e + 1) % 3)]! * 3;
          edges.push(view[p]!, view[p + 1]!, view[p + 2]!, view[q]!, view[q + 1]!, view[q + 2]!);
        }

        let polygon: number[] = [];
        let level = 0;
        if (solid && visible[t]) {
          let brightness = inst.shade * mesh.shades[t]!;
          if (lighting) {
            const nx = normals[t * 3]!;
            const ny = normals[t * 3 + 1]!;
            const nz = normals[t * 3 + 2]!;
            const len = Math.hypot(nx, ny, nz) || 1;
            brightness *= ((nx * light[0] + ny * light[1] + nz * light[2]) / len) * 0.5 + 0.5;
          }
          level = shadeLevel(brightness);
          polygon = clipAndProject(view, ia, ib, ic, camera.near, f, halfW, halfH);
        }
        if (polygon.length || edges.length) faces.push({ depth, level, polygon, edges });
      }
    }

    faces.sort((a, b) => b.depth - a.depth);
    const ink = options.edgeInk ?? 1;
    for (const face of faces) {
      if (face.polygon.length >= 6) fillPolygon(target, face.polygon, face.level);
      for (let i = 0; i < face.edges.length; i += 6) {
        drawViewSegment(target, face.edges, i, camera.near, f, halfW, halfH, ink);
      }
    }
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Row-major 3×3 for Ry · Rx · Rz, scaled. */
function rotation(yaw: number, pitch: number, roll: number, scale: number): number[] {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  // Yaw turns clockwise seen from above, to match the camera: yaw > 0 turns −z toward +x.
  return [
    (cy * cr - sy * sp * sr) * scale, (-cy * sr - sy * sp * cr) * scale, -sy * cp * scale,
    cp * sr * scale, cp * cr * scale, -sp * scale,
    (sy * cr + cy * sp * sr) * scale, (-sy * sr + cy * sp * cr) * scale, cy * cp * scale,
  ];
}

/** Clip a view-space triangle to z ≥ near (0, 3 or 4 corners) and project it. */
function clipAndProject(view: Float32Array, a: number, b: number, c: number, near: number, f: number, halfW: number, halfH: number): number[] {
  const out: number[] = [];
  const corners = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % 3]!;
    const pz = view[p + 2]!;
    const qz = view[q + 2]!;
    if (pz >= near) out.push(halfW + (view[p]! * f) / pz, halfH - (view[p + 1]! * f) / pz);
    if (pz >= near !== qz >= near) {
      const t = (near - pz) / (qz - pz);
      const x = view[p]! + (view[q]! - view[p]!) * t;
      const y = view[p + 1]! + (view[q + 1]! - view[p + 1]!) * t;
      out.push(halfW + (x * f) / near, halfH - (y * f) / near);
    }
  }
  return out;
}

function drawViewSegment(target: Target, s: number[], i: number, near: number, f: number, halfW: number, halfH: number, ink: 0 | 1): void {
  let x0 = s[i]!;
  let y0 = s[i + 1]!;
  let z0 = s[i + 2]!;
  let x1 = s[i + 3]!;
  let y1 = s[i + 4]!;
  let z1 = s[i + 5]!;
  if (z0 < near && z1 < near) return;
  if (z0 < near || z1 < near) {
    const t = (near - z0) / (z1 - z0);
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (z0 < near) [x0, y0, z0] = [x, y, near];
    else [x1, y1, z1] = [x, y, near];
  }
  drawLine(target, halfW + (x0 * f) / z0, halfH - (y0 * f) / z0, halfW + (x1 * f) / z1, halfH - (y1 * f) / z1, ink);
}

/**
 * Fill a convex polygon (screen x, y pairs) with one step of the shade ramp.
 * A pixel is inside when its centre is, so neighbouring faces neither gap nor overlap.
 */
export function fillPolygon(target: Target, polygon: readonly number[], level: number): void {
  const { width, height, pixels } = target;
  const n = polygon.length / 2;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, polygon[i * 2 + 1]!);
    maxY = Math.max(maxY, polygon[i * 2 + 1]!);
  }
  const yStart = Math.max(0, Math.ceil(minY - 0.5));
  const yEnd = Math.min(height - 1, Math.ceil(maxY - 0.5) - 1);
  const pattern = SHADE_PATTERNS[level]!;
  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = polygon[i * 2]!;
      const py = polygon[i * 2 + 1]!;
      const qx = polygon[((i + 1) % n) * 2]!;
      const qy = polygon[((i + 1) % n) * 2 + 1]!;
      if ((py <= yc && qy > yc) || (qy <= yc && py > yc)) {
        const x = px + ((yc - py) * (qx - px)) / (qy - py);
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    if (left > right) continue;
    const xStart = Math.max(0, Math.ceil(left - 0.5));
    const xEnd = Math.min(width - 1, Math.ceil(right - 0.5) - 1);
    const bits = pattern[y & 7]!;
    const row = y * width;
    for (let x = xStart; x <= xEnd; x++) pixels[row + x] = (bits >> (7 - (x & 7))) & 1 ? 0 : 1;
  }
}

/** Fill a band of rows with one step of the shade ramp. */
export function fillRows(target: Target, y0: number, y1: number, level: number): void {
  const pattern = SHADE_PATTERNS[level]!;
  const start = Math.max(0, Math.floor(y0));
  const end = Math.min(target.height, Math.ceil(y1));
  for (let y = start; y < end; y++) {
    const bits = pattern[y & 7]!;
    const row = y * target.width;
    for (let x = 0; x < target.width; x++) target.pixels[row + x] = (bits >> (7 - (x & 7))) & 1 ? 0 : 1;
  }
}

/** A one-pixel line, clipped to the target. */
export function drawLine(target: Target, ax: number, ay: number, bx: number, by: number, ink: 0 | 1 = 1): void {
  // Liang–Barsky against the target first, so a far-off endpoint costs nothing.
  const xMin = 0;
  const yMin = 0;
  const xMax = target.width - 1;
  const yMax = target.height - 1;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [[-dx, ax - xMin], [dx, xMax - ax], [-dy, ay - yMin], [dy, yMax - ay]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return;
      if (t < t1) t1 = t;
    }
  }
  let x0 = Math.round(ax + dx * t0);
  let y0 = Math.round(ay + dy * t0);
  const x1 = Math.round(ax + dx * t1);
  const y1 = Math.round(ay + dy * t1);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  const ddx = Math.abs(x1 - x0);
  const ddy = -Math.abs(y1 - y0);
  let err = ddx + ddy;
  const { width, height, pixels } = target;
  for (;;) {
    if (x0 >= 0 && y0 >= 0 && x0 < width && y0 < height) pixels[y0 * width + x0] = ink;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= ddy) {
      err += ddy;
      x0 += sx;
    }
    if (e2 <= ddx) {
      err += ddx;
      y0 += sy;
    }
  }
}
