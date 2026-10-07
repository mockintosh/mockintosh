/**
 * The Earth's land and borders, unpacked once: each vertex as degrees for
 * the land test and as a unit vector for projecting.
 *
 * Whether a point is on land is answered the way a scanline fill would: the
 * parallel through it crosses the coast some number of times to its west.
 * The crossings of a parallel are found once, from the coast edges filed by
 * the degree of latitude they span, and kept while the dot grid stays.
 */
import { BORDERS, LAND } from "./geography.generated";
import { unpack } from "./packing";

export interface Polyline {
  /** `[lon, lat, …]` degrees. */
  degrees: Float64Array;
  /** `[x, y, z, …]` on the unit sphere. */
  unit: Float64Array;
  /** Rings join their last point back to their first. */
  closed: boolean;
  /**
   * Per edge (from point i to the next), 1 where the edge is coast and 0
   * where it only closes a polygon: along the antimeridian, where the data
   * cuts land in two, or along the south pole's edge of the map.
   */
  drawn: Uint8Array;
}

const toUnit = (degrees: Float64Array): Float64Array => {
  const unit = new Float64Array((degrees.length / 2) * 3);
  for (let i = 0, j = 0; i < degrees.length; i += 2, j += 3) {
    const lon = (degrees[i]! * Math.PI) / 180;
    const lat = (degrees[i + 1]! * Math.PI) / 180;
    const c = Math.cos(lat);
    unit[j] = c * Math.cos(lon);
    unit[j + 1] = c * Math.sin(lon);
    unit[j + 2] = Math.sin(lat);
  }
  return unit;
};

function polyline(degrees: Float64Array, closed: boolean): Polyline {
  const count = degrees.length / 2;
  const edges = closed ? count : count - 1;
  const drawn = new Uint8Array(edges);
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % count;
    const [x0, y0, x1, y1] = [degrees[i * 2]!, degrees[i * 2 + 1]!, degrees[j * 2]!, degrees[j * 2 + 1]!];
    const seam = Math.abs(x0) >= 179.99 && Math.abs(x1) >= 179.99 && Math.sign(x0) === Math.sign(x1);
    const pole = y0 <= -89.99 && y1 <= -89.99;
    drawn[i] = seam || pole ? 0 : 1;
  }
  return { degrees, unit: toUnit(degrees), closed, drawn };
}

/** Coast edges in equirectangular degrees, filed by the whole degree of latitude they cross. */
class LandIndex {
  private readonly x0: Float64Array;
  private readonly y0: Float64Array;
  private readonly x1: Float64Array;
  private readonly y1: Float64Array;
  private readonly bands: Uint32Array[];

  constructor(rings: readonly Polyline[]) {
    let count = 0;
    for (const ring of rings) count += ring.degrees.length / 2;
    this.x0 = new Float64Array(count);
    this.y0 = new Float64Array(count);
    this.x1 = new Float64Array(count);
    this.y1 = new Float64Array(count);
    const filed: number[][] = Array.from({ length: 180 }, () => []);
    let e = 0;
    for (const { degrees } of rings) {
      const n = degrees.length / 2;
      for (let i = 0; i < n; i++, e++) {
        const j = (i + 1) % n;
        this.x0[e] = degrees[i * 2]!;
        this.y0[e] = degrees[i * 2 + 1]!;
        this.x1[e] = degrees[j * 2]!;
        this.y1[e] = degrees[j * 2 + 1]!;
        const lo = Math.max(0, Math.floor(Math.min(this.y0[e]!, this.y1[e]!) + 90));
        const hi = Math.min(179, Math.floor(Math.max(this.y0[e]!, this.y1[e]!) + 90));
        for (let band = lo; band <= hi; band++) filed[band]!.push(e);
      }
    }
    this.bands = filed.map((edges) => Uint32Array.from(edges));
  }

  /** Where the parallel at `lat` degrees crosses the coast, sorted west to east. */
  crossings(lat: number): Float64Array {
    const band = this.bands[Math.max(0, Math.min(179, Math.floor(lat + 90)))]!;
    const found: number[] = [];
    for (let k = 0; k < band.length; k++) {
      const e = band[k]!;
      const ya = this.y0[e]!;
      const yb = this.y1[e]!;
      // Half-open, so a parallel through a vertex counts it once.
      if (ya <= lat === yb <= lat) continue;
      const t = (lat - ya) / (yb - ya);
      found.push(this.x0[e]! + t * (this.x1[e]! - this.x0[e]!));
    }
    return Float64Array.from(found).sort();
  }
}

export class Geography {
  readonly land: Polyline[];
  readonly borders: Polyline[];
  private readonly index: LandIndex;
  private rows = new Map<number, Float64Array>();
  private rowsFor = NaN;

  constructor() {
    this.land = unpack(LAND).map((degrees) => polyline(degrees, true));
    this.borders = unpack(BORDERS).map((degrees) => polyline(degrees, false));
    this.index = new LandIndex(this.land);
  }

  /**
   * Whether (lon, lat) degrees is land, for points on a grid `step`
   * degrees apart: row `row` is the parallel at `row × step`.
   */
  isLand(lon: number, row: number, step: number): boolean {
    // A new grid, or a long pan at a close zoom: start the rows afresh.
    if (step !== this.rowsFor || this.rows.size > 20000) {
      this.rows.clear();
      this.rowsFor = step;
    }
    let crossings = this.rows.get(row);
    if (!crossings) {
      crossings = this.index.crossings(Math.max(-89.999, Math.min(89.999, row * step)));
      this.rows.set(row, crossings);
    }
    // Count the crossings to the west.
    let lo = 0;
    let hi = crossings.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (crossings[mid]! < lon) lo = mid + 1;
      else hi = mid;
    }
    return (lo & 1) === 1;
  }
}

let shared: Geography | null = null;

/** The one copy, unpacked the first time it is asked for. */
export function geography(): Geography {
  shared ??= new Geography();
  return shared;
}
