/**
 * Meshes: shared vertices, faces wound counter-clockwise seen from outside
 * (so `cross(b - a, c - a)` points out), a shade per face, and each face's
 * neighbour across each edge — what the renderer needs to find silhouettes.
 */

export type Vec3 = [number, number, number];

export interface Mesh {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertex indices per face. */
  tris: Uint16Array;
  /** Brightness multiplier per face, 0…1. */
  shades: Float32Array;
  /** Per face, the face across edges (v0→v1, v1→v2, v2→v0); -1 for an open edge. */
  adjacency: Int32Array;
  /** Per face edge: 1 where the neighbour bends away (a crease), 0 where it continues the same plane. */
  creases: Uint8Array;
  /** Bounding sphere radius about the mesh origin. */
  radius: number;
}

export function createMesh(positions: readonly number[], tris: readonly number[], shades?: readonly number[]): Mesh {
  const faces = tris.length / 3;
  const pos = Float32Array.from(positions);
  const tri = Uint16Array.from(tris);
  const adjacency = new Int32Array(faces * 3).fill(-1);
  const creases = new Uint8Array(faces * 3);

  const normals = new Float32Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    const n = faceNormal(pos, tri[f * 3]!, tri[f * 3 + 1]!, tri[f * 3 + 2]!);
    normals.set(n, f * 3);
  }

  // Each edge, keyed by its two vertices: the face that runs it a→b meets the one that runs it b→a.
  const open = new Map<number, number>();
  const key = (a: number, b: number) => a * 65536 + b;
  for (let f = 0; f < faces; f++) {
    for (let e = 0; e < 3; e++) {
      const a = tri[f * 3 + e]!;
      const b = tri[f * 3 + ((e + 1) % 3)]!;
      const other = open.get(key(b, a));
      if (other === undefined) {
        open.set(key(a, b), f * 3 + e);
        continue;
      }
      open.delete(key(b, a));
      const g = Math.floor(other / 3);
      adjacency[f * 3 + e] = g;
      adjacency[other] = f;
      const dot = normals[f * 3]! * normals[g * 3]! + normals[f * 3 + 1]! * normals[g * 3 + 1]! + normals[f * 3 + 2]! * normals[g * 3 + 2]!;
      const crease = dot < 0.999 ? 1 : 0;
      creases[f * 3 + e] = crease;
      creases[other] = crease;
    }
  }

  let radius = 0;
  for (let i = 0; i < pos.length; i += 3) radius = Math.max(radius, Math.hypot(pos[i]!, pos[i + 1]!, pos[i + 2]!));

  return {
    positions: pos,
    tris: tri,
    shades: shades ? Float32Array.from(shades) : new Float32Array(faces).fill(1),
    adjacency,
    creases,
    radius,
  };
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): Vec3 {
  const ux = pos[b * 3]! - pos[a * 3]!;
  const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
  const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
  const vx = pos[c * 3]! - pos[a * 3]!;
  const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
  const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Collects vertices and faces; `build` makes the mesh. */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly tris: number[] = [];
  readonly shades: number[] = [];

  vertex(x: number, y: number, z: number): number {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }

  tri(a: number, b: number, c: number, shade = 1): void {
    this.tris.push(a, b, c);
    this.shades.push(shade);
  }

  /** Four corners counter-clockwise from outside. */
  quad(a: number, b: number, c: number, d: number, shade = 1): void {
    this.tri(a, b, c, shade);
    this.tri(a, c, d, shade);
  }

  build(): Mesh {
    return createMesh(this.positions, this.tris, this.shades);
  }
}

export interface FrustumSpec {
  /** Bottom and top heights. */
  y0: number;
  y1: number;
  /** Half width (x) and half depth (z) of the bottom and of the top; a top of [0, 0] makes a pyramid. */
  bottom: [number, number];
  top: [number, number];
  /** Shift of the whole solid, and of the top alone against the bottom (a sloped front). */
  offset?: Vec3;
  lean?: [number, number];
  /** Shade of the top face and of the sides. */
  shade?: number;
}

/**
 * A box, a slab, a wedge-fronted hull or a pyramid: a four-sided solid with
 * a rectangular bottom and a smaller (or pointed) rectangular top.
 */
export function addFrustum(builder: MeshBuilder, spec: FrustumSpec): void {
  const [ox, oy, oz] = spec.offset ?? [0, 0, 0];
  const [lx, lz] = spec.lean ?? [0, 0];
  const shade = spec.shade ?? 1;
  const [bx, bz] = spec.bottom;
  const [tx, tz] = spec.top;
  const v = (x: number, y: number, z: number) => builder.vertex(x + ox, y + oy, z + oz);
  const b0 = v(-bx, spec.y0, -bz);
  const b1 = v(bx, spec.y0, -bz);
  const b2 = v(bx, spec.y0, bz);
  const b3 = v(-bx, spec.y0, bz);
  builder.quad(b0, b1, b2, b3, shade);
  if (tx === 0 && tz === 0) {
    const apex = v(lx, spec.y1, lz);
    builder.tri(b3, b2, apex, shade);
    builder.tri(b2, b1, apex, shade);
    builder.tri(b1, b0, apex, shade);
    builder.tri(b0, b3, apex, shade);
    return;
  }
  const t0 = v(-tx + lx, spec.y1, -tz + lz);
  const t1 = v(tx + lx, spec.y1, -tz + lz);
  const t2 = v(tx + lx, spec.y1, tz + lz);
  const t3 = v(-tx + lx, spec.y1, tz + lz);
  builder.quad(t0, t3, t2, t1, shade);
  builder.quad(b3, b2, t2, t3, shade);
  builder.quad(b2, b1, t1, t2, shade);
  builder.quad(b1, b0, t0, t1, shade);
  builder.quad(b0, b3, t3, t0, shade);
}

/** A box centred on x and z, standing on y = 0. */
export function box(width: number, height: number, depth: number, shade = 1): Mesh {
  const builder = new MeshBuilder();
  addFrustum(builder, { y0: 0, y1: height, bottom: [width / 2, depth / 2], top: [width / 2, depth / 2], shade });
  return builder.build();
}

/** A square pyramid standing on y = 0. */
export function pyramid(width: number, height: number, depth = width, shade = 1): Mesh {
  const builder = new MeshBuilder();
  addFrustum(builder, { y0: 0, y1: height, bottom: [width / 2, depth / 2], top: [0, 0], shade });
  return builder.build();
}
