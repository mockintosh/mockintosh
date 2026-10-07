import { describe, expect, it } from "vitest";
import { HEADER_GAP, HEADER_LEFT, HEADER_RIGHT, folderHeaderLayout } from "./folderHeader";

describe("folderHeaderLayout", () => {
  it("puts the figures left, centre and right when they fit", () => {
    expect(folderHeaderLayout(327, [34, 66, 77])).toEqual([HEADER_LEFT, Math.floor((327 - 66) / 2), 327 - HEADER_RIGHT - 77]);
  });

  it("runs them on from the left when they'd collide", () => {
    // System 6's 182px-wide "Macintosh HD": "4 items  2,427K in disk  7,648K ava".
    expect(folderHeaderLayout(182, [34, 69, 77])).toEqual([
      HEADER_LEFT,
      HEADER_LEFT + 34 + HEADER_GAP,
      HEADER_LEFT + 34 + HEADER_GAP + 69 + HEADER_GAP,
    ]);
  });
});
