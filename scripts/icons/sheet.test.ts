import { describe, expect, it } from "vitest";
import { fromGrid } from "@mockintosh/ui";
import { ditherCells, iconIssues, strayPixels } from "./sheet";

const solid16 = fromGrid(16, 16, [
  "................",
  "..############..",
  ...Array(12).fill("..#oooooooooo#.."),
  "..############..",
  "................",
]);

describe("iconIssues", () => {
  it("passes a masked 16×16 with solid fills", () => {
    expect(iconIssues({ label: "box", small: solid16 })).toEqual([]);
  });

  it("flags a 32×32 with no 16×16 and no transparent pixels", () => {
    const opaque = fromGrid(32, 32, Array(32).fill("o".repeat(32)));
    const messages = iconIssues({ label: "flat", large: opaque }).map((i) => i.message);
    expect(messages.some((m) => m.includes("no transparent pixels"))).toBe(true);
    expect(messages.some((m) => m.includes("no 16×16"))).toBe(true);
  });

  it("passes a 1px ring, whose diagonal steps are not dither", () => {
    const ring = fromGrid(16, 16, [
      "................",
      "................",
      "......####......",
      ".....#oooo#.....",
      "....#oooooo#....",
      "....#oooooo#....",
      "....#oooooo#....",
      "....#oooooo#....",
      ".....#oooo#.....",
      "......####......",
      ...Array(6).fill("................"),
    ]);
    expect(ditherCells(ring)).toBe(0);
    expect(strayPixels(ring)).toBe(0);
  });

  it("flags a dithered 16×16", () => {
    const dithered = fromGrid(16, 16, Array.from({ length: 16 }, (_, y) => (y % 2 ? "o#" : "#o").repeat(8)));
    expect(ditherCells(dithered)).toBeGreaterThan(100);
    expect(iconIssues({ label: "gray", small: dithered }).length).toBeGreaterThan(0);
  });
});
