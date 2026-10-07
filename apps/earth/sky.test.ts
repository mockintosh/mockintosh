import { describe, expect, it } from "vitest";
import { moonDirection, siderealAngle, stars, sunDirection } from "./sky";

const DEG = Math.PI / 180;
const latitude = ([, , z]: number[]) => Math.asin(z!) / DEG;
const longitude = ([x, y]: number[]) => Math.atan2(y!, x!) / DEG;

describe("sky", () => {
  it("puts the Sun over the Tropic of Cancer at the June solstice, over Greenwich at noon", () => {
    const sun = sunDirection(Date.UTC(2026, 5, 21, 12));
    expect(latitude(sun)).toBeCloseTo(23.4, 0);
    // The equation of time is under two minutes then: half a degree.
    expect(Math.abs(longitude(sun))).toBeLessThan(1);
  });

  it("puts the Sun over the equator at the equinoxes and south in December", () => {
    expect(Math.abs(latitude(sunDirection(Date.UTC(2026, 2, 20, 15))))).toBeLessThan(0.5);
    expect(latitude(sunDirection(Date.UTC(2026, 11, 21, 12)))).toBeCloseTo(-23.4, 0);
  });

  it("moves the Sun west fifteen degrees an hour", () => {
    const at = Date.UTC(2026, 9, 6, 10);
    const step = longitude(sunDirection(at)) - longitude(sunDirection(at + 3_600_000));
    expect(step).toBeCloseTo(15, 0);
  });

  it("turns the Earth under the stars once a sidereal day", () => {
    const at = Date.UTC(2026, 0, 1);
    const turned = (siderealAngle(at + 86_164_091) - siderealAngle(at)) / DEG;
    expect(((turned % 360) + 360) % 360).toBeCloseTo(0, 1);
  });

  it("knows the bright stars", () => {
    const { directions, magnitudes } = stars();
    expect(magnitudes.length).toBeGreaterThan(2500);
    // Sirius: the brightest, at RA 101.29°, Dec −16.72°.
    const brightest = magnitudes.indexOf(Math.min(...magnitudes));
    expect(magnitudes[brightest]).toBeCloseTo(-1.46, 1);
    const [x, y, z] = [directions[brightest * 3]!, directions[brightest * 3 + 1]!, directions[brightest * 3 + 2]!];
    expect(Math.atan2(y, x) / DEG).toBeCloseTo(101.29, 1);
    expect(Math.asin(z) / DEG).toBeCloseTo(-16.72, 1);
  });
  it("puts the Moon by the Sun when new, a right angle away at quarter, and opposite when full", () => {
    const apart = (iso: string) => {
      const m = moonDirection(Date.parse(iso));
      const s = sunDirection(Date.parse(iso));
      return Math.acos(m[0] * s[0] + m[1] * s[1] + m[2] * s[2]) / DEG;
    };
    expect(apart("2026-10-10T15:50:00Z")).toBeLessThan(6); // new
    expect(apart("2026-10-18T16:13:00Z")).toBeCloseTo(90, -1); // first quarter
    expect(apart("2026-10-26T04:12:00Z")).toBeGreaterThan(174); // full
  });
});
