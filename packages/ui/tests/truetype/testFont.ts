/**
 * Builds small TrueType fonts for scaler tests: glyphs are lists of
 * contours in font units (y up, clockwise outer contours), mapped through a
 * format-12 cmap so astral code points work.
 */

interface TestPoint {
  x: number;
  y: number;
  on?: boolean;
}

interface TestGlyph {
  advance: number;
  contours: TestPoint[][];
}

interface TestFontSpec {
  family: string;
  subfamily?: string;
  unitsPerEm?: number;
  ascender?: number;
  descender?: number;
  lineGap?: number;
  weightClass?: number;
  italic?: boolean;
  glyphs: Record<string, TestGlyph>;
  kerning?: [string, string, number][];
}

const u8 = (n: number) => [n & 0xff];
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const i16 = (n: number) => u16(n & 0xffff);
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function pack(tables: Record<string, number[]>): Uint8Array {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const out: number[] = [...u32(0x00010000), ...u16(n), ...u16(16), ...u16(0), ...u16(0)];
  let offset = 12 + n * 16;
  const bodies: number[] = [];
  for (const tag of tags) {
    const body = tables[tag]!;
    out.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(offset), ...u32(body.length));
    const padded = [...body];
    while (padded.length % 4) padded.push(0);
    bodies.push(...padded);
    offset += padded.length;
  }
  return new Uint8Array([...out, ...bodies]);
}

function encodeGlyph(glyph: TestGlyph): number[] {
  if (glyph.contours.length === 0) return [];
  const pts = glyph.contours.flat();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const out = [
    ...i16(glyph.contours.length),
    ...i16(Math.min(...xs)),
    ...i16(Math.min(...ys)),
    ...i16(Math.max(...xs)),
    ...i16(Math.max(...ys)),
  ];
  let end = -1;
  for (const c of glyph.contours) {
    end += c.length;
    out.push(...u16(end));
  }
  out.push(...u16(0));
  for (const p of pts) out.push(p.on === false ? 0 : 1);
  let x = 0;
  for (const p of pts) {
    out.push(...i16(p.x - x));
    x = p.x;
  }
  let y = 0;
  for (const p of pts) {
    out.push(...i16(p.y - y));
    y = p.y;
  }
  while (out.length % 2) out.push(0);
  return out;
}

function nameRecord(id: number, text: string): { rec: number[]; data: number[] } {
  const data = [...text].flatMap((c) => u16(c.charCodeAt(0)));
  return { rec: [...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(data.length)], data };
}

function buildTestFont(spec: TestFontSpec): Uint8Array {
  const upem = spec.unitsPerEm ?? 1000;
  const ascender = spec.ascender ?? 800;
  const descender = spec.descender ?? -200;
  const lineGap = spec.lineGap ?? 0;
  const chars = Object.keys(spec.glyphs).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
  const glyphs: TestGlyph[] = [{ advance: upem / 2, contours: [] }, ...chars.map((c) => spec.glyphs[c]!)];
  const gidOf = (ch: string) => chars.indexOf(ch) + 1;

  const glyf: number[] = [];
  const loca: number[] = [];
  for (const g of glyphs) {
    loca.push(...u32(glyf.length));
    glyf.push(...encodeGlyph(g));
  }
  loca.push(...u32(glyf.length));

  const hmtx = glyphs.flatMap((g) => [...u16(g.advance), ...i16(0)]);
  const cmap12Groups = chars.map((c) => [...u32(c.codePointAt(0)!), ...u32(c.codePointAt(0)!), ...u32(gidOf(c))]);
  const cmap12 = [...u16(12), ...u16(0), ...u32(16 + cmap12Groups.length * 12), ...u32(0), ...u32(cmap12Groups.length), ...cmap12Groups.flat()];
  const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(10), ...u32(12), ...cmap12];

  const head = [
    ...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0), ...u16(upem),
    ...u32(0), ...u32(0), ...u32(0), ...u32(0),
    ...i16(0), ...i16(descender), ...i16(upem), ...i16(ascender),
    ...u16(((spec.weightClass ?? 400) >= 700 ? 1 : 0) | (spec.italic ? 2 : 0)), ...u16(8), ...i16(2), ...i16(1), ...i16(0),
  ];
  const hhea = [
    ...u32(0x00010000), ...i16(ascender), ...i16(descender), ...i16(lineGap), ...u16(upem),
    ...i16(0), ...i16(0), ...i16(upem), ...i16(1), ...i16(0), ...i16(0),
    ...i16(0), ...i16(0), ...i16(0), ...i16(0), ...i16(0), ...u16(glyphs.length),
  ];
  const maxp = [...u32(0x00005000), ...u16(glyphs.length)];
  const os2 = [
    ...u16(1), ...i16(500), ...u16(spec.weightClass ?? 400), ...u16(5), ...u16(0),
    ...Array(20).fill(0), ...i16(0), ...Array(10).fill(0), ...Array(16).fill(0), ...Array(4).fill(0),
    ...u16((spec.italic ? 1 : 0) | ((spec.weightClass ?? 400) >= 700 ? 32 : 0)), ...u16(32), ...u16(0xffff),
    ...i16(ascender), ...i16(descender), ...i16(lineGap), ...u16(ascender), ...u16(-descender), ...u32(1), ...u32(0),
  ];
  const names = [nameRecord(1, spec.family), nameRecord(2, spec.subfamily ?? "Regular")];
  const nameData: number[] = [];
  const nameRecs: number[] = [];
  for (const n of names) {
    nameRecs.push(...n.rec, ...u16(nameData.length));
    nameData.push(...n.data);
  }
  const name = [...u16(0), ...u16(names.length), ...u16(6 + nameRecs.length), ...nameRecs, ...nameData];

  const tables: Record<string, number[]> = { cmap, glyf, head, hhea, hmtx, loca, maxp, name, "OS/2": os2 };
  if (spec.kerning?.length) {
    const pairs = spec.kerning
      .map(([l, r, v]) => [gidOf(l), gidOf(r), v] as const)
      .sort((a, b) => a[0] * 65536 + a[1] - (b[0] * 65536 + b[1]));
    const body = [...u16(pairs.length), ...u16(0), ...u16(0), ...u16(0), ...pairs.flatMap(([l, r, v]) => [...u16(l), ...u16(r), ...i16(v)])];
    tables["kern"] = [...u16(0), ...u16(1), ...u16(0), ...u16(6 + body.length), ...u8(0), ...u8(1), ...body];
  }
  return pack(tables);
}

/** Clockwise rectangle (an outer contour in TrueType's winding). */
function rect(x0: number, y0: number, x1: number, y1: number): TestPoint[] {
  return [
    { x: x0, y: y0 },
    { x: x0, y: y1 },
    { x: x1, y: y1 },
    { x: x1, y: y0 },
  ];
}

/** Rounded bowl: quadratic corners, outer clockwise and inner counter-clockwise. */
function bowl(cx: number, cy: number, rx: number, ry: number, thick: number): TestPoint[][] {
  const ring = (a: number, b: number, clockwise: boolean): TestPoint[] => {
    const pts: TestPoint[] = [
      { x: cx - a, y: cy },
      { x: cx - a, y: cy + b, on: false },
      { x: cx, y: cy + b },
      { x: cx + a, y: cy + b, on: false },
      { x: cx + a, y: cy },
      { x: cx + a, y: cy - b, on: false },
      { x: cx, y: cy - b },
      { x: cx - a, y: cy - b, on: false },
    ];
    if (clockwise) return pts;
    return [pts[0]!, ...pts.slice(1).reverse()];
  };
  return [ring(rx, ry, true), ring(rx - thick, ry - thick, false)];
}

// --- Shared fixture -------------------------------------------------------

/** Three 140-unit stems starting at different sub-pixel phases at 10 ppem. */
const stems: TestGlyph = {
  advance: 1000,
  contours: [rect(100, 0, 240, 500), rect(430, 0, 570, 500), rect(760, 0, 900, 500)],
};

export const TEST_GLYPHS: Record<string, TestGlyph> = {
  " ": { advance: 300, contours: [] },
  l: { advance: 340, contours: [rect(100, 0, 240, 750)] },
  I: { advance: 340, contours: [rect(100, 0, 240, 700)] },
  H: { advance: 700, contours: [rect(100, 0, 240, 700), rect(460, 0, 600, 700), rect(240, 300, 460, 400)] },
  x: { advance: 600, contours: [rect(60, 0, 540, 500)] },
  z: { advance: 600, contours: [rect(60, 0, 540, 500)] },
  o: { advance: 700, contours: bowl(350, 250, 250, 270, 120) },
  m: stems,
  "!": { advance: 400, contours: [rect(160, 100, 220, 700)] },
  A: { advance: 700, contours: [rect(50, 0, 650, 700)] },
  V: { advance: 700, contours: [rect(50, 0, 650, 700)] },
  "Å": { advance: 700, contours: [rect(50, 0, 650, 700), rect(250, 780, 450, 950)] },
  // Outside Decker's 256 (a page strike), taller than any line box.
  "\u01fa": { advance: 700, contours: [rect(50, 0, 650, 700), rect(250, 780, 450, 1300)] },
  "Ω": { advance: 700, contours: [rect(80, 0, 620, 700)] },
  "\u{1F600}": { advance: 900, contours: [rect(50, -100, 850, 700)] },
};

export function testFontBytes(extra: Partial<TestFontSpec> = {}): Uint8Array {
  return buildTestFont({
    family: "Test Sans",
    glyphs: TEST_GLYPHS,
    kerning: [["A", "V", -80]],
    ...extra,
  });
}

