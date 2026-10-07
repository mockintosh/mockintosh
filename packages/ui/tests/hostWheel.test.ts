import { describe, expect, it } from "vitest";
import { wheelDeltaY } from "../src/web/hostWheel";

describe("wheelDeltaY", () => {
  it("passes pixels through and turns lines and pages into pixels", () => {
    expect(wheelDeltaY({ deltaY: -100, deltaMode: 0 }, 600)).toBe(-100);
    // Firefox: a notch of a mouse wheel is three lines, about Chrome's 100 pixels.
    expect(wheelDeltaY({ deltaY: 3, deltaMode: 1 }, 600)).toBe(99);
    expect(wheelDeltaY({ deltaY: 1, deltaMode: 2 }, 600)).toBe(600);
  });
});
