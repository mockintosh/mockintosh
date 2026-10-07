import { describe, expect, it } from "vitest";
import { TileFormatError, decodeTile } from "./mvt";

// A little protobuf writer, enough to build tiles by hand.
function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
const key = (field: number, wire: number) => varint(field * 8 + wire);
const bytes = (field: number, body: number[]) => [...key(field, 2), ...varint(body.length), ...body];
const text = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);
const uint = (field: number, n: number) => [...key(field, 0), ...varint(n)];
const packed = (field: number, values: number[]) => bytes(field, values.flatMap(varint));
const zz = (n: number) => (n << 1) ^ (n >> 31);
const command = (id: number, count: number) => (count << 3) | id;

function feature(type: number, tags: number[], geometry: number[]): number[] {
  return bytes(2, [...packed(2, tags), ...uint(3, type), ...packed(4, geometry)]);
}

function tile(...layers: number[][]): Uint8Array {
  return new Uint8Array(layers.flatMap((layer) => bytes(3, layer)));
}

describe("decodeTile", () => {
  const square = [
    command(1, 1), zz(10), zz(10),
    command(2, 3), zz(20), zz(0), zz(0), zz(20), zz(-20), zz(0),
    command(7, 1),
    // A hole: a second ring in the same polygon.
    command(1, 1), zz(5), zz(-5),
    command(2, 3), zz(0), zz(-10), zz(10), zz(0), zz(0), zz(10),
    command(7, 1),
  ];
  const water = [
    ...uint(15, 2),
    ...text(1, "water"),
    ...feature(3, [0, 0, 1, 1], square),
    ...text(3, "class"),
    ...text(3, "rank"),
    ...bytes(4, text(1, "lake")),
    ...bytes(4, uint(4, 7)),
    ...uint(5, 4096),
  ];
  const roads = [
    ...text(1, "transportation"),
    ...text(3, "class"),
    ...bytes(4, text(1, "primary")),
    ...feature(2, [0, 0], [
      command(1, 1), zz(0), zz(0), command(2, 2), zz(100), zz(0), zz(0), zz(100),
      command(1, 1), zz(50), zz(50), command(2, 1), zz(1), zz(1),
    ]),
    ...uint(5, 512),
  ];
  const places = [
    ...text(1, "place"),
    ...text(3, "name"),
    ...text(3, "capital"),
    ...bytes(4, text(1, "Göteborg")),
    ...bytes(4, [...key(7, 0), 1]),
    ...feature(1, [0, 0, 1, 1], [command(1, 2), zz(3), zz(4), zz(1), zz(1)]),
  ];

  it("reads layers, their extents and their features' values", () => {
    const decoded = decodeTile(tile(water, roads, places));
    expect([...decoded.keys()]).toEqual(["water", "transportation", "place"]);
    const lake = decoded.get("water")!.features[0]!;
    expect(decoded.get("water")!.extent).toBe(4096);
    expect(decoded.get("transportation")!.extent).toBe(512);
    expect(lake.type).toBe(3);
    expect(lake.get("class")).toBe("lake");
    expect(lake.get("rank")).toBe(7);
    expect(lake.get("missing")).toBeUndefined();
    expect(decoded.get("place")!.features[0]!.properties()).toEqual({ name: "Göteborg", capital: true });
  });

  it("decodes polygon rings with their holes", () => {
    const lake = decodeTile(tile(water)).get("water")!.features[0]!.geometry();
    expect([...lake.parts]).toEqual([0, 4, 8]);
    expect([...lake.coords]).toEqual([10, 10, 30, 10, 30, 30, 10, 30, 15, 25, 15, 15, 25, 15, 25, 25]);
  });

  it("splits lines at each MoveTo and keeps a multipoint as one part", () => {
    const road = decodeTile(tile(roads)).get("transportation")!.features[0]!.geometry();
    expect([...road.parts]).toEqual([0, 3, 5]);
    expect([...road.coords]).toEqual([0, 0, 100, 0, 100, 100, 150, 150, 151, 151]);
    const point = decodeTile(tile(places)).get("place")!.features[0]!.geometry();
    expect([...point.parts]).toEqual([0, 2]);
    expect([...point.coords]).toEqual([3, 4, 4, 5]);
  });

  it("refuses bytes that end mid-field", () => {
    const whole = tile(water);
    expect(() => decodeTile(whole.subarray(0, whole.length - 3))).toThrow(TileFormatError);
  });
});
