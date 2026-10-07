import { describe, expect, it } from "vitest";
import { clampView, distance, flight, grab, project, unproject, visibleBounds, wrapAngle, type View } from "./globe";

const DEG = Math.PI / 180;
const W = 480;
const H = 320;

describe("globe", () => {
  const view: View = { lon: 147 * DEG, lat: -25 * DEG, radius: 130 };

  it("projects the centre of the view to the centre of the window", () => {
    const at = project(view, W, H, view);
    expect(at.x).toBeCloseTo(W / 2);
    expect(at.y).toBeCloseTo(H / 2);
    expect(at.visible).toBe(true);
  });

  it("puts north up and east to the right", () => {
    const north = project(view, W, H, { lon: view.lon, lat: view.lat + 0.1 });
    const east = project(view, W, H, { lon: view.lon + 0.1, lat: view.lat });
    expect(north.y).toBeLessThan(H / 2);
    expect(east.x).toBeGreaterThan(W / 2);
  });

  it("unprojects what it projects", () => {
    for (const [x, y] of [[160, 100], [300, 250], [240, 160]] as const) {
      const point = unproject(view, W, H, x, y)!;
      const back = project(view, W, H, point);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
    expect(unproject(view, W, H, 0, 0)).toBeNull();
  });

  it("grabs: the point taken hold of lands under the pointer", () => {
    const point = unproject(view, W, H, 200, 140)!;
    for (const [x, y] of [[260, 170], [170, 90], [240, 270]] as const) {
      const moved = grab(point, view.radius, W, H, x, y)!;
      expect(moved).not.toBeNull();
      const at = project(moved, W, H, point);
      expect(at.x).toBeCloseTo(x, 6);
      expect(at.y).toBeCloseTo(y, 6);
      expect(at.visible).toBe(true);
    }
  });

  it("lets go when the pointer leaves the disk", () => {
    const point = unproject(view, W, H, 240, 160)!;
    expect(grab(point, view.radius, W, H, 5, 5)).toBeNull();
  });

  it("keeps views in range", () => {
    const clamped = clampView({ lon: 4, lat: 2, radius: 1e9 }, W, H);
    expect(clamped.lon).toBeCloseTo(wrapAngle(4));
    expect(clamped.lat).toBeCloseTo(Math.PI / 2);
    expect(clamped.radius).toBe(20000);
  });

  it("flies from one view to the other, higher in between", () => {
    const from: View = { lon: 18 * DEG, lat: 59 * DEG, radius: 2000 };
    const to: View = { lon: 151 * DEG, lat: -34 * DEG, radius: 3000 };
    const trip = flight(from, to, 130);
    expect(distance(trip.at(0), from)).toBeCloseTo(0, 9);
    expect(trip.at(0).radius).toBeCloseTo(2000);
    expect(distance(trip.at(1), to)).toBeCloseTo(0, 9);
    expect(trip.at(1).radius).toBeCloseTo(3000);
    expect(trip.at(0.5).radius).toBeLessThan(500);
    expect(trip.duration).toBeGreaterThan(1);
  });

  it("sees all the way round when a pole is in sight", () => {
    const polar = visibleBounds({ lon: 0, lat: -80 * DEG, radius: 400 }, W, H);
    expect(polar.lonMax - polar.lonMin).toBeCloseTo(2 * Math.PI);
    expect(polar.latMin).toBeCloseTo(-Math.PI / 2);
    const close = visibleBounds({ lon: 10 * DEG, lat: 50 * DEG, radius: 5000 }, W, H);
    expect(close.lonMax - close.lonMin).toBeLessThan(10 * DEG);
    expect(close.latMin).toBeLessThan(50 * DEG);
    expect(close.latMax).toBeGreaterThan(50 * DEG);
  });
});
