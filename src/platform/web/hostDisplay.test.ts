import { describe, expect, it } from "vitest";
import { AUTO_MAX_SCALE, initialScreenSize, maxFixedScale } from "./hostDisplay";

describe("host display scale", () => {
  it("picks the largest whole zoom that fits, and at least 1", () => {
    expect(maxFixedScale(512, 342, 1920, 1080)).toBe(3);
    expect(maxFixedScale(512, 342, 800, 600)).toBe(1);
    expect(maxFixedScale(512, 342, 400, 300)).toBe(1);
  });

  it("caps a first boot's Auto zoom at 3x", () => {
    expect(AUTO_MAX_SCALE).toBe(3);
    expect(initialScreenSize({ width: 512, height: 342 })).toEqual({ width: 512, height: 342, scale: 3 });
  });
});
