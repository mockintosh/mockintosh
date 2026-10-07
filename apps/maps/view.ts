/**
 * The map as it is on screen: a camera over the world, the 256-pixel tiles
 * it covers drawn from whatever data has arrived, labels over them, then the
 * scale bar and attribution. What goes over the map — the pin, search
 * results' letters, the step picked and the routes' times — is laid out
 * here but drawn with QuickDraw (`marks.ts`), from `marks`.
 *
 * Display tiles are drawn once and kept, so dragging only copies them.
 * They're kept as fills, not ink (see `Bitmap`), and inked on the screen:
 * a pattern stays put as the map moves under it, rather than a gray
 * checker turning over at every pixel the map pans. A
 * display tile at zoom `z` is drawn from the data tile at `z - 1`, which is
 * how OpenMapTiles' density is meant to be seen; deeper than the server
 * goes, its deepest tiles are drawn larger. Until a tile's own data arrives
 * it is drawn from a coarser tile that has, so zooming in shows the area at
 * once and sharpens as the detail comes.
 *
 * A route for directions is drawn over the tiles and under the labels.
 *
 * Tilted (`pitch`), the flat map is drawn for the ground the camera sees and
 * laid on it in perspective, buildings are raised on it, and the labels,
 * pin and callouts are placed where their points land, upright as ever.
 * The buildings can be drawn by the graphics processor instead (`renderWith`).
 */
import { BLACK, Bitmap, WHITE, inkFills, type Paint } from "./bitmap";
import { drawTile, flatFootprints } from "./cartography";
import { LABEL_PADDING, collectLabels, placeLabels, type LabelCandidate, type LabelView, type Marker, type PlacedLabel } from "./labels";
import { TILE_SIZE, metresPerPixel, project, unproject, worldSize, type LatLon } from "./mercator";
import { tileKey, type TileAddress, type TileSource } from "./tiles";
import { drawLabel, labelSize, printable, type LabelFace } from "./text";
import type { VectorTile } from "./mvt";
import { spacedFontName } from "@mockintosh/ui";
import { generalize, type Generalized } from "./generalize";
import { Perspective, collectBuildings, drawBuildings, type BuildingGroup } from "./perspective";
import { inkBuildings, type GpuBuildings } from "./gpuBuildings";
import { PIN_HALF, PIN_HEAD, markBox, type Mark } from "./marks";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 18;

/** The middle of the view, in world pixels at `zoom` (a whole zoom level). */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Pin extends LatLon {
  name: string;
}

export interface MapOverlays {
  labels: boolean;
  pin: Pin | null;
  /** Size of the bottom-right square the window's grow box covers; the credit stays left of it. */
  corner?: number;
  /**
   * Routes to draw, start to end, the one at `selectedRoute` black and on
   * top, the others gray. The selected one's start gets a ring (its end is
   * the pin); each route's callout gives its time.
   */
  routes?: readonly MapRoute[];
  selectedRoute?: number;
  /** A point on the route to point out: the step picked from the list. */
  mark?: LatLon | null;
  /** Boxes of the view under floating panels: labels keep out of them. */
  covered?: readonly Box[];
  /** Where the map shows from on the left, right of a panel: the scale bar starts there. */
  inset?: number;
  /** How far the view tilts from looking straight down, in radians; 0 is the flat map. */
  pitch?: number;
  /** Which way the view faces, in radians clockwise from north. */
  bearing?: number;
  /** Tilted without perspective: everything at the map's scale, near or far. */
  orthographic?: boolean;
  /** Search results to point out, lettered A, B, C… in order (`resultLetter`). */
  results?: readonly LatLon[];
  /** The result highlighted in the list, drawn on top and inverted. */
  highlighted?: number;
}

/** Buildings stand up in the tilted view from this zoom in. */
export const BUILDINGS_ZOOM = 15;

export interface MapRoute {
  points: readonly LatLon[];
  /** A bubble with the route's time, on a stretch of it no other route shares. */
  callout?: { at: LatLon; text: string };
}

/** `[x0, y0, x1, y1]` on the view. */
export type Box = readonly [number, number, number, number];

/** Something on the map under the pointer: a named place or a route's callout. */
export type MapHit =
  | { type: "place"; name: string; kind: string; lat: number; lon: number }
  | { type: "route"; index: number }
  | { type: "result"; index: number };

/** A route's line: black, in a white casing so it reads over any pattern. */
const ROUTE_WIDTH = 3;
const ROUTE_CASING = 7;
const GRAY: Paint = { pattern: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55] };
const CALLOUT_FACE: LabelFace = { font: spacedFontName("menu", 1) };
const START_RING = 5;

export function cameraAt(place: LatLon, zoom: number): Camera {
  const z = clampZoom(zoom);
  const p = project(place, z);
  return { x: p.x, y: p.y, zoom: z };
}

export function cameraCentre(camera: Camera): LatLon {
  return unproject(camera, camera.zoom);
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
}

/** Keep x on the world and the view from running off the top or bottom of it. */
export function normalizeCamera(camera: Camera, viewHeight: number): Camera {
  const size = worldSize(camera.zoom);
  const x = ((camera.x % size) + size) % size;
  const y = size <= viewHeight ? size / 2 : Math.max(viewHeight / 2, Math.min(size - viewHeight / 2, camera.y));
  return { x, y, zoom: camera.zoom };
}

export function panCamera(camera: Camera, dx: number, dy: number, viewHeight: number): Camera {
  return normalizeCamera({ x: camera.x - dx, y: camera.y - dy, zoom: camera.zoom }, viewHeight);
}

/** Zoom by whole steps, keeping the world point under view pixel (sx, sy) where it is. */
export function zoomCamera(camera: Camera, steps: number, sx: number, sy: number, width: number, height: number): Camera {
  const zoom = clampZoom(camera.zoom + steps);
  if (zoom === camera.zoom) return camera;
  const k = 2 ** (zoom - camera.zoom);
  const ox = sx - width / 2;
  const oy = sy - height / 2;
  return normalizeCamera({ x: (camera.x + ox) * k - ox, y: (camera.y + oy) * k - oy, zoom }, height);
}

/** The data zoom a display zoom draws from. */
export function dataZoom(zoom: number, maxZoom: number): number {
  return Math.max(0, Math.min(maxZoom, zoom - 1));
}

interface DrawnTile {
  pixels: Uint8Array;
  /** The data zoom it was drawn from; less than its own while that's loading. */
  from: number;
}

/** How far up to look for a coarser tile to stand in while one loads. */
const FALLBACK_LEVELS = 6;
/**
 * Each frame draws display tiles, nearest first, until this many
 * milliseconds are spent; the rest wait for the next frame, so a frame
 * after a zoom stays short and the map sharpens over a few.
 */
const TILE_BUDGET_MS = 6;
const DRAWN_CAPACITY = 96;
/** Labels kept, per data tile and display zoom. */
const LABEL_CAPACITY = 96;
/** Buildings kept, per data tile: the same at every zoom. */
const BUILDING_CAPACITY = 64;
/**
 * Buildings are joined into blocks for views this far out and further: closer,
 * a typical house is too big on the screen for a block to stand in for it.
 */
const BLOCKS_ZOOM = 16;
/** Below this tilt, the flat map dissolves in over the tilted view (and out, tilting up). */
const DISSOLVE_PITCH = (12 * Math.PI) / 180;

/** Bayer's 8 × 8 ordered-dither matrix: the order pixels change over in, scattered evenly. */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

/** Take `share` of 64 of `into`'s pixels from `from`, in ordered-dither order: a dissolve, part way. */
function dissolve(into: Uint8Array, from: Uint8Array, width: number, share: number): void {
  if (share <= 0) return;
  for (let i = 0, x = 0, y = 0; i < into.length; i++) {
    if (BAYER[((y & 7) << 3) | (x & 7)]! < share) into[i] = from[i]!;
    if (++x === width) {
      x = 0;
      y++;
    }
  }
}

/** The tilted view's ground is at most this many times the view's size each way. */
const GROUND_LIMIT = 4;

/** Where a point on the ground lands on the view, or `null` when it doesn't. */
type Place = (point: LatLon) => [number, number] | null;

/** A tilted view part drawn: its ground, and what's to go over it. */
interface Tilted {
  view: Perspective;
  z: number;
  cx: number;
  cy: number;
  flat: boolean;
  complete: boolean;
  sources: TileData[];
  /** No tile was joined into blocks this frame. */
  joined: boolean;
}

interface TileData {
  tile: VectorTile;
  z: number;
  x: number;
  y: number;
}

export class MapRenderer {
  private readonly drawn = new Map<string, DrawnTile>();
  private readonly labelCache = new Map<string, LabelCandidate[]>();
  private readonly buildingCache = new Map<string, Generalized & { joined: boolean }>();
  /** Tiles whose buildings are still to be joined into blocks, one a frame. */
  private toJoin: Array<{ key: string; data: TileData; extent: number }> = [];
  /** The flat map the tilted view lays on the ground, kept between frames. */
  private ground = new Bitmap(1, 1, undefined, true);
  /** The flat map's ground, as fills, before it's inked on the screen. */
  private flatGround = new Bitmap(1, 1, undefined, true);
  /** The flat map, drawn to dissolve into while the view is nearly flat. */
  private flatFrame = new Bitmap(1, 1);
  /** What the last frame showed that a click can pick, topmost first. */
  private hits: Array<{ box: Box; hit: MapHit }> = [];
  /**
   * What goes over the last frame drawn, bottom first, to be drawn with
   * QuickDraw (`drawMarks`) over the picture.
   */
  marks: readonly Mark[] = [];

  /** `now` is a clock in milliseconds, for keeping each frame's tile drawing short. */
  constructor(
    private readonly source: TileSource,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Draw the view into `frame`. Returns `false` when some tile still has
   * better data to be drawn from, and the caller should draw again soon.
   */
  render(frame: Bitmap, camera: Camera, overlays: MapOverlays): boolean {
    const pitch = overlays.pitch ?? 0;
    const bearing = overlays.bearing ?? 0;
    if (pitch === 0) return bearing !== 0 ? this.renderTilted(frame, camera, overlays, 0, bearing) : this.renderFlat(frame, camera, overlays);
    const tilted = this.renderTilted(frame, camera, overlays, pitch, bearing);
    if (pitch >= DISSOLVE_PITCH) return tilted;
    // Nearly flat: the flat map, with its footprints, labels and scale bar,
    // dissolves in as the tilt goes, rather than all arriving on the last frame.
    if (this.flatFrame.width !== frame.width || this.flatFrame.height !== frame.height) this.flatFrame = new Bitmap(frame.width, frame.height);
    const tiltedHits = this.hits;
    const tiltedMarks = this.marks;
    const flat = this.render(this.flatFrame, camera, { ...overlays, pitch: 0 });
    const share = Math.round((1 - pitch / DISSOLVE_PITCH) * 64);
    dissolve(frame.pixels, this.flatFrame.pixels, frame.width, share);
    // A click goes to what mostly shows.
    if (share < 32) {
      this.hits = tiltedHits;
      this.marks = tiltedMarks;
    }
    return tilted && flat;
  }

  private renderFlat(frame: Bitmap, camera: Camera, overlays: MapOverlays): boolean {
    const left = Math.round(camera.x - frame.width / 2);
    const top = Math.round(camera.y - frame.height / 2);
    // The map is drawn as fills and inked on the screen, as the tilted view
    // is: its patterns stay put as it pans, rather than a gray checker
    // turning over at every pixel it moves.
    if (this.flatGround.width !== frame.width || this.flatGround.height !== frame.height) {
      this.flatGround = new Bitmap(frame.width, frame.height, undefined, true);
    }
    const ground = this.flatGround;
    const { complete, sources } = this.drawGround(ground, camera.zoom, left, top);

    this.hits = [];
    const routes = overlays.routes ?? [];
    const selected = overlays.selectedRoute ?? 0;
    // The others first, so the selected route crosses over them.
    routes.forEach((route, index) => {
      if (index !== selected) drawRoute(ground, route.points, camera, left, top, GRAY);
    });
    const start = routes[selected] ? drawRoute(ground, routes[selected].points, camera, left, top, BLACK) : null;
    frame.pixels.set(ground.pixels);
    inkFills(frame.pixels, frame.width, flatFootprints());
    const size = worldSize(camera.zoom);
    const place: Place = (point) => {
      const at = project(point, camera.zoom);
      return [nearView(at.x - left, size, frame.width), at.y - top];
    };
    const furniture = [scaleBar(frame, camera, overlays.inset ?? 0), ...attribution(frame, this.source.pending > 0, overlays.corner ?? 0)];
    const view = { left, top, width: frame.width, height: frame.height, worldWidth: size };
    this.drawOver(frame, overlays, place, furniture, start, (reserved) => (overlays.labels ? this.labelsFlat(sources, camera.zoom, overlays.pin, { ...view, reserved }) : []));
    return complete;
  }

  /**
   * `render`, with the buildings of a tilted view drawn by the graphics
   * processor (`gpu`). Everything else is drawn as `render` draws it.
   */
  async renderWith(gpu: GpuBuildings, frame: Bitmap, camera: Camera, overlays: MapOverlays): Promise<boolean> {
    const pitch = overlays.pitch ?? 0;
    // Nearly flat, or zoomed out, there are no buildings, or hardly any.
    if (pitch < DISSOLVE_PITCH || camera.zoom < BUILDINGS_ZOOM) return this.render(frame, camera, overlays);
    const tilted = this.tiltedGround(frame, camera, overlays, pitch, overlays.bearing ?? 0);
    const { view, cx, cy } = tilted;
    const raised = this.buildingGroups(tilted);
    if (raised) inkBuildings(await gpu.draw(view, raised.groups, cx, cy, raised.pxPerMetre), frame);
    return this.finishTilted(frame, camera, overlays, tilted);
  }

  /**
   * The view tilted `pitch` and turned to `bearing`: the flat map of the ground the camera sees,
   * laid in perspective, buildings raised on it once close enough, and the
   * rest placed over it upright.
   */
  private renderTilted(frame: Bitmap, camera: Camera, overlays: MapOverlays, pitch: number, bearing: number): boolean {
    const tilted = this.tiltedGround(frame, camera, overlays, pitch, bearing);
    this.raiseBuildings(frame, tilted);
    return this.finishTilted(frame, camera, overlays, tilted);
  }

  /** The tilted view's ground, inked on `frame`. */
  private tiltedGround(frame: Bitmap, camera: Camera, overlays: MapOverlays, pitch: number, bearing: number): Tilted {
    const view = new Perspective(frame.width, frame.height, pitch, bearing, overlays.orthographic ?? false);
    const z = camera.zoom;
    const cx = Math.round(camera.x);
    const cy = Math.round(camera.y);
    let [x0, y0, x1, y1] = view.groundBox();
    // So near the horizon the ground runs far; past a few views' worth it's too small to see.
    x0 = Math.max(x0, -frame.width * GROUND_LIMIT);
    x1 = Math.min(x1, frame.width * GROUND_LIMIT);
    y0 = Math.max(y0, -frame.height * GROUND_LIMIT);
    if (this.ground.width !== x1 - x0 || this.ground.height !== y1 - y0) this.ground = new Bitmap(x1 - x0, y1 - y0, undefined, true);
    const left = cx + x0;
    const top = cy + y0;
    // The ground nearest the camera is drawn first, towards where it stands: it's what the view shows biggest.
    const [standX, standY] = view.camera();
    const { complete, sources } = this.drawGround(this.ground, z, left, top, cx - left + standX / 2, cy - top + standY / 2);

    // The routes lie on the ground, so they go down before it's tilted.
    const routes = overlays.routes ?? [];
    const selected = overlays.selectedRoute ?? 0;
    routes.forEach((route, index) => {
      if (index !== selected) drawRoute(this.ground, route.points, camera, left, top, GRAY);
    });
    if (routes[selected]) drawRoute(this.ground, routes[selected].points, camera, left, top, BLACK);
    view.warp(this.ground, x0, y0, frame);
    // Only now, on the screen, do the fills become their patterns. Turned
    // but not tilted, it's the flat map, footprints and all.
    const flat = pitch === 0;
    inkFills(frame.pixels, frame.width, flat ? flatFootprints() : undefined);
    return { view, z, cx, cy, flat, complete, sources, joined: true };
  }

  /** The buildings, raised on the ground. */
  private raiseBuildings(frame: Bitmap, tilted: Tilted): void {
    const raised = this.buildingGroups(tilted);
    if (raised) drawBuildings(frame, tilted.view, raised.groups, tilted.cx, tilted.cy, raised.pxPerMetre);
  }

  /** The tilted view's buildings, tile by tile, and map pixels a metre; `null` when none stand up. A tile waiting is joined into blocks. */
  private buildingGroups(tilted: Tilted): { groups: BuildingGroup[]; pxPerMetre: number } | null {
    const { z, cx, cy, flat, sources } = tilted;
    if (flat || z < BUILDINGS_ZOOM) return null;
    const groups = sources.map((data) => this.buildingsIn(data, z));
    tilted.joined = !this.joinOne();
    return { groups, pxPerMetre: 1 / metresPerPixel(unproject({ x: cx, y: cy }, z).lat, z) };
  }

  /** What goes over the tilted view, and whether it's all drawn. */
  private finishTilted(frame: Bitmap, camera: Camera, overlays: MapOverlays, tilted: Tilted): boolean {
    const { view, z, cx, cy, flat, complete, sources, joined } = tilted;
    this.hits = [];
    const place: Place = (point) => {
      const at = project(point, z);
      return view.project(at.x - cx, at.y - cy);
    };
    // Only a flat map, turned, has one scale all over for a scale bar.
    const furniture = [...(flat ? [scaleBar(frame, camera, overlays.inset ?? 0)] : []), ...attribution(frame, this.source.pending > 0, overlays.corner ?? 0)];
    this.drawOver(frame, overlays, place, furniture, null, (reserved) =>
      overlays.labels ? this.labelsTilted(sources, z, overlays.pin, view, cx, cy, frame, reserved, !flat) : [],
    );
    // A tile just joined into blocks is drawn so on the next frame.
    return complete && joined;
  }

  /**
   * What goes over the map, flat or tilted: the labels, placed around the
   * marks (the step marked, the results' letters, the pin and the routes'
   * times), which are laid out here and left in `marks` for QuickDraw to
   * draw over the picture; and the scale bar and the credit.
   */
  private drawOver(
    frame: Bitmap,
    overlays: MapOverlays,
    place: Place,
    furnished: ReadonlyArray<Furniture | null>,
    start: Box | null,
    labels: (reserved: Box[]) => PlacedText[],
  ): void {
    const furniture = furnished.filter((o) => o !== null);
    const reserved: Box[] = [...(overlays.covered ?? []), ...furniture.map((o) => o.box)];
    if (start) reserved.push(start);
    // The marks over the map, bottom first: the step, the results (the highlighted one on top), the pin, the routes' times (the selected one's on top).
    const marks: Array<{ mark: Mark; hit: MapHit | null }> = [];
    const stepAt = overlays.mark ? pixelAt(overlays.mark, place) : null;
    if (stepAt) marks.push({ mark: { type: "step", x: stepAt[0], y: stepAt[1] }, hit: null });
    const results = (overlays.results ?? []).map((point, index) => ({ point, index }));
    results.sort((a, b) => Number(a.index === overlays.highlighted) - Number(b.index === overlays.highlighted));
    for (const { point, index } of results) {
      const at = pixelAt(point, place);
      if (at) marks.push({ mark: { type: "badge", x: at[0], y: at[1], index, highlighted: index === overlays.highlighted }, hit: { type: "result", index } });
    }
    const pinPoint = overlays.pin;
    const pinAt = pinPoint ? pixelAt(pinPoint, place) : null;
    if (pinPoint && pinAt) {
      marks.push({ mark: { type: "pin", x: pinAt[0], y: pinAt[1] }, hit: { type: "place", name: pinPoint.name, kind: "pin", lat: pinPoint.lat, lon: pinPoint.lon } });
    }
    const routes = overlays.routes ?? [];
    const selected = overlays.selectedRoute ?? 0;
    const order = routes.map((_, index) => index).sort((a, b) => Number(a === selected) - Number(b === selected));
    for (const index of order) {
      const callout = routes[index]!.callout;
      const mark = callout ? calloutAt(callout.at, callout.text, index === selected, place) : null;
      if (mark) marks.push({ mark, hit: { type: "route", index } });
    }
    for (const { mark } of marks) reserved.push(markBox(mark));
    for (const label of labels(reserved)) {
      if (label.marker !== "none") drawMarker(frame, label.marker, label.anchorX, label.anchorY);
      drawLabel(frame, label.text, label.face, label.left, label.top, label.upright);
      if (label.hit) this.hits.push(label.hit);
    }
    // The topmost mark is hit first.
    for (const { mark, hit } of marks) if (hit) this.hits.unshift({ box: markBox(mark), hit });
    this.marks = marks.map(({ mark }) => mark);
    for (const o of furniture) o.draw(frame);
  }

  /**
   * The tiles under the view `frame` shows, its top-left at world pixel
   * (left, top): drawn from the best data at hand, the better data asked for.
   */
  private drawGround(frame: Bitmap, z: number, left: number, top: number, focusX = frame.width / 2, focusY = frame.height / 2): { complete: boolean; sources: TileData[] } {
    const { width, height } = frame;
    const tiles = 2 ** z;
    const d = dataZoom(z, this.source.maxZoom);
    const shift = z - d;

    frame.pixels.fill(0);
    const wanted = new Map<string, TileAddress & { distance: number }>();
    const sources = new Map<string, { tile: VectorTile; z: number; x: number; y: number }>();
    let complete = true;
    const cache = this.drawn;
    /** Display tiles on the view, and those to draw (again) from better data, by how near the focus they are. */
    const cells: Array<{ key: string; col: number; row: number }> = [];
    const toDraw: Array<{ tx: number; row: number; best: TileData; distance: number }> = [];

    const firstRow = Math.max(0, Math.floor(top / TILE_SIZE));
    const lastRow = Math.min(tiles - 1, Math.floor((top + height - 1) / TILE_SIZE));
    const firstCol = Math.floor(left / TILE_SIZE);
    const lastCol = Math.floor((left + width - 1) / TILE_SIZE);
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        const tx = ((col % tiles) + tiles) % tiles;
        const want = { z: d, x: tx >> shift, y: row >> shift };
        const wantKey = tileKey(want.z, want.x, want.y);
        const cx = (col + 0.5) * TILE_SIZE - left - width / 2;
        const cy = (row + 0.5) * TILE_SIZE - top - height / 2;
        const distance = Math.hypot(cx, cy);
        const known = wanted.get(wantKey);
        if (!known || distance < known.distance) wanted.set(wantKey, { ...want, distance });

        const best = this.bestData(z, d, tx, row);
        if (best) sources.set(tileKey(best.z, best.x, best.y), best);
        const key = tileKey(z, tx, row);
        cells.push({ key, col, row });
        const tile = cache.get(key);
        if (best && (!tile || tile.from < best.z)) {
          const near = Math.hypot((col + 0.5) * TILE_SIZE - left - focusX, (row + 0.5) * TILE_SIZE - top - focusY);
          toDraw.push({ tx, row, best, distance: near });
        }
        if (best && best.z < d) complete = false;
      }
    }
    toDraw.sort((a, b) => a.distance - b.distance);
    const started = this.now();
    for (const [k, task] of toDraw.entries()) {
      if (k > 0 && this.now() - started > TILE_BUDGET_MS) {
        complete = false;
        break;
      }
      this.drawTile(z, task.tx, task.row, task.best);
    }
    for (const cell of cells) {
      const tile = cache.get(cell.key);
      if (tile) blit(frame, tile.pixels, cell.col * TILE_SIZE - left, cell.row * TILE_SIZE - top);
    }
    this.source.want([...wanted.values()].sort((a, b) => a.distance - b.distance));
    return { complete, sources: [...sources.values()] };
  }


  /** What the last frame drew at view pixel (x, y) that a click can pick. */
  hitTest(x: number, y: number): MapHit | null {
    const slop = 2;
    for (const { box, hit } of this.hits) {
      if (x >= box[0] - slop && x < box[2] + slop && y >= box[1] - slop && y < box[3] + slop) return hit;
    }
    return null;
  }

  /** The finest tile here for display tile (z, x, y): its own data zoom, or coarser. */
  private bestData(z: number, d: number, x: number, y: number): { tile: VectorTile; z: number; x: number; y: number } | null {
    for (let level = d; level >= Math.max(0, d - FALLBACK_LEVELS); level--) {
      const shift = z - level;
      const tile = this.source.get(level, x >> shift, y >> shift);
      if (tile) return { tile, z: level, x: x >> shift, y: y >> shift };
    }
    return null;
  }

  private drawTile(z: number, x: number, y: number, data: { tile: VectorTile; z: number; x: number; y: number }): DrawnTile {
    const target = new Bitmap(TILE_SIZE, TILE_SIZE, undefined, true);
    const span = TILE_SIZE * 2 ** (z - data.z);
    const extent = data.tile.values().next().value?.extent ?? 4096;
    drawTile(target, data.tile, z, {
      scale: span / extent,
      offsetX: data.x * span - x * TILE_SIZE,
      offsetY: data.y * span - y * TILE_SIZE,
    });
    const drawn = { pixels: target.pixels, from: data.z };
    const key = tileKey(z, x, y);
    const cache = this.drawn;
    cache.delete(key);
    cache.set(key, drawn);
    while (cache.size > DRAWN_CAPACITY) cache.delete(cache.keys().next().value!);
    return drawn;
  }

  /**
   * The buildings in a data tile, placed for display zoom `z`. They're
   * read from the tile once, in its own units, and kept for every zoom.
   */
  private buildingsIn(data: TileData, z: number): BuildingGroup {
    const key = tileKey(data.z, data.x, data.y);
    const extent = data.tile.get("building")?.extent ?? 4096;
    let found = this.buildingCache.get(key);
    if (found) {
      // Recently used, so kept longest.
      this.buildingCache.delete(key);
    } else {
      // Read once per tile, as they are; joined into blocks a frame or so later (`generalizeOne`).
      found = { singles: collectBuildings(data.tile), blocks: [], joined: false };
    }
    if (!found.joined && z <= BLOCKS_ZOOM && !this.toJoin.some((t) => t.key === key)) this.toJoin.push({ key, data, extent });
    this.buildingCache.set(key, found);
    while (this.buildingCache.size > BUILDING_CAPACITY) this.buildingCache.delete(this.buildingCache.keys().next().value!);
    const span = TILE_SIZE * 2 ** (z - data.z);
    return { buildings: found.singles, blocks: found.blocks, scale: span / extent, x: data.x * span, y: data.y * span };
  }

  /**
   * Join one tile's buildings into blocks, if any are waiting: a few tens
   * of milliseconds for a dense city tile, so one a frame, after it's drawn.
   * Whether one was joined.
   */
  private joinOne(): boolean {
    while (this.toJoin.length) {
      const { key, data, extent } = this.toJoin.shift()!;
      const found = this.buildingCache.get(key);
      if (!found || found.joined) continue;
      const middle = unproject({ x: (data.x + 0.5) * TILE_SIZE, y: (data.y + 0.5) * TILE_SIZE }, data.z);
      const unitsPerMetre = extent / (metresPerPixel(middle.lat, data.z) * TILE_SIZE);
      this.buildingCache.set(key, { ...generalize(found.singles, unitsPerMetre, extent), joined: true });
      return true;
    }
    return false;
  }

  /** Every label the tiles offer at display zoom `z`, in world pixels. */
  private candidates(sources: readonly TileData[], z: number): LabelCandidate[] {
    const candidates: LabelCandidate[] = [];
    for (const data of sources) {
      const key = `${z}|${tileKey(data.z, data.x, data.y)}`;
      let found = this.labelCache.get(key);
      if (!found) {
        const span = TILE_SIZE * 2 ** (z - data.z);
        const extent = data.tile.values().next().value?.extent ?? 4096;
        found = collectLabels(data.tile, z, { scale: span / extent, originX: data.x * span, originY: data.y * span }, labelSize, printable);
        this.labelCache.set(key, found);
        while (this.labelCache.size > LABEL_CAPACITY) this.labelCache.delete(this.labelCache.keys().next().value!);
      }
      candidates.push(...found);
    }
    return candidates;
  }

  /** The labels of the flat map, placed in world pixels. */
  private labelsFlat(sources: readonly TileData[], z: number, pin: Pin | null, view: LabelView): PlacedText[] {
    const candidates = this.candidates(sources, z);
    if (pin) {
      const at = project(pin, z);
      const label = pinLabel(pin, at.x, at.y);
      if (label) candidates.push(label);
    }
    return placeLabels(candidates, view, labelSize).map((label) => placed(label, (c) => unproject({ x: c.x, y: c.y }, z)));
  }

  /**
   * The labels of the tilted view: each where its point lands, upright, the
   * nearest first. A street name can't lie along its street here, so only
   * the ones along level stretches stay.
   */
  private labelsTilted(
    sources: readonly TileData[],
    z: number,
    pin: Pin | null,
    view: Perspective,
    cx: number,
    cy: number,
    frame: Bitmap,
    reserved: Box[],
    standing: boolean,
  ): PlacedText[] {
    const world = new Map<LabelCandidate, LatLon>();
    const candidates: LabelCandidate[] = [];
    for (const c of this.candidates(sources, z)) {
      // Shops and cafés would crowd standing buildings; places and streets stay.
      if (c.upright || (standing && c.marker === "poi")) continue;
      const at = view.project(c.x - cx, c.y - cy);
      if (!at) continue;
      const moved = { ...c, x: at[0], y: at[1] };
      world.set(moved, unproject({ x: c.x, y: c.y }, z));
      candidates.push(moved);
    }
    if (pin) {
      const ground = project(pin, z);
      const at = view.project(ground.x - cx, ground.y - cy);
      const label = at ? pinLabel(pin, at[0], at[1]) : null;
      if (label) {
        world.set(label, pin);
        candidates.push(label);
      }
    }
    const placedLabels = placeLabels(candidates, { left: 0, top: 0, width: frame.width, height: frame.height, worldWidth: 0, reserved }, labelSize);
    return placedLabels.map((label) => placed(label, (c) => world.get(c)!));
  }
}

/** A label as placed, ready to draw, and what a click on it opens. */
interface PlacedText {
  text: string;
  face: LabelFace;
  left: number;
  top: number;
  upright: boolean;
  marker: Marker;
  anchorX: number;
  anchorY: number;
  hit: { box: Box; hit: MapHit } | null;
}

function placed(label: PlacedLabel, where: (c: LabelCandidate) => LatLon): PlacedText {
  const c = label.candidate;
  let hit: PlacedText["hit"] = null;
  if (c.kind) {
    const [w, h] = labelSize(c.text, c.face);
    const right = label.left + (c.upright ? h : w);
    const bottom = label.top + (c.upright ? w : h);
    const x0 = c.beside ? Math.min(label.left, label.anchorX - 4) : label.left;
    const at = where(c);
    hit = { box: [x0, label.top, right, bottom], hit: { type: "place", name: c.text, kind: c.kind, lat: at.lat, lon: at.lon } };
  }
  return { text: c.text, face: c.face, left: label.left, top: label.top, upright: c.upright, marker: c.marker, anchorX: label.anchorX, anchorY: label.anchorY, hit };
}

/** The pin's name, right of its head, which stands above the point (x, y) it marks. */
function pinLabel(pin: Pin, x: number, y: number): LabelCandidate | null {
  const text = printable(pin.name, PIN_FACE);
  if (!text) return null;
  const [w] = labelSize(text, PIN_FACE);
  return { text, face: PIN_FACE, x: x + PIN_HALF + LABEL_PADDING + 2 + w / 2, y: y - PIN_HEAD, priority: -1, marker: "none", upright: false, beside: false, kind: "pin" };
}

const PIN_FACE: LabelFace = { font: spacedFontName("menu", 1) };

function blit(frame: Bitmap, pixels: Uint8Array, x: number, y: number): void {
  const x0 = Math.max(0, x);
  const x1 = Math.min(frame.width, x + TILE_SIZE);
  if (x0 >= x1) return;
  for (let row = Math.max(0, y); row < Math.min(frame.height, y + TILE_SIZE); row++) {
    const from = (row - y) * TILE_SIZE + (x0 - x);
    frame.pixels.set(pixels.subarray(from, from + (x1 - x0)), row * frame.width + x0);
  }
}

function drawMarker(frame: Bitmap, marker: Marker, x: number, y: number): void {
  const cx = x + 0.5;
  const cy = y + 0.5;
  switch (marker) {
    case "capital":
      frame.disc(cx, cy, 4.5, WHITE);
      frame.disc(cx, cy, 3.5, BLACK);
      frame.disc(cx, cy, 2.5, WHITE);
      frame.disc(cx, cy, 1.5, BLACK);
      break;
    case "town":
      frame.disc(cx, cy, 3.5, WHITE);
      frame.disc(cx, cy, 2.5, BLACK);
      break;
    case "peak":
      frame.fillPath([cx, cx + 4.5, cx - 4.5], [cy - 4.5, cy + 3, cy + 3], [0, 3], WHITE);
      frame.fillPath([cx, cx + 3.5, cx - 3.5], [cy - 3, cy + 2, cy + 2], [0, 3], BLACK);
      break;
    case "poi":
      for (let row = y - 2; row <= y + 2; row++) frame.span(row, x - 2, x + 3, WHITE);
      for (let row = y - 1; row <= y + 1; row++) frame.span(row, x - 1, x + 2, BLACK);
      break;
  }
}

/** Something drawn into the map that labels keep clear of: the scale bar and the credit. */
interface Furniture {
  box: readonly [number, number, number, number];
  draw(frame: Bitmap): void;
}

/** `x` moved by whole worlds to be nearest the view `width` wide: the world repeats sideways. */
function nearView(x: number, size: number, width: number): number {
  if (x < -size / 2) x += size;
  if (x > width + size / 2) x -= size;
  return x;
}

/**
 * Draw `points` as a route in `paint`. A black route's start gets a ring;
 * its box is returned, for labels to keep clear of.
 */
function drawRoute(frame: Bitmap, points: readonly LatLon[], camera: Camera, left: number, top: number, paint: Paint): Box | null {
  if (points.length < 2) return null;
  const size = worldSize(camera.zoom);
  const first = project(points[0]!, camera.zoom);
  // The whole line moves with its start, so it doesn't break where it crosses the antimeridian.
  const shift = nearView(first.x - left, size, frame.width) - (first.x - left);
  const xs: number[] = [];
  const ys: number[] = [];
  let lastX = Infinity;
  let lastY = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = project(points[i]!, camera.zoom);
    let x = p.x - left + shift;
    // Keep the line continuous across the antimeridian.
    if (xs.length > 0) {
      const prev = xs[xs.length - 1]!;
      if (x - prev > size / 2) x -= size;
      else if (prev - x > size / 2) x += size;
    }
    const y = p.y - top;
    // Points closer than a pixel add nothing at this zoom, only joints to draw.
    if (i < points.length - 1 && Math.abs(x - lastX) < 1 && Math.abs(y - lastY) < 1) continue;
    xs.push(x);
    ys.push(y);
    lastX = x;
    lastY = y;
  }
  frame.stroke(xs, ys, 0, xs.length, ROUTE_CASING, WHITE);
  frame.stroke(xs, ys, 0, xs.length, ROUTE_WIDTH, paint);
  if (paint !== BLACK) return null;
  const sx = Math.round(xs[0]!) + 0.5;
  const sy = Math.round(ys[0]!) + 0.5;
  frame.disc(sx, sy, START_RING + 1, WHITE);
  frame.disc(sx, sy, START_RING, BLACK);
  frame.disc(sx, sy, START_RING - 2, WHITE);
  return [sx - START_RING - 1, sy - START_RING - 1, sx + START_RING + 1, sy + START_RING + 1];
}

/**
 * A route's time in a box over the route, black for the selected route:
 * laid out here, drawn with QuickDraw (`marks.ts`).
 */
function calloutAt(point: LatLon, text: string, selected: boolean, place: Place): Mark | null {
  const at = place(point);
  if (!at) return null;
  const [w, h] = labelSize(text, CALLOUT_FACE);
  return { type: "callout", x: Math.round(at[0]), y: Math.round(at[1]), text, selected, width: w + 4, height: h };
}

/** Where a point lands, to the pixel; `null` when it doesn't. */
function pixelAt(point: LatLon, place: Place): [number, number] | null {
  const at = place(point);
  return at && [Math.round(at[0]), Math.round(at[1])];
}

const SMALL: LabelFace = { font: "body" };
const SCALE_STEPS = [1, 2, 5];

/** The longest round distance whose bar fits in `maxWidth` pixels, and that bar's width. */
export function scaleBarLength(metresPerPx: number, maxWidth: number): { metres: number; width: number } {
  let best = { metres: 1, width: 1 / metresPerPx };
  for (let power = 0; power <= 7; power++) {
    for (const stepSize of SCALE_STEPS) {
      const metres = stepSize * 10 ** power;
      const width = metres / metresPerPx;
      if (width <= maxWidth) best = { metres, width };
    }
  }
  return best;
}

export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
}

function scaleBar(frame: Bitmap, camera: Camera, inset: number): Furniture | null {
  if (frame.width - inset < 140 || frame.height < 60) return null;
  const centre = cameraCentre(camera);
  const { metres, width } = scaleBarLength(metresPerPixel(centre.lat, camera.zoom), 70);
  const text = formatDistance(metres);
  const [textW, textH] = labelSize(text, SMALL);
  const bar = Math.round(width);
  const x = inset + 6;
  const y = frame.height - 7;
  const textX = x + bar + 3;
  const textY = y - textH + 3;
  return {
    box: [x - 1, Math.min(y - 3, textY), textX + textW, frame.height],
    draw(target) {
      for (let row = y - 3; row <= y + 2; row++) target.span(row, x - 1, x + bar + 2, WHITE);
      target.span(y, x, x + bar + 1, BLACK);
      for (let row = y - 3; row <= y; row++) {
        target.plot(x, row, BLACK);
        target.plot(x + bar, row, BLACK);
      }
      drawLabel(target, text, SMALL, textX, textY);
    },
  };
}

const ATTRIBUTION = "© OpenStreetMap";
const LOADING = "Loading…";

/** The credit OpenStreetMap's licence asks for, and a note while tiles load. */
function attribution(frame: Bitmap, loading: boolean, corner: number): Furniture[] {
  const notes: Furniture[] = [];
  const note = (text: string, x: number, y: number, w: number, h: number): Furniture => ({
    box: [x, y, x + w, y + h],
    draw: (target) => drawLabel(target, text, SMALL, x, y),
  });
  const [w, h] = labelSize(ATTRIBUTION, SMALL);
  notes.push(note(ATTRIBUTION, frame.width - corner - w - 2, frame.height - h - 1, w, h));
  if (loading) {
    const [lw, lh] = labelSize(LOADING, SMALL);
    notes.push(note(LOADING, frame.width - lw - 2, 1, lw, lh));
  }
  return notes;
}
