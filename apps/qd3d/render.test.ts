import { describe, expect, it } from "vitest";
import { SHADE_LEVELS } from "@mockintosh/ui";
import { box, pyramid } from "./mesh";
import { CREASES, LIGHTING, Renderer, SILHOUETTE, SOLID, drawLine, fillPolygon, horizonY, instance, project, type Camera, type Target } from "./render";

function target(width = 64, height = 48): Target {
  return { width, height, pixels: new Uint8Array(width * height) };
}

function camera(init: Partial<Camera> = {}): Camera {
  return { position: [0, 1, 5], yaw: 0, pitch: 0, fov: Math.PI / 3, near: 0.1, far: 100, ...init };
}

const ink = (t: Target) => t.pixels.reduce((n, p) => n + p, 0);
const at = (t: Target, x: number, y: number) => t.pixels[y * t.width + x];

describe("mesh", () => {
  it("knows each face's neighbours and which edges bend", () => {
    const cube = box(2, 2, 2);
    expect(cube.tris.length / 3).toBe(12);
    expect([...cube.adjacency].every((face) => face >= 0)).toBe(true);
    // Each face has one flat edge (the quad's diagonal) and two creases.
    for (let f = 0; f < 12; f++) {
      expect(cube.creases[f * 3]! + cube.creases[f * 3 + 1]! + cube.creases[f * 3 + 2]!).toBe(2);
    }
    expect(pyramid(2, 2).tris.length / 3).toBe(6);
  });
});

describe("Renderer", () => {
  it("draws nothing for an empty scene and leaves the target as it was", () => {
    const t = target();
    new Renderer().render(t, camera(), [], { light: [0, 1, 0] });
    expect(ink(t)).toBe(0);
  });

  it("projects the camera's own forward to the middle of the target", () => {
    const p = project(camera({ position: [0, 0, 0] }), { width: 64, height: 48 }, [0, 0, -10])!;
    expect(p.x).toBeCloseTo(32);
    expect(p.y).toBeCloseTo(24);
    // Yaw turns right: something to the right drifts left on screen as the camera turns toward it.
    const turned = project(camera({ position: [0, 0, 0], yaw: Math.PI / 2 }), { width: 64, height: 48 }, [10, 0, 0])!;
    expect(turned.x).toBeCloseTo(32);
    expect(project(camera({ position: [0, 0, 0] }), { width: 64, height: 48 }, [0, 0, 10])).toBeNull();
    expect(horizonY(camera({ pitch: 0 }), 48)).toBe(24);
  });

  it("outlines a white box in black against white", () => {
    const t = target();
    const cube = instance(box(2, 2, 2), { position: [0, 0, 0], shade: 1, flags: SOLID | SILHOUETTE });
    new Renderer().render(t, camera(), [cube], { light: [0, 1, 0] });
    // A white fill: the inside stays clear, the outline is inked.
    expect(at(t, 32, 30)).toBe(0);
    expect(ink(t)).toBeGreaterThan(40);
    // Columns left and right of the box are untouched.
    expect(at(t, 2, 30)).toBe(0);
    expect(at(t, 61, 30)).toBe(0);
  });

  it("shades a face by its turn toward the light", () => {
    const lit = target();
    const dark = target();
    const cube = instance(box(2, 2, 2), { position: [0, 0, 0], flags: SOLID | LIGHTING });
    new Renderer().render(lit, camera(), [cube], { light: [0, 0, 1] });
    new Renderer().render(dark, camera(), [cube], { light: [0, 0, -1] });
    expect(ink(dark)).toBeGreaterThan(ink(lit) + 100);
  });

  it("draws nearer faces over farther ones", () => {
    const t = target();
    const far = instance(box(3, 3, 1), { position: [0, -0.5, -3], shade: 0, flags: SOLID });
    const near = instance(box(1, 1, 1), { position: [0, 0.5, 0], shade: 1, flags: SOLID });
    // Listed near first: the sort, not the list, decides.
    new Renderer().render(t, camera(), [near, far], { light: [0, 1, 0] });
    expect(at(t, 32, 22)).toBe(0);
    expect(at(t, 25, 22)).toBe(1);
  });

  it("clips a face that runs behind the camera at the near plane", () => {
    const t = target();
    // A long slab the camera stands over: its top runs from far ahead to behind the camera.
    const slab = instance(box(4, 0.2, 40), { position: [0, 0, 0], shade: 0, flags: SOLID | SILHOUETTE | CREASES });
    new Renderer().render(t, camera({ position: [0, 1, 5] }), [slab], { light: [0, 1, 0] });
    // All of it lies below the horizon, and it reaches the bottom edge.
    for (let y = 0; y < 24; y++) for (let x = 0; x < t.width; x++) expect(at(t, x, y)).toBe(0);
    expect(at(t, 32, t.height - 1)).toBe(1);
  });

  it("turns a mesh with yaw the same way the camera turns", () => {
    // A wedge pointing down −z, turned a quarter right, points down +x: its tip is right of centre from above.
    const t = target();
    const wedge = instance(pyramid(1, 4), { position: [0, 0, 0], pitch: -Math.PI / 2, yaw: Math.PI / 2, flags: SOLID, shade: 0 });
    new Renderer().render(t, camera({ position: [0, 10, 0], pitch: -Math.PI / 2 + 1e-4 }), [wedge], { light: [0, 1, 0] });
    let left = 0;
    let right = 0;
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        if (!at(t, x, y)) continue;
        if (x < 32) left++;
        else right++;
      }
    }
    expect(right).toBeGreaterThan(left * 2);
  });
});

describe("raster", () => {
  it("fills by pixel centres, so two halves of a square tile it exactly", () => {
    const upper = target(16, 16);
    const lower = target(16, 16);
    fillPolygon(upper, [2, 2, 12, 2, 12, 12], 0);
    fillPolygon(lower, [2, 2, 12, 12, 2, 12], 0);
    // No gap and no overlap: one half owns the diagonal.
    expect(ink(upper) + ink(lower)).toBe(100);
    for (let i = 0; i < 256; i++) expect(upper.pixels[i]! & lower.pixels[i]!).toBe(0);
  });

  it("stamps a step of the ramp, white at the top", () => {
    const t = target(16, 16);
    fillPolygon(t, [0, 0, 16, 0, 16, 16, 0, 16], SHADE_LEVELS - 1);
    expect(ink(t)).toBe(0);
    fillPolygon(t, [0, 0, 16, 0, 16, 16, 0, 16], 16);
    expect(ink(t)).toBe(128);
  });

  it("clips lines that start far off the target", () => {
    const t = target(16, 16);
    drawLine(t, -1e6, 8, 1e6, 8);
    expect(ink(t)).toBe(16);
    drawLine(t, -5, -5, -1, -1);
    expect(ink(t)).toBe(16);
  });
});
