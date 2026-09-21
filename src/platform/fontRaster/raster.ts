import { defaultRasterCharset, deckerOrdinalForCharCode, type FontStrikeDraft, type FontStrikeGlyph } from "@mockintosh/ui";
import { parseTtf, type TtfPoint } from "./parseTtf";

export const DEFAULT_THRESHOLD = 96;
export const MIN_STRIKE_SIZE = 9;
export const MAX_STRIKE_SIZE = 72;

export function clampStrikeSize(size: number): number {
  return Math.max(MIN_STRIKE_SIZE, Math.min(MAX_STRIKE_SIZE, Math.round(size)));
}

export function sanitizeFamily(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return cleaned.slice(0, 24) || "untitled";
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function subdivideQuad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, out: number[]): void {
  const dx = x0 - 2 * x1 + x2;
  const dy = y0 - 2 * y1 + y2;
  if (dx * dx + dy * dy < 0.5) {
    out.push(x2, y2);
    return;
  }
  const ax = (x0 + x1) / 2;
  const ay = (y0 + y1) / 2;
  const bx = (x1 + x2) / 2;
  const by = (y1 + y2) / 2;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  subdivideQuad(x0, y0, ax, ay, mx, my, out);
  subdivideQuad(mx, my, bx, by, x2, y2, out);
}

function contourPolyline(contour: TtfPoint[]): number[] {
  if (contour.length === 0) return [];
  const pts: TtfPoint[] = [];
  for (let i = 0; i < contour.length; i++) {
    const cur = contour[i]!;
    const next = contour[(i + 1) % contour.length]!;
    pts.push(cur);
    if (!cur.onCurve && !next.onCurve) {
      pts.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, onCurve: true });
    }
  }
  const on = pts.findIndex((p) => p.onCurve);
  if (on < 0) return [];
  const ordered = pts.slice(on).concat(pts.slice(0, on));
  const poly = [ordered[0]!.x, ordered[0]!.y];
  for (let i = 0; i < ordered.length; ) {
    const a = ordered[i]!;
    const b = ordered[(i + 1) % ordered.length]!;
    if (b.onCurve) {
      poly.push(b.x, b.y);
      i++;
      continue;
    }
    const c = ordered[(i + 2) % ordered.length]!;
    const end = c.onCurve ? c : { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, onCurve: true };
    subdivideQuad(a.x, a.y, b.x, b.y, end.x, end.y, poly);
    i += c.onCurve ? 2 : 1;
  }
  return poly;
}

function edgesOf(poly: number[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i + 3 < poly.length; i += 2) {
    const x0 = poly[i]!;
    const y0 = poly[i + 1]!;
    const x1 = poly[i + 2]!;
    const y1 = poly[i + 3]!;
    if (y0 === y1) continue;
    edges.push({ x0, y0, x1, y1 });
  }
  return edges;
}

function fillCoverage(width: number, height: number, edges: Edge[], scale: number, ox: number, oy: number): Uint8Array {
  const cover = new Uint8Array(width * height);
  const scaled: Edge[] = edges.map((e) => ({
    x0: e.x0 * scale + ox,
    y0: oy - e.y0 * scale,
    x1: e.x1 * scale + ox,
    y1: oy - e.y1 * scale,
  }));
  for (let y = 0; y < height; y++) {
    const scan = y + 0.5;
    const xs: { x: number; w: number }[] = [];
    for (const e of scaled) {
      const minY = Math.min(e.y0, e.y1);
      const maxY = Math.max(e.y0, e.y1);
      if (scan < minY || scan >= maxY) continue;
      const t = (scan - e.y0) / (e.y1 - e.y0);
      xs.push({ x: e.x0 + t * (e.x1 - e.x0), w: e.y1 > e.y0 ? 1 : -1 });
    }
    xs.sort((a, b) => a.x - b.x);
    let winding = 0;
    let prev = 0;
    for (const hit of xs) {
      if (winding !== 0) {
        const x0 = Math.max(0, Math.floor(prev));
        const x1 = Math.min(width, Math.ceil(hit.x));
        const row = y * width;
        for (let x = x0; x < x1; x++) cover[row + x] = 255;
      }
      winding += hit.w;
      prev = hit.x;
    }
  }
  return cover;
}

export function downsampleThreshold(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  factor: number,
  threshold: number,
): { width: number; height: number; pixels: Uint8Array } {
  const width = Math.max(1, Math.ceil(srcW / factor));
  const height = Math.max(1, Math.ceil(srcH / factor));
  const pixels = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= srcH) continue;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx >= srcW) continue;
          sum += src[sy * srcW + sx] ?? 0;
        }
      }
      pixels[y * width + x] = sum / area >= threshold ? 1 : 0;
    }
  }
  return { width, height, pixels };
}

export function rasterizeOutline(
  bytes: Uint8Array,
  options: { size: number; threshold: number; spacing: number; chars?: string; oversample?: number },
): FontStrikeDraft {
  const ttf = parseTtf(bytes);
  const size = clampStrikeSize(options.size);
  const oversample = Math.max(1, Math.round(options.oversample ?? 1));
  const ppem = size * oversample;
  const scale = ppem / ttf.unitsPerEm;
  const ascent = Math.max(1, Math.ceil(Math.abs(ttf.ascender) * scale));
  const descent = Math.max(0, Math.ceil(Math.abs(ttf.descender) * scale));
  const srcH = ascent + descent;
  const chars = options.chars ?? defaultRasterCharset();
  const glyphs: FontStrikeGlyph[] = [];
  let maxWidth = 1;

  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || (cp >= 0xd800 && cp <= 0xdfff)) continue;
    const ordinal = deckerOrdinalForCharCode(cp);
    if (ordinal === 255) continue;
    const gid = ttf.cmap.get(cp);
    if (gid === undefined && ch !== " ") continue;
    const glyph = gid !== undefined ? ttf.glyph(gid) : { advance: ttf.unitsPerEm / 3, xMin: 0, xMax: 0, contours: [] };
    const advance = Math.max(1, Math.round(glyph.advance * scale));
    const edges: Edge[] = [];
    let inkMin = 0;
    let inkMax = advance;
    for (const contour of glyph.contours) {
      const poly = contourPolyline(contour);
      if (poly.length < 4) continue;
      for (let i = 0; i < poly.length; i += 2) {
        inkMin = Math.min(inkMin, Math.floor(poly[i]! * scale));
        inkMax = Math.max(inkMax, Math.ceil(poly[i]! * scale));
      }
      edges.push(...edgesOf(poly));
    }
    const padL = Math.max(0, -inkMin);
    const srcW = Math.max(advance, inkMax) + padL;
    const cover = edges.length === 0 ? new Uint8Array(srcW * srcH) : fillCoverage(srcW, srcH, edges, scale, padL, ascent);
    const binary =
      oversample === 1
        ? {
            width: srcW,
            height: srcH,
            pixels: Uint8Array.from(cover, (v) => (v >= options.threshold ? 1 : 0)),
          }
        : downsampleThreshold(cover, srcW, srcH, oversample, options.threshold);
    maxWidth = Math.max(maxWidth, binary.width);
    glyphs.push({ ordinal, width: binary.width, pixels: binary.pixels });
  }

  return {
    family: sanitizeFamily(ttf.familyName),
    size,
    maxWidth,
    glyphHeight: oversample === 1 ? srcH : Math.max(1, Math.ceil(srcH / oversample)),
    spacing: Math.max(0, Math.round(options.spacing)),
    glyphs,
  };
}
