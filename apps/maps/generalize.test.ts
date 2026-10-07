import { describe, expect, it } from "vitest";
import { generalize, straighten, traceRings } from "./generalize";
import type { Building } from "./perspective";

/** A rectangular building, x0..x1 by y0..y1 in tile units, `height` metres tall, its outline clockwise (y down). */
function house(x0: number, y0: number, x1: number, y1: number, height = 10): Building {
  const xs = Float64Array.from([x0, x1, x1, x0]);
  const ys = Float64Array.from([y0, y0, y1, y1]);
  return { xs, ys, walls: Uint8Array.from([1, 1, 1, 1]), height, base: 0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0) };
}

/** Tile units are metres here. */
const METRE = 1;
const EXTENT = 4096;

describe("generalize", () => {
  it("joins a row of houses into one block, as tall as they are", () => {
    const row = [0, 1, 2, 3, 4].map((k) => house(100 + k * 8, 100, 108 + k * 8, 112, 9 + (k % 2)));
    const { singles, blocks } = generalize(row, METRE, EXTENT);
    expect(singles).toHaveLength(0);
    expect(blocks).toHaveLength(1);
    const [{ block, members, memberSize }] = blocks;
    expect(members).toHaveLength(5);
    expect(block.height).toBeCloseTo(9.4, 1);
    expect(memberSize).toBeCloseTo(Math.sqrt(8 * 12), 6);
    // About the row's footprint: 40 × 12, give or take a cell.
    expect(block.size).toBeGreaterThan(38);
    expect(block.size).toBeLessThan(44);
  });

  it("joins houses across a narrow alley, not across a street", () => {
    const alley = [house(100, 100, 110, 110), house(112, 100, 122, 110)];
    expect(generalize(alley, METRE, EXTENT).blocks).toHaveLength(1);
    const street = [house(100, 100, 110, 110), house(125, 100, 135, 110)];
    const across = generalize(street, METRE, EXTENT);
    expect(across.blocks).toHaveLength(0);
    expect(across.singles).toHaveLength(2);
  });

  it("leaves a tower, and a much bigger building, out of the block next to them", () => {
    const row = [house(100, 100, 108, 112), house(108, 100, 116, 112), house(116, 100, 124, 112, 80), house(124, 100, 184, 160)];
    const { singles, blocks } = generalize(row, METRE, EXTENT);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.members).toHaveLength(2);
    expect(singles.map((b) => b.height).sort((a, b) => a - b)).toEqual([10, 80]);
  });
});

describe("traceRings and straighten", () => {
  it("traces a filled shape clockwise and takes out its stair-steps", () => {
    // An L of cells.
    const mask = Uint8Array.from([
      1, 1, 0,
      1, 1, 0,
      1, 1, 1,
    ]);
    const [ring, ...rest] = traceRings(mask, 3, 3);
    expect(rest).toHaveLength(0);
    let area = 0;
    for (let i = 0; i < ring!.length / 2; i++) {
      const j = (i + 1) % (ring!.length / 2);
      area += ring![2 * i]! * ring![2 * j + 1]! - ring![2 * j]! * ring![2 * i + 1]!;
    }
    expect(area / 2).toBe(7);
    // Straightened, an L has its six corners.
    expect(straighten(ring!, 0.1).length / 2).toBe(6);
  });
});
