import { describe, expect, it } from "vitest";
import { decodeSuitcase, encodeSuitcase } from "@mockintosh/sdk";
import { testFontBytes } from "../../packages/ui/tests/truetype/testFont";
import { describeSuitcase, detectedStyle, styleOfOutline, suitcaseFromOutline, withOutline, withStrike } from "./suitcase";

describe("Foundry suitcases", () => {
  it("starts from an outline in the style the font declares", () => {
    const bold = testFontBytes({ family: "Case", subfamily: "Bold", weightClass: 700 });
    expect(detectedStyle(bold)).toBe(1);
    expect(detectedStyle(new Uint8Array([0, 1]))).toBe(0);
    const s = suitcaseFromOutline(bold);
    expect(s.family).toBe("Case");
    expect(s.outlines.map((o) => o.style)).toEqual([1]);
    expect(styleOfOutline(s, bold)).toBe(1);
  });

  it("replaces slots and frozen sizes, and round-trips through a .suit", () => {
    const plain = testFontBytes({ family: "Case" });
    let s = suitcaseFromOutline(plain);
    s = withOutline(s, 2, testFontBytes({ family: "Case", italic: true }));
    s = withOutline(s, 2, plain);
    s = withStrike(s, 12, 0, "%%FNT1AAAA");
    s = withStrike(s, 12, 0, "%%FNT1BBBB");
    s = withStrike(s, 9, 1, "%%FNT1CCCC");
    expect(s.outlines.map((o) => o.style)).toEqual([0, 2]);
    expect(s.strikes).toEqual([
      { size: 12, style: 0, data: "%%FNT1BBBB" },
      { size: 9, style: 1, data: "%%FNT1CCCC" },
    ]);
    expect(describeSuitcase(s)).toBe("Case · outlines: Plain, Italic · bitmaps: 12, 9 Bold");
    const again = decodeSuitcase(encodeSuitcase(s));
    expect(again.strikes).toEqual(s.strikes);
    expect(again.outlines[1]!.bytes).toEqual(plain);
  });

  it("rejects files that aren't suitcases", () => {
    expect(() => decodeSuitcase("{}")).toThrow("isn't a font suitcase");
    expect(() => decodeSuitcase("nope")).toThrow("damaged");
  });
});
