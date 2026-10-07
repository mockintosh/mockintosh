/**
 * The map's look: OpenMapTiles layers drawn in one bit. Land is white, water
 * is hatched with a black shore, woods and parks are sparse symbol patterns,
 * buildings 50% gray, and roads white with black casings, the way a printed
 * street atlas draws them. Every choice here is by layer, class
 * and zoom; the drawing itself is `Bitmap`'s.
 */
import { BLACK, Bitmap, WHITE, fillOf, walkMarks, type Paint, type Pattern } from "./bitmap";
import type { TileFeature, VectorTile } from "./mvt";

/** Where a data tile lands on the bitmap: pixel = offset + unit × scale. */
export interface TilePlacement {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const pattern = (rows: Pattern, mode: Paint["mode"] = "or"): Paint => ({ pattern: rows, mode });

/** Broken horizontal hatching, as engraved maps drew water; it covers whatever land was under it. */
const WATER = pattern([0xee, 0x00, 0x00, 0x00, 0x77, 0x00, 0x00, 0x00], "copy");
/** Little chevrons, a tree to every 32 pixels. */
const WOOD = pattern([0x00, 0x10, 0x28, 0x00, 0x00, 0x01, 0x82, 0x00]);
/** One dot to every 16 pixels. */
const GRASS = pattern([0x80, 0x00, 0x08, 0x00, 0x80, 0x00, 0x08, 0x00]);
const WETLAND = pattern([0x00, 0x70, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00]);
const SAND = pattern([0x40, 0x00, 0x04, 0x00, 0x10, 0x00, 0x01, 0x00]);
/** Industry and commerce: dotted diagonals. */
const WORKS = pattern([0x80, 0x00, 0x20, 0x00, 0x08, 0x00, 0x02, 0x00]);
const CEMETERY = pattern([0x00, 0x20, 0x70, 0x20, 0x00, 0x00, 0x00, 0x00]);
const GRAY = pattern([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55], "copy");
/** A building's footprint under the tilted view, where the building itself stands on it. */
const FOOTPRINT = pattern([0x88, 0x00, 0x22, 0x00, 0x88, 0x00, 0x22, 0x00], "copy");

/**
 * For a map drawn as fills (`Bitmap`) but shown flat, only turned: the
 * footprints inked as buildings are on the flat map, since none stand up.
 */
export function flatFootprints(): ReadonlyMap<number, number> {
  return new Map([[fillOf(FOOTPRINT.pattern), fillOf(GRAY.pattern)]]);
}

/** Width, then the white inside it (0 for a solid black line), from each zoom on. */
type RoadSteps = ReadonlyArray<readonly [zoom: number, width: number, fill: number]>;

// Zoomed out, a road atlas shows the network a class at a time: motorways
// from 7, trunk roads from 9, main roads from 10, each as a single line, the
// motorways heavier. Casings start at 12, where a road has room to be two
// lines; before that a dual carriageway would draw as four.
const MOTORWAY: RoadSteps = [[7, 1, 0], [9, 2, 0], [12, 5, 3], [13, 6, 4], [14, 7, 5], [15, 9, 7], [16, 11, 9], [17, 14, 12], [18, 18, 16]];
const TRUNK: RoadSteps = [[9, 1, 0], [12, 5, 3], [13, 6, 4], [14, 7, 5], [15, 9, 7], [16, 11, 9], [17, 14, 12], [18, 18, 16]];
const PRIMARY: RoadSteps = [[10, 1, 0], [12, 4, 2], [13, 5, 3], [14, 6, 4], [15, 8, 6], [16, 10, 8], [17, 13, 11], [18, 16, 14]];
const SECONDARY: RoadSteps = [[12, 1, 0], [13, 4, 2], [14, 5, 3], [15, 7, 5], [16, 9, 7], [17, 12, 10], [18, 15, 13]];
const TERTIARY: RoadSteps = [[13, 1, 0], [14, 4, 2], [15, 6, 4], [16, 8, 6], [17, 11, 9], [18, 14, 12]];
const MINOR: RoadSteps = [[14, 1, 0], [15, 4, 2], [16, 6, 4], [17, 9, 7], [18, 12, 10]];
const SERVICE: RoadSteps = [[15, 1, 0], [16, 4, 2], [17, 6, 4], [18, 8, 6]];

/** Road classes, least important first: the order casings and fills are drawn in. */
const ROAD_CLASSES: ReadonlyArray<readonly [string, RoadSteps]> = [
  ["service", SERVICE],
  ["busway", SERVICE],
  ["raceway", SERVICE],
  ["minor", MINOR],
  ["tertiary", TERTIARY],
  ["secondary", SECONDARY],
  ["primary", PRIMARY],
  ["trunk", TRUNK],
  ["motorway", MOTORWAY],
];
const ROAD_RANK = new Map(ROAD_CLASSES.map(([name], rank) => [name, rank]));

interface Stroke {
  width: number;
  fill: number;
}

function step(steps: RoadSteps, zoom: number): Stroke | null {
  let found: Stroke | null = null;
  for (const [from, width, fill] of steps) if (zoom >= from) found = { width, fill };
  return found;
}

/** A road's stroke at `zoom`; a slip road is drawn as the class below it. */
function roadStroke(cls: string, zoom: number, ramp = false): Stroke | null {
  let rank = ROAD_RANK.get(cls);
  if (rank === undefined) return null;
  if (ramp && rank > ROAD_RANK.get("tertiary")!) rank = Math.max(ROAD_RANK.get("tertiary")!, rank - 2);
  return step(ROAD_CLASSES[rank]![1], zoom);
}

const DOTTED = [1, 2];
const TUNNEL_DASH = [3, 2];
const BORDER_DASH = [6, 2, 2, 2];
const STATE_DASH = [2, 2];

/** Tile units turned to bitmap pixels, one feature at a time. */
class Projector {
  xs = new Float64Array(256);
  ys = new Float64Array(256);
  private ringX = new Float64Array(256);
  private ringY = new Float64Array(256);
  private readonly parts: number[] = [];
  /** Feature bounding boxes outside this (in tile units) are skipped. */
  private minX = 0;
  private minY = 0;
  private maxX = 0;
  private maxY = 0;

  /** Features further than `margin` pixels outside the bitmap are skipped. */
  constructor(readonly target: Bitmap, readonly place: TilePlacement, margin: number) {
    const { scale, offsetX, offsetY } = place;
    this.minX = (-margin - offsetX) / scale;
    this.minY = (-margin - offsetY) / scale;
    this.maxX = (this.target.width + margin - offsetX) / scale;
    this.maxY = (this.target.height + margin - offsetY) / scale;
  }

  /**
   * The feature's geometry in pixels, compacted into `xs` / `ys` with the
   * returned part boundaries, or `null` when nothing of it reaches the
   * bitmap. Polygon rings under `minArea` square pixels are left out: a lake,
   * an island or a wood that small is only a speck.
   */
  load(feature: TileFeature, minArea = 0): readonly number[] | null {
    const g = feature.geometry();
    if (g.maxX < this.minX || g.minX > this.maxX || g.maxY < this.minY || g.minY > this.maxY) return null;
    const { scale, offsetX, offsetY } = this.place;
    const polygon = feature.type === 3 && minArea > 0;
    if (polygon && (g.maxX - g.minX) * (g.maxY - g.minY) * scale * scale < minArea) return null;
    const n = g.coords.length / 2;
    if (n > this.xs.length) {
      this.xs = new Float64Array(n * 2);
      this.ys = new Float64Array(n * 2);
    }
    for (let i = 0; i < n; i++) {
      this.xs[i] = offsetX + g.coords[2 * i]! * scale;
      this.ys[i] = offsetY + g.coords[2 * i + 1]! * scale;
    }
    const parts = this.parts;
    parts.length = 0;
    if (!polygon) {
      for (const part of g.parts) parts.push(part);
      return parts;
    }
    let kept = 0;
    for (let k = 0; k + 1 < g.parts.length; k++) {
      const start = g.parts[k]!;
      const end = g.parts[k + 1]!;
      if (Math.abs(ringArea(this.xs, this.ys, start, end)) < minArea) continue;
      if (kept !== start) {
        this.xs.copyWithin(kept, start, end);
        this.ys.copyWithin(kept, start, end);
      }
      parts.push(kept);
      kept += end - start;
    }
    if (parts.length === 0) return null;
    parts.push(kept);
    return parts;
  }

  fill(feature: TileFeature, paint: Paint, minArea = 0): void {
    const parts = this.load(feature, minArea);
    if (parts) this.target.fillPath(this.xs, this.ys, parts, paint);
  }

  /** Each line, or each polygon ring, stroked. */
  stroke(feature: TileFeature, width: number, paint: Paint, dash?: readonly number[], minArea = 0): void {
    const parts = this.load(feature, minArea);
    if (!parts) return;
    for (let k = 0; k + 1 < parts.length; k++) {
      const start = parts[k]!;
      const end = parts[k + 1]!;
      if (feature.type !== 3) {
        this.target.stroke(this.xs, this.ys, start, end, width, paint, dash);
        continue;
      }
      // A ring comes back round to its first point.
      const n = end - start;
      if (n + 1 > this.ringX.length) {
        this.ringX = new Float64Array((n + 1) * 2);
        this.ringY = new Float64Array((n + 1) * 2);
      }
      this.ringX.set(this.xs.subarray(start, end));
      this.ringY.set(this.ys.subarray(start, end));
      this.ringX[n] = this.xs[start]!;
      this.ringY[n] = this.ys[start]!;
      this.target.stroke(this.ringX, this.ringY, 0, n + 1, width, paint, dash);
    }
  }
}

/** A ring's signed area by the shoelace formula. */
function ringArea(xs: ArrayLike<number>, ys: ArrayLike<number>, start: number, end: number): number {
  let twice = 0;
  for (let i = start, j = end - 1; i < end; j = i++) twice += (xs[j]! - xs[i]!) * (ys[j]! + ys[i]!);
  return twice / 2;
}

function features(tile: VectorTile, name: string): readonly TileFeature[] {
  return tile.get(name)?.features ?? [];
}

const str = (f: TileFeature, key: string) => {
  const value = f.get(key);
  return typeof value === "string" ? value : "";
};

const LANDCOVER: Readonly<Record<string, readonly [minZoom: number, paint: Paint]>> = {
  wood: [11, WOOD],
  grass: [12, GRASS],
  wetland: [11, WETLAND],
  sand: [12, SAND],
};

/**
 * Smallest areas drawn, in square pixels. A water speck smaller than a
 * letter is noise; a pattern needs room for a few of its marks.
 */
const MIN_WATER = 20;
const MIN_PATTERN = 200;
const MIN_BUILDING = 6;

/**
 * Draw one data tile, placed by `place`, onto `target` as the map looks at
 * display zoom `zoom`. Everything but the labels.
 */
export function drawTile(target: Bitmap, tile: VectorTile, zoom: number, place: TilePlacement): void {
  // Wide enough for the widest road's casing.
  const p = new Projector(target, place, 24);

  for (const f of features(tile, "landcover")) {
    const style = LANDCOVER[str(f, "class")];
    if (style && zoom >= style[0] && f.type === 3) p.fill(f, style[1], MIN_PATTERN);
  }

  for (const f of features(tile, "landuse")) {
    if (f.type !== 3) continue;
    const cls = str(f, "class");
    if (zoom >= 12 && (cls === "industrial" || cls === "commercial" || cls === "retail" || cls === "railway" || cls === "garages")) p.fill(f, WORKS, MIN_PATTERN);
    else if (zoom >= 13 && cls === "cemetery") p.fill(f, CEMETERY, MIN_PATTERN);
  }

  for (const f of features(tile, "park")) {
    if (f.type !== 3) continue;
    if (zoom < 12) continue;
    p.fill(f, GRASS, MIN_PATTERN);
    p.stroke(f, 1, BLACK, DOTTED, MIN_PATTERN);
  }

  // Rivers as lines go under the water polygons, which carry the real banks
  // where the map has them.
  for (const f of features(tile, "waterway")) {
    if (f.type !== 2 || str(f, "brunnel") === "tunnel") continue;
    const cls = str(f, "class");
    const dash = f.get("intermittent") === 1 ? TUNNEL_DASH : undefined;
    if (cls === "river" || cls === "canal") {
      if (zoom >= 14) {
        const width = Math.min(10, zoom - 10);
        p.stroke(f, width + 2, BLACK, dash);
        p.stroke(f, width, WATER);
      } else if (zoom >= 8) {
        p.stroke(f, zoom >= 12 ? 2 : 1, BLACK, dash);
      }
    } else if (zoom >= 13) {
      p.stroke(f, 1, BLACK, dash);
    }
  }

  drawWater(p, tile);

  if (zoom >= 11) {
    for (const f of features(tile, "aeroway")) {
      const cls = str(f, "class");
      if (f.type === 3 && (cls === "runway" || cls === "taxiway" || (zoom >= 14 && cls === "apron"))) p.fill(f, GRAY, MIN_WATER);
      else if (f.type === 2 && cls === "runway") p.stroke(f, Math.max(2, zoom - 9), BLACK);
      else if (f.type === 2 && cls === "taxiway" && zoom >= 13) p.stroke(f, Math.max(1, zoom - 13), BLACK);
    }
  }

  if (zoom >= 14) drawBuildings(p, tile, zoom >= 16);

  drawTransportation(p, tile, zoom);

  for (const f of features(tile, "boundary")) {
    if (f.type !== 2 || f.get("maritime") === 1) continue;
    const level = Number(f.get("admin_level") ?? 99);
    if (level <= 2) {
      p.stroke(f, zoom >= 5 ? 2 : 1, BLACK, zoom >= 5 ? BORDER_DASH : TUNNEL_DASH);
    } else if (level <= 4 && zoom >= 5) {
      p.stroke(f, 1, BLACK, STATE_DASH);
    }
  }
}

/** Pixels of mask around the bitmap, so the water's edge is found the same on both sides of a tile seam. */
const WATER_MARGIN = 2;
/** Narrow water at least this many pixels long is a river or a channel, and stays. */
const MIN_NARROW_WATER = 24;

/**
 * Water, generalized to the pixel grid, as a cartographer would: the water
 * is filled into a mask, and anything narrower than three pixels is taken
 * out. Long narrow water (a river, a channel, the top of a bay) goes back in
 * and draws as a black line; short creeks and specks stay out. A marsh shore,
 * all creeks a pixel or two wide, would otherwise draw solid black once each
 * creek had its outline. The mask is hatched, and its edge is the shore.
 * Intermittent water keeps a dashed outline of its own.
 */
function drawWater(p: Projector, tile: VectorTile): void {
  const { target, place } = p;
  const width = target.width + WATER_MARGIN * 2;
  const height = target.height + WATER_MARGIN * 2;
  const mask = new Bitmap(width, height);
  const m = new Projector(mask, { ...place, offsetX: place.offsetX + WATER_MARGIN, offsetY: place.offsetY + WATER_MARGIN }, 24);
  const intermittent: TileFeature[] = [];
  for (const f of features(tile, "water")) {
    if (f.type !== 3 || str(f, "brunnel") === "tunnel") continue;
    if (f.get("intermittent") === 1) intermittent.push(f);
    else m.fill(f, BLACK, MIN_WATER);
  }
  const water = generalizeWater(mask.pixels, width, height);
  for (let y = 0; y < target.height; y++) {
    for (let x = 0; x < target.width; x++) {
      const i = (y + WATER_MARGIN) * width + x + WATER_MARGIN;
      if (!water[i]) continue;
      const shore = !water[i - 1] || !water[i + 1] || !water[i - width] || !water[i + width];
      target.plot(x, y, shore ? BLACK : WATER);
    }
  }
  for (const f of intermittent) {
    p.fill(f, WATER, MIN_WATER);
    p.stroke(f, 1, BLACK, TUNNEL_DASH, MIN_WATER);
  }
}

/**
 * The water mask with what's narrower than three pixels taken out, unless
 * it's long or runs off the mask, and with specks left over removed.
 */
export function generalizeWater(mask: Uint8Array, width: number, height: number): Uint8Array {
  const opened = new Uint8Array(mask);
  openMask(opened, width, height);
  const narrow = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) narrow[i] = mask[i]! & (opened[i]! ^ 1);
  forEachComponent(narrow, width, height, (pixels, edge) => {
    if (edge || pixels.length >= MIN_NARROW_WATER) for (const i of pixels) opened[i] = 1;
  });
  forEachComponent(opened.slice(), width, height, (pixels, edge) => {
    if (!edge && pixels.length < MIN_WATER) for (const i of pixels) opened[i] = 0;
  });
  return opened;
}

/** Morphological opening with a 3×3 square, in place: what survives is what a 3×3 block fits inside. */
function openMask(pixels: Uint8Array, width: number, height: number): void {
  const scratch = new Uint8Array(pixels.length);
  // Erode, then dilate, each as a row pass and a column pass.
  pass(pixels, scratch, width, height, 1, 0, Math.min);
  pass(scratch, pixels, width, height, 0, 1, Math.min);
  pass(pixels, scratch, width, height, 1, 0, Math.max);
  pass(scratch, pixels, width, height, 0, 1, Math.max);
}

/** `to` = `pick` of each pixel of `from` and its two neighbours along (dx, dy); the edges repeat. */
function pass(
  from: Uint8Array,
  to: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
  pick: (a: number, b: number, c: number) => number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const before = dx ? (x > 0 ? i - 1 : i) : y > 0 ? i - width : i;
      const after = dx ? (x < width - 1 ? i + 1 : i) : y < height - 1 ? i + width : i;
      to[i] = pick(from[before]!, from[i]!, from[after]!);
    }
  }
}

/**
 * Each 8-connected group of set pixels in `pixels` (which is cleared as it
 * goes), with whether it touches the edge: such a group may go on in the
 * next tile, so it can't be judged by its size here.
 */
function forEachComponent(
  pixels: Uint8Array,
  width: number,
  height: number,
  visit: (component: number[], edge: boolean) => void,
): void {
  const stack: number[] = [];
  for (let start = 0; start < pixels.length; start++) {
    if (!pixels[start]) continue;
    const component: number[] = [];
    let edge = false;
    pixels[start] = 0;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      component.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (pixels[j]) {
            pixels[j] = 0;
            stack.push(j);
          }
        }
      }
    }
    visit(component, edge);
  }
}

/**
 * A building at least this many pixels across keeps its own outline, walls
 * shared with its neighbours and all; smaller ones that touch are outlined
 * together, as one block, the way their walls would blur together anyway.
 */
const OWN_OUTLINE = 32;

/** A building label per pixel, for `drawBuildings`; one for every map drawn, grown as needed. */
let buildingLabels = new Int32Array(0);
/** Which pixels `drawBuildings` drew a line on, the same way. */
let outlinePixels = new Uint8Array(0);

/**
 * The buildings' footprints, gray, and with `outlined` a black line round
 * each block of them: inside the footprints, on the pixels next to the
 * ground or to a building outlined on its own (`OWN_OUTLINE`).
 */
function drawBuildings(p: Projector, tile: VectorTile, outlined: boolean): void {
  const target = p.target;
  // Under the tilted view most buildings stand up from their footprint; what's left of it is lighter.
  const paint = target.fills ? FOOTPRINT : GRAY;
  const { scale, offsetX, offsetY } = p.place;
  const span = (tile.get("building")?.extent ?? 4096) * scale;
  // The pixels this tile outlines are its own, so no line is drawn along its
  // edge; it reads one pixel further for their neighbours.
  const left = Math.max(0, Math.ceil(offsetX - 0.5));
  const right = Math.min(target.width, Math.ceil(offsetX + span - 0.5));
  const top = Math.max(0, Math.ceil(offsetY - 0.5));
  const bottom = Math.min(target.height, Math.ceil(offsetY + span - 0.5));
  outlined &&= left < right && top < bottom;
  const x0 = Math.max(0, left - 1), x1 = Math.min(target.width, right + 1);
  const y0 = Math.max(0, top - 1), y1 = Math.min(target.height, bottom + 1);
  const width = target.width;
  if (outlined) {
    if (buildingLabels.length < width * target.height) {
      buildingLabels = new Int32Array(width * target.height);
      outlinePixels = new Uint8Array(width * target.height);
    }
    for (let y = y0; y < y1; y++) buildingLabels.fill(0, y * width + x0, y * width + x1);
  }
  const labels = buildingLabels;

  // Small buildings share label 1; one outlined on its own has a label of its own.
  let next = 1;
  for (const f of features(tile, "building")) {
    if (f.type !== 3) continue;
    const parts = p.load(f, MIN_BUILDING);
    if (!parts) continue;
    target.fillPath(p.xs, p.ys, parts, paint);
    // A part that starts above the ground (a tower on its podium) adds no line to a flat map.
    if (!outlined || Number(f.get("render_min_height") ?? 0) > 0) continue;
    const g = f.geometry();
    const label = Math.min(g.maxX - g.minX, g.maxY - g.minY) * scale >= OWN_OUTLINE ? ++next : 1;
    target.scanPath(p.xs, p.ys, parts, (y, from, to) => {
      if (y < y0 || y >= y1) return;
      from = Math.max(from, x0);
      to = Math.min(to, x1);
      if (from < to) labels.fill(label, y * width + from, y * width + to);
    });
  }
  if (!outlined) return;

  // A pixel is on the outline when a neighbour is ground, or is another
  // building with a lower label: one line between two buildings, not two.
  // Past the map's sides, the neighbours count as the same building.
  const lines = outlinePixels;
  const height = target.height;
  for (let y = y0; y < y1; y++) lines.fill(0, y * width + x0, y * width + x1);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = y * width + x;
      const label = labels[i]!;
      if (label === 0) continue;
      if (
        (x > 0 && labels[i - 1]! < label) ||
        (x + 1 < width && labels[i + 1]! < label) ||
        (y > 0 && labels[i - width]! < label) ||
        (y + 1 < height && labels[i + width]! < label)
      ) {
        lines[i] = 1;
        target.plot(x, y, BLACK);
      }
    }
  }
  // A line straight on the gray would merge with its pattern; the footprint
  // keeps a pixel of white beside it.
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = y * width + x;
      if (labels[i] === 0 || lines[i]) continue;
      if ((x > 0 && lines[i - 1]) || (x + 1 < width && lines[i + 1]) || (y > 0 && lines[i - width]) || (y + 1 < height && lines[i + width])) {
        target.plot(x, y, WHITE);
      }
    }
  }
}

interface Road {
  feature: TileFeature;
  rank: number;
  stroke: Stroke;
}

/**
 * A footpath is drawn only where it has this many pixels of white between it
 * and a road's casing. Sidewalks and crossings, which run beside and across
 * the roads, so drop out until the map is zoomed in far enough to part them
 * from their road; a path through a park or a plaza stays.
 */
const PATH_CLEARANCE = 6;
/** What's left of a path shorter than this, in pixels, isn't drawn: a stub between a crossing and a sidewalk. */
const MIN_PATH_RUN = 12;
/** Pixels between the points along a path tested for room. */
const PATH_STEP = 2;
const ROAD_CELL = 32;

/** The drawn roads' pieces, in pixels, bucketed in a grid, to find how close a point is to one. */
class RoadIndex {
  private readonly cells = new Map<number, number[]>();
  /** x0, y0, x1, y1, half width, for each piece. */
  private readonly pieces: number[] = [];

  add(p: Projector, road: Road): void {
    const parts = p.load(road.feature);
    if (!parts) return;
    const half = road.stroke.width / 2;
    for (let k = 0; k + 1 < parts.length; k++) {
      for (let i = parts[k]!; i + 1 < parts[k + 1]!; i++) {
        const x0 = p.xs[i]!, y0 = p.ys[i]!, x1 = p.xs[i + 1]!, y1 = p.ys[i + 1]!;
        const id = this.pieces.length;
        this.pieces.push(x0, y0, x1, y1, half);
        const pad = half + PATH_CLEARANCE;
        for (let cy = Math.floor((Math.min(y0, y1) - pad) / ROAD_CELL); cy <= Math.floor((Math.max(y0, y1) + pad) / ROAD_CELL); cy++) {
          for (let cx = Math.floor((Math.min(x0, x1) - pad) / ROAD_CELL); cx <= Math.floor((Math.max(x0, x1) + pad) / ROAD_CELL); cx++) {
            const key = cy * 65536 + cx;
            const cell = this.cells.get(key);
            if (cell) cell.push(id);
            else this.cells.set(key, [id]);
          }
        }
      }
    }
  }

  /** Whether (x, y) has `PATH_CLEARANCE` pixels of room from every road's edge. */
  clear(x: number, y: number): boolean {
    const cell = this.cells.get(Math.floor(y / ROAD_CELL) * 65536 + Math.floor(x / ROAD_CELL));
    if (!cell) return true;
    const pieces = this.pieces;
    for (const id of cell) {
      const x0 = pieces[id]!, y0 = pieces[id + 1]!, x1 = pieces[id + 2]!, y1 = pieces[id + 3]!;
      const room = pieces[id + 4]! + PATH_CLEARANCE;
      const dx = x1 - x0, dy = y1 - y0;
      const length2 = dx * dx + dy * dy;
      const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length2)) : 0;
      const ex = x0 + t * dx - x, ey = y0 + t * dy - y;
      if (ex * ex + ey * ey < room * room) return false;
    }
    return true;
  }
}

/**
 * A footpath, dotted, in the runs of it that have room beside the roads
 * (`PATH_CLEARANCE`) and are long enough to read as a path.
 */
function drawPath(p: Projector, f: TileFeature, roads: RoadIndex): void {
  const parts = p.load(f);
  if (!parts) return;
  const runX: number[] = [];
  const runY: number[] = [];
  let runLength = 0;
  const flush = () => {
    if (runX.length >= 2 && runLength >= MIN_PATH_RUN) p.target.stroke(runX, runY, 0, runX.length, 1, BLACK, DOTTED);
    runX.length = 0;
    runY.length = 0;
    runLength = 0;
  };
  const visit = (x: number, y: number) => {
    if (!roads.clear(x, y)) return flush();
    const n = runX.length;
    if (n) runLength += Math.hypot(x - runX[n - 1]!, y - runY[n - 1]!);
    runX.push(x);
    runY.push(y);
  };
  for (let k = 0; k + 1 < parts.length; k++) {
    const start = parts[k]!, end = parts[k + 1]!;
    visit(p.xs[start]!, p.ys[start]!);
    for (let i = start; i + 1 < end; i++) {
      const x0 = p.xs[i]!, y0 = p.ys[i]!, x1 = p.xs[i + 1]!, y1 = p.ys[i + 1]!;
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / PATH_STEP);
      for (let s = 1; s <= steps; s++) visit(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
    }
    flush();
  }
}

function drawTransportation(p: Projector, tile: VectorTile, zoom: number): void {
  const layer = features(tile, "transportation");
  const levels: Road[][] = [[], [], []];
  const rails: TileFeature[] = [];
  const bridgeRails: TileFeature[] = [];
  const paths: TileFeature[] = [];

  for (const f of layer) {
    if (f.type !== 2) continue;
    const cls = str(f, "class");
    const brunnel = str(f, "brunnel");
    if (cls === "path" || cls === "track") {
      if (brunnel !== "tunnel" && zoom >= (cls === "track" ? 14 : 15)) paths.push(f);
      continue;
    }
    // Ferry routes aren't drawn: dashes across the water hatch only cluttered it.
    if (cls === "ferry") continue;
    if (cls === "rail" || cls === "transit") {
      if (brunnel === "tunnel") continue;
      const sub = str(f, "subclass");
      const minZoom = cls === "rail" && (sub === "rail" || sub === "") ? 11 : 14;
      if (zoom >= minZoom) (brunnel === "bridge" ? bridgeRails : rails).push(f);
      continue;
    }
    const ramp = f.get("ramp") === 1;
    // Slip roads and tunnels only clutter a map drawn this small.
    if ((ramp && zoom < 12) || (brunnel === "tunnel" && zoom < 13)) continue;
    const stroke = roadStroke(cls, zoom, ramp);
    if (!stroke) continue;
    const level = brunnel === "tunnel" ? 0 : brunnel === "bridge" ? 2 : 1;
    levels[level]!.push({ feature: f, rank: ROAD_RANK.get(cls)!, stroke });
  }

  // Paths go under the roads, where they have room beside them.
  if (paths.length) {
    const index = new RoadIndex();
    for (const road of [...levels[1]!, ...levels[2]!]) index.add(p, road);
    for (const f of paths) drawPath(p, f, index);
  }

  for (const [level, roads] of levels.entries()) {
    roads.sort((a, b) => a.rank - b.rank);
    const tunnel = level === 0;
    for (const road of roads) {
      p.stroke(road.feature, road.stroke.width, BLACK, tunnel ? TUNNEL_DASH : undefined);
    }
    for (const road of roads) {
      if (road.stroke.fill > 0) p.stroke(road.feature, road.stroke.fill, WHITE);
    }
    if (level === 1) for (const rail of rails) drawRail(p, rail, zoom);
    if (level === 2) for (const rail of bridgeRails) drawRail(p, rail, zoom);
  }
}

/** A railway: a line, with cross-ties once there's room for them. */
function drawRail(p: Projector, f: TileFeature, zoom: number): void {
  p.stroke(f, 1, BLACK);
  if (zoom < 14) return;
  const parts = p.load(f);
  if (!parts) return;
  const tie = zoom >= 16 ? 3 : 2;
  for (let k = 0; k + 1 < parts.length; k++) {
    walkMarks(p.xs, p.ys, parts[k]!, parts[k + 1]!, zoom >= 16 ? 6 : 8, (x, y, ux, uy) => {
      p.target.hairline(x - uy * tie, y + ux * tie, x + uy * tie, y - ux * tie, BLACK);
    });
  }
}
