/**
 * The 3D buildings drawn by the graphics processor, as `drawBuildings` draws
 * them on the CPU. Each data tile's buildings go to the GPU once, as a mesh
 * in the tile's own units: roofs triangulated, walls, and their edges. A
 * frame sends only the camera and where each tile lies; the corner program
 * below projects every corner, and makes there each choice that hangs on
 * the view: which walls face the camera, which upright edges show, what's
 * too low or too small to stand up or have edges, and whether a block or
 * its buildings show. What comes back is a paint a pixel, inked here.
 */
import type { GpuCornerProgram, GpuMesh, GpuRasterBatch, GpuRasterizer } from "@mockintosh/sdk";
import { BLACK, WHITE, type Bitmap, type Paint } from "./bitmap";
import type { BuildingBlock } from "./generalize";
import {
  BLOCK_BELOW,
  CORNER,
  HALF,
  LIGHT,
  LOWEST,
  ORTHO_EDGE,
  ORTHO_FAR,
  PERSPECTIVE_EDGE,
  QUARTER,
  SMALL,
  wallPaint,
  type Building,
  type BuildingGroup,
  type Perspective,
} from "./perspective";

/** The paints a pixel's value stands for: its place here, plus one. */
const PAINTS: readonly Paint[] = [WHITE, BLACK, LIGHT, QUARTER, HALF];
const valueOf = (paint: Paint) => PAINTS.indexOf(paint) + 1;

// What a corner belongs to.
const ROOF = 0;
const WALL = 1;
const ROOF_EDGE = 2;
const BASE_EDGE = 3;
/** An upright edge, between the walls before and after its corner. */
const UPRIGHT = 4;
// An upright edge's flags.
const WALL_BEFORE = 1;
const WALL_AFTER = 2;
const SHARP = 4;

/**
 * A corner: x and y in tile units, height in metres, and a code (the
 * building's place, what the corner belongs to, its paint and flags); then
 * a wall's outward normal and its offset along it (tile units), or an
 * upright edge's two walls' normals.
 */
const NUMBERS_PER_CORNER = 8;
/** A building: where it stands, how tall and wide; then the block it's in, and which it is. */
const NUMBERS_PER_BUILDING = 8;
/** A building's place in the code, above the paint (3 bits), what it belongs to (3) and flags (3). */
const PLACE = 512;
/** Places a mesh can number, for codes a 32-bit float holds exactly. */
const MAX_BUILDINGS = 2 ** 24 / PLACE;
// Which of a block and its buildings a building is.
const ALWAYS = 0;
const BLOCK = 1;
const MEMBER = 2;

/** How much nearer, at most, an edge is drawn than its surface: a share of its nearness in perspective, pixels orthographic. */
const MOST_EDGE_PERSPECTIVE = 0.05;
const MOST_EDGE_ORTHO = 4;

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * The corner program. `frame.params`: [focal, sin(pitch), cos(pitch),
 * sin(bearing)], [cos(bearing), orthographic, map pixels a metre, -],
 * [where the camera stands (map pixels from the point looked at), the way
 * it looks, flat, orthographic]. `batch.params`: [tile units to map pixels,
 * the tile's origin from the point looked at].
 */
const SOURCE = `
const LOWEST = ${f(LOWEST)};
const SMALL = ${f(SMALL)};
const BLOCK_BELOW = ${f(BLOCK_BELOW)};
const PERSPECTIVE_EDGE = ${f(PERSPECTIVE_EDGE)};
const ORTHO_EDGE = ${f(ORTHO_EDGE)};
const ORTHO_FAR = ${f(ORTHO_FAR)};
const MOST_EDGE_PERSPECTIVE = ${f(MOST_EDGE_PERSPECTIVE)};
const MOST_EDGE_ORTHO = ${f(MOST_EDGE_ORTHO)};

fn hidden() -> RasterCorner {
  return RasterCorner(vec4f(0.0, 0.0, -1.0, 1.0), 0u);
}

fn orthographic() -> bool {
  return frame.params[1].y > 0.5;
}

/** A map point or direction turned so the camera faces up: x right, y towards the camera. */
fn turned(p: vec2f) -> vec2f {
  let s = frame.params[0].w;
  let c = frame.params[1].x;
  return vec2f(p.x * c + p.y * s, p.y * c - p.x * s);
}

/** How far in front of the camera a turned point at height z is, as \`Perspective.depth\`. */
fn depthAt(t: vec2f, z: f32) -> f32 {
  let near = select(frame.params[0].x, 0.0, orthographic());
  return near - t.y * frame.params[0].y - z * frame.params[0].z;
}

fn scaleAt(depth: f32) -> f32 {
  if (orthographic()) { return 1.0; }
  return frame.params[0].x / depth;
}

/** Whether a wall, normal n and offset (n · a point on it, tile units), faces the camera, as \`Perspective.faces\`. */
fn faces(n: vec2f, offset: f32) -> bool {
  if (orthographic()) { return dot(n, frame.params[2].zw) > 0.0; }
  return dot(n, frame.params[2].xy - batch.params[0].yz) - offset * batch.params[0].x > 0.0;
}

/**
 * How much a surface's nearness changes across a pixel, for the surface
 * through turned point p with turned normal n: an edge is drawn that much
 * nearer than it, so it isn't lost to the surface it edges.
 */
fn pixelBias(n: vec3f, p: vec3f) -> f32 {
  let sinP = frame.params[0].y;
  let cosP = frame.params[0].z;
  let focal = frame.params[0].x;
  let across = abs(n.x) + abs(n.y * cosP - n.z * sinP);
  if (orthographic()) {
    let along = abs(n.y * sinP + n.z * cosP);
    return across / max(along, 1e-6);
  }
  let camera = vec3f(0.0, focal * sinP, focal * cosP);
  return across / max(focal * abs(dot(n, p - camera)), 1e-6);
}

fn corner(at: array<vec4f, 2>) -> RasterCorner {
  let code = u32(at[0].w);
  let place = code / ${PLACE}u;
  let value = code & 7u;
  let role = (code >> 3u) & 7u;
  let flags = (code >> 6u) & 7u;
  let scale = batch.params[0].x;
  let origin = batch.params[0].yz;
  let ortho = orthographic();
  let building = meshData[place * 2u];
  let block = meshData[place * 2u + 1u];

  // A block shows where its buildings would be small, and they where it doesn't.
  if (block.w > 0.5) {
    let depth = depthAt(turned(origin + block.xy * scale), 0.0);
    let small = (ortho || depth > 1.0) && block.z * scale * scaleAt(depth) < BLOCK_BELOW;
    if (small != (block.w < 1.5)) { return hidden(); }
  }
  // Too far, or too low, to stand up from the ground in a pixel or two: the flat map shows it.
  let middle = depthAt(turned(origin + building.xy * scale), 0.0);
  if (!ortho && middle <= 1.0) { return hidden(); }
  let k = scaleAt(middle);
  let pxPerMetre = frame.params[1].z;
  if (building.z * pxPerMetre * k < LOWEST) { return hidden(); }
  let small = building.w * scale * k < SMALL;

  var edge = false;
  var normal = vec3f(0.0, 0.0, 1.0);
  switch role {
    case ${ROOF}u: {}
    case ${WALL}u: {
      if (!faces(at[1].xy, at[1].z)) { return hidden(); }
    }
    case ${ROOF_EDGE}u: {
      edge = true;
    }
    case ${BASE_EDGE}u: {
      if (small || !faces(at[1].xy, at[1].z)) { return hidden(); }
      edge = true;
      normal = vec3f(turned(at[1].xy), 0.0);
    }
    default: {
      // An upright edge shows at a sharp corner, or where the building turns out of sight.
      if (small) { return hidden(); }
      let before = (flags & ${WALL_BEFORE}u) != 0u && faces(at[1].xy, dot(at[1].xy, at[0].xy));
      let after = (flags & ${WALL_AFTER}u) != 0u && faces(at[1].zw, dot(at[1].zw, at[0].xy));
      if (!(before || after) || (before && after && (flags & ${SHARP}u) == 0u)) { return hidden(); }
      edge = true;
      normal = vec3f(turned(select(at[1].xy, at[1].zw, after)), 0.0);
    }
  }

  let t = turned(origin + at[0].xy * scale);
  let z = at[0].z * pxPerMetre;
  let depth = depthAt(t, z);
  let half = frame.size * 0.5;
  let down = t.y * frame.params[0].z - z * frame.params[0].y;
  let shown = select(value, ${valueOf(BLACK)}u, edge);
  if (ortho) {
    var nearness = ORTHO_FAR - depth;
    if (edge) { nearness += ORTHO_EDGE + min(pixelBias(normal, vec3f(t, z)), MOST_EDGE_ORTHO); }
    return RasterCorner(vec4f(t.x / half.x, -down / half.y, nearness / (2.0 * ORTHO_FAR), 1.0), shown);
  }
  // With w the depth, z / w is 1 / depth: the nearness, even across the screen.
  var near = 1.0;
  if (edge) { near = PERSPECTIVE_EDGE + min(pixelBias(normal, vec3f(t, z)) * depth, MOST_EDGE_PERSPECTIVE); }
  let focal = frame.params[0].x;
  return RasterCorner(vec4f(t.x * focal / half.x, -down * focal / half.y, near, depth), shown);
}
`;

/** A tile's buildings as a mesh: its triangles' corners, then its lines'. */
export interface BuildingMesh {
  corners: Float32Array;
  data: Float32Array;
  triangles: number;
  lines: number;
}

/** The mesh of a tile's buildings: `singles` as they are, and each block with its members, to show one or the other. */
export function buildingMesh(singles: readonly Building[], blocks: readonly BuildingBlock[] = []): BuildingMesh {
  const triangles: number[] = [];
  const lines: number[] = [];
  const data: number[] = [];
  const add = (b: Building, select: number, block: Building | null, memberSize: number) => {
    const place = data.length / NUMBERS_PER_BUILDING;
    if (place >= MAX_BUILDINGS) return;
    data.push(b.cx, b.cy, b.height, b.size, block?.cx ?? 0, block?.cy ?? 0, memberSize, select);
    addBuilding(b, place, triangles, lines);
  };
  for (const b of singles) add(b, ALWAYS, null, 0);
  for (const { block, members, memberSize } of blocks) {
    add(block, BLOCK, block, memberSize);
    for (const member of members) add(member, MEMBER, block, memberSize);
  }
  const corners = new Float32Array(triangles.length + lines.length);
  corners.set(triangles);
  corners.set(lines, triangles.length);
  return {
    corners,
    data: Float32Array.from(data),
    triangles: triangles.length / NUMBERS_PER_CORNER,
    lines: lines.length / NUMBERS_PER_CORNER,
  };
}

function addBuilding(b: Building, place: number, triangles: number[], lines: number[]): void {
  const n = b.xs.length;
  const code = (paint: Paint, role: number, flags = 0) => place * PLACE + valueOf(paint) + role * 8 + flags * 64;
  const at = (out: number[], i: number, z: number, c: number, n0 = 0, n1 = 0, n2 = 0, n3 = 0) => {
    out.push(b.xs[i]!, b.ys[i]!, z, c, n0, n1, n2, n3);
  };
  // Each edge's direction, and its wall's outward normal (an outline runs clockwise, y down).
  const dirX = new Float64Array(n);
  const dirY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const length = Math.hypot(b.xs[j]! - b.xs[i]!, b.ys[j]! - b.ys[i]!);
    if (length === 0) continue;
    dirX[i] = (b.xs[j]! - b.xs[i]!) / length;
    dirY[i] = (b.ys[j]! - b.ys[i]!) / length;
  }

  const roof: number[] = [];
  triangulate(b.xs, b.ys, n, roof);
  for (const i of roof) at(triangles, i, b.height, code(WHITE, ROOF));

  for (let i = 0; i < n; i++) {
    if (!b.walls[i] || (dirX[i] === 0 && dirY[i] === 0)) continue;
    const j = (i + 1) % n;
    const nx = dirY[i]!;
    const ny = -dirX[i]!;
    const offset = nx * b.xs[i]! + ny * b.ys[i]!;
    const c = code(wallPaint(dirX[i]!, dirY[i]!), WALL);
    for (const [k, z] of [[i, b.base], [j, b.base], [j, b.height], [i, b.base], [j, b.height], [i, b.height]] as const) {
      at(triangles, k, z, c, nx, ny, offset);
    }
    at(lines, i, b.height, code(BLACK, ROOF_EDGE));
    at(lines, j, b.height, code(BLACK, ROOF_EDGE));
    at(lines, i, b.base, code(BLACK, BASE_EDGE), nx, ny, offset);
    at(lines, j, b.base, code(BLACK, BASE_EDGE), nx, ny, offset);
  }

  for (let k = 0; k < n; k++) {
    const before = (k + n - 1) % n;
    if (!b.walls[before] && !b.walls[k]) continue;
    const sharp = dirX[before]! * dirX[k]! + dirY[before]! * dirY[k]! <= CORNER;
    const flags = (b.walls[before] ? WALL_BEFORE : 0) | (b.walls[k] ? WALL_AFTER : 0) | (sharp ? SHARP : 0);
    const c = code(BLACK, UPRIGHT, flags);
    at(lines, k, b.base, c, dirY[before]!, -dirX[before]!, dirY[k]!, -dirX[k]!);
    at(lines, k, b.height, c, dirY[before]!, -dirX[before]!, dirY[k]!, -dirX[k]!);
  }
}

/** Tiles' meshes kept on the GPU at once. */
const MESH_CAPACITY = 64;

export class GpuBuildings {
  /** Each tile's mesh, by its buildings (which a tile joined into blocks replaces); most recently drawn last. */
  private readonly meshes = new Map<readonly Building[], { mesh: GpuMesh; triangles: number; lines: number }>();

  private constructor(
    private readonly raster: GpuRasterizer,
    private readonly program: GpuCornerProgram,
  ) {}

  /** Buildings drawn with `raster`, which they then own and close. */
  static async open(raster: GpuRasterizer): Promise<GpuBuildings> {
    try {
      return new GpuBuildings(raster, await raster.program(SOURCE, NUMBERS_PER_CORNER));
    } catch (err) {
      raster.close();
      throw err;
    }
  }

  /**
   * The buildings of `groups` as `drawBuildings` would raise them, drawn on
   * the GPU: a paint a pixel (see `inkBuildings`), 0 where there's none.
   */
  draw(view: Perspective, groups: readonly BuildingGroup[], camX: number, camY: number, pxPerMetre: number): Promise<Uint8Array> {
    const triangles: GpuRasterBatch[] = [];
    const lines: GpuRasterBatch[] = [];
    for (const group of groups) {
      const { mesh, triangles: t, lines: l } = this.meshOf(group);
      const params = [group.scale, group.x - camX, group.y - camY, 0];
      if (t) triangles.push({ program: this.program, mesh, topology: "triangles", first: 0, count: t, params });
      if (l) lines.push({ program: this.program, mesh, topology: "lines", first: t, count: l, params });
    }
    const turnSin = Math.sin(view.bearing);
    const turnCos = Math.cos(view.bearing);
    const [standX, standY] = view.camera();
    return this.raster.draw({
      width: view.width,
      height: view.height,
      params: [
        view.focal, Math.sin(view.pitch), Math.cos(view.pitch), turnSin,
        turnCos, view.orthographic ? 1 : 0, pxPerMetre, 0,
        // Where the camera stands, and (orthographic) the way it looks, on the map.
        standX, standY, -turnSin, turnCos,
      ],
      // Every surface before any edge, so an edge is tested against all of them.
      batches: [...triangles, ...lines],
    });
  }

  close(): void {
    for (const { mesh } of this.meshes.values()) mesh.close();
    this.meshes.clear();
    this.program.close();
    this.raster.close();
  }

  private meshOf(group: BuildingGroup): { mesh: GpuMesh; triangles: number; lines: number } {
    let found = this.meshes.get(group.buildings);
    if (found) {
      this.meshes.delete(group.buildings);
    } else {
      const built = buildingMesh(group.buildings, group.blocks);
      found = { mesh: this.raster.mesh(built.corners, built.data), triangles: built.triangles, lines: built.lines };
    }
    this.meshes.set(group.buildings, found);
    while (this.meshes.size > MESH_CAPACITY) {
      const [oldest, { mesh }] = this.meshes.entries().next().value!;
      mesh.close();
      this.meshes.delete(oldest);
    }
    return found;
  }
}

/** Ink `target` where buildings were drawn: `values` from `GpuBuildings.draw`; 0 leaves the pixel be. */
export function inkBuildings(values: Uint8Array, target: Bitmap): void {
  const { width, height, pixels, phaseX, phaseY } = target;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const value = values[i]!;
      if (value === 0) continue;
      const rows = PAINTS[value - 1]!.pattern;
      pixels[i] = (rows[(y + phaseY) & 7]! >> (7 - ((x + phaseX) & 7))) & 1;
    }
  }
}

/**
 * Triangles covering the simple polygon of the first `n` points, by
 * clipping ears, as corner indices into `out`. A polygon too knotted to
 * clip has its rest filled as a fan.
 */
export function triangulate(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, out: number[]): void {
  if (n < 3) return;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += xs[j]! * ys[i]! - xs[i]! * ys[j]!;
  const turn = area >= 0 ? 1 : -1;
  const left: number[] = [];
  for (let i = 0; i < n; i++) left.push(i);
  const cross = (a: number, b: number, c: number) => ((xs[b]! - xs[a]!) * (ys[c]! - ys[a]!) - (ys[b]! - ys[a]!) * (xs[c]! - xs[a]!)) * turn;
  let misses = 0;
  let i = 0;
  while (left.length > 3 && misses < left.length) {
    const m = left.length;
    const a = left[(i + m - 1) % m]!, b = left[i % m]!, c = left[(i + 1) % m]!;
    let ear = cross(a, b, c) > 0;
    for (let k = 0; ear && k < m; k++) {
      const p = left[k]!;
      if (p === a || p === b || p === c) continue;
      if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) ear = false;
    }
    if (ear) {
      out.push(a, b, c);
      left.splice(i % m, 1);
      misses = 0;
    } else {
      i++;
      misses++;
    }
  }
  for (let k = 1; k + 1 < left.length; k++) out.push(left[0]!, left[k]!, left[k + 1]!);
}
