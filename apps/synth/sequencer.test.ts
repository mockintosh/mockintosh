import { describe, expect, it } from "vitest";
import { PARAMS, PERFORMANCE_PARAMS, fromTravel, sanitizePatch, toTravel } from "./params";
import {
  ArpMode,
  arpSequence,
  createRandom,
  mutatePattern,
  parsePattern,
  quantize,
  rollPattern,
  rotatePattern,
  sanitizePattern,
  scaleOffsets,
} from "./sequencer";

describe("patterns", () => {
  it("parses the compact score", () => {
    const pattern = parsePattern("0 . 12~ 7!");
    expect(pattern.steps.slice(0, 4)).toEqual([
      { on: true, offset: 0, accent: false, slide: false },
      { on: false, offset: 0, accent: false, slide: false },
      { on: true, offset: 12, accent: false, slide: true },
      { on: true, offset: 7, accent: true, slide: false },
    ]);
    expect(pattern.steps).toHaveLength(16);
  });

  it("rolls lines that stay in the scale", () => {
    const random = createRandom(42);
    for (let scale = 0; scale < 7; scale++) {
      const allowed = new Set(scaleOffsets(scale));
      const pattern = mutatePattern(rollPattern(random, scale), random, scale);
      for (const step of pattern.steps) if (step.on) expect(allowed.has(step.offset)).toBe(true);
    }
  });

  it("quantizes to the nearest scale tone", () => {
    expect(quantize(1, 0)).toBe(0);
    expect(quantize(6, 0)).toBe(5);
    expect(quantize(13, 4)).toBe(12);
  });

  it("rotates and survives untrusted JSON", () => {
    const pattern = parsePattern("5");
    expect(rotatePattern(pattern, 1).steps[1]!.offset).toBe(5);
    expect(rotatePattern(pattern, -1).steps[15]!.offset).toBe(5);
    expect(sanitizePattern({ steps: [{ on: true, offset: 99 }, "junk"] }).steps[0]).toEqual({
      on: true,
      offset: 24,
      accent: false,
      slide: false,
    });
  });
});

describe("arpeggiator", () => {
  it("walks up, down and both ways over octaves", () => {
    expect(arpSequence([64, 60, 67], ArpMode.Up, 1)).toEqual([60, 64, 67]);
    expect(arpSequence([64, 60, 67], ArpMode.Down, 1)).toEqual([67, 64, 60]);
    expect(arpSequence([60, 64], ArpMode.Up, 2)).toEqual([60, 64, 72, 76]);
    expect(arpSequence([60, 64, 67], ArpMode.UpDown, 1)).toEqual([60, 64, 67, 64]);
    expect(arpSequence([64, 60], ArpMode.AsPlayed, 1)).toEqual([64, 60]);
    expect(arpSequence([60], ArpMode.Off, 1)).toEqual([]);
  });
});

describe("parameters", () => {
  it("round-trips knob travel", () => {
    for (const def of [...Object.values(PARAMS), ...Object.values(PERFORMANCE_PARAMS)]) {
      const value = def.default;
      expect(fromTravel(def, toTravel(def, value))).toBeCloseTo(value, 6);
      expect(toTravel(def, fromTravel(def, 0))).toBeCloseTo(0, 6);
      expect(toTravel(def, fromTravel(def, 1))).toBeCloseTo(1, 6);
    }
  });

  it("clamps saved patches", () => {
    const patch = sanitizePatch({ cutoff: 1e9, osc1Wave: 7.4, volume: "loud" });
    expect(patch.cutoff).toBe(18000);
    expect(patch.osc1Wave).toBe(3);
    expect(patch.volume).toBe(PARAMS.volume.default);
  });
});
