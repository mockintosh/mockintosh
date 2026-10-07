/**
 * Buildings generalized into blocks, as a cartographer would at a smaller
 * scale: neighbours that touch or nearly touch, of much the same height and
 * size — a street of row houses — become one block with one outline. From
 * far enough off that each house is only a few pixels across, the block is
 * what's drawn; closer, the houses themselves.
 *
 * A group's outline is found on a grid: its buildings are filled in, the
 * narrow gaps between them closed, courtyards filled, and the boundary
 * traced and straightened. A big building never joins small ones, and
 * buildings of different heights stay apart, so a tower still stands out
 * of the block it's in.
 */
import { BLACK, Bitmap } from "./bitmap";
import type { Building } from "./perspective";

/** Buildings joined into one block, and the block. */
export interface BuildingBlock {
  block: Building;
  members: Building[];
  /** A typical member's size, in tile units: the block stands in for them once that's small on the screen. */
  memberSize: number;
}

export interface Generalized {
  /** Buildings that join no block. */
  singles: Building[];
  blocks: BuildingBlock[];
}

/** Buildings this close, in metres, are neighbours: across a party wall, or a narrow alley. */
const GAP_METRES = 2.5;
/** Neighbours this far apart in height don't join: a difference of metres, or a share of the taller. */
const HEIGHT_METRES = 4;
const HEIGHT_SHARE = 0.3;
/** Neighbours this many times the other's size (across) don't join. */
const SIZE_RATIO = 3;
/** The grid a block's outline is found on, in metres per cell. */
const CELL_METRES = 2.5;
/** A group spanning more cells than this each way is left as its buildings: a whole district isn't a block. */
const MOST_CELLS = 400;

/**
 * The buildings of a tile joined into blocks where they can be.
 * `unitsPerMetre` is how many tile units make a metre on the ground there;
 * `extent` is the tile's size in units (outlines past it were cut by the tile).
 */
export function generalize(buildings: readonly Building[], unitsPerMetre: number, extent: number): Generalized {
  const n = buildings.length;
  const gap = GAP_METRES * unitsPerMetre;
  const boxes = buildings.map(boxOf);
  const sizes = boxes.map((b) => Math.sqrt(Math.max(1, b.area)));

  // Neighbours, found through a grid of buckets about a building across.
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const bucket = Math.max(gap * 4, 64);
  const grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    for (let gx = Math.floor((b.x0 - gap) / bucket); gx <= Math.floor((b.x1 + gap) / bucket); gx++) {
      for (let gy = Math.floor((b.y0 - gap) / bucket); gy <= Math.floor((b.y1 + gap) / bucket); gy++) {
        const key = `${gx},${gy}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  });
  for (const list of grid.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const i = list[p]!;
        const j = list[q]!;
        if (find(i) === find(j)) continue;
        const a = boxes[i]!, b = boxes[j]!;
        if (a.x0 - gap > b.x1 || b.x0 - gap > a.x1 || a.y0 - gap > b.y1 || b.y0 - gap > a.y1) continue;
        const hi = buildings[i]!.height, hj = buildings[j]!.height;
        if (Math.abs(hi - hj) > Math.max(HEIGHT_METRES, HEIGHT_SHARE * Math.max(hi, hj))) continue;
        if (Math.max(sizes[i]!, sizes[j]!) > SIZE_RATIO * Math.min(sizes[i]!, sizes[j]!)) continue;
        if (buildings[i]!.base !== buildings[j]!.base) continue;
        parent[find(i)] = find(j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }

  const singles: Building[] = [];
  const blocks: BuildingBlock[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) {
      singles.push(buildings[members[0]!]!);
      continue;
    }
    const outlines = blockOutlines(members.map((i) => buildings[i]!), CELL_METRES * unitsPerMetre, gap, extent);
    if (!outlines) {
      for (const i of members) singles.push(buildings[i]!);
      continue;
    }
    const memberSize = median(members.map((i) => sizes[i]!));
    // A gap the grid didn't close leaves more than one outline: each is a
    // block of the buildings whose middles it holds. A building in none,
    // or alone in one, stays as it is.
    const placed = new Set<number>();
    for (const block of outlines) {
      const held = members.filter((i) => !placed.has(i) && inside(block, buildings[i]!.cx, buildings[i]!.cy));
      if (held.length < 2) continue;
      held.forEach((i) => placed.add(i));
      let heldArea = 0;
      for (const i of held) heldArea += boxes[i]!.area;
      block.height = held.reduce((sum, i) => sum + boxes[i]!.area * buildings[i]!.height, 0) / heldArea;
      block.base = buildings[held[0]!]!.base;
      blocks.push({ block, members: held.map((i) => buildings[i]!), memberSize });
    }
    for (const i of members) if (!placed.has(i)) singles.push(buildings[i]!);
  }
  return { singles, blocks };
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1]!;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

function boxOf(b: Building): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
  const n = b.xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    x0 = Math.min(x0, b.xs[i]!); x1 = Math.max(x1, b.xs[i]!);
    y0 = Math.min(y0, b.ys[i]!); y1 = Math.max(y1, b.ys[i]!);
    area += b.xs[i]! * b.ys[j]! - b.xs[j]! * b.ys[i]!;
  }
  return { x0, y0, x1, y1, area: Math.abs(area) / 2 };
}

/** Whether (x, y) is inside the building's outline (even-odd). */
function inside(b: Building, x: number, y: number): boolean {
  let hit = false;
  const n = b.xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = b.ys[i]!, yj = b.ys[j]!;
    if (yi > y !== yj > y && x < ((b.xs[j]! - b.xs[i]!) * (y - yi)) / (yj - yi) + b.xs[i]!) hit = !hit;
  }
  return hit;
}

/**
 * The outlines of `members` together, in tile units: filled into a grid of
 * `cell`-unit cells, gaps up to `gap` closed, courtyards filled, each
 * piece's boundary traced and straightened. `null` for a group too big for
 * the grid.
 */
function blockOutlines(members: Building[], cell: number, gap: number, extent: number): Building[] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of members) {
    for (let i = 0; i < b.xs.length; i++) {
      x0 = Math.min(x0, b.xs[i]!); x1 = Math.max(x1, b.xs[i]!);
      y0 = Math.min(y0, b.ys[i]!); y1 = Math.max(y1, b.ys[i]!);
    }
  }
  const pad = Math.ceil(gap / cell) + 2;
  const width = Math.ceil((x1 - x0) / cell) + pad * 2;
  const height = Math.ceil((y1 - y0) / cell) + pad * 2;
  if (width > MOST_CELLS || height > MOST_CELLS) return null;
  const ox = x0 - pad * cell;
  const oy = y0 - pad * cell;

  // The buildings, filled in, on a grid reused between groups.
  const grid = new Bitmap(width, height, scratch("grid", width * height).subarray(0, width * height).fill(0));
  for (const b of members) {
    const xs = Array.from(b.xs, (x) => (x - ox) / cell);
    const ys = Array.from(b.ys, (y) => (y - oy) / cell);
    grid.fillPath(xs, ys, [0, xs.length], BLACK);
  }
  const mask = grid.pixels;
  // Narrow gaps closed: grown by the gap, then shrunk back.
  const reach = Math.max(1, Math.round(gap / cell / 2));
  grow(mask, width, height, reach, 1);
  grow(mask, width, height, reach, 0);
  fillCourtyards(mask, width, height);

  const outlines: Building[] = [];
  for (const ring of traceRings(mask, width, height)) {
    const simple = straighten(ring, 0.8);
    if (simple.length < 6) continue;
    const n = simple.length / 2;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const walls = new Uint8Array(n);
    let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      xs[i] = ox + simple[2 * i]! * cell;
      ys[i] = oy + simple[2 * i + 1]! * cell;
      cx += xs[i]!; cy += ys[i]!;
      minX = Math.min(minX, xs[i]!); maxX = Math.max(maxX, xs[i]!);
      minY = Math.min(minY, ys[i]!); maxY = Math.max(maxY, ys[i]!);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // Past the tile's edge, the tile cut the buildings: no wall there, as for a single building.
      const cut = (xs[i]! < 0 && xs[j]! < 0) || (xs[i]! > extent && xs[j]! > extent) || (ys[i]! < 0 && ys[j]! < 0) || (ys[i]! > extent && ys[j]! > extent);
      walls[i] = cut ? 0 : 1;
    }
    outlines.push({ xs, ys, walls, height: 0, base: 0, cx: cx / n, cy: cy / n, size: Math.max(maxX - minX, maxY - minY) });
  }
  return outlines;
}

/** Buffers reused between groups and tiles, grown as needed. */
const buffers = new Map<string, Uint8Array>();
const intBuffers = new Map<string, Int32Array>();

function scratch(name: string, size: number): Uint8Array {
  let buffer = buffers.get(name);
  if (!buffer || buffer.length < size) buffers.set(name, (buffer = new Uint8Array(Math.max(size, (buffer?.length ?? 0) * 2))));
  return buffer;
}

function scratchInt(name: string, size: number): Int32Array {
  let buffer = intBuffers.get(name);
  if (!buffer || buffer.length < size) intBuffers.set(name, (buffer = new Int32Array(Math.max(size, (buffer?.length ?? 0) * 2))));
  return buffer;
}

/** Grow `value` cells of the mask by `reach` cells each way (a square), rows then columns. */
function grow(mask: Uint8Array, width: number, height: number, reach: number, value: 0 | 1): void {
  const row = scratch("row", Math.max(width, height));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = mask[y * width + x]!;
    for (let x = 0; x < width; x++) {
      if (row[x] === value) continue;
      for (let d = -reach; d <= reach; d++) {
        const nx = x + d;
        if (nx >= 0 && nx < width && row[nx] === value) {
          mask[y * width + x] = value;
          break;
        }
      }
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) row[y] = mask[y * width + x]!;
    for (let y = 0; y < height; y++) {
      if (row[y] === value) continue;
      for (let d = -reach; d <= reach; d++) {
        const ny = y + d;
        if (ny >= 0 && ny < height && row[ny] === value) {
          mask[y * width + x] = value;
          break;
        }
      }
    }
  }
}

/** Fill what the outside can't reach: a block is solid, courtyards and all. */
function fillCourtyards(mask: Uint8Array, width: number, height: number): void {
  const size = mask.length;
  const outside = scratch("outside", size);
  outside.fill(0, 0, size);
  const stack = scratchInt("stack", size);
  let top = 0;
  const visit = (i: number) => {
    if (mask[i] || outside[i]) return;
    outside[i] = 1;
    stack[top++] = i;
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (top > 0) {
    const i = stack[--top]!;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < size - width) visit(i + width);
  }
  for (let i = 0; i < size; i++) if (!outside[i]) mask[i] = 1;
}

/**
 * The boundaries of the mask's filled cells, each a ring of cell corners
 * running clockwise on the grid (y down), as building outlines do.
 */
export function traceRings(mask: Uint8Array, width: number, height: number): number[][] {
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  // Each cell side between filled and empty is an edge from corner to
  // corner, filled on its right. A corner has at most two going out (where
  // two filled cells meet only at it).
  const corners = (width + 1) * (height + 1);
  const first = scratchInt("first", corners);
  const second = scratchInt("second", corners);
  first.fill(-1, 0, corners);
  second.fill(-1, 0, corners);
  const starts: number[] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const from = ay * (width + 1) + ax;
    const to = by * (width + 1) + bx;
    if (first[from] === -1) {
      first[from] = to;
      starts.push(from);
    } else second[from] = to;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add(x, y, x + 1, y);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  /** The next edge out of `at`, taken. */
  const take = (at: number): number => {
    const to = second[at] !== -1 ? second[at]! : first[at]!;
    if (second[at] !== -1) second[at] = -1;
    else first[at] = -1;
    return to;
  };
  const rings: number[][] = [];
  for (const start of starts) {
    while (first[start] !== -1 || second[start] !== -1) {
      const ring: number[] = [];
      let at = start;
      do {
        ring.push(at % (width + 1), Math.floor(at / (width + 1)));
        at = take(at);
      } while (at !== start && (first[at] !== -1 || second[at] !== -1));
      if (ring.length >= 6) rings.push(ring);
    }
  }
  return rings;
}

/**
 * A closed ring of points with the stair-steps of the grid taken out:
 * Douglas–Peucker, keeping points more than `tolerance` off the line
 * between those kept around them.
 */
export function straighten(ring: number[], tolerance: number): number[] {
  const n = ring.length / 2;
  if (n < 4) return ring;
  // Start from the point farthest from the first, so the ring splits into two runs.
  let far = 0;
  let farthest = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[2 * i]! - ring[0]!, ring[2 * i + 1]! - ring[1]!);
    if (d > farthest) {
      farthest = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const run = (a: number, b: number) => {
    // Points strictly between a and b, going round.
    let worst = -1;
    let at = -1;
    const ax = ring[2 * a]!, ay = ring[2 * a + 1]!, bx = ring[2 * (b % n)]!, by = ring[2 * (b % n) + 1]!;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    for (let k = a + 1; k < b; k++) {
      const i = k % n;
      const d = Math.abs((bx - ax) * (ay - ring[2 * i + 1]!) - (ax - ring[2 * i]!) * (by - ay)) / length;
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolerance) {
      keep[at % n] = 1;
      run(a, at);
      run(at, b);
    }
  };
  run(0, far);
  run(far, n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[2 * i]!, ring[2 * i + 1]!);
  return out;
}
