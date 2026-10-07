import { describe, expect, it } from "vitest";
import { geography } from "./geography";
import { encode, unpack } from "./packing";
import { EarthRenderer, dotColumns, gridStep } from "./render";
import { sunDirection } from "./sky";

/** Whether a point is land, asked as the dot grid asks: row 1 of a grid `lat` degrees apart. */
const isLand = (lon: number, lat: number) => geography().isLand(lon, 1, lat);

describe("geography", () => {
  it("unpacks every line it packed", () => {
    const geo = geography();
    expect(geo.land.length).toBeGreaterThan(1000);
    expect(geo.borders.length).toBeGreaterThan(300);
    for (const ring of geo.land) {
      for (let i = 0; i < ring.degrees.length; i += 2) {
        expect(Math.abs(ring.degrees[i]!)).toBeLessThanOrEqual(180);
        expect(Math.abs(ring.degrees[i + 1]!)).toBeLessThanOrEqual(90);
      }
    }
  });

  it("reads back numbers of any size, signed", () => {
    // Count 2, then (+3, −1) and (+1000, +40) as zigzag: 6, 1, 2000, 80.
    const [line] = unpack(encode([2, 6, 1, 2000, 80]));
    expect(Array.from(line!).map((v) => Math.round(v * 100))).toEqual([3, -1, 1003, 39]);
  });

  it("knows land from sea", () => {
    expect(isLand(133.88, -23.7)).toBe(true); // Alice Springs
    expect(isLand(-3.7, 40.42)).toBe(true); // Madrid
    expect(isLand(-1.5, 52.5)).toBe(true); // Birmingham
    expect(isLand(-100, 40)).toBe(true); // Kansas
    expect(isLand(0, -85)).toBe(true); // Antarctica
    expect(isLand(3, 56)).toBe(false); // The North Sea
    expect(isLand(-150, 0)).toBe(false); // The Pacific
    expect(isLand(-30, 30)).toBe(false); // The Atlantic
    expect(isLand(150, -40)).toBe(false); // The Tasman Sea
  });

  it("leaves the cuts along the antimeridian undrawn", () => {
    const seams = geography().land.flatMap((ring) => {
      const d = ring.degrees;
      const n = d.length / 2;
      return Array.from(ring.drawn, (drawn, i) => ({ drawn, x0: d[i * 2]!, x1: d[((i + 1) % n) * 2]! })).filter(
        (edge) => Math.abs(edge.x0) >= 179.99 && Math.abs(edge.x1) >= 179.99 && Math.sign(edge.x0) === Math.sign(edge.x1),
      );
    });
    expect(seams.length).toBeGreaterThan(0);
    expect(seams.every((edge) => edge.drawn === 0)).toBe(true);
  });
});

describe("render", () => {
  it("draws the whole Earth white on black", () => {
    const frame = { width: 200, height: 140, pixels: new Uint8Array(200 * 140) };
    new EarthRenderer(geography()).draw(
      frame,
      { lon: 2.5, lat: -0.4, radius: 58 },
      { grid: true, borders: true, places: true, atmosphere: true, stars: false, status: true, lighting: "studio", time: 0 },
    );
    const white = frame.pixels.filter((p) => p === 0).length;
    expect(frame.pixels[0]).toBe(1);
    expect(white).toBeGreaterThan(frame.pixels.length * 0.05);
    expect(white).toBeLessThan(frame.pixels.length * 0.5);
    // The limb is lit all the way round.
    expect(frame.pixels[70 * 200 + 100 + 58]).toBe(0);
    expect(frame.pixels[70 * 200 + 100 - 58]).toBe(0);
  });

  it("spaces grid lines and dots for the zoom", () => {
    expect(gridStep(130)).toBe(15);
    expect(gridStep(20000)).toBe(0.1);
    expect(dotColumns(130) & (dotColumns(130) - 1)).toBe(0);
    expect((2 * Math.PI * 130) / dotColumns(130)).toBeGreaterThan(2);
  });
  it("lights the day side, darkens the night side and hides the stars behind the Earth", () => {
    // Noon over Africa, and the view right over it.
    const noon = Date.UTC(2026, 9, 6, 11);
    const [x, y, z] = sunDirection(noon);
    const view = { lon: Math.atan2(y, x), lat: Math.asin(z) + 0.15, radius: 58 };
    const renderer = new EarthRenderer(geography());
    const whiteInDisk = (time: number, stars: boolean) => {
      const frame = { width: 200, height: 140, pixels: new Uint8Array(200 * 140) };
      const layers = { grid: false, borders: false, places: false, atmosphere: false, stars, status: false, lighting: "sun" as const, time };
      renderer.draw(frame, view, layers);
      let white = 0;
      for (let py = 0; py < 140; py++) {
        for (let px = 0; px < 200; px++) {
          if ((px + 0.5 - 100) ** 2 + (py + 0.5 - 70) ** 2 < 50 ** 2 && frame.pixels[py * 200 + px] === 0) white++;
        }
      }
      return white;
    };
    const midnight = noon + 12 * 3_600_000;
    // Under the Sun the day side is bright, as Google Earth's is: a quarter of Africa and the seas around it white or more (dots alone managed an eighth).
    expect(whiteInDisk(noon, true)).toBeGreaterThan(Math.PI * 50 ** 2 * 0.25);
    expect(whiteInDisk(noon, true)).toBeGreaterThan(whiteInDisk(midnight, true) * 3);
    expect(whiteInDisk(midnight, true)).toBe(whiteInDisk(midnight, false));
  });
});
