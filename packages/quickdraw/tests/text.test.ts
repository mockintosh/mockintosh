import { describe, expect, it, beforeEach } from "vitest";
import {
  CharWidth,
  ClosePicture,
  DrawString,
  DrawText,
  GetFontInfo,
  HidePen,
  InitGraf,
  MeasureText,
  MoveTo,
  OpenPicture,
  OpenPort,
  NewRgn,
  RectRgn,
  SetClip,
  SetOrigin,
  StdText,
  StdTxMeas,
  StringWidth,
  TextWidth,
  UnionRgn,
  installFontManager,
  type FMInput,
  type FMOutput,
  type FontInfo,
  type FontStrike,
  type GrafPort,
} from "../src";
import { getBit, makeRect, newBitMap, pixelsFromBitMap } from "../src/bits";
import { fallbackFMOutput } from "../src/fontManager";

function openPort(w = 64, h = 32): GrafPort {
  InitGraf(newBitMap(w, h));
  const port = {} as GrafPort;
  OpenPort(port);
  return port;
}

function emptyStrike(overrides: Partial<FontStrike> = {}): FontStrike {
  return {
    fontType: 0,
    firstChar: 0,
    lastChar: 255,
    widMax: 8,
    kernMax: 0,
    nDescent: 0,
    fRectWidth: 0,
    fRectHeight: 0,
    ascent: 0,
    descent: 0,
    leading: 0,
    rowWords: 0,
    bitImage: new Uint8Array(0),
    locTable: new Int16Array(258),
    owTable: new Int16Array(258).fill(0x8000),
    ...overrides,
  };
}

/** 8×8 strike: 'A' (65) is a 3×8 left-justified bar of black pixels. */
function barStrike(): FontStrike {
  const height = 8;
  const rowWords = 1;
  const bitImage = new Uint8Array(rowWords * 2 * height);
  for (let y = 0; y < height; y++) {
    bitImage[y * 2] = 0xe0; // 1110 0000 — 3 px bar
  }
  const locTable = new Int16Array(258);
  const owTable = new Int16Array(258).fill(0x8000);
  locTable[65] = 0;
  locTable[66] = 3;
  owTable[65] = 3;
  locTable[256] = 0;
  locTable[257] = 3;
  owTable[256] = 3;
  return {
    fontType: 0,
    firstChar: 0,
    lastChar: 255,
    widMax: 8,
    kernMax: 0,
    nDescent: -2,
    fRectWidth: 3,
    fRectHeight: height,
    ascent: 8,
    descent: 0,
    leading: 0,
    rowWords,
    bitImage,
    locTable,
    owTable,
  };
}

function widthsOf(map: Record<number, number>): Int32Array {
  const w = new Int32Array(256);
  for (let i = 0; i < 256; i++) w[i] = ((map[i] ?? 0) << 16) | 0;
  return w;
}

function installSynthetic(
  strike: FontStrike,
  advances: Record<number, number>,
  extra: Partial<FMOutput> = {}
): void {
  installFontManager((inRec: FMInput): FMOutput => {
    const base = fallbackFMOutput(inRec);
    return {
      ...base,
      fontHandle: strike,
      ascent: strike.ascent & 0xff,
      descent: strike.descent & 0xff,
      widMax: strike.widMax & 0xff,
      leading: strike.leading,
      widthTable: widthsOf(advances),
      ...extra,
    };
  });
}

describe("StdTxMeas", () => {
  beforeEach(() => {
    openPort();
    installSynthetic(emptyStrike({ ascent: 9, descent: 2, widMax: 8, leading: 1 }), {
      65: 5, // A
      66: 7, // B
      32: 3,
    });
  });

  it("sums Fixed width-table advances and fills FontInfo", () => {
    const info: FontInfo = { ascent: 0, descent: 0, widMax: 0, leading: 0 };
    const numer = { h: 1, v: 1 };
    const denom = { h: 1, v: 1 };
    const w = StdTxMeas(2, [65, 66], numer, denom, info);
    expect(w).toBe(12);
    expect(info).toEqual({ ascent: 9, descent: 2, widMax: 8, leading: 1 });
  });

  it("TextWidth / StringWidth / CharWidth go through the same table", () => {
    expect(CharWidth("A")).toBe(5);
    expect(StringWidth("AB")).toBe(12);
    expect(TextWidth("AB", 0, 2)).toBe(12);
  });

  it("TextWidth scales with +denom/2 when numer.h ≠ denom.h", () => {
    installFontManager((inRec) => {
      const out = fallbackFMOutput(inRec);
      out.widthTable = widthsOf({ 65: 5 });
      out.numer = { h: 2, v: 1 };
      out.denom = { h: 1, v: 1 };
      return out;
    });
    // (5 * 2 + 0) / 1 = 10
    expect(TextWidth("A", 0, 1)).toBe(10);
  });

  it("MeasureText writes count+1 integer locations", () => {
    const locs: number[] = [];
    MeasureText(2, [65, 66], locs);
    expect(locs.slice(0, 3)).toEqual([0, 5, 12]);
  });
});

describe("GetFontInfo", () => {
  it("adds extra to widMax and shadow to ascent/descent", () => {
    openPort();
    installFontManager((inRec) => {
      const out = fallbackFMOutput(inRec);
      out.ascent = 8;
      out.descent = 2;
      out.widMax = 6;
      out.leading = 1;
      out.extra = 2;
      out.shadow = 1;
      return out;
    });
    const info: FontInfo = { ascent: 0, descent: 0, widMax: 0, leading: 0 };
    GetFontInfo(info);
    expect(info.widMax).toBe(8);
    expect(info.ascent).toBe(9);
    expect(info.descent).toBe(3);
    expect(info.leading).toBe(1);
  });
});

describe("fallback without a Font Manager", () => {
  it("measures 6 px/char and does not paint", () => {
    installFontManager(fallbackFMOutput);
    const port = openPort();
    MoveTo(2, 10);
    DrawString("Hi");
    expect(port.pnLoc.h).toBe(2 + 12);
    expect(getBit(port.portBits, 2, 2)).toBe(0);
  });
});

describe("DrText", () => {
  it("treats pnLoc.v as the baseline (glyph top = v − ascent)", () => {
    const port = openPort(32, 24);
    installSynthetic(barStrike(), { 65: 4 });
    MoveTo(4, 12);
    DrawString("A");
    // Bar occupies x=4..6, y = 12-8 = 4 .. 12
    expect(getBit(port.portBits, 4, 4)).toBe(1);
    expect(getBit(port.portBits, 4, 11)).toBe(1);
    expect(getBit(port.portBits, 4, 3)).toBe(0);
    expect(getBit(port.portBits, 4, 12)).toBe(0);
    expect(port.pnLoc.h).toBe(8);
  });

  it("places glyphs in local coordinates when the port origin is not (0,0)", () => {
    installSynthetic(barStrike(), { 65: 4 });
    const plain = openPort(32, 24);
    MoveTo(4, 12);
    DrawString("A");
    const shifted = openPort(32, 24);
    SetOrigin(10, 20);
    MoveTo(14, 32);
    DrawString("A");
    expect(pixelsFromBitMap(shifted.portBits)).toEqual(pixelsFromBitMap(plain.portBits));
  });

  it("does not blit the space character", () => {
    const port = openPort(32, 24);
    installSynthetic(barStrike(), { 65: 4, 32: 10 });
    MoveTo(2, 12);
    DrawString(" ");
    expect(port.pnLoc.h).toBe(12);
    for (let y = 4; y < 12; y++) {
      expect(getBit(port.portBits, 2, y)).toBe(0);
    }
  });

  it("bumps the pen then skips drawing when pnVis < 0", () => {
    const port = openPort(32, 24);
    installSynthetic(barStrike(), { 65: 4 });
    HidePen();
    MoveTo(4, 12);
    DrawString("A");
    expect(port.pnLoc.h).toBe(8);
    expect(getBit(port.portBits, 4, 4)).toBe(0);
  });

  it("smears bold one pixel to the right", () => {
    const port = openPort(32, 24);
    installSynthetic(barStrike(), { 65: 5 }, { bold: 1 });
    MoveTo(4, 12);
    DrawString("A");
    // Original bar 3 px + 1 px smear
    expect(getBit(port.portBits, 4, 8)).toBe(1);
    expect(getBit(port.portBits, 6, 8)).toBe(1);
    expect(getBit(port.portBits, 7, 8)).toBe(1);
  });

  it("direct-to-screen srcOr matches the scratch path under a split clip", () => {
    installSynthetic(barStrike(), { 65: 4 });
    const fast = openPort(32, 24);
    MoveTo(4, 12);
    DrawString("A");
    const slow = openPort(32, 24);
    const left = NewRgn();
    const right = NewRgn();
    const u = NewRgn();
    RectRgn(left, makeRect(0, 0, 24, 16));
    RectRgn(right, makeRect(0, 16, 24, 32));
    UnionRgn(left, right, u);
    SetClip(u);
    MoveTo(4, 12);
    DrawString("A");
    expect(pixelsFromBitMap(slow.portBits)).toEqual(pixelsFromBitMap(fast.portBits));
  });

  it("shears italic so the top row sits to the right of the bottom", () => {
    const port = openPort(48, 24);
    installSynthetic(barStrike(), { 65: 8 }, { italic: 16 }); // 1 px/row
    MoveTo(8, 16);
    DrawString("A");
    // Bottom row (y=15) unshifted at h=8; top row (y=8) shifted ~7 px
    expect(getBit(port.portBits, 8, 15)).toBe(1);
    expect(getBit(port.portBits, 8 + 7, 8)).toBe(1);
  });
});

describe("StdText picture recording", () => {
  function hex(data: number[]): string {
    return data.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  }

  it("emits font-state then $2B (or $28) and the text bytes", () => {
    installSynthetic(emptyStrike(), { 72: 6, 105: 6 });
    openPort();
    const pic = OpenPicture(makeRect(0, 0, 32, 24));
    if (!pic) throw new Error("OpenPicture nil");
    MoveTo(10, 20);
    DrawString("Hi");
    ClosePicture();
    const data = pic.pic._data;
    expect(data[0]).toBe(0x11);
    expect(data[1]).toBe(0x01);
    // txMode srcOr (1) differs from pic snapshot srcCopy (0)
    const modeAt = data.indexOf(0x05);
    expect(modeAt).toBeGreaterThan(0);
    expect(data.slice(modeAt, modeAt + 3)).toEqual([0x05, 0x00, 0x01]);
    // pnLoc (10,20) vs picTxLoc (0,0) → short DHDV $2B
    const textAt = data.indexOf(0x2b);
    expect(textAt).toBeGreaterThan(modeAt);
    expect(data.slice(textAt, textAt + 5)).toEqual([
      0x2b, 10, 20, 2, "H".charCodeAt(0),
    ]);
    expect(data[textAt + 4]).toBe("H".charCodeAt(0));
    expect(data[textAt + 5]).toBe("i".charCodeAt(0));
    expect(hex(data.slice(textAt, textAt + 6))).toBe("2b 0a 14 02 48 69");
  });

  it("pnVis < -1 records nothing beyond the version word", () => {
    installSynthetic(emptyStrike(), { 65: 4 });
    const port = openPort();
    const pic = OpenPicture(makeRect(0, 0, 32, 24));
    if (!pic) throw new Error("OpenPicture nil");
    HidePen(); // OpenPicture already hid once → pnVis = -2
    expect(port.pnVis).toBeLessThan(-1);
    MoveTo(4, 8);
    DrawString("A");
    ClosePicture();
    expect(pic.pic._data.slice(0, 2)).toEqual([0x11, 0x01]);
    expect(pic.pic._data.includes(0x28)).toBe(false);
    expect(pic.pic._data.includes(0x2b)).toBe(false);
  });

  it("DrawText dispatches through textProc, not DrText directly", () => {
    openPort();
    const calls: number[][] = [];
    const port = {} as GrafPort;
    OpenPort(port);
    port.grafProcs = {
      textProc: (count, addr) => {
        calls.push(addr.slice(0, count));
      },
    };
    DrawText("Z", 0, 1);
    expect(calls).toEqual([[90]]);
  });

  it("StdText chunks runs longer than 255 bytes", () => {
    openPort();
    const counts: number[] = [];
    const port = {} as GrafPort;
    // Re-open so we own grafProcs after InitGraf from the previous test's port.
    InitGraf(newBitMap(16, 16));
    OpenPort(port);
    installSynthetic(emptyStrike(), { 65: 1 });
    port.grafProcs = {
      textProc: (count, addr, numer, denom) => {
        counts.push(count);
        StdText(count, addr, numer, denom);
      },
    };
    const bytes = new Array(300).fill(65);
    DrawText(bytes, 0, 300);
    // CallText sees 300; StdText itself chunks — this textProc is the bottleneck
    // and is invoked once with the full count. Chunking is inside StdText.
    expect(counts).toEqual([300]);
    expect(port.pnLoc.h).toBe(300);
  });
});
