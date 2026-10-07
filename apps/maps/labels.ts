/**
 * What the map names, and where: candidates gathered from each tile's
 * label layers (places, water, peaks, airports, points of interest, streets),
 * then placed most important first, each where it doesn't collide with one
 * already down. Street names go along straight stretches of road that run
 * east–west, or north–south turned to read upwards; a 1-bit bitmap font
 * can't follow a curve.
 */
import type { TileFeature, VectorTile } from "./mvt";
import type { LabelFace } from "./text";
import { spacedFontName } from "@mockintosh/ui";

export type Marker = "none" | "town" | "capital" | "peak" | "poi";

export interface LabelCandidate {
  text: string;
  face: LabelFace;
  /** The anchor, in world pixels at the display zoom. */
  x: number;
  y: number;
  /** Lower goes down first. */
  priority: number;
  marker: Marker;
  /** Turned a quarter, reading upwards: a north–south street. */
  upright: boolean;
  /** Drawn beside a marker rather than centred on the anchor. */
  beside: boolean;
  /** What the label names, when a click on it should open the place: "city", "golf_course". */
  kind?: string;
}

/** Where a data tile's units land in world pixels: world = origin + unit × scale. */
export interface LabelPlacement {
  scale: number;
  originX: number;
  originY: number;
}

/** How big a label's box is, halo included: `[width, height]` as it reads. */
export type MeasureLabel = (text: string, face: LabelFace) => [number, number];
/** `text` as `face` can draw it, or `null`. */
export type PrintableText = (text: string, face: LabelFace) => string | null;

// Weight comes from the faces themselves (Chicago, Geneva at 12 and 9),
// never from the Font Manager's bold smear.
const BODY: LabelFace = { font: "body" };
const LARGE: LabelFace = { font: "geneva12" };
const CHICAGO: LabelFace = { font: spacedFontName("menu", 1) };
const CAPS: LabelFace = { font: "body", upper: true, tracking: 1 };
/** Water and islands: New York, the Mac's serif, set apart from Geneva's land names without a slanted smear. */
const WATER: LabelFace = { font: "newYork", size: 9 };

/**
 * Which of a feature's names to show, in order: English, as the search
 * results are, then the Latin-script forms, then the name on the ground.
 */
const NAME_KEYS = ["name_en", "name:latin", "name_int", "name"] as const;

/** The first of the feature's names that `face` can draw, or `null`. */
function labelName(f: TileFeature, face: LabelFace, printable: PrintableText): string | null {
  for (const key of NAME_KEYS) {
    const value = f.get(key);
    if (typeof value !== "string" || !value.trim()) continue;
    const text = printable(value.trim(), face);
    if (text) return text;
  }
  return null;
}

function rank(f: TileFeature): number {
  const value = f.get("rank");
  return typeof value === "number" ? Math.min(value, 30) : 15;
}

interface PlaceStyle {
  face: LabelFace;
  priority: number;
  marker: Marker;
}

function placeStyle(f: TileFeature, zoom: number): PlaceStyle | null {
  const cls = f.get("class");
  const r = rank(f);
  const dots = zoom <= 10;
  switch (cls) {
    case "continent":
      return zoom <= 2 ? { face: CAPS, priority: 0, marker: "none" } : null;
    case "country":
      return zoom <= 8 ? { face: zoom <= 4 ? CAPS : { ...CAPS, font: "geneva12" }, priority: 1 + r, marker: "none" } : null;
    case "state":
    case "province":
      return zoom >= 5 && zoom <= 9 ? { face: CAPS, priority: 40 + r, marker: "none" } : null;
    case "city": {
      const capital = f.get("capital") === 2;
      return {
        face: r <= 4 || capital ? CHICAGO : LARGE,
        priority: (capital ? 4 : 10) + r,
        marker: dots ? (capital ? "capital" : "town") : "none",
      };
    }
    case "town":
      return { face: zoom >= 12 ? LARGE : BODY, priority: 30 + r, marker: dots ? "town" : "none" };
    case "village":
      return zoom >= 10 ? { face: BODY, priority: 45 + r, marker: zoom <= 11 ? "town" : "none" } : null;
    case "suburb":
    case "quarter":
      return zoom >= 12 ? { face: CAPS, priority: 35 + r, marker: "none" } : null;
    case "neighbourhood":
    case "hamlet":
    case "locality":
    case "isolated_dwelling":
      return zoom >= 14 ? { face: BODY, priority: 60 + r, marker: "none" } : null;
    case "island":
      return zoom >= 9 ? { face: WATER, priority: 50 + r, marker: "none" } : null;
    default:
      return null;
  }
}

/** Road classes whose names show, and the zoom they show from. */
const STREET_ZOOM: Readonly<Record<string, number>> = {
  motorway: 13, trunk: 13, primary: 14, secondary: 14, tertiary: 15, minor: 16, service: 17,
};
const STREET_PRIORITY: Readonly<Record<string, number>> = {
  motorway: 62, trunk: 62, primary: 64, secondary: 66, tertiary: 68, minor: 72, service: 76,
};
/** How far from level a stretch may wander and still carry a name. */
const STRAIGHT = (14 * Math.PI) / 180;

/**
 * The label candidates in one data tile, at display zoom `zoom`. `measure`
 * sizes street names, which need a straight stretch at least as long.
 */
export function collectLabels(
  tile: VectorTile,
  zoom: number,
  place: LabelPlacement,
  measure: MeasureLabel,
  printable: PrintableText,
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const at = (f: TileFeature): [number, number] | null => {
    const g = f.geometry();
    if (g.coords.length < 2) return null;
    return [place.originX + g.coords[0]! * place.scale, place.originY + g.coords[1]! * place.scale];
  };
  const add = (f: TileFeature, face: LabelFace, priority: number, marker: Marker, kind: string) => {
    if (f.type !== 1) return;
    const text = labelName(f, face, printable);
    const point = at(f);
    if (!text || !point) return;
    out.push({ text, face, x: point[0], y: point[1], priority, marker, upright: false, beside: marker !== "none", kind });
  };
  const kindOf = (f: TileFeature, fallback: string) => String(f.get("subclass") || f.get("class") || fallback);

  for (const f of tile.get("place")?.features ?? []) {
    const style = placeStyle(f, zoom);
    if (style) add(f, style.face, style.priority, style.marker, kindOf(f, "place"));
  }
  for (const f of tile.get("water_name")?.features ?? []) {
    const cls = f.get("class");
    const big = cls === "ocean" || cls === "sea";
    if (big || zoom >= 8) add(f, big ? { ...WATER, upper: true, tracking: 1 } : WATER, big ? 20 : 50, "none", kindOf(f, "water"));
  }
  if (zoom >= 12) {
    for (const f of tile.get("mountain_peak")?.features ?? []) add(f, BODY, 70 + rank(f), "peak", "peak");
    for (const f of tile.get("aerodrome_label")?.features ?? []) add(f, BODY, 55, "none", "airport");
  }
  if (zoom >= 15) {
    // The tile ranks its points of interest, most notable first.
    const most = zoom >= 17 ? Infinity : zoom === 16 ? 12 : 4;
    for (const f of tile.get("poi")?.features ?? []) {
      const r = rank(f);
      if (r <= most) add(f, BODY, 80 + r, "poi", kindOf(f, "place"));
    }
  }
  for (const f of tile.get("transportation_name")?.features ?? []) {
    if (f.type !== 2) continue;
    const cls = String(f.get("class") ?? "");
    const from = STREET_ZOOM[cls];
    if (from === undefined || zoom < from) continue;
    const ref = f.get("ref");
    const text = labelName(f, BODY, printable) ?? (zoom <= 14 && typeof ref === "string" ? printable(ref, BODY) : null);
    if (!text) continue;
    for (const spot of straightStretches(f, place, measure(text, BODY)[0] + 6)) {
      out.push({ text, face: BODY, x: spot.x, y: spot.y, priority: STREET_PRIORITY[cls]!, marker: "none", upright: spot.upright, beside: false, kind: "street" });
    }
  }
  return out;
}

/** Along a long stretch, a name is offered this often, so some copy is on screen. */
const STREET_REPEAT = 200;

/**
 * Spots for a street name: the middle of every stretch of the line at least
 * `length` pixels long that runs within `STRAIGHT` of level or of plumb, and
 * more along a long one. Placing keeps one per `REPEAT_DISTANCE`.
 */
export function straightStretches(
  f: TileFeature,
  place: LabelPlacement,
  length: number,
): Array<{ x: number; y: number; upright: boolean }> {
  const g = f.geometry();
  const spots: Array<{ x: number; y: number; upright: boolean }> = [];
  const px = (i: number) => place.originX + g.coords[2 * i]! * place.scale;
  const py = (i: number) => place.originY + g.coords[2 * i + 1]! * place.scale;
  for (let p = 0; p + 1 < g.parts.length; p++) {
    const start = g.parts[p]!;
    const end = g.parts[p + 1]!;
    let runStart = start;
    let runAngle = NaN;
    const finish = (runEnd: number) => {
      if (runEnd <= runStart || Number.isNaN(runAngle)) return;
      const ax = px(runStart), ay = py(runStart), bx = px(runEnd), by = py(runEnd);
      const run = Math.hypot(bx - ax, by - ay);
      const level = Math.abs(Math.sin(runAngle)) < Math.sin(STRAIGHT);
      const plumb = Math.abs(Math.cos(runAngle)) < Math.sin(STRAIGHT);
      if (run < length || !(level || plumb)) return;
      // Spots spaced along the stretch, centred on it, each with room for the name.
      const count = Math.max(1, Math.floor((run - length) / STREET_REPEAT) + 1);
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        spots.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, upright: plumb });
      }
    };
    for (let i = start; i + 1 < end; i++) {
      const angle = Math.atan2(py(i + 1) - py(i), px(i + 1) - px(i));
      if (Number.isNaN(runAngle)) {
        runAngle = angle;
        continue;
      }
      const turn = Math.abs(Math.atan2(Math.sin(angle - runAngle), Math.cos(angle - runAngle)));
      if (turn > STRAIGHT / 2) {
        finish(i);
        runStart = i;
        runAngle = angle;
      }
    }
    finish(end - 1);
  }
  return spots;
}

export interface PlacedLabel {
  candidate: LabelCandidate;
  /** The text box's top-left on the view. */
  left: number;
  top: number;
  /** The anchor on the view, where a marker goes. */
  anchorX: number;
  anchorY: number;
}

export interface LabelView {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The world's width at this zoom, for anchors across the antimeridian. */
  worldWidth: number;
  /** Boxes on the view labels keep out of, `[x0, y0, x1, y1]`: the scale bar, the attribution. */
  reserved?: ReadonlyArray<readonly [number, number, number, number]>;
}

/** Space kept clear around each label so the map shows between them. */
export const LABEL_PADDING = 3;
/** Repeats of the same street name closer than this are dropped. */
const REPEAT_DISTANCE = 160;
const MARKER_RADIUS = 3;
const MARKER_GAP = 3;

/**
 * Place labels most important first, skipping any that would overlap one
 * already placed or run off the view.
 */
export function placeLabels(candidates: readonly LabelCandidate[], view: LabelView, measure: MeasureLabel): PlacedLabel[] {
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority || a.y - b.y || a.x - b.x);
  const boxes: number[] = (view.reserved ?? []).flat();
  const placed: PlacedLabel[] = [];
  const seen = new Map<string, Array<[number, number]>>();
  for (const c of sorted) {
    let ax = c.x - view.left;
    if (view.worldWidth > 0) {
      while (ax < -view.worldWidth / 2) ax += view.worldWidth;
      while (ax > view.width + view.worldWidth / 2) ax -= view.worldWidth;
    }
    const ay = c.y - view.top;
    if (ax < 0 || ay < 0 || ax >= view.width || ay >= view.height) continue;

    const repeats = seen.get(c.text);
    if (repeats?.some(([x, y]) => Math.hypot(x - ax, y - ay) < (c.marker === "none" ? REPEAT_DISTANCE : 2))) continue;

    const [w, h] = measure(c.text, c.face);
    const boxW = c.upright ? h : w;
    const boxH = c.upright ? w : h;
    let left: number;
    let top: number;
    let x0: number;
    if (c.beside) {
      left = Math.round(ax + MARKER_RADIUS + MARKER_GAP - 1);
      top = Math.round(ay - boxH / 2);
      x0 = Math.round(ax - MARKER_RADIUS - 1);
    } else {
      left = Math.round(ax - boxW / 2);
      top = Math.round(ay - boxH / 2);
      x0 = left;
    }
    const x1 = left + boxW;
    const y1 = top + boxH;
    if (x0 < 0 || top < 0 || x1 > view.width || y1 > view.height) continue;
    if (collides(boxes, x0 - LABEL_PADDING, top - LABEL_PADDING, x1 + LABEL_PADDING, y1 + LABEL_PADDING)) continue;

    boxes.push(x0, top, x1, y1);
    placed.push({ candidate: c, left, top, anchorX: Math.round(ax), anchorY: Math.round(ay) });
    if (repeats) repeats.push([ax, ay]);
    else seen.set(c.text, [[ax, ay]]);
  }
  return placed;
}

function collides(boxes: readonly number[], x0: number, y0: number, x1: number, y1: number): boolean {
  for (let i = 0; i < boxes.length; i += 4) {
    if (x0 < boxes[i + 2]! && x1 > boxes[i]! && y0 < boxes[i + 3]! && y1 > boxes[i + 1]!) return true;
  }
  return false;
}
