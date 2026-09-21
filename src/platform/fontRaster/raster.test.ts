import { describe, expect, it } from "vitest";
import { decodeDeckerFont, encodeDeckerFont, listFontFamilies, registerFont } from "@mockintosh/sdk";
import { createOutlineFontRasterService } from "./service";
import { rasterizeOutline } from "./raster";
import { parseTtf } from "./parseTtf";
import { buildTinyTtf } from "./tinyTtf";
import { deckerFontFromDraft, draftFromDeckerFont } from "@mockintosh/ui";

describe("tiny TrueType fixture", () => {
  it("parses a boxed A and the family name", () => {
    const ttf = parseTtf(buildTinyTtf());
    expect(ttf.familyName).toBe("Tiny");
    expect(ttf.unitsPerEm).toBe(1000);
    expect(ttf.cmap.get(32)).toBe(1);
    expect(ttf.cmap.get(65)).toBe(2);
    expect(ttf.glyph(2).contours.length).toBe(1);
    expect(ttf.glyph(2).contours[0]!.length).toBe(4);
  });
});

describe("outline rasterizer", () => {
  it("produces a strike whose A has ink and packs as %%FNT1", async () => {
    const bytes = buildTinyTtf();
    const draft = rasterizeOutline(bytes, { size: 36, threshold: 96, spacing: 1, chars: " A" });
    expect(draft.family).toBe("tiny");
    expect(draft.size).toBe(36);
    expect(draft.glyphHeight).toBeGreaterThanOrEqual(36);
    expect(draft.spacing).toBe(1);

    const letterA = draft.glyphs.find((g) => g.ordinal === 65);
    expect(letterA).toBeDefined();
    expect(letterA!.width).toBeGreaterThan(0);
    expect(letterA!.pixels.some((p) => p === 1)).toBe(true);
    const inkRows: number[] = [];
    for (let y = 0; y < draft.glyphHeight; y++) {
      const row = letterA!.pixels.subarray(y * letterA!.width, (y + 1) * letterA!.width);
      if (row.some((p) => p === 1)) inkRows.push(y);
    }
    expect(inkRows[0]).toBeLessThan(Math.floor(draft.glyphHeight / 2));

    const packed = encodeDeckerFont(deckerFontFromDraft(draft));
    expect(packed.startsWith("%%FNT1")).toBe(true);
    const roundtrip = draftFromDeckerFont(decodeDeckerFont(packed, draft.family), draft.family, draft.size);
    const again = roundtrip.glyphs.find((g) => g.ordinal === 65)!;
    expect(again.width).toBe(letterA!.width);
    expect([...again.pixels]).toEqual([...letterA!.pixels]);
  });

  it("registers the packed strike on the SDK font list", async () => {
    const draft = rasterizeOutline(buildTinyTtf(), { size: 24, threshold: 96, spacing: 0, chars: "A" });
    const packed = encodeDeckerFont(deckerFontFromDraft(draft));
    registerFont(draft.family, packed, draft.size);
    const listed = listFontFamilies();
    const info = listed.find((f) => f.name === draft.family);
    expect(info).toBeDefined();
    expect(info!.sizes).toContain(24);
  });

  it("x2/x3 outline modes still emit an A with ink", async () => {
    const raster = createOutlineFontRasterService();
    expect(raster.modes()).toEqual(["outline", "x2", "x3"]);
    for (const mode of ["outline", "x2", "x3"] as const) {
      const draft = await raster.rasterize(buildTinyTtf(), {
        size: 18,
        mode,
        threshold: 96,
        spacing: 0,
        chars: "A",
      });
      const letterA = draft.glyphs.find((g) => g.ordinal === 65);
      expect(letterA?.pixels.some((p) => p === 1), mode).toBe(true);
    }
  });
});
