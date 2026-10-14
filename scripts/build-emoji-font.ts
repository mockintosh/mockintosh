/**
 * Bake the built-in Emoji family from Google's Noto Emoji (SIL OFL): the
 * black-and-white emoji font, outlines only.
 *
 *   tsx scripts/build-emoji-font.ts --font path/to/NotoEmoji[wght].ttf
 *   tsx scripts/build-emoji-font.ts --font … --preview /tmp/emoji.png
 *
 * The font comes from github.com/google/fonts (`ofl/notoemoji`); its
 * `OFL.txt` beside it is copied next to the strikes. Variations are not
 * applied: the strikes are the default (Regular) instance.
 *
 * Every emoji is a square `size` × `size` cell advancing `size + 1`, keyed by code point. Emoji
 * that are sequences (ZWJ families, flags, keycaps, skin tones) are the
 * font's `ccmp` ligatures: a sequence whose ligature is the glyph of a
 * single code point (Noto draws no skin tones, so 👍🏽 is 👍) maps to that
 * code point; any other gets a private-use code point from U+F0000, and
 * `sequences.ts` lists them all for `emoji.ts`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { encodeFaceRecord, type FaceGlyph } from "../packages/ui/src/fonts/codec";
import { isDefaultIgnorable, SEQUENCE_BASE } from "../packages/ui/src/fonts/emojiClusters";
import { downsample, scanConvert, type PixelContour } from "../packages/ui/src/fonts/truetype/raster";
import { parseSfnt, type SfntFont } from "../packages/ui/src/fonts/truetype/sfnt";
import { encodePng1bit } from "../packages/ui/src/png";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "packages/ui/src/fonts/faces/emoji");

/** Cell heights baked: the largest that fits a face's cell draws its emoji (`emoji.ts`). */
const EMOJI_SIZES = [10, 12, 14, 16, 20, 24] as const;

/** Oversampling for coverage, and the share of a pixel that must be ink. */
const OVERSAMPLE = 8;
const THRESHOLD = 0.42;
/**
 * Below this cell height Noto's hairlines break into dots, so a stroke that
 * misses every pixel centre keeps one pixel (dropout control, as the scaler does).
 */
const DROPOUT_BELOW = 16;

const { values } = parseArgs({
  options: {
    font: { type: "string" },
    preview: { type: "string" },
    sizes: { type: "string" },
  },
});
if (!values.font) throw new Error("--font path/to/NotoEmoji[wght].ttf");
const fontBytes = new Uint8Array(readFileSync(values.font));
const font = parseSfnt(fontBytes);

// --- Sequences: the ligatures `ccmp` makes ---------------------------------

interface Sequence {
  codePoints: number[];
  gid: number;
}

function readLigatures(bytes: Uint8Array, sfnt: SfntFont): Sequence[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at);
  let gsub = -1;
  for (let i = 0; i < u16(4); i++) {
    const tag = String.fromCharCode(...bytes.subarray(12 + i * 16, 16 + i * 16));
    if (tag === "GSUB") gsub = view.getUint32(12 + i * 16 + 8);
  }
  if (gsub < 0) throw new Error("No GSUB table");
  const features = gsub + u16(gsub + 6);
  const lookups = gsub + u16(gsub + 8);
  const ccmp = new Set<number>();
  for (let i = 0; i < u16(features); i++) {
    const tag = String.fromCharCode(...bytes.subarray(features + 2 + i * 6, features + 6 + i * 6));
    if (tag !== "ccmp") continue;
    const feature = features + u16(features + 6 + i * 6);
    for (let j = 0; j < u16(feature + 2); j++) ccmp.add(u16(feature + 4 + j * 2));
  }
  const coverage = (at: number): number[] => {
    const out: number[] = [];
    if (u16(at) === 1) {
      for (let i = 0; i < u16(at + 2); i++) out.push(u16(at + 4 + i * 2));
    } else {
      for (let i = 0; i < u16(at + 2); i++) {
        for (let g = u16(at + 4 + i * 6); g <= u16(at + 6 + i * 6); g++) out.push(g);
      }
    }
    return out;
  };
  const codePointOf = new Map<number, number>();
  for (const cp of sfnt.codePoints()) if (!codePointOf.has(sfnt.glyphId(cp))) codePointOf.set(sfnt.glyphId(cp), cp);

  const sequences: Sequence[] = [];
  for (const index of ccmp) {
    const lookup = lookups + u16(lookups + 2 + index * 2);
    if (u16(lookup) !== 4) continue;
    for (let s = 0; s < u16(lookup + 4); s++) {
      const sub = lookup + u16(lookup + 6 + s * 2);
      const firsts = coverage(sub + u16(sub + 2));
      firsts.forEach((first, k) => {
        const set = sub + u16(sub + 6 + k * 2);
        for (let j = 0; j < u16(set); j++) {
          const lig = set + u16(set + 2 + j * 2);
          const gids = [first];
          for (let c = 1; c < u16(lig + 2); c++) gids.push(u16(lig + 4 + (c - 1) * 2));
          const codePoints = gids.map((gid) => codePointOf.get(gid));
          if (codePoints.some((cp) => cp === undefined)) continue;
          sequences.push({ codePoints: codePoints as number[], gid: u16(lig) });
        }
      });
    }
  }
  return sequences;
}

// --- Glyphs ----------------------------------------------------------------

/** One glyph to bake, by the code point it is stored under. */
interface Wanted {
  codePoint: number;
  gid: number;
}

const wanted: Wanted[] = [];
const codePointOfGid = new Map<number, number>();
for (const cp of font.codePoints()) {
  // ASCII stays the text face's; ignorables draw nothing.
  if (cp < 0xa0 || isDefaultIgnorable(cp)) continue;
  const gid = font.glyphId(cp);
  if (!gid || font.glyph(gid).contours.length === 0) continue;
  wanted.push({ codePoint: cp, gid });
  if (!codePointOfGid.has(gid)) codePointOfGid.set(gid, cp);
}

const sequenceTable: [string, number][] = [];
let nextPrivate = SEQUENCE_BASE;
for (const seq of readLigatures(fontBytes, font)) {
  const key = String.fromCodePoint(...seq.codePoints.filter((cp) => cp !== 0xfe0f && cp !== 0xfe0e));
  if ([...key].length < 2) continue;
  let codePoint = codePointOfGid.get(seq.gid);
  if (codePoint === undefined) {
    codePoint = nextPrivate++;
    codePointOfGid.set(seq.gid, codePoint);
    wanted.push({ codePoint, gid: seq.gid });
  }
  sequenceTable.push([key, codePoint]);
}
sequenceTable.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

// The design square: where Noto draws its emoji, from the glyphs' own bounds.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}
const bounds = wanted.map((w) => font.bounds(w.gid));
const centerX = median(bounds.map((b) => (b.xMin + b.xMax) / 2));
const centerY = median(bounds.map((b) => (b.yMin + b.yMax) / 2));
const square = median(bounds.map((b) => Math.max(b.xMax - b.xMin, b.yMax - b.yMin)));

/** `gid` in a `size` × `size` cell, wider when the emoji is wider than the square. */
function renderGlyph(gid: number, size: number): { width: number; pixels: Uint8Array } {
  const glyph = font.glyph(gid);
  const scale = (size * OVERSAMPLE) / square;
  const inkWidth = Math.ceil(((glyph.xMax - glyph.xMin) / square) * size);
  const width = Math.max(size, inkWidth);
  const contours: PixelContour[] = glyph.contours.map((contour) =>
    contour.map((p) => ({ ...p, x: (p.x - centerX) * scale, y: (p.y - centerY) * scale })),
  );
  const big = scanConvert(
    contours,
    {
      width: width * OVERSAMPLE,
      height: size * OVERSAMPLE,
      originX: (width * OVERSAMPLE) / 2,
      baseline: (size * OVERSAMPLE) / 2,
    },
    { dropout: false },
  );
  const { pixels } = downsample(big, width * OVERSAMPLE, size * OVERSAMPLE, OVERSAMPLE, THRESHOLD * 255);
  if (size < DROPOUT_BELOW) {
    const native: PixelContour[] = contours.map((contour) => contour.map((p) => ({ ...p, x: p.x / OVERSAMPLE, y: p.y / OVERSAMPLE })));
    const kept = scanConvert(native, { width, height: size, originX: width / 2, baseline: size / 2 }, { dropout: true });
    for (let i = 0; i < pixels.length; i++) pixels[i] ||= kept[i]!;
  }
  return { width, pixels };
}

function strikeRecord(size: number): string {
  const glyphs: FaceGlyph[] = [];
  const done = new Set<number>();
  for (const { codePoint, gid } of wanted) {
    if (done.has(codePoint)) continue;
    done.add(codePoint);
    const { width, pixels } = renderGlyph(gid, size);
    // A column of air after each, as a text face's glyphs have, so neighbours don't touch.
    glyphs.push({ codePoint, width, advance: width + 1, originX: 0, pixels });
  }
  glyphs.sort((a, b) => (a.codePoint as number) - (b.codePoint as number));
  return encodeFaceRecord({ glyphHeight: size, inkAbove: 0, inkBelow: 0, spacing: 0, glyphs });
}

// --- Preview ---------------------------------------------------------------

const PREVIEW =
  "😀😃😂🥲😍🤔😴😭😡👍👎👋🙏💪👀🧠❤️💔🔥⭐🌈☀️🌙⛄🍎🍕☕🎉🎁📱💻⌨️🖨️📁📎✂️🔒🔑⚠️✅❌❓💡🐶🐱🐭🦊🐻🐧🐢🌳🌻🚗✈️🚀⏰🎵📷🏠⚽";

function preview(path: string, sizes: readonly number[]): void {
  const chars = [...new Intl.Segmenter().segment(PREVIEW)].map((s) => s.segment);
  const zoom = 4;
  const gap = 4;
  const rows = sizes.map((size) => ({ size, top: 0 }));
  let height = gap;
  for (const row of rows) {
    row.top = height;
    height += row.size + gap;
  }
  const width = gap + Math.max(...sizes.map((size) => chars.length * (size + 2)));
  const sheet = new Uint8Array(width * height);
  for (const { size, top } of rows) {
    let x = gap;
    for (const ch of chars) {
      const key = String.fromCodePoint(...[...ch].map((c) => c.codePointAt(0)!).filter((cp) => cp !== 0xfe0f));
      const cp = sequenceTable.find(([k]) => k === key)?.[1] ?? key.codePointAt(0)!;
      const entry = wanted.find((w) => w.codePoint === cp);
      if (entry) {
        const { width: w, pixels } = renderGlyph(entry.gid, size);
        for (let y = 0; y < size; y++) for (let i = 0; i < w; i++) if (pixels[y * w + i]) sheet[(top + y) * width + x + i] = 1;
      }
      x += size + 2;
    }
  }
  const big = new Uint8Array(width * zoom * height * zoom);
  for (let y = 0; y < height * zoom; y++) {
    for (let x = 0; x < width * zoom; x++) big[y * width * zoom + x] = sheet[Math.floor(y / zoom) * width + Math.floor(x / zoom)]!;
  }
  writeFileSync(path, encodePng1bit(big, width * zoom, height * zoom));
  console.log(`Preview: ${path}`);
}

// --- Output ----------------------------------------------------------------

const sizes = values.sizes ? values.sizes.split(",").map(Number) : [...EMOJI_SIZES];
console.log(
  `${wanted.length} glyphs (${sequenceTable.length} sequences, ${nextPrivate - SEQUENCE_BASE} private), square ${square} units`,
);
if (values.preview) {
  preview(values.preview, sizes);
} else {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const header = (what: string) =>
    `// Generated by scripts/build-emoji-font.ts from Noto Emoji (SIL OFL, LICENSE-NotoEmoji.txt). Do not hand-edit.\n// ${what}\n`;
  const imports: string[] = [];
  const entries: string[] = [];
  for (const size of sizes) {
    const name = `EMOJI_${size}`;
    const data = strikeRecord(size);
    writeFileSync(join(OUT, `emoji_${size}.ts`), `${header(`Emoji ${size}: ${size}px cells.`)}export const ${name} = "${data}";\n`);
    imports.push(`import { ${name} } from "./emoji_${size}";`);
    entries.push(`  { size: ${size}, data: ${name} },`);
    console.log(`emoji ${size}: ${(data.length / 1024).toFixed(0)} KB`);
  }
  writeFileSync(
    join(OUT, "generated.ts"),
    `${header("The Emoji family's strikes, and its sequences.")}\n${imports.join("\n")}\n\nexport { EMOJI_SEQUENCES } from "./sequences";\n\n/** One strike per cell height. */\nexport const EMOJI_STRIKES: readonly { size: number; data: string }[] = [\n${entries.join("\n")}\n];\n`,
  );
  // Sequence, then its code point in hex; entries joined by newlines.
  const packed = sequenceTable.map(([key, cp]) => `${key}\t${cp.toString(16)}`).join("\n");
  writeFileSync(
    join(OUT, "sequences.ts"),
    `${header(`${sequenceTable.length} sequences: each is its code points (no variation selectors), a tab, and the code point that draws it, in hex.`)}export const EMOJI_SEQUENCES = ${JSON.stringify(packed)};\n`,
  );
  const license = join(dirname(values.font), "OFL.txt");
  if (existsSync(license)) copyFileSync(license, join(OUT, "LICENSE-NotoEmoji.txt"));
  else console.warn(`No OFL.txt beside the font: ${OUT}/LICENSE-NotoEmoji.txt not written`);
}
