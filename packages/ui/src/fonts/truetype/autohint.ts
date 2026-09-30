/**
 * A small autohinter for 1-bit strikes, after FreeType's "autofit".
 *
 * It does not run the font's own TrueType instructions. Instead it measures
 * the design once per font (blue zones: baseline, x-height, cap height,
 * ascender, descender; standard stem widths) and, per glyph, finds
 * segments (flat runs and extrema of the outline), pairs them into stems,
 * and moves them onto whole pixels:
 *
 * - Y: segments inside a blue zone snap to the zone's rounded row, so every
 *   `x` and `o` share one x-height; overshoots collapse at small sizes.
 * - Both axes: a stem keeps a whole-pixel width, and stems that are the
 *   same in the design get the same width on screen.
 * - Untouched points follow their snapped neighbours on the contour, the
 *   way TrueType's IUP instruction interpolates.
 *
 * Output coordinates are pixels with y up and the baseline at 0.
 */

import type { OutlineGlyph, OutlinePoint, SfntFont } from "./sfnt";

type Axis = "x" | "y";

interface Segment {
  contour: number;
  points: number[];
  /** Position across the axis (y for horizontal segments), font units. */
  pos: number;
  /** Extent along the segment, font units. */
  min: number;
  max: number;
  /** Ink lies on the larger-coordinate side (above / to the right). */
  inkAbove: boolean;
  round: boolean;
}

interface BlueZone {
  name: "baseline" | "xheight" | "cap" | "ascender" | "descender";
  top: boolean;
  ref: number;
  overshoot: number;
}

export interface HintGlobals {
  /** Ink lies right of the direction of travel (TrueType); false for CFF. */
  inkRight: boolean;
  blues: BlueZone[];
  /** Standard vertical / horizontal stem widths in font units (0 = unknown). */
  stemV: number;
  stemH: number;
  unitsPerEm: number;
}

/** A segment is flat when it rises no more than 1 in 12 along its run. */
const FLAT_RATIO = 12;
/** Stems wider than this share of the em are counters, not stems. */
const MAX_STEM_EM = 0.3;
/** Blue-zone capture distance, share of the em. */
const BLUE_FUZZ_EM = 0.025;

function coordsOf(p: OutlinePoint, axis: Axis): { u: number; v: number } {
  return axis === "y" ? { u: p.x, v: p.y } : { u: p.y, v: p.x };
}

function signedArea(contour: OutlinePoint[]): number {
  let a = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i]!;
    const q = contour[(i + 1) % contour.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function findSegments(contours: OutlinePoint[][], axis: Axis, inkRight: boolean): Segment[] {
  const out: Segment[] = [];
  contours.forEach((contour, ci) => {
    const n = contour.length;
    if (n < 2) return;
    const inRun = new Uint8Array(n);
    const flatDir = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const a = coordsOf(contour[i]!, axis);
      const b = coordsOf(contour[(i + 1) % n]!, axis);
      const du = b.u - a.u;
      const dv = b.v - a.v;
      if (du !== 0 && Math.abs(dv) * FLAT_RATIO <= Math.abs(du)) flatDir[i] = du > 0 ? 1 : -1;
    }
    // Start scanning just after a break so runs don't wrap mid-way.
    let start = 0;
    while (start < n && flatDir[start] !== 0 && flatDir[(start + n - 1) % n] === flatDir[start]) start++;
    if (start === n) start = 0;
    for (let k = 0; k < n; ) {
      const i = (start + k) % n;
      const dir = flatDir[i]!;
      if (dir === 0) {
        k++;
        continue;
      }
      const pts = [i];
      let len = 0;
      while (len < n && flatDir[(i + len) % n] === dir) {
        pts.push((i + len + 1) % n);
        len++;
      }
      k += len;
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      let round = false;
      let onCount = 0;
      for (const idx of pts) {
        const p = contour[idx]!;
        const c = coordsOf(p, axis);
        if (p.on) {
          sum += c.v;
          onCount++;
        }
        min = Math.min(min, c.u);
        max = Math.max(max, c.u);
        if (!p.on) round = true;
        inRun[idx] = 1;
      }
      const pos = onCount > 0 ? sum / onCount : coordsOf(contour[pts[0]!]!, axis).v;
      out.push({ contour: ci, points: pts, pos, min, max, inkAbove: inkAboveFor(axis, dir, inkRight), round });
    }
    // Extrema that no flat run caught (curve apexes, pointed joins).
    for (let i = 0; i < n; i++) {
      if (inRun[i]) continue;
      const p = coordsOf(contour[i]!, axis);
      const prev = coordsOf(contour[(i + n - 1) % n]!, axis);
      const next = coordsOf(contour[(i + 1) % n]!, axis);
      const d0 = p.v - prev.v;
      const d1 = next.v - p.v;
      if (!(d0 * d1 < 0)) continue;
      const dir = next.u - prev.u;
      if (dir === 0) continue;
      const reach = Math.max(1, Math.min(Math.abs(prev.u - p.u), Math.abs(next.u - p.u)) / 2);
      out.push({
        contour: ci,
        points: [i],
        pos: p.v,
        min: p.u - reach,
        max: p.u + reach,
        inkAbove: inkAboveFor(axis, dir > 0 ? 1 : -1, inkRight),
        round: true,
      });
    }
  });
  return out;
}

function inkAboveFor(axis: Axis, dir: number, inkRight: boolean): boolean {
  // Moving +x with ink on the right puts ink below; moving +y puts it to the right.
  if (axis === "y") return dir > 0 ? !inkRight : inkRight;
  return dir > 0 ? inkRight : !inkRight;
}

interface Stem {
  lower: Segment;
  upper: Segment;
  width: number;
}

function pairStems(segments: Segment[], maxWidth: number): Stem[] {
  const candidates: Stem[] = [];
  for (const lower of segments) {
    if (!lower.inkAbove) continue;
    for (const upper of segments) {
      if (upper.inkAbove || upper.pos <= lower.pos) continue;
      const width = upper.pos - lower.pos;
      if (width > maxWidth) continue;
      const overlap = Math.min(lower.max, upper.max) - Math.max(lower.min, upper.min);
      if (overlap <= 0) continue;
      candidates.push({ lower, upper, width });
    }
  }
  candidates.sort((a, b) => a.width - b.width);
  const used = new Set<Segment>();
  const stems: Stem[] = [];
  for (const c of candidates) {
    if (used.has(c.lower) || used.has(c.upper)) continue;
    used.add(c.lower);
    used.add(c.upper);
    stems.push(c);
  }
  return stems;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

function glyphFor(font: SfntFont, ch: string): OutlineGlyph | undefined {
  const gid = font.glyphId(ch.codePointAt(0)!);
  if (!gid) return undefined;
  const g = font.glyph(gid);
  return g.contours.length ? g : undefined;
}

function detectOrientation(font: SfntFont): boolean {
  for (const ch of "oOHlI0") {
    const g = glyphFor(font, ch);
    if (!g) continue;
    let best = 0;
    for (const c of g.contours) {
      const a = signedArea(c);
      if (Math.abs(a) > Math.abs(best)) best = a;
    }
    if (best !== 0) return best < 0;
  }
  return !font.cff;
}

function measureZone(
  font: SfntFont,
  inkRight: boolean,
  top: boolean,
  flatChars: string,
  roundChars: string,
): { ref: number; overshoot: number } | undefined {
  const edge = (chars: string, wantRound: boolean | undefined): number[] => {
    const found: number[] = [];
    for (const ch of chars) {
      const g = glyphFor(font, ch);
      if (!g) continue;
      const segs = findSegments(g.contours, "y", inkRight).filter((s) => s.inkAbove !== top);
      if (segs.length === 0) continue;
      const extreme = segs.reduce((a, b) => (top ? (b.pos > a.pos ? b : a) : b.pos < a.pos ? b : a));
      if (wantRound === undefined || extreme.round === wantRound) found.push(extreme.pos);
    }
    return found;
  };
  let flats = edge(flatChars, false);
  if (flats.length === 0) flats = edge(flatChars, undefined);
  const rounds = edge(roundChars, undefined);
  if (flats.length === 0 && rounds.length === 0) return undefined;
  const ref = flats.length ? median(flats) : median(rounds);
  const overshoot = rounds.length ? median(rounds) : ref;
  // An "overshoot" on the wrong side of the flat line is noise.
  return { ref, overshoot: top ? Math.max(ref, overshoot) : Math.min(ref, overshoot) };
}

export function computeHintGlobals(font: SfntFont): HintGlobals {
  const inkRight = detectOrientation(font);
  const blues: BlueZone[] = [];
  const add = (name: BlueZone["name"], top: boolean, flat: string, round: string, fallback?: number) => {
    const zone = measureZone(font, inkRight, top, flat, round);
    if (zone) blues.push({ name, top, ...zone });
    else if (fallback) blues.push({ name, top, ref: fallback, overshoot: fallback });
  };
  add("baseline", false, "HIxzLEmn", "oOecs", 0);
  add("xheight", true, "xzuvwy", "oecas", font.xHeight || undefined);
  add("cap", true, "HEFTZIL", "OCGQS", font.capHeight || undefined);
  add("ascender", true, "bdhkl", "");
  add("descender", false, "pq", "");

  const stemWidths = (chars: string, axis: Axis): number[] => {
    const out: number[] = [];
    for (const ch of chars) {
      const g = glyphFor(font, ch);
      if (!g) continue;
      const stems = pairStems(findSegments(g.contours, axis, inkRight), font.unitsPerEm * MAX_STEM_EM);
      for (const s of stems) if (!s.lower.round && !s.upper.round) out.push(s.width);
    }
    return out;
  };
  return {
    inkRight,
    blues,
    stemV: median(stemWidths("lIi|", "x")),
    stemH: median(stemWidths("HzEet", "y")),
    unitsPerEm: font.unitsPerEm,
  };
}

/** Pixel rows for each blue zone at one scale. */
function zonePixels(globals: HintGlobals, scale: number, ppem: number): Map<BlueZone, { ref: number; shift: number }> {
  const out = new Map<BlueZone, { ref: number; shift: number }>();
  for (const zone of globals.blues) {
    const raw = zone.ref * scale;
    let ref = Math.round(raw);
    // Small x-heights round up (FreeType's "increase x-height"): legibility wins.
    if (zone.name === "xheight" && ppem < 16 && raw - Math.floor(raw) >= 0.3) ref = Math.ceil(raw);
    const over = Math.abs(zone.overshoot - zone.ref) * scale;
    const shift = over < 0.5 ? 0 : Math.max(1, Math.round(over));
    out.set(zone, { ref, shift: zone.top ? shift : -shift });
  }
  return out;
}

function snapWidth(width: number, std: number): number {
  if (std > 0 && Math.abs(width - std) <= std * 0.25) return Math.max(1, Math.round(std));
  return Math.max(1, Math.round(width));
}

interface Work {
  xs: number[][];
  ys: number[][];
}

function assignTargets(
  segments: Segment[],
  stems: Stem[],
  scale: number,
  std: number,
  blueTarget: (s: Segment) => number | undefined,
  equalizeGaps: boolean,
): Map<Segment, number> {
  const target = new Map<Segment, number>();
  for (const s of segments) {
    const t = blueTarget(s);
    if (t !== undefined) target.set(s, t);
  }
  const anchored = stems.filter((s) => target.has(s.lower) || target.has(s.upper));
  const free = stems.filter((s) => !target.has(s.lower) && !target.has(s.upper)).sort((a, b) => a.lower.pos - b.lower.pos);
  for (const stem of anchored) {
    const w = snapWidth(stem.width * scale, std * scale);
    const lo = target.get(stem.lower);
    const hi = target.get(stem.upper);
    if (lo !== undefined && hi === undefined) target.set(stem.upper, lo + w);
    else if (hi !== undefined && lo === undefined) target.set(stem.lower, hi - w);
  }
  const placed: { lower: number; w: number; center: number }[] = [];
  for (const stem of free) {
    const w = snapWidth(stem.width * scale, std * scale);
    const center = ((stem.lower.pos + stem.upper.pos) / 2) * scale;
    let lower = Math.round(center - w / 2);
    const n = placed.length;
    if (equalizeGaps && n >= 2) {
      const a = placed[n - 2]!;
      const b = placed[n - 1]!;
      const gapBefore = b.center - a.center;
      const gap = center - b.center;
      if (b.w === w && a.w === w && Math.abs(gap - gapBefore) <= gapBefore * 0.1) lower = b.lower + (b.lower - a.lower);
    }
    placed.push({ lower, w, center });
    target.set(stem.lower, lower);
    target.set(stem.upper, lower + w);
  }
  // Lone flat edges (serif sides, bar ends) land on a pixel boundary too.
  for (const s of segments) {
    if (target.has(s) || s.round) continue;
    target.set(s, Math.round(s.pos * scale));
  }
  return target;
}

/** Move untouched points after the touched ones (TrueType IUP semantics). */
function interpolate(coords: number[][], orig: number[][], touched: Uint8Array[]): void {
  const globalPairs: [number, number][] = [];
  coords.forEach((c, ci) => {
    c.forEach((v, i) => {
      if (touched[ci]![i]) globalPairs.push([orig[ci]![i]!, v]);
    });
  });
  globalPairs.sort((a, b) => a[0] - b[0]);
  const globalMap = (o: number): number => {
    if (globalPairs.length === 0) return o;
    const first = globalPairs[0]!;
    const last = globalPairs[globalPairs.length - 1]!;
    if (o <= first[0]) return o + (first[1] - first[0]);
    if (o >= last[0]) return o + (last[1] - last[0]);
    let lo = 0;
    let hi = globalPairs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (globalPairs[mid]![0] <= o) lo = mid;
      else hi = mid;
    }
    const a = globalPairs[lo]!;
    const b = globalPairs[hi]!;
    if (b[0] === a[0]) return o + (a[1] - a[0]);
    return a[1] + ((o - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  };

  coords.forEach((c, ci) => {
    const t = touched[ci]!;
    const o = orig[ci]!;
    const n = c.length;
    const touchedIdx: number[] = [];
    for (let i = 0; i < n; i++) if (t[i]) touchedIdx.push(i);
    if (touchedIdx.length === 0) {
      for (let i = 0; i < n; i++) c[i] = globalMap(o[i]!);
      return;
    }
    if (touchedIdx.length === 1) {
      const d = c[touchedIdx[0]!]! - o[touchedIdx[0]!]!;
      for (let i = 0; i < n; i++) if (!t[i]) c[i] = o[i]! + d;
      return;
    }
    for (let k = 0; k < touchedIdx.length; k++) {
      const p1 = touchedIdx[k]!;
      const p2 = touchedIdx[(k + 1) % touchedIdx.length]!;
      const o1 = o[p1]!;
      const o2 = o[p2]!;
      const n1 = c[p1]!;
      const n2 = c[p2]!;
      const lo = Math.min(o1, o2);
      const hi = Math.max(o1, o2);
      const dLo = o1 <= o2 ? n1 - o1 : n2 - o2;
      const dHi = o1 <= o2 ? n2 - o2 : n1 - o1;
      for (let i = (p1 + 1) % n; i !== p2; i = (i + 1) % n) {
        const v = o[i]!;
        if (lo === hi) c[i] = v + (n1 - o1);
        else if (v <= lo) c[i] = v + dLo;
        else if (v >= hi) c[i] = v + dHi;
        else c[i] = n1 + ((v - o1) * (n2 - n1)) / (o2 - o1);
      }
    }
  });
}

function hintAxis(
  glyph: OutlineGlyph,
  work: Work,
  axis: Axis,
  globals: HintGlobals,
  scale: number,
  ppem: number,
  zoneScale: number = scale,
): void {
  const segments = findSegments(glyph.contours, axis, globals.inkRight);
  if (segments.length === 0) return;
  const stems = pairStems(segments, globals.unitsPerEm * MAX_STEM_EM);
  const fuzz = globals.unitsPerEm * BLUE_FUZZ_EM;
  const zones = axis === "y" ? zonePixels(globals, zoneScale, ppem) : undefined;
  const blueTarget = (s: Segment): number | undefined => {
    if (!zones) return undefined;
    let best: BlueZone | undefined;
    let bestDist = Infinity;
    for (const zone of globals.blues) {
      if (zone.top === s.inkAbove) continue;
      const lo = Math.min(zone.ref, zone.overshoot) - fuzz;
      const hi = Math.max(zone.ref, zone.overshoot) + fuzz;
      if (s.pos < lo || s.pos > hi) continue;
      const dist = Math.abs(s.pos - zone.ref);
      if (dist < bestDist) {
        best = zone;
        bestDist = dist;
      }
    }
    if (!best) return undefined;
    const px = zones.get(best)!;
    const overshooting = Math.abs(s.pos - best.overshoot) < Math.abs(s.pos - best.ref);
    return px.ref + (overshooting ? px.shift : 0);
  };
  const std = axis === "x" ? globals.stemV : globals.stemH;
  const targets = assignTargets(segments, stems, scale, std, blueTarget, axis === "x");

  const coords = axis === "y" ? work.ys : work.xs;
  const orig = coords.map((c) => c.slice());
  const touched = coords.map((c) => new Uint8Array(c.length));
  for (const [seg, t] of targets) {
    const c = coords[seg.contour]!;
    for (const i of seg.points) {
      c[i] = t;
      touched[seg.contour]![i] = 1;
    }
  }
  interpolate(coords, orig, touched);
}

/**
 * Scale `glyph` to pixels (`scale` = ppem / unitsPerEm, `yScale` adds the
 * PreserveGlyph squeeze) and, when `globals` is given, grid-fit it.
 */
export function placeGlyph(
  glyph: OutlineGlyph,
  scale: number,
  yScale: number,
  ppem: number,
  globals: HintGlobals | undefined,
): OutlinePoint[][] {
  const work: Work = {
    xs: glyph.contours.map((c) => c.map((p) => p.x * scale)),
    ys: glyph.contours.map((c) => c.map((p) => p.y * scale * yScale)),
  };
  if (globals) {
    hintAxis(glyph, work, "y", globals, scale * yScale, ppem, scale);
    hintAxis(glyph, work, "x", globals, scale, ppem);
  }
  return glyph.contours.map((c, ci) =>
    c.map((p, i) => ({ x: work.xs[ci]![i]!, y: work.ys[ci]![i]!, on: p.on, cubic: p.cubic })),
  );
}
