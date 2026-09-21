/** Minimal TrueType used by outline-rasterizer tests: space + a boxed “A”. */

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function i16(n: number): number[] {
  return u16(n & 0xffff);
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function pad4(bytes: number[]): number[] {
  const out = bytes.slice();
  while (out.length % 4) out.push(0);
  return out;
}

function concat(parts: number[][]): number[] {
  return parts.flat();
}

function packTables(tables: { tag: string; body: number[] }[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = sorted.length;
  const searchRange = 16 * 2 ** Math.floor(Math.log2(n));
  const entrySelector = Math.floor(Math.log2(n));
  const rangeShift = n * 16 - searchRange;
  const header = concat([
    u32(0x00010000),
    u16(n),
    u16(searchRange),
    u16(entrySelector),
    u16(rangeShift),
  ]);
  let offset = 12 + n * 16;
  const dir: number[] = [];
  const bodies: number[] = [];
  for (const table of sorted) {
    const padded = pad4(table.body);
    dir.push(
      ...[...table.tag].map((c) => c.charCodeAt(0)),
      ...u32(0),
      ...u32(offset),
      ...u32(table.body.length),
    );
    bodies.push(...padded);
    offset += padded.length;
  }
  return new Uint8Array(concat([header, dir, bodies]));
}

function headTable(): number[] {
  return concat([
    u32(0x00010000),
    u32(0x00010000),
    u32(0),
    u32(0x5f0f3cf5),
    u16(0),
    u16(1000),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    i16(100),
    i16(0),
    i16(700),
    i16(800),
    u16(0),
    u16(8),
    i16(2),
    i16(0),
    i16(0),
  ]);
}

function hheaTable(): number[] {
  return concat([
    u32(0x00010000),
    i16(800),
    i16(-200),
    i16(0),
    u16(800),
    i16(0),
    i16(0),
    i16(700),
    i16(1),
    i16(0),
    i16(0),
    i16(0),
    i16(0),
    i16(0),
    i16(0),
    i16(0),
    u16(3),
  ]);
}

function maxpTable(): number[] {
  return concat([
    u32(0x00010000),
    u16(3),
    u16(4),
    u16(1),
    u16(0),
    u16(0),
    u16(2),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
  ]);
}

function hmtxTable(): number[] {
  return concat([u16(500), i16(0), u16(300), i16(0), u16(800), i16(100)]);
}

function locaTable(): number[] {
  // Glyphs 0 and 1 are empty; glyph 2 (A) starts at glyf offset 0.
  return concat([u16(0), u16(0), u16(0), u16(17)]);
}

function glyfA(): number[] {
  return concat([
    i16(1),
    i16(100),
    i16(0),
    i16(700),
    i16(800),
    u16(3),
    u16(0),
    [0x01, 0x01, 0x01, 0x01],
    i16(100),
    i16(600),
    i16(0),
    i16(-600),
    i16(0),
    i16(0),
    i16(800),
    i16(-800),
  ]);
}

function cmapTable(): number[] {
  const format4 = concat([
    u16(4),
    u16(42),
    u16(0),
    u16(6),
    u16(4),
    u16(1),
    u16(2),
    u16(32),
    u16(65),
    u16(0xffff),
    u16(0),
    u16(32),
    u16(65),
    u16(0xffff),
    i16(1 - 32),
    i16(2 - 65),
    i16(1),
    u16(0),
    u16(0),
    u16(0),
  ]);
  return concat([u16(0), u16(1), u16(3), u16(1), u32(12), format4]);
}

function nameTable(): number[] {
  const tiny = [0x00, 0x54, 0x00, 0x69, 0x00, 0x6e, 0x00, 0x79];
  const record = (nameId: number) =>
    concat([u16(3), u16(1), u16(0x0409), u16(nameId), u16(tiny.length), u16(0)]);
  return concat([u16(0), u16(2), u16(30), record(1), record(4), tiny]);
}

/** Three-glyph TrueType named “Tiny”: U+0020 space, U+0041 a filled box. */
export function buildTinyTtf(): Uint8Array {
  return packTables([
    { tag: "cmap", body: cmapTable() },
    { tag: "glyf", body: glyfA() },
    { tag: "head", body: headTable() },
    { tag: "hhea", body: hheaTable() },
    { tag: "hmtx", body: hmtxTable() },
    { tag: "loca", body: locaTable() },
    { tag: "maxp", body: maxpTable() },
    { tag: "name", body: nameTable() },
  ]);
}
