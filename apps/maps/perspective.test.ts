import { describe, expect, it } from "vitest";
import { Bitmap } from "./bitmap";
import type { TileFeature, VectorTile } from "./mvt";
import { PITCH_3D, Perspective, collectBuildings, drawBuildings } from "./perspective";

describe("Perspective", () => {
  it("is the flat map when it doesn't tilt", () => {
    const view = new Perspective(400, 300, 0);
    expect(view.project(30, -20)).toEqual([230, 130]);
    const [x, y] = view.ground(230, 130)!;
    expect(x).toBeCloseTo(30, 9);
    expect(y).toBeCloseTo(-20, 9);
  });

  it("finds on the ground the point it put on the screen", () => {
    const view = new Perspective(400, 300, PITCH_3D);
    for (const [x, y] of [[0, 0], [120, -340], [-80, 90]] as const) {
      const [sx, sy] = view.project(x, y)!;
      const [gx, gy] = view.ground(sx, sy)!;
      expect(gx).toBeCloseTo(x, 6);
      expect(gy).toBeCloseTo(y, 6);
    }
    // The point looked at keeps the flat map's place and scale.
    expect(view.project(0, 0)).toEqual([200, 150]);
    expect(view.project(1, 0)![0] - 200).toBeCloseTo(1, 6);
  });

  it("shows the far side of the ground smaller, and raises what stands on it", () => {
    const view = new Perspective(400, 300, PITCH_3D);
    const near = view.project(10, 100)![0] - view.project(0, 100)![0];
    const far = view.project(10, -300)![0] - view.project(0, -300)![0];
    expect(far).toBeLessThan(near);
    expect(view.project(0, 0, 50)![1]).toBeLessThan(150);
  });

  it("turns to face its bearing", () => {
    // Facing east, a point east of the middle is ahead, up the screen; north is to the left.
    const east = new Perspective(400, 300, 0, Math.PI / 2);
    const [ex, ey] = east.project(0, 0)!;
    expect([ex, ey]).toEqual([200, 150]);
    const [ax, ay] = east.project(50, 0)!;
    expect(ax).toBeCloseTo(200, 6);
    expect(ay).toBeCloseTo(100, 6);
    const [nx, ny] = east.project(0, -50)!;
    expect(nx).toBeCloseTo(150, 6);
    expect(ny).toBeCloseTo(150, 6);
    // Tilted and turned, the ground under a screen point is where it came from.
    const view = new Perspective(400, 300, PITCH_3D, 2.1);
    const [sx, sy] = view.project(-70, 130)!;
    const [gx, gy] = view.ground(sx, sy)!;
    expect(gx).toBeCloseTo(-70, 6);
    expect(gy).toBeCloseTo(130, 6);
  });

  it("draws everything at the map's scale orthographic, near or far", () => {
    const view = new Perspective(400, 300, PITCH_3D, 0.7, true);
    const step = (y: number) => {
      const a = view.project(0, y)!;
      const b = view.project(10, y)!;
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    // Ten pixels on the ground are as long on the screen near as far (the tilt only foreshortens them).
    expect(step(-400)).toBeCloseTo(step(200), 6);
    expect(new Perspective(400, 300, PITCH_3D, 0, true).project(10, 0)![0] - 200).toBeCloseTo(10, 6);
    // A height rises the same anywhere: sin(pitch) of it.
    expect(view.project(0, 0)![1] - view.project(0, 0, 40)![1]).toBeCloseTo(40 * Math.sin(PITCH_3D), 6);
    expect(view.project(0, -400)![1] - view.project(0, -400, 40)![1]).toBeCloseTo(40 * Math.sin(PITCH_3D), 6);
    // And the ground under a screen point is where it came from.
    const [sx, sy] = view.project(-70, 130)!;
    const [gx, gy] = view.ground(sx, sy)!;
    expect(gx).toBeCloseTo(-70, 6);
    expect(gy).toBeCloseTo(130, 6);
  });

  it("draws buildings orthographic too, each surface hiding what's behind it", () => {
    const view = new Perspective(200, 150, PITCH_3D, -Math.PI / 2, true);
    const target = new Bitmap(200, 150);
    const buildings = collectBuildings(tile([[-20, -20, 20, -20, 20, 20, -20, 20, -20, -20]], { render_height: 40 }));
    drawBuildings(target, view, [{ buildings, scale: 1, x: 0, y: 0 }], 0, 0, 1);
    // Facing west: the east wall in front is shaded, the roof above it white.
    const [sx, groundY] = view.project(20, 0)!;
    const [, roofY] = view.project(20, 0, 40)!;
    let wall = 0;
    for (let y = Math.ceil(roofY) + 2; y < Math.floor(groundY) - 1; y++) wall += target.pixels[y * 200 + Math.round(sx)]!;
    expect(wall).toBeGreaterThan(0);
    const [cx, cy] = view.project(0, 0, 40)!;
    expect(target.pixels[Math.round(cy) * 200 + Math.round(cx)]).toBe(0);
  });

  it("lays the flat map on the ground", () => {
    const flat = new Bitmap(800, 800);
    // A black square on the point looked at.
    for (let y = 395; y < 405; y++) flat.span(y, 395, 405, { pattern: [255, 255, 255, 255, 255, 255, 255, 255] });
    const view = new Perspective(200, 150, PITCH_3D);
    const out = new Bitmap(200, 150);
    view.warp(flat, -400, -400, out);
    expect(out.pixels[75 * 200 + 100]).toBe(1);
    expect(out.pixels[10 * 200 + 10]).toBe(0);
  });
});

/** A tile with one building layer of the given rings, in tile units of 4096. */
function tile(rings: number[][], props: Record<string, number> = {}): VectorTile {
  const coords = Int32Array.from(rings.flat());
  const parts = [0];
  for (const ring of rings) parts.push(parts.at(-1)! + ring.length / 2);
  const feature = {
    type: 3,
    geometry: () => ({ coords, parts: Int32Array.from(parts) }),
    get: (key: string) => props[key],
  } as unknown as TileFeature;
  return new Map([["building", { name: "building", extent: 4096, features: [feature] }]]);
}

describe("collectBuildings", () => {
  // Clockwise on the tile (y down): an outline. Its hole runs the other way.
  const outline = [100, 100, 300, 100, 300, 300, 100, 300, 100, 100];
  const hole = [150, 150, 150, 250, 250, 250, 250, 150, 150, 150];

  it("raises outlines to their mapped height, and leaves holes be", () => {
    const [building, ...rest] = collectBuildings(tile([outline, hole], { render_height: 30, render_min_height: 5 }));
    expect(rest).toHaveLength(0);
    expect(building!.height).toBe(30);
    expect(building!.base).toBe(5);
    // In the tile's own units, for any zoom to place.
    expect(Array.from(building!.xs)).toEqual([100, 300, 300, 100]);
    expect(Array.from(building!.ys)).toEqual([100, 100, 300, 300]);
    expect(Array.from(building!.walls)).toEqual([1, 1, 1, 1]);
  });

  it("places a tile's buildings for the zoom they're drawn at", () => {
    // A 20-unit building in the middle of its tile, the tile drawn at half and at twice its units.
    const view = new Perspective(200, 150, PITCH_3D);
    const square = [[10, 10, 30, 10, 30, 30, 10, 30, 10, 10]];
    const draw = (scale: number) => {
      const target = new Bitmap(200, 150);
      drawBuildings(target, view, [{ buildings: collectBuildings(tile(square, { render_height: 30 })), scale, x: -20 * scale, y: -20 * scale }], 0, 0, scale);
      return target;
    };
    const near = draw(2);
    const far = draw(0.5);
    // At four times the scale it's four times as wide and as tall, standing on the same spot: the middle of the view.
    const ink = (b: Bitmap) => b.pixels.reduce((sum, p) => sum + p, 0);
    expect(ink(near)).toBeGreaterThan(ink(far) * 4);
    const [, roofFar] = view.project(0, 0, 15)!;
    const [, roofNear] = view.project(0, 0, 60)!;
    expect(far.pixels[Math.round(roofFar) * 200 + 100]).toBe(0);
    expect(near.pixels[Math.round(roofNear) * 200 + 100]).toBe(0);
  });

  it("draws a block in place of its buildings from afar, and the buildings up close", () => {
    const view = new Perspective(200, 150, PITCH_3D);
    const houses = [[-20, -10, 0, -10, 0, 10, -20, 10, -20, -10], [0, -10, 20, -10, 20, 10, 0, 10, 0, -10]];
    const members = houses.flatMap((ring) => collectBuildings(tile([ring], { render_height: 10 })));
    // A block told apart from its houses by standing taller.
    const [block] = collectBuildings(tile([[-20, -10, 20, -10, 20, 10, -20, 10, -20, -10]], { render_height: 30 }));
    /** The highest row drawn on, the buildings drawn at `scale` view pixels per tile unit, offered as a block or not. */
    const top = (scale: number, asBlock: boolean) => {
      const target = new Bitmap(200, 150);
      const group = asBlock
        ? { buildings: [], blocks: [{ block: block!, members, memberSize: 20 }], scale, x: 0, y: 0 }
        : { buildings: members, scale, x: 0, y: 0 };
      drawBuildings(target, view, [group], 0, 0, scale);
      return Math.floor(target.pixels.findIndex((p) => p === 1) / 200);
    };
    // 20 units at 0.4 is an 8-pixel house: the block, 30 m tall, stands taller than the houses would.
    expect(top(0.4, true)).toBeLessThan(top(0.4, false));
    // At 2, a 40-pixel house: the houses themselves.
    expect(top(2, true)).toBe(top(2, false));
  });

  it("chooses block or buildings the same all over an orthographic view", () => {
    // Orthographic, a house is the same size on the screen anywhere: near the
    // camera or far, the same block stands in for the same houses.
    const view = new Perspective(400, 300, PITCH_3D, 0, true);
    const ring = (x: number, y: number) => [x, y, x + 20, y, x + 20, y + 20, x, y + 20, x, y];
    /** Two houses and their block at `y` in a tile whose unit 500 is the middle of the view. */
    const drawnAt = (y: number) => {
      const members = [ring(480, y), ring(500, y)].flatMap((r) => collectBuildings(tile([r], { render_height: 10 })));
      const [block] = collectBuildings(tile([[480, y, 520, y, 520, y + 20, 480, y + 20, 480, y]], { render_height: 30 }));
      const target = new Bitmap(400, 300);
      drawBuildings(target, view, [{ buildings: [], blocks: [{ block: block!, members, memberSize: 20 }], scale: 0.3, x: -150, y: -150 }], 0, 0, 0.3);
      // How far above the footprint's middle the drawing reaches: the 30 m block's or the 10 m houses' height.
      const [, ground] = view.project(0, (y + 10) * 0.3 - 150)!;
      const row = Math.floor(target.pixels.findIndex((p) => p === 1) / 400);
      return Math.round(ground - row);
    };
    // Behind the middle of the view (depth > 0) and in front of it (depth < 0): the block, both times.
    expect(drawnAt(100)).toBe(drawnAt(900));
    expect(drawnAt(900)).toBeGreaterThan(30 * 0.3 * Math.sin(PITCH_3D));
  });

  it("puts no wall where the tile cut a building off", () => {
    const cut = [-80, 100, 300, 100, 300, 300, -80, 300, -80, 100];
    expect(Array.from(collectBuildings(tile([cut]))[0]!.walls)).toEqual([1, 1, 1, 0]);
  });

  it("shows the nearest surface where buildings overlap, whatever order they come in", () => {
    // A tall tower inside a low C-shaped building with the same middle: no
    // order of whole buildings draws both right, each pixel keeping the nearest does.
    // Facing west, so the walls in view face east, away from the light, and are shaded.
    const view = new Perspective(200, 150, PITCH_3D, -Math.PI / 2);
    const c = [-40, -40, 40, -40, 40, -30, -30, -30, -30, 30, 40, 30, 40, 40, -40, 40, -40, -40];
    const tower = [-10, -10, 10, -10, 10, 10, -10, 10, -10, -10];
    for (const order of [[c, tower], [tower, c]]) {
      const target = new Bitmap(200, 150);
      const groups = order.map((ring) => ({ buildings: collectBuildings(tile([ring], { render_height: ring === tower ? 60 : 5 })), scale: 1, x: 0, y: 0 }));
      drawBuildings(target, view, groups, 0, 0, 1);
      // The tower's near wall shows above the low building's roof, and its own roof is white.
      const [sx] = view.project(10, 0, 30)!;
      const [, wallTop] = view.project(10, 0, 55)!;
      const [, wallLow] = view.project(10, 0, 10)!;
      let wall = 0;
      for (let y = Math.ceil(wallTop); y < Math.floor(wallLow); y++) wall += target.pixels[y * 200 + Math.round(sx)]!;
      expect(wall).toBeGreaterThan(0);
      const [rx, ry] = view.project(0, 0, 60)!;
      expect(target.pixels[Math.round(ry) * 200 + Math.round(rx)]).toBe(0);
    }
  });

  it("draws a tower that rises past the camera, cut where it passes it", () => {
    const view = new Perspective(200, 150, PITCH_3D);
    // Near the foot of the view, and taller than the camera stands.
    expect(view.cameraHeight()).toBeLessThan(400);
    const buildings = collectBuildings(tile([[-20, 100, 20, 100, 20, 140, -20, 140, -20, 100]], { render_height: 400 }));
    const target = new Bitmap(200, 150);
    drawBuildings(target, view, [{ buildings, scale: 1, x: 0, y: 0 }], 0, 0, 1);
    // Its near wall fills the bottom of the view, up the middle.
    let wall = 0;
    for (let y = 100; y < 150; y++) wall += target.pixels[y * 200 + 100]!;
    expect(wall).toBeGreaterThan(10);
  });

  it("draws a building's walls and roof", () => {
    // Facing west: the wall in front faces east, away from the light.
    const view = new Perspective(200, 150, PITCH_3D, -Math.PI / 2);
    const target = new Bitmap(200, 150);
    const buildings = collectBuildings(tile([[-20, -20, 20, -20, 20, 20, -20, 20, -20, -20]], { render_height: 40 }));
    drawBuildings(target, view, [{ buildings, scale: 1, x: 0, y: 0 }], 0, 0, 1);
    // Its near wall, shaded, runs from the ground up to the roof's white top.
    const [sx, groundY] = view.project(20, 0)!;
    const [, roofY] = view.project(20, 0, 40)!;
    expect(roofY).toBeLessThan(groundY - 10);
    let wall = 0;
    for (let y = Math.ceil(roofY) + 2; y < Math.floor(groundY) - 1; y++) wall += target.pixels[y * 200 + Math.round(sx)]!;
    expect(wall).toBeGreaterThan(0);
    const [cx, cy] = view.project(0, 0, 40)!;
    expect(target.pixels[Math.round(cy) * 200 + Math.round(cx)]).toBe(0);
  });
});
