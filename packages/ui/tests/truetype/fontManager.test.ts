import { describe, expect, it } from "vitest";
import type { GrafPort } from "@mockintosh/quickdraw";
import { InitGraf, OpenPort, TextFace, TextFont, TextSize, bold, globals } from "@mockintosh/quickdraw";
import { getBit, newBitMap } from "@mockintosh/quickdraw/bits";
import {
  getFont,
  getFontForScaling,
  getRealFace,
  listFontFamilies,
  onFontsChanged,
  registerFont,
  registerOutlineFace,
  registerStyledStrike,
  requireFont,
  unregisterFamily,
} from "../../src/fonts/registry";
import { charAdvance, getGlyphPixel, getGlyphWidth, textAdvance } from "../../src/fonts/font";
import { drawString, installFontBridge, measureText } from "../../src/fonts/bridge";
import { fontFamilyId, hostSwapFont, uiTextRuns } from "../../src/fonts/strike";
import { encodeDeckerFont } from "../../src/fonts/codec";
import { deckerOrdinalForCharCode } from "../../src/fonts/drom";
import { OutlineFace } from "../../src/fonts/truetype/scaler";
import { deckerFontFromDraft } from "../../src/fonts/draft";
import { resolveFont } from "../../src/fonts/style";
import { testFontBytes } from "./testFont";

installFontBridge();

function install(family: string, extra: Parameters<typeof testFontBytes>[0] = {}) {
  unregisterFamily(family);
  return registerOutlineFace(testFontBytes(extra), { family });
}

function inkCount(font: ReturnType<typeof requireFont>, ord: number): number {
  let n = 0;
  for (let y = 0; y < font.glyphHeight; y++)
    for (let x = 0; x < getGlyphWidth(font, ord); x++) if (getGlyphPixel(font, ord, x, y)) n++;
  return n;
}

describe("outline families in the Font Manager", () => {
  it("scales any size, filling glyphs only on first use", () => {
    install("testsans");
    const font = requireFont("testsans", 13);
    expect(font.size).toBe(13);
    expect(font.outline).toBeDefined();
    expect(font.outline!.filled["H".charCodeAt(0)]).toBe(0);
    expect(getGlyphWidth(font, 72)).toBeGreaterThan(0);
    expect(inkCount(font, 72)).toBeGreaterThan(0);
    expect(font.outline!.filled[72]).toBe(1);
    expect(font.outline!.filled[65]).toBe(0);
  });

  it("lists the family as scalable and tells listeners", () => {
    let calls = 0;
    const off = onFontsChanged(() => calls++);
    install("testsans");
    off();
    expect(calls).toBeGreaterThan(0);
    const info = listFontFamilies().find((f) => f.name === "testsans");
    expect(info?.scalable).toBe(true);
    expect(info?.displayName).toBe("Test Sans");
  });

  it("prefers a hand-tuned bitmap strike at its size (SetOutlinePreferred false)", () => {
    install("testsans");
    const scaled = requireFont("testsans", 12);
    const draft = {
      family: "testsans",
      size: 12,
      maxWidth: 4,
      glyphHeight: 10,
      spacing: 1,
      glyphs: [{ ordinal: 72, width: 4, pixels: new Uint8Array(40).fill(1) }],
    };
    registerFont("testsans", encodeDeckerFont(deckerFontFromDraft(draft)), 12);
    const bitmap = requireFont("testsans", 12);
    expect(bitmap).not.toBe(scaled);
    expect(bitmap.outline).toBeUndefined();
    expect(requireFont("testsans", 13).outline).toBeDefined();
  });

  it("applies pair kerning in measurement and splits draw runs there", () => {
    install("testsans");
    const font = requireFont("testsans", 30);
    const plain = charAdvance(font, "A") + charAdvance(font, "V");
    expect(textAdvance(font, "AV")).toBe(plain - 2);
    const runs = uiTextRuns(font, "AV");
    expect(runs).toHaveLength(2);
    expect(runs[1]!.x).toBe(charAdvance(font, "A") - 2);
  });

  it("draws characters beyond Decker's 256 from page strikes", () => {
    install("testsans");
    const font = requireFont("testsans", 16);
    expect(charAdvance(font, "Ω")).toBeGreaterThan(0);
    expect(textAdvance(font, "\u{1F600}")).toBeGreaterThan(0);
    const runs = uiTextRuns(font, "HΩ\u{1F600}");
    expect(runs.map((r) => r.faceKey)).toEqual(["testsans", "testsans\u0001p4", "testsans\u0001p503"]);
    expect(runs[1]!.bytes).toEqual([0xa9]);
    const page = getFont("testsans\u0001p4", 16)!;
    expect(inkCount(page, 0xa9)).toBeGreaterThan(0);
  });

  it("matches real Bold faces before synthesizing", () => {
    install("testsans");
    registerOutlineFace(testFontBytes({ subfamily: "Bold", weightClass: 700 }), { family: "testsans" });
    const real = getRealFace("testsans", 1, 14);
    expect(real?.covered).toBe(1);
    const boldItalic = getRealFace("testsans", 3, 14);
    expect(boldItalic?.covered).toBe(1);
    const synthesized = resolveFont("testsans", { bold: true }, 14);
    expect(synthesized).toBe(real!.font);
    expect(measureText("H", "testsans", { bold: true }, 14)).toBe(charAdvance(real!.font, "H"));
  });

  it("uses a styled bitmap strike when a suitcase has one", () => {
    install("testsans");
    const draft = {
      family: "testsans",
      size: 12,
      maxWidth: 3,
      glyphHeight: 10,
      spacing: 0,
      glyphs: [{ ordinal: 72, width: 3, pixels: new Uint8Array(30).fill(1) }],
    };
    const strike = registerStyledStrike("testsans", 12, encodeDeckerFont(deckerFontFromDraft(draft)), 1);
    expect(getRealFace("testsans", 1, 12)?.font).toBe(strike);
  });
});

describe("bitmap scaling order", () => {
  it("picks 2×, then ½, then the next larger size, then the largest", () => {
    // Geneva ships 9, 10, 12, 14, 18, 20, 24.
    expect(getFontForScaling("geneva", 9)?.size).toBe(9);
    expect(getFontForScaling("geneva", 7)?.size).toBe(14);
    expect(getFontForScaling("geneva", 36)?.size).toBe(18);
    expect(getFontForScaling("geneva", 11)?.size).toBe(12);
    expect(getFontForScaling("geneva", 60)?.size).toBe(24);
  });
});

describe("QuickDraw through the scaler", () => {
  it("DrawText paints lazily rendered outline glyphs with no stretching", () => {
    install("testsans");
    const screen = newBitMap(64, 32);
    InitGraf(screen);
    const port = {} as GrafPort;
    OpenPort(port);
    drawString(port, "H", 2, 2, "testsans", 1, {}, 17);
    const font = requireFont("testsans", 17);
    let painted = 0;
    let expected = 0;
    for (let y = 0; y < font.glyphHeight; y++) {
      for (let x = 0; x < getGlyphWidth(font, 72); x++) {
        const want = getGlyphPixel(font, 72, x, y);
        if (want) expected++;
        if (want && getBit(screen, 2 + x, 2 + y)) painted++;
      }
    }
    expect(expected).toBeGreaterThan(0);
    expect(painted).toBe(expected);
  });

  it("_SwapFont returns 1/1 scaling for outline sizes and drops covered bold", () => {
    install("testsans");
    registerOutlineFace(testFontBytes({ subfamily: "Bold", weightClass: 700 }), { family: "testsans" });
    const screen = newBitMap(8, 8);
    InitGraf(screen);
    OpenPort({} as GrafPort);
    TextFont(fontFamilyId("testsans"));
    TextSize(23);
    TextFace(bold);
    const port = globals.thePort!;
    const out = hostSwapFont({
      family: port.txFont,
      size: 23,
      face: bold,
      needBits: true,
      device: 0,
      numer: { h: 1, v: 1 },
      denom: { h: 1, v: 1 },
    });
    expect(out.numer).toEqual({ h: 1, v: 1 });
    expect(out.denom).toEqual({ h: 1, v: 1 });
    expect(out.bold).toBe(0);
  });

  it("reuses the last width tables instead of rebuilding one per swap", () => {
    install("testsans");
    const screen = newBitMap(8, 8);
    InitGraf(screen);
    OpenPort({} as GrafPort);
    const swap = (size: number) =>
      hostSwapFont({
        family: fontFamilyId("testsans"),
        size,
        face: 0,
        needBits: true,
        device: 0,
        numer: { h: 1, v: 1 },
        denom: { h: 1, v: 1 },
      }).widthTable;
    const first = swap(19);
    expect(swap(19)).toBe(first);
    expect(swap(21)).not.toBe(first);
    expect(first[72]! >> 16).toBe(charAdvance(requireFont("testsans", 19), "H"));
  });

  it("fits accented capitals in the line and draws taller ink above it", () => {
    install("testsans");
    const font = requireFont("testsans", 20);
    expect(font.inkAbove).toBeUndefined();
    const aring = deckerOrdinalForCharCode(0xc5);
    for (let x = 0; x < getGlyphWidth(font, aring); x++) expect(getGlyphPixel(font, aring, x, -1)).toBe(false);

    // Ǻ lives on page strike 2 and rises above any line box.
    const page = getFont("testsans\u0001p2", 20)!;
    expect(page.glyphHeight).toBe(font.glyphHeight);
    expect(page.inkAbove).toBeGreaterThan(0);

    const screen = newBitMap(64, 80);
    InitGraf(screen);
    const port = {} as GrafPort;
    OpenPort(port);
    const top = 30;
    drawString(port, "\u01fa", 2, top, "testsans", 1, {}, 20);
    let inkAboveLine = 0;
    for (let y = 0; y < top; y++) for (let x = 0; x < 30; x++) inkAboveLine += getBit(screen, x, y);
    expect(inkAboveLine).toBeGreaterThan(0);
  });
});
