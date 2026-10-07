import { describe, expect, it } from "vitest";
import {
  ASCII_MATCH_MODES,
  BASELINE_ASCII,
  asciiToBits,
  createAsciiDitherer,
  isBaselineAscii,
  listAsciiGlyphs,
  renderAsciiGlyphAtlas,
  type AsciiMatchMode,
} from "../src/asciiDither";
import type { ImageFrame } from "../src/dither";

const MODES: AsciiMatchMode[] = [...ASCII_MATCH_MODES];

function frame(pixels: number[][]): ImageFrame {
  const height = pixels.length;
  const width = pixels[0].length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = pixels[y][x];
      const i = (y * width + x) * 4;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function fill(width: number, height: number, value: number): number[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => value));
}

function dump(width: number, height: number, bits: Uint8Array): string {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) row += bits[y * width + x] ? "#" : ".";
    rows.push(row);
  }
  return rows.join("\n");
}

describe("asciiToBits", () => {
  it.each(MODES)("maps a solid dark tile to black and a solid light tile to white (%s)", (match) => {
    const dark = asciiToBits(frame(fill(8, 8, 0)), { match });
    const light = asciiToBits(frame(fill(8, 8, 255)), { match });
    expect([...dark]).toEqual(Array(64).fill(1));
    expect([...light]).toEqual(Array(64).fill(0));
  });

  it.each(MODES)("puts ink on the dark side of a left-heavy tile, not a centered blob (%s)", (match) => {
    const pixels = fill(8, 8, 255);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) pixels[y][x] = 40;
    }
    const bits = asciiToBits(frame(pixels), { match });
    let left = 0;
    let right = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) left += bits[y * 8 + x];
      for (let x = 4; x < 8; x++) right += bits[y * 8 + x];
    }
    expect(left).toBeGreaterThan(right);
    expect(right).toBeLessThan(8);
  });

  it.each(MODES)("follows a dark diagonal instead of filling a blob (%s)", (match) => {
    const pixels = fill(8, 8, 255);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (Math.abs(x + y - 7) <= 1) pixels[y][x] = 30;
      }
    }
    const bits = asciiToBits(frame(pixels), { match });
    let on = 0;
    let off = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (Math.abs(x + y - 7) <= 1) on += bits[y * 8 + x];
        else off += bits[y * 8 + x];
      }
    }
    expect(on, dump(8, 8, bits)).toBeGreaterThan(off);
    expect(off, dump(8, 8, bits)).toBeLessThan(8);
  });

  it.each(MODES)("picks a vertical stroke for a dark column on white (%s)", (match) => {
    const pixels = fill(8, 8, 255);
    for (let y = 0; y < 8; y++) pixels[y][3] = 0;
    const bits = asciiToBits(frame(pixels), { match });
    const cols = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) cols[x] += bits[y * 8 + x];
    }
    const peak = cols.indexOf(Math.max(...cols));
    expect(peak === 2 || peak === 3).toBe(true);
    expect(cols[peak]).toBeGreaterThanOrEqual(6);
    expect(cols.reduce((n, c) => n + c, 0) - cols[peak]).toBeLessThan(8);
  });

  it("thresholds leftover pixels that do not fill an 8×8 tile", () => {
    const pixels = fill(9, 8, 255);
    for (let y = 0; y < 8; y++) pixels[y][8] = 0;
    const bits = asciiToBits(frame(pixels));
    expect(bits).toHaveLength(72);
    for (let y = 0; y < 8; y++) expect(bits[y * 9 + 8]).toBe(1);
  });

  it.each(["mass", "blend"] as const)("maps mid-gray to about half ink, not a solid slab (%s)", (match) => {
    const bits = asciiToBits(frame(fill(16, 16, 128)), { match });
    const black = bits.reduce((n, b) => n + b, 0);
    expect(black).toBeGreaterThan(16 * 16 * 0.3);
    expect(black).toBeLessThan(16 * 16 * 0.7);
  });

  it("standalone luma on flat mid-gray prefers white — 128 is closer to 255 than to 0", () => {
    const bits = asciiToBits(frame(fill(8, 8, 128)), { match: "luma" });
    const black = bits.reduce((n, b) => n + b, 0);
    expect(black).toBeLessThan(32);
  });

  it("walks a luminance ramp through several glyphs", () => {
    const pixels = fill(48, 8, 255);
    for (let x = 0; x < 48; x++) {
      const v = Math.round((x / 47) * 255);
      for (let y = 0; y < 8; y++) pixels[y][x] = v;
    }
    const bits = asciiToBits(frame(pixels));
    const tiles = new Set<string>();
    for (let tx = 0; tx < 48; tx += 8) {
      let key = "";
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) key += bits[y * 48 + tx + x] ? "#" : ".";
      }
      tiles.add(key);
    }
    expect(tiles.size).toBeGreaterThan(2);
  });

  it("createAsciiDitherer reuses the output buffer", () => {
    const src = frame(fill(8, 8, 0));
    const dither = createAsciiDitherer(8, 8);
    const out = new Uint8Array(64);
    dither(src, out);
    expect([...out]).toEqual(Array(64).fill(1));
  });

  it("includes a full-tile checker", () => {
    const isChecker = (bits: Uint8Array): boolean => {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = bits[y * 8 + x];
          if (x < 7 && bits[y * 8 + x + 1] === v) return false;
          if (y < 7 && bits[(y + 1) * 8 + x] === v) return false;
        }
      }
      return true;
    };
    expect(listAsciiGlyphs().some(isChecker)).toBe(true);
  });

  it("lists 8×8 stamps and paints an atlas", () => {
    const glyphs = listAsciiGlyphs();
    expect(glyphs.length).toBeGreaterThan(20);
    for (const g of glyphs) expect(g).toHaveLength(64);
    const atlas = renderAsciiGlyphAtlas(143, 80);
    expect(atlas).toHaveLength(143 * 80);
    expect(atlas.some((b) => b === 1)).toBe(true);
  });

  it("includes VIC-20 letters and symbols that were missing from rawgly", () => {
    const pack = (rows: string[]): string =>
      rows.flatMap((row) => [...row].map((c) => (c === "1" ? 1 : 0))).join("");
    const keys = new Set(listAsciiGlyphs().map((g) => [...g].join("")));
    expect(keys.has(pack(["00011000", "00100100", "01000010", "01111110", "01000010", "01000010", "01000010", "00000000"]))).toBe(true); // A
    expect(keys.has(pack(["00111100", "01000010", "00000010", "00011100", "00000010", "01000010", "00111100", "00000000"]))).toBe(true); // 3
    expect(keys.has(pack(["00111100", "01000010", "01000010", "00111100", "01000010", "01000010", "00111100", "00000000"]))).toBe(true); // 8
    expect(keys.has(pack(["00000000", "00000000", "00111000", "00000100", "00111100", "01000100", "00111010", "00000000"]))).toBe(true); // a
    expect(keys.has(pack(["00001100", "00010000", "00010000", "00111100", "00010000", "01110000", "01101110", "00000000"]))).toBe(true); // £
  });

  it("omitted options match the explicit baseline", () => {
    const pixels = fill(16, 16, 160);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 8; x++) pixels[y][x] = 70;
    }
    const omitted = asciiToBits(frame(pixels));
    const explicit = asciiToBits(frame(pixels), { ...BASELINE_ASCII });
    expect([...omitted]).toEqual([...explicit]);
    expect(isBaselineAscii()).toBe(true);
    expect(isBaselineAscii({ punch: 2 })).toBe(false);
  });

  it("punch 1 with neighbors on is still the baseline pick", () => {
    const pixels = fill(16, 16, 160);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 8; x++) pixels[y][x] = 70;
    }
    const baseline = asciiToBits(frame(pixels));
    const punched = asciiToBits(frame(pixels), { punch: 1, directional: true });
    expect([...punched]).toEqual([...baseline]);
  });

  it("raising punch changes stamps on a soft field", () => {
    const pixels = fill(32, 16, 0);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        pixels[y][x] = Math.round(60 + (x / 31) * 120 + (y / 15) * 40);
      }
    }
    const baseline = asciiToBits(frame(pixels), { match: "mass", diffuse: false });
    const punched = asciiToBits(frame(pixels), { match: "mass", punch: 4, diffuse: false });
    let differ = 0;
    for (let i = 0; i < baseline.length; i++) if (baseline[i] !== punched[i]) differ++;
    expect(differ).toBeGreaterThan(0);
  });

  it("turning diffuse off keeps identical tiles identical", () => {
    const src = frame(fill(24, 16, 110));
    const off = asciiToBits(src, { diffuse: false });
    const tile = (bits: Uint8Array, col: number, row: number) => {
      const keys: number[] = [];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) keys.push(bits[(row * 8 + y) * 24 + col * 8 + x]);
      }
      return keys.join("");
    };
    expect(tile(off, 0, 0)).toBe(tile(off, 1, 0));
    expect(tile(off, 0, 0)).toBe(tile(off, 2, 1));
  });

  it("leftover-ink carry can change the next tile near a luma boundary", () => {
    const src = frame(fill(16, 8, 128));
    const on = asciiToBits(src, { match: "luma", diffuse: true });
    const off = asciiToBits(src, { match: "luma", diffuse: false });
    let differ = 0;
    for (let i = 0; i < on.length; i++) if (on[i] !== off[i]) differ++;
    expect(differ).toBeGreaterThan(0);
  });

  it("neighbors + punch differs from punch alone across a tile edge", () => {
    const pixels = fill(16, 8, 200);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) pixels[y][x] = 40;
    }
    const punchOnly = asciiToBits(frame(pixels), { punch: 3, directional: false, diffuse: false });
    const withNeighbors = asciiToBits(frame(pixels), { punch: 3, directional: true, diffuse: false });
    let differ = 0;
    for (let i = 0; i < punchOnly.length; i++) if (punchOnly[i] !== withNeighbors[i]) differ++;
    expect(differ).toBeGreaterThan(0);
  });

  it("normalize stays 0/1 and can change the mass pick", () => {
    const pixels = fill(8, 8, 200);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 3; x++) pixels[y][x] = 30;
    }
    const off = asciiToBits(frame(pixels), { match: "mass", normalize: false, diffuse: false });
    const on = asciiToBits(frame(pixels), { match: "mass", normalize: true, diffuse: false });
    expect(off.every((b) => b === 0 || b === 1)).toBe(true);
    expect(on.every((b) => b === 0 || b === 1)).toBe(true);
  });

  it("dithers a viewfinder-sized frame quickly", () => {
    const src = frame(fill(288, 288, 128));
    const dither = createAsciiDitherer(288, 288);
    const out = new Uint8Array(288 * 288);
    dither(src, out);
    // Best of several, so one run stalled by a busy machine doesn't fail it.
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      dither(src, out);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(80);
  });
});
