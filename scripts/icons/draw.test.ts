import { describe, expect, it } from "vitest";
import { IconCanvas } from "./draw";

describe("IconCanvas", () => {
  it("draws a circle that is symmetric both ways and as wide as it is tall", () => {
    const rows = new IconCanvas(32).ellipse(15.5, 15.5, 14, 14).rows();
    expect(rows).toEqual([...rows].reverse());
    expect(rows.map((r) => [...r].reverse().join(""))).toEqual(rows);
    const inkRows = rows.filter((r) => r.includes("#")).length;
    const inkCols = [...Array(32).keys()].filter((x) => rows.some((r) => r[x] === "#")).length;
    expect(inkRows).toBe(inkCols);
  });

  it("draws a 1px outline with no pixel doubled on a diagonal", () => {
    const rows = new IconCanvas(8).line(0, 0, 7, 7).rows();
    expect(rows.every((r, y) => r === ".".repeat(y) + "#" + ".".repeat(7 - y))).toBe(true);
  });

  it("floods only the enclosed region", () => {
    const c = new IconCanvas(8).rect(1, 1, 6, 6).flood(3, 3, "paper");
    expect(c.get(3, 3)).toBe("paper");
    expect(c.get(0, 0)).toBe("clear");
  });

  it("round-trips through grid rows", () => {
    const rows = ["#o.", ".#o", "o.#"];
    expect(IconCanvas.fromRows(rows).rows()).toEqual(rows);
  });
});
