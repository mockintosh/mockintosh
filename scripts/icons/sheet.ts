/**
 * Icon contact sheets: one PNG that shows each icon the way the OS draws it
 * (on the desktop, selected, in the application menu) beside an enlarged,
 * gridded copy for judging single pixels. An ASCII grid in a monospace font is
 * twice as tall as it is wide, so icons are judged here, never from source.
 */
import { mkdir } from "fs/promises";
import { dirname } from "path";
import sharp from "sharp";
import { BLACK, smallIcon, type Sprite } from "@mockintosh/ui";

export interface SheetIcon {
  label: string;
  /** The 32×32 icon. */
  large?: Sprite;
  /** The hand-drawn 16×16. Without one the sheet shows what `smallIcon()` derives. */
  small?: Sprite;
}

export interface IconIssue {
  label: string;
  message: string;
}

const ZOOM = 8;
const ACTUAL = 2;
const PAD = 16;
const LABEL_H = 22;
const CAPTION_H = 16;
const GAP = 24;

const INK = "#000";
const PAPER = "#fff";
const CLEAR = "#d8d8d8";
const GRID = "#b4b4b4";
const GRID_MAJOR = "#5a5a5a";
const WARN = "#c00";

function opaque(sprite: Sprite, i: number): boolean {
  return !sprite.mask || sprite.mask[i] !== 0;
}

function inverted(sprite: Sprite): Sprite {
  const data = new Uint8Array(sprite.data.length);
  for (let i = 0; i < data.length; i++) data[i] = opaque(sprite, i) && sprite.data[i] !== BLACK ? BLACK : 0;
  return { ...sprite, data };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Pixels as runs of one colour per row, so a sheet stays a few thousand rects. */
function pixelRects(sprite: Sprite, x0: number, y0: number, scale: number, clear: string | null): string {
  const out: string[] = [];
  for (let y = 0; y < sprite.height; y++) {
    let x = 0;
    while (x < sprite.width) {
      const i = y * sprite.width + x;
      const fill = !opaque(sprite, i) ? clear : sprite.data[i] === BLACK ? INK : PAPER;
      let end = x + 1;
      while (end < sprite.width) {
        const j = y * sprite.width + end;
        const next = !opaque(sprite, j) ? clear : sprite.data[j] === BLACK ? INK : PAPER;
        if (next !== fill) break;
        end++;
      }
      if (fill) {
        out.push(
          `<rect x="${x0 + x * scale}" y="${y0 + y * scale}" width="${(end - x) * scale}" height="${scale}" fill="${fill}"/>`
        );
      }
      x = end;
    }
  }
  return out.join("");
}

function gridLines(sprite: Sprite, x0: number, y0: number, scale: number): string {
  const w = sprite.width * scale;
  const h = sprite.height * scale;
  const out: string[] = [];
  for (let i = 0; i <= sprite.width; i++) {
    const major = i % 8 === 0;
    out.push(
      `<line x1="${x0 + i * scale}" y1="${y0}" x2="${x0 + i * scale}" y2="${y0 + h}" stroke="${major ? GRID_MAJOR : GRID}" stroke-width="1"/>`
    );
  }
  for (let i = 0; i <= sprite.height; i++) {
    const major = i % 8 === 0;
    out.push(
      `<line x1="${x0}" y1="${y0 + i * scale}" x2="${x0 + w}" y2="${y0 + i * scale}" stroke="${major ? GRID_MAJOR : GRID}" stroke-width="1"/>`
    );
  }
  return out.join("");
}

function caption(x: number, y: number, text: string, color = "#333"): string {
  return `<text x="${x}" y="${y}" font-family="Menlo, monospace" font-size="11" fill="${color}">${escapeXml(text)}</text>`;
}

interface Panel {
  width: number;
  height: number;
  draw(x: number, y: number): string;
}

/** The sprite at its real size, ×2, on the desktop's 50% gray. */
function desktopPanel(title: string, sprite: Sprite): Panel {
  const inner = 48 * ACTUAL;
  return {
    width: inner,
    height: inner + CAPTION_H,
    draw(x, y) {
      const off = ((inner - sprite.width * ACTUAL) / 2) | 0;
      return (
        caption(x, y + 11, title) +
        `<rect x="${x}" y="${y + CAPTION_H}" width="${inner}" height="${inner}" fill="url(#desk)"/>` +
        pixelRects(sprite, x + off, y + CAPTION_H + off, ACTUAL, null)
      );
    },
  };
}

/** The 16×16 as the application menu draws it: a white bar, ×2. */
function menuPanel(sprite: Sprite): Panel {
  const w = 40 * ACTUAL;
  const h = 20 * ACTUAL;
  return {
    width: w,
    height: h + CAPTION_H,
    draw(x, y) {
      const top = y + CAPTION_H;
      return (
        caption(x, y + 11, "app menu") +
        `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${PAPER}"/>` +
        `<rect x="${x}" y="${top + h - ACTUAL}" width="${w}" height="${ACTUAL}" fill="${INK}"/>` +
        pixelRects(sprite, x + ((w - 16 * ACTUAL) / 2) | 0, top + 1 * ACTUAL, ACTUAL, null)
      );
    },
  };
}

function zoomPanel(title: string, sprite: Sprite, color?: string): Panel {
  const w = sprite.width * ZOOM;
  const h = sprite.height * ZOOM;
  return {
    width: w,
    height: h + CAPTION_H,
    draw(x, y) {
      const top = y + CAPTION_H;
      return caption(x, y + 11, title, color) + pixelRects(sprite, x, top, ZOOM, CLEAR) + gridLines(sprite, x, top, ZOOM);
    },
  };
}

function rowPanels(icon: SheetIcon): Panel[] {
  const panels: Panel[] = [];
  const small = icon.small ?? (icon.large ? smallIcon(icon.large) : undefined);
  if (icon.large) {
    panels.push(desktopPanel("desktop", icon.large));
    panels.push(desktopPanel("selected", inverted(icon.large)));
  }
  if (small) panels.push(menuPanel(small));
  if (icon.large) panels.push(zoomPanel(`${icon.large.width}×${icon.large.height} ×${ZOOM}`, icon.large));
  if (small) {
    panels.push(
      icon.small
        ? zoomPanel(`${small.width}×${small.height} ×${ZOOM}`, small)
        : zoomPanel("16×16 auto-reduced", small, WARN)
    );
  }
  return panels;
}

function sheetSvg(icons: SheetIcon[]): { svg: string; width: number; height: number } {
  const rows = icons.map((icon) => ({ icon, panels: rowPanels(icon) }));
  let width = 0;
  let height = PAD;
  const parts: string[] = [];
  for (const { icon, panels } of rows) {
    parts.push(caption(PAD, height + 13, icon.label, "#000").replace('font-size="11"', 'font-size="13" font-weight="bold"'));
    const top = height + LABEL_H;
    let x = PAD;
    let rowH = 0;
    for (const panel of panels) {
      parts.push(panel.draw(x, top));
      x += panel.width + GAP;
      rowH = Math.max(rowH, panel.height);
    }
    width = Math.max(width, x - GAP + PAD);
    height = top + rowH + PAD + 8;
  }
  const desk =
    `<pattern id="desk" width="${ACTUAL * 2}" height="${ACTUAL * 2}" patternUnits="userSpaceOnUse">` +
    `<rect width="${ACTUAL * 2}" height="${ACTUAL * 2}" fill="${PAPER}"/>` +
    `<rect width="${ACTUAL}" height="${ACTUAL}" fill="${INK}"/>` +
    `<rect x="${ACTUAL}" y="${ACTUAL}" width="${ACTUAL}" height="${ACTUAL}" fill="${INK}"/></pattern>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">` +
    `<defs>${desk}</defs><rect width="100%" height="100%" fill="#f2f2f2"/>${parts.join("")}</svg>`;
  return { svg, width, height };
}

/**
 * Write the sheet as PNG pages of at most `perPage` icons, so each page stays
 * small enough to read without being scaled down. Returns the page paths.
 */
export async function writeIconSheets(icons: SheetIcon[], dest: string, perPage = 6): Promise<string[]> {
  await mkdir(dirname(dest), { recursive: true });
  const pages: string[] = [];
  const count = Math.ceil(icons.length / perPage);
  for (let p = 0; p < count; p++) {
    const path = count === 1 ? dest : dest.replace(/\.png$/i, `-${p + 1}.png`);
    const { svg } = sheetSvg(icons.slice(p * perPage, (p + 1) * perPage));
    await sharp(Buffer.from(svg)).png().toFile(path);
    pages.push(path);
  }
  return pages;
}

function count(sprite: Sprite, test: (i: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < sprite.width * sprite.height; i++) if (test(i)) n++;
  return n;
}

function black(sprite: Sprite, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return false;
  const i = y * sprite.width + x;
  return opaque(sprite, i) && sprite.data[i] === BLACK;
}

/**
 * 3×3 windows laid out as a checkerboard: the 50% dither that turns to mush
 * at 16×16. A 3×3 window, not 2×2, so a 1px diagonal or a small round
 * outline (whose steps are diagonal pairs) is not mistaken for dither.
 */
export function ditherCells(sprite: Sprite): number {
  let n = 0;
  for (let y = 0; y + 2 < sprite.height; y++) {
    for (let x = 0; x + 2 < sprite.width; x++) {
      const first = black(sprite, x, y);
      let checker = true;
      for (let dy = 0; dy < 3 && checker; dy++) {
        for (let dx = 0; dx < 3 && checker; dx++) {
          const i = (y + dy) * sprite.width + x + dx;
          if (!opaque(sprite, i) || black(sprite, x + dx, y + dy) !== (((dx + dy) & 1) === 0 ? first : !first)) checker = false;
        }
      }
      if (checker) n++;
    }
  }
  return n;
}

/** Black pixels with no black neighbour, diagonals included: specks that read as dirt when small. */
export function strayPixels(sprite: Sprite): number {
  let n = 0;
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (!black(sprite, x, y)) continue;
      let alone = true;
      for (let dy = -1; dy <= 1 && alone; dy++) {
        for (let dx = -1; dx <= 1 && alone; dx++) if ((dx || dy) && black(sprite, x + dx, y + dy)) alone = false;
      }
      if (alone) n++;
    }
  }
  return n;
}

/** What the sheet cannot show at a glance: wrong sizes, a missing mask, a missing or noisy 16×16. */
export function iconIssues(icon: SheetIcon): IconIssue[] {
  const issues: IconIssue[] = [];
  const add = (message: string) => issues.push({ label: icon.label, message });
  const { large, small } = icon;
  if (large) {
    if (large.width !== 32 || large.height !== 32) add(`icon is ${large.width}×${large.height}, not 32×32`);
    if (count(large, (i) => !opaque(large, i)) === 0) add("icon has no transparent pixels: it draws as a white square on the desktop");
  }
  if (!small) {
    if (large) add("no 16×16: the application menu shows smallIcon()'s reduction");
    return issues;
  }
  if (small.width !== 16 || small.height !== 16) add(`small icon is ${small.width}×${small.height}, not 16×16`);
  if (count(small, (i) => !opaque(small, i)) === 0) add("16×16 has no transparent pixels");
  const dither = ditherCells(small);
  if (dither >= 4) add(`16×16 has ${dither} checkerboard cells: use solid black or white at this size`);
  const stray = strayPixels(small);
  if (stray >= 3) add(`16×16 has ${stray} isolated black pixels`);
  return issues;
}
