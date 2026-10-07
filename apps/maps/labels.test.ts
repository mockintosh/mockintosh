import { describe, expect, it } from "vitest";
import { placeLabels, straightStretches, type LabelCandidate, type MeasureLabel } from "./labels";
import type { TileFeature } from "./mvt";

/** Every character 6 pixels wide, every label 10 tall. */
const measure: MeasureLabel = (text) => [text.length * 6, 10];

function candidate(text: string, x: number, y: number, priority: number, extra: Partial<LabelCandidate> = {}): LabelCandidate {
  return { text, face: { font: "body" }, x, y, priority, marker: "none", upright: false, beside: false, ...extra };
}

const VIEW = { left: 1000, top: 2000, width: 200, height: 100, worldWidth: 4096 };

describe("placeLabels", () => {
  it("places the most important first and drops what would overlap it", () => {
    const placed = placeLabels(
      [candidate("Village", 1100, 2050, 40), candidate("City", 1102, 2052, 10), candidate("Far", 1180, 2020, 50)],
      VIEW,
      measure,
    );
    expect(placed.map((p) => p.candidate.text)).toEqual(["City", "Far"]);
    expect(placed[0]).toMatchObject({ left: 90, top: 47, anchorX: 102, anchorY: 52 });
  });

  it("keeps labels inside the view and out of reserved corners", () => {
    const placed = placeLabels(
      [candidate("Edge", 1002, 2050, 1), candidate("Corner", 1030, 2090, 2), candidate("Fine", 1100, 2030, 3)],
      { ...VIEW, reserved: [[0, 80, 80, 100]] },
      measure,
    );
    expect(placed.map((p) => p.candidate.text)).toEqual(["Fine"]);
  });

  it("finds anchors across the antimeridian", () => {
    const placed = placeLabels([candidate("Fiji", 4096 + 1100, 2050, 1)], VIEW, measure);
    expect(placed[0]?.anchorX).toBe(100);
  });

  it("drops repeats of a street name nearby, and copies of a point exactly on one", () => {
    const placed = placeLabels(
      [
        candidate("Main St", 1040, 2020, 60),
        candidate("Main St", 1150, 2080, 60),
        candidate("Town", 1100, 2050, 30, { marker: "town", beside: true }),
        candidate("Town", 1100, 2050, 30, { marker: "town", beside: true }),
      ],
      VIEW,
      measure,
    );
    expect(placed.map((p) => p.candidate.text)).toEqual(["Town", "Main St"]);
  });

  it("turns north–south street names on their side", () => {
    const [placed] = placeLabels([candidate("Long Road", 1100, 2050, 60, { upright: true })], VIEW, measure);
    // 54 wide when read, so 54 tall when turned.
    expect(placed).toMatchObject({ left: 95, top: 23 });
  });
});

function line(...points: number[]): TileFeature {
  const coords = Int32Array.from(points);
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const geometry = {
    coords,
    parts: Int32Array.from([0, points.length / 2]),
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  return { type: 2, geometry: () => geometry, get: () => undefined } as unknown as TileFeature;
}

describe("straightStretches", () => {
  const place = { scale: 1, originX: 0, originY: 0 };

  it("offers the middle of a level stretch long enough for the name", () => {
    expect(straightStretches(line(0, 0, 100, 2, 200, 4), place, 50)).toEqual([{ x: 100, y: 2, upright: false }]);
    expect(straightStretches(line(0, 0, 40, 0), place, 50)).toEqual([]);
  });

  it("turns at a corner, and reads a north–south stretch upright", () => {
    const spots = straightStretches(line(0, 0, 100, 0, 100, 200), place, 50);
    expect(spots).toEqual([{ x: 50, y: 0, upright: false }, { x: 100, y: 100, upright: true }]);
  });

  it("skips diagonals, and offers several spots along a long road", () => {
    expect(straightStretches(line(0, 0, 200, 200), place, 50)).toEqual([]);
    expect(straightStretches(line(0, 0, 1000, 0), place, 50).length).toBeGreaterThan(3);
  });
});
