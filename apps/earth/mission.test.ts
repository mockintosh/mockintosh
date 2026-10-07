import { describe, expect, it } from "vitest";
import { ENTRY_ALTITUDE, EARTH_RADIUS, TLI, fly, sampleAt, solveFreeReturn } from "./mission";

const DEG = Math.PI / 180;

describe("free return", () => {
  const flight = fly(TLI);

  it("goes round the far side of the Moon 150 km up and comes home to the entry corridor", () => {
    expect(flight.farSide).toBe(true);
    expect(flight.perilune.altitude).toBeGreaterThan(140);
    expect(flight.perilune.altitude).toBeLessThan(160);
    expect(flight.perilune.t / 3600).toBeGreaterThan(60);
    expect(flight.perilune.t / 3600).toBeLessThan(80);
    expect(flight.perigee.altitude).toBeGreaterThan(30);
    expect(flight.perigee.altitude).toBeLessThan(60);
    const last = flight.samples[flight.samples.length - 1]!;
    expect(Math.hypot(...last.p) - EARTH_RADIUS).toBeLessThanOrEqual(ENTRY_ALTITUDE + 1);
    expect(flight.end / 86400).toBeGreaterThan(5);
    expect(flight.end / 86400).toBeLessThan(7);
  });

  it("is the flight the solver finds", () => {
    const solved = solveFreeReturn([10.96, 10.965], [-133.5 * DEG, -131.5 * DEG]);
    expect(solved.speed).toBeCloseTo(TLI.speed, 6);
    expect(solved.angle).toBeCloseTo(TLI.angle, 5);
  });

  it("reads smoothly between samples", () => {
    const t = flight.perilune.t / 2 + 1234;
    const a = sampleAt(flight, t);
    const b = sampleAt(flight, t + 10);
    // Ten seconds on, it has moved about ten seconds' worth.
    const moved = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
    expect(moved / (10 * Math.hypot(...a.v))).toBeCloseTo(1, 2);
  });
});
