/**
 * A geometric monoline display face, drawn as strokes rather than pixels so
 * it can be written on, zoomed through and extruded at any size. Glyphs sit
 * on a 10-unit cap height with y growing down (0 = cap line, 10 = baseline).
 */
import type { Painter, Vec } from "./painter";

export type Stroke = readonly Vec[];

interface Glyph {
  width: number;
  strokes: readonly Stroke[];
}

const p = (x: number, y: number): Vec => ({ x, y });

/** A polyline through `[x, y]` pairs. */
function L(...pairs: [number, number][]): Vec[] {
  return pairs.map(([x, y]) => p(x, y));
}

/** An elliptical arc from `a0` to `a1` degrees (0 = right, 90 = down). */
function A(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Vec[] {
  // Fine enough that the camera can fly into a letter without seeing facets.
  const steps = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 3));
  const out: Vec[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = ((a0 + ((a1 - a0) * k) / steps) * Math.PI) / 180;
    out.push(p(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
  }
  return out;
}

/** Join pieces into one continuous stroke. */
function J(...parts: Vec[][]): Vec[] {
  return parts.flat();
}

const P_BOWL = J(L([0, 10], [0, 0], [3.5, 0]), A(3.5, 2.75, 2.75, 2.75, -90, 90), L([3.5, 5.5], [0, 5.5]));

const GLYPHS: Record<string, Glyph> = {
  A: { width: 8, strokes: [L([0, 10], [4, 0], [8, 10]), L([1.6, 6.5], [6.4, 6.5])] },
  B: {
    width: 7,
    strokes: [
      J(L([0, 5], [0, 0], [3.5, 0]), A(3.5, 2.5, 2.5, 2.5, -90, 90), L([3.5, 5], [0, 5])),
      J(L([0, 5], [4, 5]), A(4, 7.5, 2.75, 2.5, -90, 90), L([4, 10], [0, 10], [0, 5])),
    ],
  },
  C: { width: 9, strokes: [A(5, 5, 5, 5, -45, -315)] },
  D: { width: 8.5, strokes: [J(L([0, 0], [0, 10], [3.5, 10]), A(3.5, 5, 5, 5, 90, -90), L([3.5, 0], [0, 0]))] },
  E: { width: 7, strokes: [L([7, 0], [0, 0], [0, 10], [7, 10]), L([0, 5], [5.5, 5])] },
  F: { width: 7, strokes: [L([7, 0], [0, 0], [0, 10]), L([0, 5], [5.5, 5])] },
  G: { width: 10, strokes: [J(A(5, 5, 5, 5, -45, -360), L([10, 5], [5.5, 5]))] },
  H: { width: 8, strokes: [L([0, 0], [0, 10]), L([8, 0], [8, 10]), L([0, 5], [8, 5])] },
  I: { width: 0, strokes: [L([0, 0], [0, 10])] },
  J: { width: 5.5, strokes: [J(L([5.5, 0], [5.5, 7.25]), A(2.75, 7.25, 2.75, 2.75, 0, 180))] },
  K: { width: 7.5, strokes: [L([0, 0], [0, 10]), L([7, 0], [0, 7]), L([2.6, 4.4], [7.5, 10])] },
  L: { width: 6, strokes: [L([0, 0], [0, 10], [6, 10])] },
  M: { width: 10, strokes: [L([0, 10], [0, 0], [5, 8], [10, 0], [10, 10])] },
  N: { width: 8, strokes: [L([0, 10], [0, 0], [8, 10], [8, 0])] },
  O: { width: 10, strokes: [A(5, 5, 5, 5, -90, 270)] },
  P: { width: 6.25, strokes: [P_BOWL] },
  Q: { width: 10.5, strokes: [A(5, 5, 5, 5, -90, 270), L([6.5, 6.5], [10.5, 10.5])] },
  R: { width: 7, strokes: [P_BOWL, L([3.5, 5.5], [7, 10])] },
  S: { width: 7, strokes: [J(A(3.5, 2.5, 3.5, 2.5, -20, -270), A(3.5, 7.5, 3.5, 2.5, -90, 160))] },
  T: { width: 8, strokes: [L([0, 0], [8, 0]), L([4, 0], [4, 10])] },
  U: { width: 8, strokes: [J(L([0, 0], [0, 6]), A(4, 6, 4, 4, 180, 0), L([8, 6], [8, 0]))] },
  V: { width: 8, strokes: [L([0, 0], [4, 10], [8, 0])] },
  W: { width: 11, strokes: [L([0, 0], [2.75, 10], [5.5, 2], [8.25, 10], [11, 0])] },
  X: { width: 8, strokes: [L([0, 0], [8, 10]), L([8, 0], [0, 10])] },
  Y: { width: 8, strokes: [L([0, 0], [4, 5], [8, 0]), L([4, 5], [4, 10])] },
  Z: { width: 8, strokes: [L([0, 0], [8, 0], [0, 10], [8, 10])] },
  "0": { width: 7, strokes: [A(3.5, 5, 3.5, 5, -90, 270)] },
  "1": { width: 3, strokes: [L([0, 2], [3, 0], [3, 10])] },
  "2": { width: 7, strokes: [J(A(3.5, 3.5, 3.5, 3.5, 180, 400), L([0, 10], [7, 10]))] },
  "3": { width: 7, strokes: [J(A(3.3, 2.6, 3.2, 2.6, -160, 90), A(3.5, 7.4, 3.5, 2.6, -90, 160))] },
  "4": { width: 8, strokes: [L([6, 10], [6, 0], [0, 7], [8, 7])] },
  "5": { width: 7, strokes: [L([6.5, 0], [1, 0], [0.5, 4.6]), A(3.5, 6.75, 3.5, 3.25, -150, 150)] },
  "6": { width: 7, strokes: [A(3.5, 6.5, 3.5, 3.5, -90, 270), L([0.3, 5.2], [4.5, 0])] },
  "7": { width: 7, strokes: [L([0, 0], [7, 0], [2.5, 10])] },
  "8": { width: 7, strokes: [A(3.5, 2.5, 3, 2.5, 90, 450), A(3.5, 7.25, 3.5, 2.75, -90, 270)] },
  "9": { width: 7, strokes: [A(3.5, 3.5, 3.5, 3.5, -90, 270), L([6.7, 4.8], [2.5, 10])] },
  "-": { width: 4, strokes: [L([0, 6], [4, 6])] },
  ".": { width: 0, strokes: [L([0, 10], [0, 10])] },
  "/": { width: 5, strokes: [L([0, 10], [5, 0])] },
  " ": { width: 4, strokes: [] },
};

/** One placed glyph: strokes in stage units, ready to draw. */
export interface PlacedGlyph {
  char: string;
  /** Left edge and advance of the glyph box, in stage units. */
  x: number;
  width: number;
  /** Visual centre, for per-letter transforms. */
  center: Vec;
  strokes: Stroke[];
}

export interface TextStyle {
  /** Cap height in stage units. */
  size: number;
  /** Extra space between glyph boxes, in cap-height tenths (default 3.2). */
  tracking?: number;
}

/**
 * Lay `text` out with its cap line at `top` and its box centred on `cx`
 * (or starting at `x` when `align` is "left").
 */
export function layoutText(
  text: string,
  style: TextStyle,
  at: { cx?: number; x?: number; top: number },
): PlacedGlyph[] {
  const u = style.size / 10;
  const tracking = style.tracking ?? 3.2;
  const chars = [...text.toUpperCase()].filter((ch) => GLYPHS[ch]);
  const total = chars.reduce((w, ch, k) => w + GLYPHS[ch]!.width + (k > 0 ? tracking : 0), 0) * u;
  let x = at.x ?? (at.cx ?? 0) - total / 2;
  return chars.map((char) => {
    const glyph = GLYPHS[char]!;
    const placed: PlacedGlyph = {
      char,
      x,
      width: glyph.width * u,
      center: { x: x + (glyph.width * u) / 2, y: at.top + style.size / 2 },
      strokes: glyph.strokes.map((stroke) => stroke.map((q) => ({ x: x + q.x * u, y: at.top + q.y * u }))),
    };
    x += (glyph.width + tracking) * u;
    return placed;
  });
}

export function strokeLength(stroke: Stroke): number {
  let total = 0;
  for (let k = 1; k < stroke.length; k++) total += Math.hypot(stroke[k]!.x - stroke[k - 1]!.x, stroke[k]!.y - stroke[k - 1]!.y);
  return total;
}

/** The first `fraction` of a stroke, by length: a pen writing it on. */
export function partialStroke(stroke: Stroke, fraction: number): Vec[] {
  if (fraction >= 1) return [...stroke];
  if (fraction <= 0 || stroke.length === 0) return [];
  let remaining = strokeLength(stroke) * fraction;
  const out: Vec[] = [stroke[0]!];
  for (let k = 1; k < stroke.length; k++) {
    const a = stroke[k - 1]!;
    const b = stroke[k]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= remaining) {
      const f = len > 0 ? remaining / len : 0;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      return out;
    }
    out.push(b);
    remaining -= len;
  }
  return out;
}

/** Map every point of a glyph's strokes. */
export function mapGlyph(glyph: PlacedGlyph, f: (q: Vec) => Vec): Stroke[] {
  return glyph.strokes.map((stroke) => stroke.map(f));
}

/** Draw strokes `width` wide, each written on to `fraction`. */
export function drawStrokes(painter: Painter, strokes: readonly Stroke[], width: number, fraction = 1): void {
  for (const stroke of strokes) {
    const part = fraction >= 1 ? stroke : partialStroke(stroke, fraction);
    if (part.length > 0) painter.stroke(part, width);
  }
}

/** Evenly spaced points along every stroke, `spacing` stage units apart. */
export function sampleStrokes(glyphs: readonly PlacedGlyph[], spacing: number): Vec[] {
  const out: Vec[] = [];
  for (const glyph of glyphs) {
    for (const stroke of glyph.strokes) {
      const len = strokeLength(stroke);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k <= n; k++) {
        const part = partialStroke(stroke, k / n);
        out.push(part[part.length - 1] ?? stroke[0]!);
      }
    }
  }
  return out;
}
