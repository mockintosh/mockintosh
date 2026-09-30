/**
 * Import every pixel cut of Redaction (https://www.redaction.us, SIL OFL)
 * as a native %%FNT1 strike.
 *
 * Redaction N draws every outline point on an N-unit grid of a 1000-unit em,
 * with straight edges only, so one grid step is one pixel at 1000 / N px:
 * Redaction 100 → 10, 70 → 14, 50 → 20, 35 → 29, 20 → 50, 10 → 100.
 * Each cell is sampled at its centre (nonzero winding), which is exact.
 * Glyphs whose ink overhangs their advance keep it through an overhang
 * table (ordinal → [advance, originX]); only Decker's ordinals are kept.
 * Regular, Bold and Italic are imported. Regular 10–29 are bundled; the
 * other bitmaps go to their own modules (`redaction50.ts`, `redactionBold.ts`,
 * …) so the registry can load them on first use.
 *
 * Usage:
 *   npx tsx scripts/import-redaction.ts                  # downloads redaction.zip
 *   npx tsx scripts/import-redaction.ts --otf /path/to/OTF
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deckerOrdinalForCharCode, defaultRasterCharset } from "../packages/ui/src/fonts/drom";
import { parseSfnt, type SfntFont } from "../packages/ui/src/fonts/truetype/sfnt";

const ZIP_URL = "https://www.redaction.us/static/redaction.zip";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const facesDir = resolve(root, "packages/ui/src/fonts/faces");

const STYLES = ["Regular", "Bold", "Italic"] as const;

/**
 * The module a strike's bitmap goes to when it loads on first use rather
 * than with the bundle: the 50 and 100 strikes on their own, and Bold and
 * Italic's smaller sizes together per style. Regular 10–29 stay bundled.
 */
function lazyModule(style: (typeof STYLES)[number], size: number): string | null {
  const stem = style === "Regular" ? "redaction" : `redaction${style}`;
  if (size >= 50) return `${stem}${size}`;
  return style === "Regular" ? null : stem;
}

/** Cut (grid in font units) → strike size in pixels. */
const CUTS = [100, 70, 50, 35, 20, 10] as const;

async function otfDir(): Promise<string> {
  const flag = process.argv.indexOf("--otf");
  if (flag >= 0) return resolve(process.argv[flag + 1]!);
  const work = mkdtempSync(join(tmpdir(), "redaction-"));
  const response = await fetch(ZIP_URL);
  if (!response.ok) throw new Error(`${ZIP_URL}: HTTP ${response.status}`);
  writeFileSync(join(work, "redaction.zip"), Buffer.from(await response.arrayBuffer()));
  // The site's zip wraps the release zip (OTF/, webfonts/).
  execFileSync("unzip", ["-q", "-o", "redaction.zip", "-d", "outer"], { cwd: work });
  execFileSync("unzip", ["-q", "-o", "outer/redaction/Redaction_2_001.zip", "-d", "release"], { cwd: work });
  return join(work, "release/OTF");
}

interface Glyph {
  ordinal: number;
  advance: number;
  /** Ink as [x, y] pixels, x from the pen, y up from the baseline. */
  ink: [number, number][];
}

/** Glyphs with a point off the grid (a few per cut); their cells are still sampled at centres. */
const offGrid = new Set<string>();

/** Nonzero winding of the polygon contours around (x, y). */
function inside(contours: [number, number][][], x: number, y: number): boolean {
  let winding = 0;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const [x0, y0] = contour[i]!;
      const [x1, y1] = contour[(i + 1) % contour.length]!;
      if (y0 <= y ? y1 > y : y1 <= y) {
        const cross = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y1 > y0 ? cross > 0 : cross < 0) winding += y1 > y0 ? 1 : -1;
      }
    }
  }
  return winding !== 0;
}

function rasterize(font: SfntFont, grid: number, codePoint: number, ordinal: number): Glyph | null {
  const gid = font.glyphId(codePoint);
  if (gid === 0) return null;
  const outline = font.glyph(gid);
  const label = `Redaction ${grid} U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  const contours = outline.contours.map((contour) =>
    contour.map((p): [number, number] => {
      if (!p.on) throw new Error(`${label}: curved outline`);
      if (p.x % grid || p.y % grid) offGrid.add(label);
      return [p.x / grid, p.y / grid];
    }),
  );
  const ink: [number, number][] = [];
  const points = contours.flat();
  if (points.length) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x < Math.ceil(Math.max(...xs)); x++) if (inside(contours, x + 0.5, y + 0.5)) ink.push([x, y]);
  }
  if (font.advance(gid) % grid) offGrid.add(label);
  return { ordinal, advance: Math.round(font.advance(gid) / grid), ink };
}

interface Strike {
  size: number;
  width: number;
  height: number;
  ascent: number;
  descent: number;
  glyphs: number;
  data: string;
  overhangs: Map<number, [number, number]>;
}

function convert(bytes: Uint8Array, grid: number): Strike {
  const font = parseSfnt(bytes);
  if (font.unitsPerEm !== 1000) throw new Error(`Redaction ${grid}: unitsPerEm ${font.unitsPerEm}`);
  const glyphs: Glyph[] = [];
  for (const ch of defaultRasterCharset()) {
    const codePoint = ch.codePointAt(0)!;
    const glyph = rasterize(font, grid, codePoint, deckerOrdinalForCharCode(codePoint));
    if (glyph) glyphs.push(glyph);
  }
  // Line box from the font's ascender / descender, grown to any ink that leaves it.
  let ascent = Math.ceil(font.ascender / grid);
  let descent = Math.ceil(-font.descender / grid);
  for (const g of glyphs)
    for (const [, y] of g.ink) {
      ascent = Math.max(ascent, y + 1);
      descent = Math.max(descent, -y);
    }
  const height = ascent + descent;

  const overhangs = new Map<number, [number, number]>();
  const cells = glyphs.map((g) => {
    const left = g.ink.reduce((min, [x]) => Math.min(min, x), 0);
    const right = g.ink.reduce((max, [x]) => Math.max(max, x + 1), g.advance);
    if (left < 0 || right > g.advance) overhangs.set(g.ordinal, [g.advance, -left]);
    return { g, left, width: Math.max(1, right - left) };
  });
  const width = Math.max(...cells.map((c) => c.width));
  if (width > 255 || height > 255) throw new Error(`Redaction ${grid}: ${width}×${height} exceeds %%FNT1's one-byte sizes`);

  const byteWidth = (width + 7) >> 3;
  const out: number[] = [width, height, 0];
  for (const { g, left, width: cellWidth } of cells.sort((a, b) => a.g.ordinal - b.g.ordinal)) {
    const packed = new Uint8Array(byteWidth * height);
    for (const [x, y] of g.ink) {
      const col = x - left;
      const row = ascent - 1 - y;
      packed[row * byteWidth + (col >> 3)]! |= 0x80 >> (col & 7);
    }
    out.push(g.ordinal, cellWidth);
    for (const byte of packed) out.push(byte);
  }
  return {
    size: Math.round(1000 / grid),
    width,
    height,
    ascent,
    descent,
    glyphs: cells.length,
    data: `%%FNT1${Buffer.from(out).toString("base64")}`,
    overhangs,
  };
}

const dir = await otfDir();
const GENERATED = [
  "// Generated from Redaction 2.001 (https://www.redaction.us, SIL OFL). Do not hand-edit.",
  "//   npx tsx scripts/import-redaction.ts",
];
const header = [...GENERATED, "//", "// Each cut at the size where its grid is one pixel."];
const body: string[] = [];
/** Lazy module (e.g. `redactionBold50`) → its exports. */
const lazyModules = new Map<string, string[]>();
for (const style of STYLES) {
  for (const grid of CUTS) {
    const file = join(dir, `Redaction${grid}-${style}.otf`);
    if (!existsSync(file)) throw new Error(`Missing ${file}`);
    const strike = convert(new Uint8Array(readFileSync(file)), grid);
    const suffix = style === "Regular" ? "" : `_${style.toUpperCase()}`;
    const name = `BUILTIN_FONT_REDACTION${suffix}_${strike.size}`;
    header.push(
      `// Redaction ${grid} ${style} → ${strike.size}: cell ${strike.width}×${strike.height} ` +
        `(ascent ${strike.ascent} + descent ${strike.descent}), ${strike.glyphs} glyphs.`,
    );
    const module = lazyModule(style, strike.size);
    const data = `export const ${name} = "${strike.data}";`;
    if (module) {
      if (!lazyModules.has(module)) lazyModules.set(module, []);
      lazyModules.get(module)!.push(data);
    } else {
      body.push(data);
    }
    body.push(`export const ${name}_INFO = { ascent: ${strike.ascent}, descent: ${strike.descent}, leading: 0 };`);
    const table = [...strike.overhangs].sort(([a], [b]) => a - b).map(([o, [a, x]]) => `${o}: [${a}, ${x}]`);
    body.push(
      "/** Ordinal → [advance, originX] for glyphs whose ink overhangs their advance. */",
      `export const ${name}_OVERHANGS: Readonly<Record<number, readonly [number, number]>> = { ${table.join(", ")} };`,
    );
    console.log(`Redaction ${grid} ${style} → ${strike.size}px: ${strike.width}×${strike.height}, ${strike.glyphs} glyphs`);
  }
}
if (offGrid.size) console.log(`Off-grid points (sampled as drawn): ${offGrid.size} glyphs`);
for (const [module, exports] of lazyModules) {
  const path = join(facesDir, `${module}.ts`);
  writeFileSync(path, [...GENERATED, "// Loaded on first use; metrics are in redaction.ts.", ...exports].join("\n") + "\n", "utf8");
  console.log(`Wrote ${path}`);
}
const outPath = join(facesDir, "redaction.ts");
writeFileSync(outPath, [...header, ...body].join("\n") + "\n", "utf8");
console.log(`Wrote ${outPath}`);
