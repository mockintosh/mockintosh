/**
 * Mapbox Vector Tiles (vector-tile-spec 2.1): the protobuf a tile server
 * sends, read into layers of features. Geometry stays in tile units (0 to
 * `extent`, usually 4096) and is decoded only when a feature is drawn; a
 * dense city tile holds tens of thousands of features, most of them in layers
 * the map never shows at that zoom.
 */

export type Value = string | number | boolean;

/** 1 = points, 2 = lines, 3 = polygons (rings, outer ones clockwise on screen). */
export type GeometryType = 1 | 2 | 3;

/**
 * A feature's shape: `coords` holds x, y pairs, and part `i` (a point group,
 * a line, or a ring) runs from point `parts[i]` up to `parts[i + 1]`.
 */
export interface Geometry {
  coords: Int32Array;
  parts: Int32Array;
  /** The bounding box, so a renderer can skip what it won't reach. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TileLayer {
  readonly name: string;
  readonly extent: number;
  readonly features: readonly TileFeature[];
}

export type VectorTile = ReadonlyMap<string, TileLayer>;

/** Thrown for bytes that are not a vector tile. */
export class TileFormatError extends Error {}

class Reader {
  pos = 0;
  private view: DataView | null = null;

  constructor(readonly buf: Uint8Array, readonly end = buf.length) {}

  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      if (this.pos >= this.end) throw new TileFormatError("Truncated varint");
      const byte = this.buf[this.pos++]!;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 128;
    }
  }

  /** The end of a length-delimited field that starts here. */
  span(): number {
    const end = this.varint() + this.pos;
    if (end > this.end) throw new TileFormatError("Field runs past the end of its message");
    return end;
  }

  string(): string {
    const end = this.span();
    const text = decoder.decode(this.buf.subarray(this.pos, end));
    this.pos = end;
    return text;
  }

  float(): number {
    const value = this.data(4).getFloat32(this.pos, true);
    this.pos += 4;
    return value;
  }

  double(): number {
    const value = this.data(8).getFloat64(this.pos, true);
    this.pos += 8;
    return value;
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos = this.span();
    else if (wire === 5) this.pos += 4;
    else throw new TileFormatError(`Unknown wire type ${wire}`);
    if (this.pos > this.end) throw new TileFormatError("Field runs past the end of its message");
  }

  private data(size: number): DataView {
    if (this.pos + size > this.end) throw new TileFormatError("Truncated number");
    return (this.view ??= new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength));
  }
}

const decoder = new TextDecoder();

function zigzag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

/** Values whose varint read as an unsigned 64-bit number. */
function signed64(n: number): number {
  return n >= 2 ** 63 ? n - 2 ** 64 : n;
}

interface LayerData {
  keys: string[];
  values: Value[];
  keyIndex: Map<string, number>;
}

export class TileFeature {
  private shape: Geometry | null = null;

  constructor(
    private readonly layer: LayerData,
    private readonly buf: Uint8Array,
    readonly type: GeometryType,
    private readonly tags: readonly number[],
    private readonly geometryStart: number,
    private readonly geometryEnd: number,
  ) {}

  /** The feature's value for `key`, if it has one. */
  get(key: string): Value | undefined {
    const k = this.layer.keyIndex.get(key);
    if (k === undefined) return undefined;
    for (let i = 0; i < this.tags.length; i += 2) {
      if (this.tags[i] === k) return this.layer.values[this.tags[i + 1]!];
    }
    return undefined;
  }

  /** Every property, for inspection and tests. */
  properties(): Record<string, Value> {
    const out: Record<string, Value> = {};
    for (let i = 0; i < this.tags.length; i += 2) {
      const key = this.layer.keys[this.tags[i]!];
      const value = this.layer.values[this.tags[i + 1]!];
      if (key !== undefined && value !== undefined) out[key] = value;
    }
    return out;
  }

  geometry(): Geometry {
    return (this.shape ??= decodeGeometry(this.buf, this.geometryStart, this.geometryEnd, this.type));
  }
}

function decodeGeometry(buf: Uint8Array, start: number, end: number, type: GeometryType): Geometry {
  const reader = new Reader(buf, end);
  reader.pos = start;
  const coords: number[] = [];
  const parts: number[] = [];
  let x = 0;
  let y = 0;
  while (reader.pos < end) {
    const command = reader.varint();
    const id = command & 7;
    const count = command >>> 3;
    if (id === 1 || id === 2) {
      // A MoveTo starts a part, except between the points of a multipoint.
      if (id === 1 && (type !== 1 || parts.length === 0)) parts.push(coords.length / 2);
      for (let i = 0; i < count; i++) {
        x += zigzag(reader.varint());
        y += zigzag(reader.varint());
        coords.push(x, y);
      }
    } else if (id !== 7) {
      throw new TileFormatError(`Unknown geometry command ${id}`);
    }
  }
  parts.push(coords.length / 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    const px = coords[i]!, py = coords[i + 1]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { coords: Int32Array.from(coords), parts: Int32Array.from(parts), minX, minY, maxX, maxY };
}

function readValue(reader: Reader): Value | undefined {
  const end = reader.span();
  let value: Value | undefined;
  while (reader.pos < end) {
    const tag = reader.varint();
    const field = tag >>> 3;
    if (field === 1) value = reader.string();
    else if (field === 2) value = reader.float();
    else if (field === 3) value = reader.double();
    else if (field === 4) value = signed64(reader.varint());
    else if (field === 5) value = reader.varint();
    else if (field === 6) value = zigzag(reader.varint());
    else if (field === 7) value = reader.varint() !== 0;
    else reader.skip(tag & 7);
  }
  reader.pos = end;
  return value;
}

function readFeature(reader: Reader, layer: LayerData, out: TileFeature[]): void {
  const end = reader.span();
  let type = 0;
  let tags: number[] = [];
  let geometryStart = -1;
  let geometryEnd = -1;
  while (reader.pos < end) {
    const tag = reader.varint();
    const field = tag >>> 3;
    if (field === 2 && (tag & 7) === 2) {
      const tagsEnd = reader.span();
      tags = [];
      while (reader.pos < tagsEnd) tags.push(reader.varint());
    } else if (field === 3) {
      type = reader.varint();
    } else if (field === 4 && (tag & 7) === 2) {
      geometryEnd = reader.span();
      geometryStart = reader.pos;
      reader.pos = geometryEnd;
    } else {
      reader.skip(tag & 7);
    }
  }
  reader.pos = end;
  if ((type === 1 || type === 2 || type === 3) && geometryStart >= 0) {
    out.push(new TileFeature(layer, reader.buf, type, tags, geometryStart, geometryEnd));
  }
}

function readLayer(reader: Reader): TileLayer {
  const end = reader.span();
  const data: LayerData = { keys: [], values: [], keyIndex: new Map() };
  const features: TileFeature[] = [];
  let name = "";
  let extent = 4096;
  while (reader.pos < end) {
    const tag = reader.varint();
    const field = tag >>> 3;
    if (field === 1) name = reader.string();
    else if (field === 2) readFeature(reader, data, features);
    else if (field === 3) {
      const key = reader.string();
      if (!data.keyIndex.has(key)) data.keyIndex.set(key, data.keys.length);
      data.keys.push(key);
    } else if (field === 4) data.values.push(readValue(reader) ?? "");
    else if (field === 5) extent = reader.varint();
    else reader.skip(tag & 7);
  }
  reader.pos = end;
  return { name, extent, features };
}

/** Read a tile's layers by name. Throws `TileFormatError` for anything else. */
export function decodeTile(bytes: Uint8Array): VectorTile {
  const reader = new Reader(bytes);
  const layers = new Map<string, TileLayer>();
  while (reader.pos < reader.end) {
    const tag = reader.varint();
    if (tag >>> 3 === 3 && (tag & 7) === 2) {
      const layer = readLayer(reader);
      layers.set(layer.name, layer);
    } else {
      reader.skip(tag & 7);
    }
  }
  return layers;
}
