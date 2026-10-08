import { describe, expect, it } from "vitest";
import { wheelDeltaX, wheelDeltaY } from "../src/web/hostWheel";

describe("wheelDeltaY", () => {
  it("passes pixels through and turns lines and pages into pixels", () => {
    expect(wheelDeltaY({ deltaY: -100, deltaMode: 0 }, 600)).toBe(-100);
    // Firefox: a notch of a mouse wheel is three lines, about Chrome's 100 pixels.
    expect(wheelDeltaY({ deltaY: 3, deltaMode: 1 }, 600)).toBe(99);
    expect(wheelDeltaY({ deltaY: 1, deltaMode: 2 }, 600)).toBe(600);
  });
});

describe("wheelDeltaX", () => {
  it("measures sideways travel the same way, a page being the page's width", () => {
    expect(wheelDeltaX({ deltaX: 40, deltaMode: 0 }, 800)).toBe(40);
    expect(wheelDeltaX({ deltaX: -3, deltaMode: 1 }, 800)).toBe(-99);
    expect(wheelDeltaX({ deltaX: 1, deltaMode: 2 }, 800)).toBe(800);
  });
});
