/** Minimal TrueType reader: cmap/glyf/hmtx/name. CFF OpenType is rejected. */

export interface TtfPoint {
  x: number;
  y: number;
  onCurve: boolean;
}

export interface TtfGlyph {
  advance: number;
  xMin: number;
  xMax: number;
  contours: TtfPoint[][];
}

export interface ParsedTtf {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  familyName: string;
  cmap: Map<number, number>;
  glyph(id: number): TtfGlyph;
}

interface Table {
  offset: number;
  length: number;
}

function tagAt(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!);
}

function tablesOf(data: Uint8Array): Map<string, Table> {
  if (data.length < 12) throw new Error("Not a font file.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const scalar = view.getUint32(0);
  if (scalar === 0x4f54544f) throw new Error("CFF OpenType is not supported in outline mode. Use Hinted.");
  const count = view.getUint16(4);
  const tables = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const base = 12 + i * 16;
    tables.set(tagAt(data, base), { offset: view.getUint32(base + 8), length: view.getUint32(base + 12) });
  }
  return tables;
}

function requireTable(tables: Map<string, Table>, name: string): Table {
  const table = tables.get(name);
  if (!table) throw new Error(`Font is missing the ${name} table.`);
  return table;
}

function readCmap(view: DataView, table: Table): Map<number, number> {
  const cmap = new Map<number, number>();
  const nenc = view.getUint16(table.offset + 2);
  let rec = 0;
  for (let i = 0; i < nenc; i++) {
    const plat = view.getUint16(table.offset + 4 + i * 8);
    const enc = view.getUint16(table.offset + 6 + i * 8);
    const recOff = table.offset + view.getUint32(table.offset + 8 + i * 8);
    const fmt = view.getUint16(recOff);
    if (fmt === 4 && (rec === 0 || (plat === 3 && enc === 1))) rec = recOff;
  }
  if (!rec) throw new Error("Font has no Unicode cmap.");
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
        gid = view.getUint16(ptr);
        if (gid) gid = (gid + delta) & 0xffff;
      }
      if (gid) cmap.set(cp, gid);
    }
  }
  return cmap;
}

function readName(view: DataView, table: Table): string {
  const count = view.getUint16(table.offset + 2);
  const storage = table.offset + view.getUint16(table.offset + 4);
  let family = "";
  for (let i = 0; i < count; i++) {
    const rec = table.offset + 6 + i * 12;
    const plat = view.getUint16(rec);
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = storage + view.getUint16(rec + 10);
    if (nameId !== 1 && nameId !== 16) continue;
    let text = "";
    if (plat === 3) {
      for (let n = 0; n < length; n += 2) text += String.fromCharCode(view.getUint16(offset + n));
    } else {
      for (let n = 0; n < length; n++) text += String.fromCharCode(view.getUint8(offset + n));
    }
    text = text.replace(/\0/g, "").trim();
    if (!text) continue;
    if (nameId === 16) return text;
    if (!family) family = text;
  }
  return family || "untitled";
}

function readSimpleGlyph(view: DataView, offset: number, contours: number): TtfPoint[][] {
  const xMin = view.getInt16(offset + 2);
  const xMax = view.getInt16(offset + 6);
  const ends: number[] = [];
  let p = offset + 10;
  for (let i = 0; i < contours; i++) ends.push(view.getUint16(p + 2 * i));
  p += 2 * contours;
  const instr = view.getUint16(p);
  p += 2 + instr;
  const nPoints = (ends[ends.length - 1] ?? -1) + 1;
  const flags: number[] = [];
  for (let i = 0; i < nPoints; ) {
    const flag = view.getUint8(p++);
    flags.push(flag);
    i++;
    if (flag & 8) {
      const repeat = view.getUint8(p++);
      for (let r = 0; r < repeat; r++) {
        flags.push(flag);
        i++;
      }
    }
  }
  const xs = new Array<number>(nPoints).fill(0);
  const ys = new Array<number>(nPoints).fill(0);
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
  const out: TtfPoint[][] = [];
  let start = 0;
  for (const end of ends) {
    const contour: TtfPoint[] = [];
    for (let i = start; i <= end; i++) {
      contour.push({ x: xs[i]!, y: ys[i]!, onCurve: (flags[i]! & 1) !== 0 });
    }
    out.push(contour);
    start = end + 1;
  }
  void xMin;
  void xMax;
  return out;
}

export function parseTtf(bytes: Uint8Array): ParsedTtf {
  const data = bytes;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = tablesOf(data);
  const head = requireTable(tables, "head");
  const maxp = requireTable(tables, "maxp");
  const hhea = requireTable(tables, "hhea");
  const hmtx = requireTable(tables, "hmtx");
  const loca = requireTable(tables, "loca");
  const glyf = requireTable(tables, "glyf");
  const cmap = requireTable(tables, "cmap");
  const name = tables.get("name");

  const unitsPerEm = view.getUint16(head.offset + 18);
  const locaFormat = view.getInt16(head.offset + 50);
  const numGlyphs = view.getUint16(maxp.offset + 4);
  const ascender = view.getInt16(hhea.offset + 4);
  const descender = view.getInt16(hhea.offset + 6);
  const numberOfHMetrics = view.getUint16(hhea.offset + 34);

  const advances: number[] = [];
  const lsbs: number[] = [];
  for (let i = 0; i < numberOfHMetrics; i++) {
    advances.push(view.getUint16(hmtx.offset + i * 4));
    lsbs.push(view.getInt16(hmtx.offset + i * 4 + 2));
  }
  const lastAdvance = advances[advances.length - 1] ?? 0;
  for (let i = numberOfHMetrics; i < numGlyphs; i++) {
    advances.push(lastAdvance);
    lsbs.push(view.getInt16(hmtx.offset + numberOfHMetrics * 4 + (i - numberOfHMetrics) * 2));
  }

  const locaOff = (id: number) =>
    locaFormat === 0 ? view.getUint16(loca.offset + 2 * id) * 2 : view.getUint32(loca.offset + 4 * id);

  const cache = new Map<number, TtfGlyph>();

  const loadGlyph = (id: number, depth = 0): TtfGlyph => {
    const cached = cache.get(id);
    if (cached) return cached;
    const empty: TtfGlyph = { advance: advances[id] ?? 0, xMin: 0, xMax: 0, contours: [] };
    if (id < 0 || id >= numGlyphs || depth > 8) return empty;
    const start = glyf.offset + locaOff(id);
    const end = glyf.offset + locaOff(id + 1);
    if (end <= start) {
      cache.set(id, empty);
      return empty;
    }
    const nContours = view.getInt16(start);
    const xMin = view.getInt16(start + 2);
    const xMax = view.getInt16(start + 6);
    if (nContours >= 0) {
      const glyph: TtfGlyph = {
        advance: advances[id] ?? 0,
        xMin,
        xMax,
        contours: readSimpleGlyph(view, start, nContours),
      };
      cache.set(id, glyph);
      return glyph;
    }
    const contours: TtfPoint[][] = [];
    let p = start + 10;
    let more = true;
    while (more) {
      const flags = view.getUint16(p);
      p += 2;
      const childId = view.getUint16(p);
      p += 2;
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
      const dx = flags & 2 ? arg1 : 0;
      const dy = flags & 2 ? arg2 : 0;
      const child = loadGlyph(childId, depth + 1);
      for (const contour of child.contours) {
        contours.push(
          contour.map((pt) => ({
            x: pt.x * xx + pt.y * yx + dx,
            y: pt.x * xy + pt.y * yy + dy,
            onCurve: pt.onCurve,
          })),
        );
      }
      more = (flags & 32) !== 0;
    }
    const glyph: TtfGlyph = { advance: advances[id] ?? 0, xMin, xMax, contours };
    cache.set(id, glyph);
    return glyph;
  };

  void lsbs;
  return {
    unitsPerEm: unitsPerEm || 1000,
    ascender,
    descender,
    familyName: name ? readName(view, name) : "untitled",
    cmap: readCmap(view, cmap),
    glyph: (id) => loadGlyph(id),
  };
}

export function peekFontFamily(bytes: Uint8Array): string {
  try {
    return parseTtf(bytes).familyName;
  } catch {
    return "untitled";
  }
}
