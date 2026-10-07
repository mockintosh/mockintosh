import { describe, expect, it } from "vitest";
import { BLACK, Bitmap, WHITE, walkDashes, walkMarks, type Paint } from "./bitmap";

function rows(bitmap: Bitmap): string[] {
  const out: string[] = [];
  for (let y = 0; y < bitmap.height; y++) {
    let row = "";
    for (let x = 0; x < bitmap.width; x++) row += bitmap.pixels[y * bitmap.width + x] ? "#" : ".";
    out.push(row);
  }
  return out;
}

describe("Bitmap", () => {
  it("fills the pixels whose centres are inside a polygon", () => {
    const b = new Bitmap(6, 4);
    b.fillPath([1, 5, 5, 1], [1, 1, 3, 3], [0, 4], BLACK);
    expect(rows(b)).toEqual(["......", ".####.", ".####.", "......"]);
  });

  it("leaves holes open by the even-odd rule", () => {
    const b = new Bitmap(7, 7);
    const xs = [0, 7, 7, 0, 2, 2, 5, 5];
    const ys = [0, 0, 7, 7, 2, 5, 5, 2];
    b.fillPath(xs, ys, [0, 4, 8], BLACK);
    expect(rows(b)).toEqual(["#######", "#######", "##...##", "##...##", "##...##", "#######", "#######"]);
  });

  it("aligns patterns to the phase, and `or` keeps what was under the white bits", () => {
    const checker: Paint = { pattern: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55] };
    const b = new Bitmap(4, 2);
    b.fill(checker);
    expect(rows(b)).toEqual(["#.#.", ".#.#"]);
    b.phaseX = 1;
    b.fill(checker);
    expect(rows(b)).toEqual([".#.#", "#.#."]);
    b.fill(WHITE);
    b.span(0, 0, 4, BLACK);
    b.phaseX = 0;
    b.fill({ ...checker, mode: "or" });
    expect(rows(b)).toEqual(["####", ".#.#"]);
  });

  it("draws hairlines end to end and clips them to the bitmap", () => {
    const b = new Bitmap(5, 3);
    b.hairline(0.5, 0.5, 4.5, 2.5, BLACK);
    expect(rows(b)).toEqual(["#....", ".##..", "...##"]);
    const c = new Bitmap(3, 3);
    c.hairline(-1000, 1.5, 1000, 1.5, BLACK);
    expect(rows(c)).toEqual(["...", "###", "..."]);
  });

  it("strokes wide lines with round joins", () => {
    const b = new Bitmap(9, 9);
    b.stroke([1.5, 7.5, 7.5], [1.5, 1.5, 7.5], 0, 3, 3, BLACK);
    expect(rows(b)).toEqual([
      "#########",
      "#########",
      "#########",
      "......###",
      "......###",
      "......###",
      "......###",
      "......###",
      "......###",
    ]);
  });

  it("draws discs of the pixels whose centres are within the radius", () => {
    const b = new Bitmap(5, 5);
    b.disc(2.5, 2.5, 2, BLACK);
    expect(rows(b)).toEqual(["..#..", ".###.", "#####", ".###.", "..#.."]);
  });
});

describe("walkDashes", () => {
  it("carries the dash phase around corners", () => {
    const drawn: number[][] = [];
    walkDashes([0, 5, 5], [0, 0, 5], 0, 3, [3, 2], (x0, y0, x1, y1) => drawn.push([x0, y0, x1, y1]));
    expect(drawn).toEqual([[0, 0, 3, 0], [5, 0, 5, 3]]);
  });
});

describe("walkMarks", () => {
  it("marks every spacing, starting half a spacing in", () => {
    const marks: number[][] = [];
    walkMarks([0, 10, 10], [0, 0, 10], 0, 3, 4, (x, y, ux, uy) => marks.push([x, y, ux, uy]));
    expect(marks).toEqual([[2, 0, 1, 0], [6, 0, 1, 0], [10, 0, 1, 0], [10, 4, 0, 1], [10, 8, 0, 1]]);
  });
});
