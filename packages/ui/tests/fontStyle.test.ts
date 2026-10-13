import { describe, it, expect } from "vitest";
import { smearBitmapFaceBold } from "../src/fonts/boldSmear";
import { getGlyphWidth } from "../src/fonts/font";
import { getRealFace, initBuiltinFonts, listFonts, requireFont } from "../src/fonts/registry";
import { resolveFont } from "../src/fonts/style";
import { measureText } from "../src/fonts/bridge";
import { faceMetrics } from "../src/fonts/metrics";
import { hostSwapFont, italicShearUnits, STRIKE_DESCENT, uiFontMetrics } from "../src/fonts/strike";
import { italic as italicFace, outline as outlineFace } from "@mockintosh/quickdraw";

initBuiltinFonts();

/** QuickDraw's italic style bit. */
const ITALIC_BITS = 2;

function sampleAdvance(font: ReturnType<typeof requireFont>): number {
  for (let ord = 32; ord < 127; ord++) {
    if (getGlyphWidth(font, ord) > 0) return ord;
  }
  return -1;
}

describe("resolveFont bold smear", () => {
  it("smears every built-in face one pixel wider", () => {
    for (const name of listFonts()) {
      const plain = requireFont(name);
      const bold = resolveFont(name, { bold: true });
      expect(bold.name).toBe(plain.name);
      expect(bold.glyphHeight).toBe(plain.glyphHeight);
      expect(bold.maxWidth).toBe(plain.maxWidth + 1);
      const sample = sampleAdvance(plain);
      if (sample >= 0) {
        expect(getGlyphWidth(bold, sample)).toBe(getGlyphWidth(plain, sample) + 1);
      }
    }
  });

  it("caches the smear per base face", () => {
    expect(resolveFont("mono", { bold: true })).toBe(resolveFont("mono", { bold: true }));
  });

  it("matches a fresh smear of the named face", () => {
    const expected = smearBitmapFaceBold(requireFont("mono"), "mono");
    const actual = resolveFont("mono", { bold: true });
    expect(getGlyphWidth(actual, "W".charCodeAt(0))).toBe(getGlyphWidth(expected, "W".charCodeAt(0)));
  });

  it("keeps the base face FontInfo", () => {
    const plain = faceMetrics(requireFont("geneva12"));
    const bold = faceMetrics(resolveFont("geneva12", { bold: true }));
    expect(bold.ascent).toBe(plain.ascent);
    expect(bold.descent).toBe(plain.descent);
    expect(bold.leading).toBe(plain.leading);
    expect(bold.lineHeight).toBe(plain.lineHeight);
  });

  it("measures bold wider by one pixel per glyph", () => {
    expect(measureText("A", "mono", { bold: true })).toBe(measureText("A", "mono") + 1);
    expect(measureText("Hi", "body", { bold: true })).toBe(measureText("Hi", "body") + 2);
  });
});

describe("resolveFont italic extra", () => {
  it("grows every built-in face without an italic of its own one pixel, keeping cell height", () => {
    for (const name of listFonts()) {
      if (getRealFace(name, ITALIC_BITS)?.covered) continue;
      const plain = requireFont(name);
      const italic = resolveFont(name, { italic: true });
      expect(italic.name).toBe(plain.name);
      expect(italic.glyphHeight).toBe(plain.glyphHeight);
      expect(italic.maxWidth).toBe(plain.maxWidth + 1);
      const sample = sampleAdvance(plain);
      if (sample >= 0) {
        expect(getGlyphWidth(italic, sample)).toBe(getGlyphWidth(plain, sample) + 1);
      }
    }
  });

  it("draws Geneva 9 italic with Apple's own strike instead of shearing", () => {
    expect(getRealFace("body", ITALIC_BITS)?.covered).toBe(ITALIC_BITS);
    const plain = requireFont("body");
    const italic = resolveFont("body", { italic: true });
    expect(italic.glyphHeight).toBe(plain.glyphHeight);
    expect(italic.glyphData).not.toEqual(plain.glyphData);
  });

  it("stacks with bold", () => {
    const plain = requireFont("mono");
    const both = resolveFont("mono", { bold: true, italic: true });
    expect(both.maxWidth).toBe(plain.maxWidth + 2);
    expect(getGlyphWidth(both, "A".charCodeAt(0))).toBe(
      getGlyphWidth(plain, "A".charCodeAt(0)) + 2,
    );
    expect(measureText("Hi", "mono", { bold: true, italic: true })).toBe(
      measureText("Hi", "mono") + 4,
    );
  });

  it("caches italic and bold+italic separately", () => {
    expect(resolveFont("venice", { italic: true })).toBe(resolveFont("venice", { italic: true }));
    expect(resolveFont("venice", { italic: true })).not.toBe(resolveFont("venice", { bold: true }));
  });

  it("asks DrawText for a slope that moves the top of short faces, and none for Apple's own italic", () => {
    const body = uiFontMetrics(requireFont("body"));
    const tall = uiFontMetrics(requireFont("athens"));
    expect(italicShearUnits(body.ascent, STRIKE_DESCENT)).toBeGreaterThan(body.ascent >> 3);
    expect(italicShearUnits(tall.ascent, STRIKE_DESCENT)).toBe(tall.ascent >> 3);

    const fm = hostSwapFont({
      family: 0,
      size: 0,
      face: italicFace,
      needBits: true,
      device: 0,
      numer: { h: 1, v: 1 },
      denom: { h: 1, v: 1 },
    });
    // Geneva 9 has Apple's own italic strike, so there is nothing left to shear.
    expect(fm.italic).toBe(0);
  });
});

describe("resolveFont outline extra", () => {
  it("pads one pixel on every side of the Decker cell", () => {
    const plain = requireFont("mono");
    const outlined = resolveFont("mono", { outline: true });
    expect(outlined.maxWidth).toBe(plain.maxWidth + 2);
    expect(outlined.glyphHeight).toBe(plain.glyphHeight + 2);
    expect(outlined.outlinePad).toBe(1);
    expect(measureText("Hi", "body", { outline: true })).toBe(measureText("Hi", "body") + 4);
  });

  it("does not ask DrawText to bold-smear a plain outline", () => {
    const fm = hostSwapFont({
      family: 0,
      size: 0,
      face: outlineFace,
      needBits: true,
      device: 0,
      numer: { h: 1, v: 1 },
      denom: { h: 1, v: 1 },
    });
    expect(fm.bold).toBe(0);
    expect(fm.shadow).toBe(0);
    expect(fm.extra).toBe(0);
  });
});

describe("resolveFont shadow extra", () => {
  it("is outline plus one pixel right and down", () => {
    const plain = requireFont("mono");
    const outlined = resolveFont("mono", { outline: true });
    const drop = resolveFont("mono", { shadow: true });
    expect(drop.maxWidth).toBe(outlined.maxWidth + 1);
    expect(drop.glyphHeight).toBe(outlined.glyphHeight + 1);
    expect(drop.outlinePad).toBe(1);
    expect(drop.shadowPad).toBe(1);
    expect(measureText("Hi", "body", { shadow: true })).toBe(measureText("Hi", "body", { outline: true }) + 2);

    const both = resolveFont("mono", { outline: true, shadow: true });
    expect(both.maxWidth).toBe(plain.maxWidth + 3);
    expect(both.glyphHeight).toBe(plain.glyphHeight + 3);
  });

  it("stacks bold, italic, outline, and shadow", () => {
    const plain = measureText("Hi", "mono");
    expect(
      measureText("Hi", "mono", { bold: true, italic: true, outline: true, shadow: true }),
    ).toBe(plain + 10);
  });
});
