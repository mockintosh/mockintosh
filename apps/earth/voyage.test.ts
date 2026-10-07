import { describe, expect, it } from "vitest";
import { geography } from "./geography";
import { SpaceRenderer } from "./space";
import { EARTH_RADIUS, MOON_RADIUS } from "./mission";
import { Voyage } from "./voyage";

describe("voyage", () => {
  it("plays the five-and-a-half-day flight in a minute or two", () => {
    const voyage = new Voyage();
    let seconds = 0;
    while (!voyage.finished && seconds < 600) {
      voyage.advance(1 / 30);
      seconds += 1 / 30;
    }
    expect(voyage.finished).toBe(true);
    expect(seconds).toBeGreaterThan(45);
    expect(seconds).toBeLessThan(180);
  });

  it("loses the Earth behind the Moon for about the half hour Apollo did", () => {
    const voyage = new Voyage();
    let behind = 0;
    for (let t = voyage.flight.perilune.t - 7200; t < voyage.flight.perilune.t + 7200; t += 30) {
      voyage.t = t;
      if (voyage.lossOfSignal()) behind += 30;
    }
    expect(behind / 60).toBeGreaterThan(15);
    expect(behind / 60).toBeLessThan(45);
  });

  it("comes home somewhere on the Earth", () => {
    const { lat, lon } = new Voyage().landing();
    expect(Math.abs(lat)).toBeLessThanOrEqual(Math.PI / 2);
    expect(Math.abs(lon)).toBeLessThanOrEqual(Math.PI);
  });

  it("frames the earthrise with the Moon below and the Earth above", () => {
    const voyage = new Voyage();
    voyage.t = voyage.flight.perilune.t;
    while (voyage.lossOfSignal()) voyage.t += 10;
    voyage.t += 60;
    voyage.paused = true;
    for (let i = 0; i < 30; i++) voyage.advance(0.1);
    const frame = { width: 240, height: 160, pixels: new Uint8Array(240 * 160) };
    new SpaceRenderer(geography()).draw(frame, voyage.scene(240, 160));
    const whiteIn = (y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < 240; x++) n += frame.pixels[y * 240 + x] === 0 ? 1 : 0;
      return n;
    };
    // The lunar ground fills the bottom; the Earth stands in the upper half's middle.
    expect(whiteIn(130, 150)).toBeGreaterThan(240 * 20 * 0.02);
    expect(whiteIn(30, 80)).toBeGreaterThan(30);
  });

  it("draws the whole flight in the overview, and none of it aboard", () => {
    const voyage = new Voyage();
    voyage.t = voyage.flight.perilune.t + 3600 * 20;
    expect(voyage.scene(480, 320).path).toHaveLength(0);
    voyage.mode = "overview";
    const scene = voyage.scene(480, 320);
    expect(scene.path.length).toBe(voyage.flight.samples.length);
    expect(scene.flown).toBeGreaterThan(0);
    expect(scene.flown).toBeLessThan(scene.path.length);
    expect(scene.craft).not.toBeNull();
  });
  it("keeps the overview's path outside the Earth and Moon as they are drawn there, many times their size", () => {
    const voyage = new Voyage();
    voyage.mode = "overview";
    for (const t of [0, voyage.flight.perilune.t, voyage.flight.end]) {
      voyage.t = t;
      const scene = voyage.scene(480, 320);
      for (const p of scene.path) {
        expect(Math.hypot(...p)).toBeGreaterThan(EARTH_RADIUS * scene.scale.earth);
        expect(Math.hypot(p[0] - scene.moon[0], p[1] - scene.moon[1], p[2] - scene.moon[2])).toBeGreaterThan(MOON_RADIUS * scene.scale.moon);
      }
    }
  });
  it("keeps Apollo 8's clock: launched 21 December 1968 at 12:51 UTC, the burn at 2:53 GET", () => {
    const voyage = new Voyage();
    voyage.jump(0);
    expect(voyage.scene(480, 320).instruments.clock).toBe("GET 002:53:17  21 DEC 1968 15:44 UTC");
  });

  it("runs a second of flight a second in real time, faster only as asked", () => {
    const voyage = new Voyage();
    voyage.setPacing("realtime");
    expect(voyage.rate()).toBe(1);
    voyage.advance(10);
    expect(voyage.t).toBeCloseTo(-1500 + 10, 6);
    voyage.speed = 64;
    expect(voyage.rate()).toBe(64);
    expect(voyage.scene(480, 320).instruments.camera).toContain("REAL TIME X64");
    // Back to condensed, the speed comes back within its range.
    voyage.setPacing("condensed");
    expect(voyage.speed).toBeLessThanOrEqual(64);
  });

  it("offers the moments worth jumping to, in order", () => {
    const voyage = new Voyage();
    const names = voyage.events.map((e) => e.name);
    expect(names).toContain("Loss of Signal");
    expect(names).toContain("Earthrise");
    for (let i = 1; i < voyage.events.length; i++) expect(voyage.events[i]!.t).toBeGreaterThan(voyage.events[i - 1]!.t);
    const earthrise = voyage.events.find((e) => e.name === "Earthrise")!;
    voyage.jump(earthrise.t);
    // A minute before the Earth comes out from behind the Moon.
    expect(voyage.lossOfSignal()).toBe(true);
    voyage.jump(earthrise.t + 120);
    expect(voyage.lossOfSignal()).toBe(false);
  });
});
