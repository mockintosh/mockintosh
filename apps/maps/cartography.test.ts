import { describe, expect, it } from "vitest";
import { Bitmap } from "./bitmap";
import { drawTile, generalizeWater } from "./cartography";
import type { TileFeature, TileLayer, Value, VectorTile } from "./mvt";

/** A feature from flat x, y rings or lines, in pixels (the tile is drawn at scale 1). */
function feature(type: 2 | 3, props: Record<string, Value>, ...parts: number[][]): TileFeature {
  const coords = Int32Array.from(parts.flat());
  const starts = [0];
  for (const part of parts) starts.push(starts.at(-1)! + part.length / 2);
  const xs = parts.flat().filter((_, i) => i % 2 === 0);
  const ys = parts.flat().filter((_, i) => i % 2 === 1);
  const geometry = { coords, parts: Int32Array.from(starts), minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return { type, geometry: () => geometry, get: (key: string) => props[key], properties: () => props } as unknown as TileFeature;
}

function tile(layers: Record<string, TileFeature[]>): VectorTile {
  return new Map(Object.entries(layers).map(([name, features]): [string, TileLayer] => [name, { name, extent: 64, features }]));
}

const square = (x: number, y: number, size: number) => [x, y, x + size, y, x + size, y + size, x, y + size];
const ink = (b: Bitmap, x0: number, y0: number, x1: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += b.pixels[y * b.width + x]!;
  return n;
};
const draw = (layers: Record<string, TileFeature[]>, zoom: number) => {
  const b = new Bitmap(64, 64);
  drawTile(b, tile(layers), zoom, { scale: 1, offsetX: 0, offsetY: 0 });
  return b;
};

describe("drawTile", () => {
  it("leaves out lakes and islands too small to read", () => {
    const lake = feature(3, { class: "lake" }, square(4, 4, 40), square(20, 20, 3));
    const pond = feature(3, { class: "lake" }, square(52, 52, 4));
    const b = draw({ water: [lake, pond] }, 12);
    // The island is hatched over like the rest of the lake (one hatch period along), not outlined.
    expect(ink(b, 19, 19, 25, 25)).toBe(ink(b, 27, 19, 33, 25));
    expect(ink(b, 50, 50, 58, 58)).toBe(0);
    expect(ink(b, 4, 4, 44, 5)).toBeGreaterThan(30);
  });

  it("shows a road class only from its zoom on", () => {
    const road = (cls: string) => feature(2, { class: cls }, [0, 32, 64, 32]);
    const roads = { transportation: [road("primary")] };
    expect(ink(draw(roads, 9), 0, 30, 64, 35)).toBe(0);
    expect(ink(draw(roads, 10), 0, 30, 64, 35)).toBeGreaterThan(60);
    const motorway = { transportation: [road("motorway")] };
    expect(ink(draw(motorway, 6), 0, 30, 64, 35)).toBe(0);
    // A motorway is a single heavy line until there's room for a casing.
    expect(ink(draw(motorway, 10), 0, 30, 64, 35)).toBeGreaterThan(120);
  });
});

describe("generalizeWater", () => {
  /** A mask from rows of `#` (water) and `.` (land). */
  function mask(rows: string[]): [Uint8Array, number, number] {
    return [Uint8Array.from(rows.join("").split(""), (c) => (c === "#" ? 1 : 0)), rows[0]!.length, rows.length];
  }
  const rows = (pixels: Uint8Array, width: number) =>
    Array.from({ length: pixels.length / width }, (_, y) => Array.from(pixels.subarray(y * width, (y + 1) * width), (v) => (v ? "#" : ".")).join(""));

  it("drops short creeks and specks but keeps long narrow water and anything running off the edge", () => {
    const [pixels, width, height] = mask([
      "..............................",
      ".######.......................",
      ".######.......................",
      ".########............###......",
      ".######..............###......",
      ".######..............###......",
      "..............................",
      "..###########################.",
      "..............................",
      "..........................####",
      "..............................",
    ]);
    expect(rows(generalizeWater(pixels, width, height), width)).toEqual([
      "..............................",
      ".######.......................",
      ".######.......................",
      ".######.......................",
      ".######.......................",
      ".######.......................",
      "..............................",
      "..###########################.",
      "..............................",
      "..........................####",
      "..............................",
    ]);
  });
});
