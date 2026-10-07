import { describe, expect, it } from "vitest";
import { project, unproject, worldSize } from "./mercator";
import { cameraAt, dataZoom, formatDistance, normalizeCamera, panCamera, scaleBarLength, zoomCamera } from "./view";

describe("the camera", () => {
  it("wraps east–west and stops at the top and bottom of the world", () => {
    const size = worldSize(3);
    expect(normalizeCamera({ x: size + 10, y: 500, zoom: 3 }, 300).x).toBe(10);
    expect(normalizeCamera({ x: -10, y: 500, zoom: 3 }, 300).x).toBe(size - 10);
    expect(normalizeCamera({ x: 0, y: -50, zoom: 3 }, 300).y).toBe(150);
    expect(normalizeCamera({ x: 0, y: size + 50, zoom: 3 }, 300).y).toBe(size - 150);
    // A world shorter than the view sits in its middle.
    expect(normalizeCamera({ x: 0, y: 0, zoom: 0 }, 300).y).toBe(128);
  });

  it("moves with the drag", () => {
    const camera = { x: 1000, y: 1000, zoom: 4 };
    expect(panCamera(camera, 30, -20, 300)).toEqual({ x: 970, y: 1020, zoom: 4 });
  });

  it("zooms about the pointer, keeping the place under it still", () => {
    const camera = cameraAt({ lat: 57.7, lon: 11.97 }, 10);
    const [width, height, sx, sy] = [400, 300, 300, 50];
    const under = (c: typeof camera) => unproject({ x: c.x + sx - width / 2, y: c.y + sy - height / 2 }, c.zoom);
    const before = under(camera);
    const zoomedIn = zoomCamera(camera, 1, sx, sy, width, height);
    expect(zoomedIn.zoom).toBe(11);
    expect(under(zoomedIn).lat).toBeCloseTo(before.lat, 9);
    expect(under(zoomedIn).lon).toBeCloseTo(before.lon, 9);
    const zoomedOut = zoomCamera(camera, -2, sx, sy, width, height);
    expect(under(zoomedOut).lon).toBeCloseTo(before.lon, 9);
  });

  it("stays within the zooms it can draw", () => {
    const deepest = cameraAt({ lat: 0, lon: 0 }, 99);
    expect(deepest.zoom).toBe(18);
    expect(zoomCamera(deepest, 1, 0, 0, 100, 100)).toBe(deepest);
    expect(cameraAt({ lat: 0, lon: 0 }, 0).zoom).toBe(1);
    expect(project({ lat: 0, lon: 0 }, 18).x).toBe(deepest.x);
  });

  it("draws from the data a level up, and from the deepest data beyond it", () => {
    expect(dataZoom(1, 14)).toBe(0);
    expect(dataZoom(12, 14)).toBe(11);
    expect(dataZoom(18, 14)).toBe(14);
  });
});

describe("the scale bar", () => {
  it("picks the longest round distance that fits", () => {
    expect(scaleBarLength(10, 70)).toEqual({ metres: 500, width: 50 });
    expect(scaleBarLength(30, 70)).toEqual({ metres: 2000, width: 2000 / 30 });
    expect(formatDistance(500)).toBe("500 m");
    expect(formatDistance(2000)).toBe("2 km");
  });
});
