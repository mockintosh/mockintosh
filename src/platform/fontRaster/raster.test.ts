import { describe, expect, it } from "vitest";
import { decodeDeckerFont, encodeDeckerFont, listFontFamilies, registerFont } from "@mockintosh/sdk";
import { OutlineFace, deckerFontFromDraft, draftFromDeckerFont } from "@mockintosh/ui";
import { createOutlineFontRasterService } from "./service";
import { rasterizeWithScaler } from "./raster";
import { buildTinyTtf } from "./tinyTtf";

describe("tiny TrueType fixture", () => {
  it("parses a boxed A and the family name through the scaler's reader", () => {
    const face = new OutlineFace(buildTinyTtf());
    expect(face.familyName).toBe("Tiny");
    expect(face.font.unitsPerEm).toBe(1000);
    expect(face.font.glyphId(32)).toBe(1);
    expect(face.font.glyphId(65)).toBe(2);
    expect(face.font.glyph(2).contours).toHaveLength(1);
    expect(face.font.glyph(2).contours[0]).toHaveLength(4);
  });
});

describe("baking strikes", () => {
  it("produces a strike whose A has ink and packs as %%FNT1", () => {
    const draft = rasterizeWithScaler(buildTinyTtf(), { size: 36, mode: "auto", threshold: 96, spacing: 1, chars: " A" });
    expect(draft.family).toBe("tiny");
    expect(draft.size).toBe(36);
    expect(draft.glyphHeight).toBeGreaterThanOrEqual(36);
    expect(draft.spacing).toBe(1);

    const letterA = draft.glyphs.find((g) => g.ordinal === 65)!;
    expect(letterA.width).toBeGreaterThan(0);
    expect(letterA.pixels.some((p) => p === 1)).toBe(true);

    const packed = encodeDeckerFont(deckerFontFromDraft(draft));
    expect(packed.startsWith("%%FNT1")).toBe(true);
    const again = draftFromDeckerFont(decodeDeckerFont(packed, draft.family), draft.family, draft.size).glyphs.find(
      (g) => g.ordinal === 65,
    )!;
    expect(again.width).toBe(letterA.width);
    expect([...again.pixels]).toEqual([...letterA.pixels]);
  });

  it("registers the packed strike on the SDK font list", () => {
    const draft = rasterizeWithScaler(buildTinyTtf(), { size: 24, mode: "auto", threshold: 96, spacing: 0, chars: "A" });
    registerFont(draft.family, encodeDeckerFont(deckerFontFromDraft(draft)), draft.size);
    expect(listFontFamilies().find((f) => f.name === draft.family)?.sizes).toContain(24);
  });

  it("every scaler mode emits an A with ink, and the threshold matters when oversampling", async () => {
    const raster = createOutlineFontRasterService();
    expect(raster.modes()).toEqual(["auto", "outline", "x2", "x3"]);
    for (const mode of raster.modes()) {
      const draft = await raster.rasterize(buildTinyTtf(), { size: 18, mode, threshold: 96, spacing: 0, chars: "A" });
      expect(draft.glyphs.find((g) => g.ordinal === 65)?.pixels.some((p) => p === 1), mode).toBe(true);
    }
    const ink = (threshold: number) =>
      rasterizeWithScaler(buildTinyTtf(), { size: 11, mode: "x3", threshold, spacing: 0, chars: "A" })
        .glyphs[0]!.pixels.reduce((a, b) => a + b, 0);
    expect(ink(16)).toBeGreaterThan(ink(250));
  });
});
