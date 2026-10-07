/**
 * `'sfnt'` reader for the Font Manager's outline scaler.
 *
 * TrueType (`glyf`) and PostScript-flavoured OpenType (`CFF `) outlines,
 * cmap formats 4 / 12, `OS/2` + `head` style bits, and pair kerning from
 * `kern` or GPOS. Tables are read lazily; glyphs are cached per font.
 * Hinting bytecode is skipped: `autohint.ts` grid-fits instead.
 */

import { readCffOutlines, type CffOutlines } from "./cff";

export interface OutlinePoint {
  x: number;
  y: number;
  /** On-curve point. Off-curve points are quadratic controls unless `cubic`. */
  on: boolean;
  /** Cubic (CFF) control point: two in a row between on-curve points. */
  cubic?: boolean;
}

export interface OutlineGlyph {
  advance: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  contours: OutlinePoint[][];
}

export interface GlyphBounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface SfntFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  /** `OS/2` sxHeight / sCapHeight when present (version ≥ 2), else 0. */
  xHeight: number;
  capHeight: number;
  familyName: string;
  subfamilyName: string;
  weightClass: number;
  bold: boolean;
  italic: boolean;
  numGlyphs: number;
  /** `true` for CFF outlines (counter-clockwise outer contours). */
  cff: boolean;
  /** Glyph id for a Unicode code point; 0 (`.notdef`) when missing. */
  glyphId(codePoint: number): number;
  /** Every mapped code point, ascending. */
  codePoints(): number[];
  advance(gid: number): number;
  /** Bounding box without decoding the outline (glyf header / cached CFF). */
  bounds(gid: number): GlyphBounds;
  glyph(gid: number): OutlineGlyph;
  /** Pair adjustment in font units (negative tightens). */
  kerning(left: number, right: number): number;
  hasKerning: boolean;
}

interface Table {
  offset: number;
  length: number;
}

const EMPTY_BOUNDS: GlyphBounds = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readDirectory(view: DataView): { tables: Map<string, Table>; scalar: number } {
  if (view.byteLength < 12) throw new Error("Not a font file.");
  let base = 0;
  if (tag(view, 0) === "ttcf") base = view.getUint32(12);
  const scalar = view.getUint32(base);
  const count = view.getUint16(base + 4);
  const tables = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + i * 16;
    tables.set(tag(view, rec), { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  if (!tables.has("head") && !tables.has("bhed")) throw new Error("Not a TrueType or OpenType font.");
  return { tables, scalar };
}

function need(tables: Map<string, Table>, name: string): Table {
  const table = tables.get(name);
  if (!table) throw new Error(`Font is missing the ${name.trim()} table.`);
  return table;
}

// --- cmap ---------------------------------------------------------------

interface CmapLookup {
  get(cp: number): number;
  all(): number[];
}

function cmapFormat4(view: DataView, rec: number): Map<number, number> {
  const out = new Map<number, number>();
  const segCount = view.getUint16(rec + 6) / 2;
  const end0 = rec + 14;
  const start0 = end0 + 2 * segCount + 2;
  const delta0 = start0 + 2 * segCount;
  const range0 = delta0 + 2 * segCount;
  for (let i = 0; i < segCount; i++) {
    const end = view.getUint16(end0 + 2 * i);
    const start = view.getUint16(start0 + 2 * i);
    if (start === 0xffff) continue;
    const delta = view.getInt16(delta0 + 2 * i);
    const range = view.getUint16(range0 + 2 * i);
    for (let cp = start; cp <= end; cp++) {
      let gid: number;
      if (range === 0) gid = (cp + delta) & 0xffff;
      else {
        const ptr = range0 + 2 * i + range + 2 * (cp - start);
        if (ptr + 2 > view.byteLength) continue;
        gid = view.getUint16(ptr);
        if (gid) gid = (gid + delta) & 0xffff;
      }
      if (gid) out.set(cp, gid);
    }
  }
  return out;
}

function cmapFormat12(view: DataView, rec: number): Map<number, number> {
  const out = new Map<number, number>();
  const groups = view.getUint32(rec + 12);
  for (let i = 0; i < groups; i++) {
    const g = rec + 16 + i * 12;
    const start = view.getUint32(g);
    const end = Math.min(view.getUint32(g + 4), start + 0xffff, 0x10ffff);
    const gid0 = view.getUint32(g + 8);
    for (let cp = start; cp <= end; cp++) out.set(cp, gid0 + (cp - start));
  }
  return out;
}

function cmapFormat0(view: DataView, rec: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < 256; i++) {
    const gid = view.getUint8(rec + 6 + i);
    if (gid) out.set(i, gid);
  }
  return out;
}

function readCmap(view: DataView, table: Table): CmapLookup {
  const nenc = view.getUint16(table.offset + 2);
  let best: { score: number; rec: number; fmt: number; symbol: boolean } | undefined;
  for (let i = 0; i < nenc; i++) {
    const plat = view.getUint16(table.offset + 4 + i * 8);
    const enc = view.getUint16(table.offset + 6 + i * 8);
    const rec = table.offset + view.getUint32(table.offset + 8 + i * 8);
    const fmt = view.getUint16(rec);
    let score = 0;
    if (fmt === 12 && (plat === 0 || (plat === 3 && enc === 10))) score = 5;
    else if (fmt === 4 && plat === 3 && enc === 1) score = 4;
    else if (fmt === 4 && plat === 0) score = 3;
    else if (fmt === 4 && plat === 3 && enc === 0) score = 2;
    else if (fmt === 0 && plat === 1 && enc === 0) score = 1;
    if (score && (!best || score > best.score)) best = { score, rec, fmt, symbol: plat === 3 && enc === 0 };
  }
  if (!best) throw new Error("Font has no Unicode character map.");
  const pick = best;
  let map: Map<number, number> | undefined;
  const load = (): Map<number, number> =>
    (map ??=
      pick.fmt === 12 ? cmapFormat12(view, pick.rec) : pick.fmt === 4 ? cmapFormat4(view, pick.rec) : cmapFormat0(view, pick.rec));
  return {
    get(cp) {
      const m = load();
      const gid = m.get(cp);
      if (gid !== undefined) return gid;
      // Symbol fonts park their glyphs in the Private Use Area at U+F0xx.
      if (pick.symbol && cp < 0x100) return m.get(0xf000 | cp) ?? 0;
      return 0;
    },
    all() {
      return [...load().keys()].sort((a, b) => a - b);
    },
  };
}

// --- name ---------------------------------------------------------------

function readNames(view: DataView, table: Table | undefined): { family: string; subfamily: string } {
  if (!table) return { family: "untitled", subfamily: "Regular" };
  const count = view.getUint16(table.offset + 2);
  const storage = table.offset + view.getUint16(table.offset + 4);
  const found = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const rec = table.offset + 6 + i * 12;
    const plat = view.getUint16(rec);
    const nameId = view.getUint16(rec + 6);
    if (nameId !== 1 && nameId !== 2 && nameId !== 16 && nameId !== 17) continue;
    const length = view.getUint16(rec + 8);
    const offset = storage + view.getUint16(rec + 10);
    let text = "";
    if (plat === 3 || plat === 0) {
      for (let n = 0; n + 1 < length; n += 2) text += String.fromCharCode(view.getUint16(offset + n));
    } else {
      for (let n = 0; n < length; n++) text += String.fromCharCode(view.getUint8(offset + n));
    }
    text = text.replace(/\0/g, "").trim();
    if (text && (!found.has(nameId) || plat === 3)) found.set(nameId, text);
  }
  return {
    family: found.get(16) ?? found.get(1) ?? "untitled",
    subfamily: found.get(17) ?? found.get(2) ?? "Regular",
  };
}

// --- glyf ---------------------------------------------------------------

function readSimpleGlyph(view: DataView, offset: number, contours: number): OutlinePoint[][] {
  const ends: number[] = [];
  let p = offset + 10;
  for (let i = 0; i < contours; i++) ends.push(view.getUint16(p + 2 * i));
  p += 2 * contours;
  p += 2 + view.getUint16(p);
  const nPoints = (ends[ends.length - 1] ?? -1) + 1;
  const flags = new Uint8Array(nPoints);
  for (let i = 0; i < nPoints; ) {
    const flag = view.getUint8(p++);
    flags[i++] = flag;
    if (flag & 8) {
      const repeat = view.getUint8(p++);
      for (let r = 0; r < repeat && i < nPoints; r++) flags[i++] = flag;
    }
  }
  const xs = new Int32Array(nPoints);
  const ys = new Int32Array(nPoints);
  let x = 0;
  for (let i = 0; i < nPoints; i++) {
    const flag = flags[i]!;
    if (flag & 2) {
      const d = view.getUint8(p++);
      x += flag & 16 ? d : -d;
    } else if (!(flag & 16)) {
      x += view.getInt16(p);
      p += 2;
    }
    xs[i] = x;
  }
  let y = 0;
  for (let i = 0; i < nPoints; i++) {
    const flag = flags[i]!;
    if (flag & 4) {
      const d = view.getUint8(p++);
      y += flag & 32 ? d : -d;
    } else if (!(flag & 32)) {
      y += view.getInt16(p);
      p += 2;
    }
    ys[i] = y;
  }
  const out: OutlinePoint[][] = [];
  let start = 0;
  for (const end of ends) {
    const contour: OutlinePoint[] = [];
    for (let i = start; i <= end; i++) contour.push({ x: xs[i]!, y: ys[i]!, on: (flags[i]! & 1) !== 0 });
    if (contour.length > 0) out.push(contour);
    start = end + 1;
  }
  return out;
}

// --- kerning ------------------------------------------------------------

type PairKern = (left: number, right: number) => number;

function readKernTable(view: DataView, table: Table): PairKern | undefined {
  const pairs = new Map<number, number>();
  const o = table.offset;
  const version = view.getUint16(o);
  let nTables: number;
  let p: number;
  let apple = false;
  if (version === 0) {
    nTables = view.getUint16(o + 2);
    p = o + 4;
  } else if (version === 1) {
    apple = true;
    nTables = view.getUint32(o + 4);
    p = o + 8;
  } else return undefined;
  for (let t = 0; t < nTables; t++) {
    let length: number;
    let format: number;
    let horizontal: boolean;
    let header: number;
    if (apple) {
      length = view.getUint32(p);
      const coverage = view.getUint16(p + 4);
      format = coverage & 0xff;
      horizontal = (coverage & 0xe000) === 0;
      header = 8;
    } else {
      length = view.getUint16(p + 2);
      const coverage = view.getUint16(p + 4);
      format = coverage >> 8;
      horizontal = (coverage & 0x7) === 1;
      header = 6;
    }
    if (format === 0 && horizontal) {
      const n = view.getUint16(p + header);
      for (let i = 0; i < n; i++) {
        const rec = p + header + 8 + i * 6;
        if (rec + 6 > view.byteLength) break;
        const key = view.getUint16(rec) * 65536 + view.getUint16(rec + 2);
        pairs.set(key, (pairs.get(key) ?? 0) + view.getInt16(rec + 4));
      }
    }
    if (length <= 0) break;
    p += length;
  }
  if (pairs.size === 0) return undefined;
  return (l, r) => pairs.get(l * 65536 + r) ?? 0;
}

function coverageIndex(view: DataView, offset: number): Map<number, number> {
  const out = new Map<number, number>();
  const format = view.getUint16(offset);
  if (format === 1) {
    const n = view.getUint16(offset + 2);
    for (let i = 0; i < n; i++) out.set(view.getUint16(offset + 4 + i * 2), i);
  } else if (format === 2) {
    const n = view.getUint16(offset + 2);
    for (let i = 0; i < n; i++) {
      const r = offset + 4 + i * 6;
      const start = view.getUint16(r);
      const end = view.getUint16(r + 2);
      const startIndex = view.getUint16(r + 4);
      for (let g = start; g <= end; g++) out.set(g, startIndex + g - start);
    }
  }
  return out;
}

function classDef(view: DataView, offset: number): (gid: number) => number {
  const format = view.getUint16(offset);
  if (format === 1) {
    const start = view.getUint16(offset + 2);
    const n = view.getUint16(offset + 4);
    return (gid) => (gid >= start && gid < start + n ? view.getUint16(offset + 6 + (gid - start) * 2) : 0);
  }
  if (format === 2) {
    const n = view.getUint16(offset + 2);
    const ranges: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const r = offset + 4 + i * 6;
      ranges.push([view.getUint16(r), view.getUint16(r + 2), view.getUint16(r + 4)]);
    }
    return (gid) => {
      let lo = 0;
      let hi = ranges.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const [s, e, c] = ranges[mid]!;
        if (gid < s) hi = mid - 1;
        else if (gid > e) lo = mid + 1;
        else return c;
      }
      return 0;
    };
  }
  return () => 0;
}

function valueRecordSize(format: number): number {
  let n = 0;
  for (let f = format; f; f >>= 1) n += f & 1;
  return n * 2;
}

/** XAdvance of a ValueRecord (0 when the format omits it). */
function xAdvanceOf(view: DataView, offset: number, format: number): number {
  if (!(format & 4)) return 0;
  let p = offset;
  if (format & 1) p += 2;
  if (format & 2) p += 2;
  return view.getInt16(p);
}

function xPlacementOf(view: DataView, offset: number, format: number): number {
  return format & 1 ? view.getInt16(offset) : 0;
}

function readGposKerning(view: DataView, table: Table): PairKern | undefined {
  const o = table.offset;
  const featureList = o + view.getUint16(o + 6);
  const lookupList = o + view.getUint16(o + 8);
  const lookupIndices = new Set<number>();
  const nFeatures = view.getUint16(featureList);
  for (let i = 0; i < nFeatures; i++) {
    const rec = featureList + 2 + i * 6;
    if (tag(view, rec) !== "kern") continue;
    const feature = featureList + view.getUint16(rec + 4);
    const n = view.getUint16(feature + 2);
    for (let k = 0; k < n; k++) lookupIndices.add(view.getUint16(feature + 4 + k * 2));
  }
  if (lookupIndices.size === 0) return undefined;

  const subtables: MaybeKern[] = [];
  const nLookups = view.getUint16(lookupList);
  for (const index of [...lookupIndices].sort((a, b) => a - b)) {
    if (index >= nLookups) continue;
    const lookup = lookupList + view.getUint16(lookupList + 2 + index * 2);
    let type = view.getUint16(lookup);
    const nSub = view.getUint16(lookup + 4);
    for (let s = 0; s < nSub; s++) {
      let sub = lookup + view.getUint16(lookup + 6 + s * 2);
      if (type === 9) {
        type = view.getUint16(sub + 2);
        sub = sub + view.getUint32(sub + 4);
      }
      if (type !== 2) continue;
      const kern = pairPosSubtable(view, sub);
      if (kern) subtables.push(kern);
    }
  }
  if (subtables.length === 0) return undefined;
  return (l, r) => {
    for (const sub of subtables) {
      const v = sub(l, r);
      if (v !== undefined) return v;
    }
    return 0;
  };
}

type MaybeKern = (left: number, right: number) => number | undefined;

function pairPosSubtable(view: DataView, sub: number): MaybeKern | undefined {
  const format = view.getUint16(sub);
  const coverage = coverageIndex(view, sub + view.getUint16(sub + 2));
  const vf1 = view.getUint16(sub + 4);
  const vf2 = view.getUint16(sub + 6);
  const size1 = valueRecordSize(vf1);
  const size2 = valueRecordSize(vf2);
  const adjust = (rec: number) => xAdvanceOf(view, rec, vf1) + xPlacementOf(view, rec + size1, vf2);
  if (format === 1) {
    const pairSets = sub + 10;
    return (l, r) => {
      const ci = coverage.get(l);
      if (ci === undefined) return undefined;
      const set = sub + view.getUint16(pairSets + ci * 2);
      const n = view.getUint16(set);
      const recSize = 2 + size1 + size2;
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rec = set + 2 + mid * recSize;
        const second = view.getUint16(rec);
        if (second < r) lo = mid + 1;
        else if (second > r) hi = mid - 1;
        else return adjust(rec + 2);
      }
      return undefined;
    };
  }
  if (format === 2) {
    const class1 = classDef(view, sub + view.getUint16(sub + 8));
    const class2 = classDef(view, sub + view.getUint16(sub + 10));
    const class2Count = view.getUint16(sub + 14);
    const records = sub + 16;
    const recSize = size1 + size2;
    return (l, r) => {
      if (!coverage.has(l)) return undefined;
      const c1 = class1(l);
      const c2 = class2(r);
      return adjust(records + (c1 * class2Count + c2) * recSize);
    };
  }
  return undefined;
}

// --- font ---------------------------------------------------------------

export function parseSfnt(bytes: Uint8Array): SfntFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { tables } = readDirectory(view);
  const head = tables.get("head") ?? need(tables, "bhed");
  const maxp = need(tables, "maxp");
  const hhea = need(tables, "hhea");
  const hmtx = need(tables, "hmtx");
  const cmapTable = need(tables, "cmap");
  const os2 = tables.get("OS/2");
  const cffTable = tables.get("CFF ");
  const names = readNames(view, tables.get("name"));

  const unitsPerEm = view.getUint16(head.offset + 18) || 1000;
  const macStyle = view.getUint16(head.offset + 44);
  const locaFormat = view.getInt16(head.offset + 50);
  const numGlyphs = view.getUint16(maxp.offset + 4);
  const numberOfHMetrics = Math.max(1, view.getUint16(hhea.offset + 34));

  let ascender = view.getInt16(hhea.offset + 4);
  let descender = view.getInt16(hhea.offset + 6);
  let lineGap = view.getInt16(hhea.offset + 8);
  let weightClass = macStyle & 1 ? 700 : 400;
  let bold = (macStyle & 1) !== 0;
  let italic = (macStyle & 2) !== 0;
  let xHeight = 0;
  let capHeight = 0;
  if (os2 && os2.length >= 78) {
    const version = view.getUint16(os2.offset);
    weightClass = view.getUint16(os2.offset + 4) || weightClass;
    const fsSelection = view.getUint16(os2.offset + 62);
    italic ||= (fsSelection & 1) !== 0;
    bold ||= (fsSelection & 32) !== 0;
    if (ascender === 0 && descender === 0) {
      ascender = view.getUint16(os2.offset + 74);
      descender = -view.getUint16(os2.offset + 76);
      lineGap = view.getInt16(os2.offset + 72);
    }
    if (version >= 2 && os2.length >= 90) {
      xHeight = view.getInt16(os2.offset + 86);
      capHeight = view.getInt16(os2.offset + 88);
    }
  }
  if (weightClass >= 600) bold = true;

  const advanceOf = (gid: number): number => {
    const i = Math.min(Math.max(0, gid), numberOfHMetrics - 1);
    return view.getUint16(hmtx.offset + i * 4);
  };

  const cmap = readCmap(view, cmapTable);
  const cache = new Map<number, OutlineGlyph>();
  let cff: CffOutlines | undefined;
  if (cffTable) cff = readCffOutlines(bytes.subarray(cffTable.offset, cffTable.offset + cffTable.length));

  const loca = cff ? undefined : need(tables, "loca");
  const glyf = cff ? undefined : need(tables, "glyf");
  const locaOff = (id: number) =>
    locaFormat === 0 ? view.getUint16(loca!.offset + 2 * id) * 2 : view.getUint32(loca!.offset + 4 * id);

  const glyfRange = (id: number): [number, number] => [glyf!.offset + locaOff(id), glyf!.offset + locaOff(id + 1)];

  const withBounds = (advance: number, contours: OutlinePoint[][]): OutlineGlyph => {
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const c of contours)
      for (const p of c) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    if (xMin === Infinity) return { advance, xMin: 0, yMin: 0, xMax: 0, yMax: 0, contours };
    return { advance, xMin, yMin, xMax, yMax, contours };
  };

  const loadGlyf = (id: number, depth: number): OutlinePoint[][] => {
    if (id < 0 || id >= numGlyphs || depth > 8) return [];
    const [start, end] = glyfRange(id);
    if (end <= start) return [];
    const nContours = view.getInt16(start);
    if (nContours >= 0) return readSimpleGlyph(view, start, nContours);
    const contours: OutlinePoint[][] = [];
    let p = start + 10;
    let more = true;
    while (more) {
      const flags = view.getUint16(p);
      const childId = view.getUint16(p + 2);
      p += 4;
      let arg1: number;
      let arg2: number;
      if (flags & 1) {
        arg1 = view.getInt16(p);
        arg2 = view.getInt16(p + 2);
        p += 4;
      } else {
        arg1 = view.getInt8(p);
        arg2 = view.getInt8(p + 1);
        p += 2;
      }
      let xx = 1;
      let xy = 0;
      let yx = 0;
      let yy = 1;
      if (flags & 8) {
        xx = yy = view.getInt16(p) / 0x4000;
        p += 2;
      } else if (flags & 64) {
        xx = view.getInt16(p) / 0x4000;
        yy = view.getInt16(p + 2) / 0x4000;
        p += 4;
      } else if (flags & 128) {
        xx = view.getInt16(p) / 0x4000;
        xy = view.getInt16(p + 2) / 0x4000;
        yx = view.getInt16(p + 4) / 0x4000;
        yy = view.getInt16(p + 6) / 0x4000;
        p += 8;
      }
      const child = loadGlyf(childId, depth + 1);
      let dx = 0;
      let dy = 0;
      if (flags & 2) {
        dx = arg1;
        dy = arg2;
        // SCALED_COMPONENT_OFFSET: the offset is in the component's own space.
        if (flags & 0x800) {
          dx = arg1 * xx + arg2 * yx;
          dy = arg1 * xy + arg2 * yy;
        }
      } else {
        // Point matching: align child point arg2 onto parent point arg1.
        const parentPts = contours.flat();
        const childPts = child.flat();
        const a = parentPts[arg1];
        const b = childPts[arg2];
        if (a && b) {
          dx = a.x - (b.x * xx + b.y * yx);
          dy = a.y - (b.x * xy + b.y * yy);
        }
      }
      for (const contour of child) {
        contours.push(
          contour.map((pt) => ({ x: pt.x * xx + pt.y * yx + dx, y: pt.x * xy + pt.y * yy + dy, on: pt.on })),
        );
      }
      more = (flags & 32) !== 0;
    }
    return contours;
  };

  const glyph = (gid: number): OutlineGlyph => {
    const cached = cache.get(gid);
    if (cached) return cached;
    const contours = cff ? cff.glyph(gid) : loadGlyf(gid, 0);
    const g = withBounds(advanceOf(gid), contours);
    cache.set(gid, g);
    return g;
  };

  const bounds = (gid: number): GlyphBounds => {
    if (gid < 0 || gid >= numGlyphs) return EMPTY_BOUNDS;
    if (cff || cache.has(gid)) return glyph(gid);
    const [start, end] = glyfRange(gid);
    if (end <= start) return EMPTY_BOUNDS;
    // Composite headers can understate transformed children; decode those.
    if (view.getInt16(start) < 0) return glyph(gid);
    return {
      xMin: view.getInt16(start + 2),
      yMin: view.getInt16(start + 4),
      xMax: view.getInt16(start + 6),
      yMax: view.getInt16(start + 8),
    };
  };

  let kern: PairKern | undefined;
  const gpos = tables.get("GPOS");
  const kernTable = tables.get("kern");
  try {
    if (gpos) kern = readGposKerning(view, gpos);
    if (!kern && kernTable) kern = readKernTable(view, kernTable);
  } catch {
    kern = undefined;
  }
  const kernCache = new Map<number, number>();

  return {
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    xHeight,
    capHeight,
    familyName: names.family,
    subfamilyName: names.subfamily,
    weightClass,
    bold,
    italic,
    numGlyphs,
    cff: Boolean(cff),
    glyphId: (cp) => cmap.get(cp),
    codePoints: () => cmap.all(),
    advance: advanceOf,
    bounds,
    glyph,
    hasKerning: Boolean(kern),
    kerning(left, right) {
      if (!kern || !left || !right) return 0;
      const key = left * 65536 + right;
      let v = kernCache.get(key);
      if (v === undefined) {
        v = kern(left, right);
        kernCache.set(key, v);
      }
      return v;
    },
  };
}

/** Family name for a font file, or `"untitled"` when it can't be read. */
export function peekSfntFamily(bytes: Uint8Array): string {
  try {
    return parseSfnt(bytes).familyName;
  } catch {
    return "untitled";
  }
}
