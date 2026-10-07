import { describe, expect, it } from "vitest";
import { buildingMesh, triangulate } from "./gpuBuildings";
import type { Building } from "./perspective";

/** A rectangular building, its outline clockwise (y down), in tile units. */
function house(x0: number, y0: number, x1: number, y1: number, height = 10, base = 0): Building {
  const xs = Float64Array.from([x0, x1, x1, x0]);
  const ys = Float64Array.from([y0, y0, y1, y1]);
  return { xs, ys, walls: Uint8Array.from([1, 1, 1, 1]), height, base, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0) };
}

const NUMBERS = 8;
/** A corner's code, taken apart. */
const decode = (code: number) => ({ place: Math.floor(code / 512), value: code & 7, role: (code >> 3) & 7, flags: (code >> 6) & 7 });

describe("buildingMesh", () => {
  it("makes a building's roof, walls and edges, triangles first", () => {
    const mesh = buildingMesh([house(0, 0, 20, 10, 30, 5)]);
    // A roof of two triangles and four walls of two; four roof edges, four along the foot, four upright.
    expect(mesh.triangles).toBe(6 + 4 * 6);
    expect(mesh.lines).toBe(8 + 8 + 8);
    expect(mesh.corners.length).toBe((mesh.triangles + mesh.lines) * NUMBERS);
    expect(Array.from(mesh.data)).toEqual([10, 5, 30, 20, 0, 0, 0, 0]);

    const corner = (k: number) => Array.from(mesh.corners.subarray(k * NUMBERS, (k + 1) * NUMBERS));
    // The roof, white, at the building's height.
    expect(corner(0)[2]).toBe(30);
    expect(decode(corner(0)[3]!)).toEqual({ place: 0, value: 1, role: 0, flags: 0 });
    // The first wall runs east along the north side: it faces north, from its foot to its roof.
    const wall = Array.from({ length: 6 }, (_, k) => corner(6 + k));
    expect(new Set(wall.map((c) => c[2]))).toEqual(new Set([5, 30]));
    expect(wall[0]!.slice(4, 7)).toEqual([0, -1, 0]);
    expect(decode(wall[0]![3]!).role).toBe(1);
    // Every edge is black.
    for (let k = mesh.triangles; k < mesh.triangles + mesh.lines; k++) expect(decode(corner(k)[3]!).value).toBe(2);
    // A box's corners are all sharp, with a wall either side.
    const uprights = Array.from({ length: mesh.lines }, (_, k) => corner(mesh.triangles + k)).filter((c) => decode(c[3]!).role === 4);
    expect(uprights).toHaveLength(8);
    for (const c of uprights) expect(decode(c[3]!).flags).toBe(7);
  });

  it("numbers a block and its members, to show one or the other", () => {
    const members = [house(0, 0, 8, 12), house(8, 0, 16, 12)];
    const block = house(0, 0, 16, 12);
    const mesh = buildingMesh([house(40, 40, 50, 50)], [{ block, members, memberSize: 12 }]);
    const data = Array.from(mesh.data);
    expect(data.length).toBe(4 * 8);
    // The single shows always; the block where its members would be small; they where it wouldn't.
    expect(data.slice(4, 8)).toEqual([0, 0, 0, 0]);
    expect(data.slice(12, 16)).toEqual([8, 6, 12, 1]);
    expect(data.slice(20, 24)).toEqual([8, 6, 12, 2]);
    expect(data.slice(28, 32)).toEqual([8, 6, 12, 2]);
    const places = new Set<number>();
    for (let k = 0; k < mesh.triangles + mesh.lines; k++) places.add(decode(mesh.corners[k * NUMBERS + 3]!).place);
    expect(places).toEqual(new Set([0, 1, 2, 3]));
  });

  it("puts no wall or edge where the tile cut a building off", () => {
    const cut = house(0, 0, 20, 10);
    cut.walls[1] = 0;
    const mesh = buildingMesh([cut]);
    expect(mesh.triangles).toBe(6 + 3 * 6);
    // Three roof and foot edges; the cut's two corners keep their upright edge for the wall still there.
    expect(mesh.lines).toBe(6 + 6 + 8);
  });
});

describe("triangulate", () => {
  it("covers a concave outline exactly, with no triangle turned over", () => {
    // An L, clockwise on the screen.
    const xs = [0, 30, 30, 10, 10, 0];
    const ys = [0, 0, 10, 10, 30, 30];
    const out: number[] = [];
    triangulate(xs, ys, 6, out);
    expect(out).toHaveLength(12);
    let total = 0;
    for (let t = 0; t < out.length; t += 3) {
      const [a, b, c] = [out[t]!, out[t + 1]!, out[t + 2]!];
      const area = ((xs[b]! - xs[a]!) * (ys[c]! - ys[a]!) - (xs[c]! - xs[a]!) * (ys[b]! - ys[a]!)) / 2;
      expect(area).toBeGreaterThanOrEqual(0);
      total += area;
    }
    expect(total).toBe(30 * 10 + 10 * 20);
  });
});
