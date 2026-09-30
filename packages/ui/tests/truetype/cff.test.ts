import { describe, expect, it } from "vitest";
import { readCffOutlines } from "../../src/fonts/truetype/cff";

/** CFF INDEX with 1-byte offsets. */
function index(items: number[][]): number[] {
  if (!items.length) return [0, 0];
  const offsets = [1];
  for (const item of items) offsets.push(offsets[offsets.length - 1]! + item.length);
  return [0, items.length, 1, ...offsets, ...items.flat()];
}

/** A name-keyed CFF with no hints or Private DICT: just these charstrings. */
function cff(charStrings: number[][]): Uint8Array {
  const head = [1, 0, 4, 1, ...index([[84]])];
  // Top DICT: CharStrings offset as a 2-byte int (28), op 17. Its INDEX is 2 + 1 + 2 + 4 bytes.
  const offset = head.length + 9 + 2 + 2;
  return Uint8Array.from([...head, ...index([[28, offset >> 8, offset & 255, 17]]), 0, 0, 0, 0, ...index(charStrings)]);
}

const RMOVETO = 21;
const HMOVETO = 22;
const VMOVETO = 4;
const HLINETO = 6;
const ENDCHAR = 14;
// Type 2 numbers: 100 → 239, 200 → [247, 92], 300 → [247, 192], 500 → [248, 136].
const N100 = [239];
const N200 = [247, 92];
const N300 = [247, 192];
const N500 = [248, 136];

describe("readCffOutlines", () => {
  it("reads a leading width only when a moveto has one argument too many", () => {
    const outlines = readCffOutlines(
      cff([
        [...N100, ...N200, RMOVETO, ...N300, HLINETO, ENDCHAR],
        [...N500, ...N100, ...N200, RMOVETO, ...N300, HLINETO, ENDCHAR],
        [...N100, HMOVETO, ...N300, HLINETO, ENDCHAR],
        [...N500, ...N100, HMOVETO, ...N300, HLINETO, ENDCHAR],
        [...N500, ...N200, VMOVETO, ...N300, HLINETO, ENDCHAR],
      ]),
    );
    const starts = [0, 1, 2, 3, 4].map((gid) => {
      const [first] = outlines.glyph(gid)[0]!;
      return [first!.x, first!.y];
    });
    expect(starts).toEqual([
      [100, 200],
      [100, 200],
      [100, 0],
      [100, 0],
      [0, 200],
    ]);
  });
});
