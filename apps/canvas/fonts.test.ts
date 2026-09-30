import { describe, expect, it } from "vitest";
import { effectiveSize, fontFamilyOf, fontLabel, fontMenu, sizeChoices, SCALABLE_SIZES } from "./fonts";
import { listFontFamilies } from "@mockintosh/ui";

describe("Canvas font sizes", () => {
  it("offers a bitmap family's real strikes and a TrueType family every standard size", () => {
    expect(sizeChoices("body", [])).toEqual([9, 10, 12, 14, 18, 20, 24]);
    expect(sizeChoices("menu", [])).toEqual([12]);
    expect(sizeChoices("futura", [{ name: "futura", defaultSize: 12, sizes: [], scalable: true, displayName: "Futura" }])).toEqual([
      ...SCALABLE_SIZES,
    ]);
  });

  it("lists every family by name and checks a role font under its family", () => {
    const menu = fontMenu(listFontFamilies()).map((f) => f.displayName);
    expect(menu).toEqual(expect.arrayContaining(["Chicago", "Geneva", "New York", "San Francisco", "Venice", "Geist Pixel"]));
    expect(menu).toEqual([...menu].sort((a, b) => a.localeCompare(b)));
    expect(fontFamilyOf("body")).toBe("geneva");
    expect(fontLabel("menu", listFontFamilies())).toBe("Chicago");
  });

  it("falls back to the font's default size", () => {
    expect(effectiveSize("body", undefined)).toBe(9);
    expect(effectiveSize("menu", undefined)).toBe(12);
    expect(effectiveSize("body", 18)).toBe(18);
  });
});
