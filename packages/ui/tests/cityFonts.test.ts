import { describe, it, expect } from "vitest";
import {
  defaultFontSize,
  getFont,
  initBuiltinFonts,
  listFontFamilies,
  listFontSizes,
  listFonts,
  requireFont,
} from "../src/fonts/registry";
import { getGlyphPixel, getGlyphWidth } from "../src/fonts/font";
import { measureText } from "../src/fonts/bridge";
import { faceMetrics } from "../src/fonts/metrics";

initBuiltinFonts();

function glyphHasInk(name: string, size: number, ch: string): boolean {
  const font = requireFont(name, size);
  const ord = ch.charCodeAt(0);
  const width = getGlyphWidth(font, ord);
  for (let y = 0; y < font.glyphHeight; y++) {
    for (let x = 0; x < width; x++) {
      if (getGlyphPixel(font, ord, x, y)) return true;
    }
  }
  return false;
}

describe("city font families", () => {
  it("lists original city names with their native sizes under the family", () => {
    expect(listFonts()).toEqual(expect.arrayContaining([
      "body",
      "menu",
      "mono",
      "chicane",
      "genova",
      "newark",
      "monoco",
      "vence",
      "londinium",
      "athene",
      "sanfrisco",
      "taranto",
      "kairos",
      "losalamos",
    ]));
    expect(listFontSizes("chicane")).toEqual([12]);
    expect(listFontSizes("genova")).toEqual([9, 10, 12, 14, 18, 20, 24]);
    expect(listFontSizes("monoco")).toEqual([9, 12]);
    expect(listFontSizes("newark")).toEqual([9, 10, 12, 14, 18, 20, 24]);
    expect(listFontSizes("vence")).toEqual([14]);
    expect(listFontSizes("londinium")).toEqual([18]);
    expect(listFontSizes("athene")).toEqual([18]);
    expect(listFontSizes("sanfrisco")).toEqual([18]);
    expect(listFontSizes("taranto")).toEqual([9, 12, 14, 18, 24]);
    expect(listFontSizes("kairos")).toEqual([18]);
    expect(listFontSizes("losalamos")).toEqual([12, 24]);
  });

  it("keeps body / menu / mono as aliases onto Geneva 9, Chicago 12, Monaco 9", () => {
    expect(defaultFontSize("body")).toBe(9);
    expect(defaultFontSize("menu")).toBe(12);
    expect(defaultFontSize("mono")).toBe(9);
    expect(requireFont("body")).toBe(requireFont("genova", 9));
    expect(requireFont("menu")).toBe(requireFont("chicane", 12));
    expect(requireFont("mono")).toBe(requireFont("monoco", 9));
  });

  it("snaps a missing size to the nearest native strike", () => {
    expect(requireFont("genova", 11)).toBe(requireFont("genova", 12));
    expect(requireFont("genova", 13)).toBe(requireFont("genova", 14));
    expect(requireFont("genova", 16)).toBe(requireFont("genova", 18));
  });

  it("lets body size={12} select Geneva 12", () => {
    expect(requireFont("body", 12)).toBe(requireFont("genova", 12));
  });

  it("opens the Apple names the families used to go by, without listing them", () => {
    expect(requireFont("geneva", 12)).toBe(requireFont("genova", 12));
    expect(requireFont("chicago")).toBe(requireFont("chicane", 12));
    expect(requireFont("losAngeles", 24)).toBe(requireFont("losalamos", 24));
    const names = listFontFamilies().map((f) => f.name);
    expect(names).not.toContain("geneva");
    expect(names).not.toContain("newYork");
    expect(listFontFamilies().find((f) => f.name === "losalamos")?.displayName).toBe("Los Alamos");
  });

  it("does not advertise baked bold names as families", () => {
    expect(listFonts()).not.toContain("bodyBold");
    expect(listFonts()).not.toContain("genova12Bold");
    expect(getFont("bodyBold")).toBeTruthy();
    expect(listFontFamilies().some((family) => family.name === "genova")).toBe(true);
  });

  it("draws ink in each city family at its default size", () => {
    for (const name of ["chicane", "genova", "newark", "monoco", "vence", "londinium", "athene", "sanfrisco", "taranto", "losalamos"]) {
      expect(glyphHasInk(name, defaultFontSize(name), "A")).toBe(true);
    }
    expect(glyphHasInk("kairos", 18, "z")).toBe(true);
  });

  it("makes larger Geneva wider than Geneva 9", () => {
    expect(measureText("Washington", "genova", {}, 12)).toBeGreaterThan(measureText("Washington", "genova", {}, 9));
    expect(requireFont("genova", 24).glyphHeight).toBeGreaterThan(requireFont("genova", 9).glyphHeight);
  });

  it("uses the FONT header for New York 12", () => {
    const m = faceMetrics(requireFont("newark", 12));
    expect(m.ascent).toBe(12);
    expect(m.descent).toBe(3);
    expect(m.leading).toBe(1);
  });
});
