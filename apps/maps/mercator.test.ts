import { describe, expect, it } from "vitest";
import { MAX_LATITUDE, metresPerPixel, project, unproject, worldSize, wrapLongitude, zoomToFit } from "./mercator";

describe("Web Mercator", () => {
  it("puts the origin in the middle of the world and the corners at its edges", () => {
    expect(project({ lat: 0, lon: 0 }, 0)).toEqual({ x: 128, y: 128 });
    const nw = project({ lat: MAX_LATITUDE, lon: -180 }, 2);
    expect(nw.x).toBe(0);
    expect(nw.y).toBeCloseTo(0, 6);
    expect(project({ lat: -MAX_LATITUDE, lon: 180 }, 2).y).toBeCloseTo(worldSize(2), 6);
  });

  it("round-trips a place", () => {
    const cupertino = { lat: 37.3318, lon: -122.0312 };
    const back = unproject(project(cupertino, 15), 15);
    expect(back.lat).toBeCloseTo(cupertino.lat, 9);
    expect(back.lon).toBeCloseTo(cupertino.lon, 9);
  });

  it("wraps longitudes past the antimeridian", () => {
    expect(wrapLongitude(190)).toBeCloseTo(-170);
    expect(wrapLongitude(-190)).toBeCloseTo(170);
    expect(unproject({ x: worldSize(1) + 128, y: 256 }, 1).lon).toBeCloseTo(-90);
  });

  it("measures about 156 km a pixel at the equator at zoom 0, half that at 60°", () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(156_543, -1);
    expect(metresPerPixel(60, 0)).toBeCloseTo(78_271, -1);
  });

  it("finds the largest zoom that fits a box", () => {
    const sweden = { south: 55.3, north: 69.1, west: 11.0, east: 24.2 };
    const zoom = zoomToFit(sweden, 400, 300, 1, 18);
    const fits = (z: number) => {
      const nw = project({ lat: sweden.north, lon: sweden.west }, z);
      const se = project({ lat: sweden.south, lon: sweden.east }, z);
      return se.x - nw.x <= 400 && se.y - nw.y <= 300;
    };
    expect(fits(zoom)).toBe(true);
    expect(fits(zoom + 1)).toBe(false);
  });
});
