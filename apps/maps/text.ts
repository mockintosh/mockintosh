/**
 * Map lettering, drawn straight into the map's bitmap from the system's
 * bitmap fonts, with a one-pixel white halo so a name stays legible over
 * roads and patterns. Italic (water) is the face's own italic strike where it
 * has one (Geneva 9, from System 7.5.3), else the Font Manager's slant,
 * applied here because a strike's pixels are upright; street names along north–south
 * roads are turned to read upwards.
 */
import {
  getGlyphPixel,
  getGlyphWidth,
  getRealFace,
  glyphAdvance,
  glyphOriginX,
  locateGlyph,
  lookalikeGlyph,
  resolveFont,
  type DeckerFont,
} from "@mockintosh/ui";
import type { Bitmap } from "./bitmap";

export interface LabelFace {
  /**
   * A font name `<text font>` takes: `body`, `geneva12`, `menu`, … Not
   * `bodyBold` or `geneva12Bold`: those are the Font Manager's smear.
   */
  font: string;
  /** Point size, for a family name such as `newYork`; a role name (`body`) has its own. */
  size?: number;
  italic?: boolean;
  upper?: boolean;
  /** Extra pixels between letters. */
  tracking?: number;
}

/** A label's pixels: `ink` letters inside a `halo` one pixel wider all round. */
interface LabelImage {
  width: number;
  height: number;
  ink: Uint8Array;
  halo: Uint8Array;
}

/** Letters no system font draws, for the ones `normalize("NFD")` can't take apart. */
const PLAIN: Readonly<Record<string, string>> = {
  ł: "l", Ł: "L", đ: "d", Đ: "D", ħ: "h", Ħ: "H", ı: "i", ŀ: "l", Ŀ: "L", ŧ: "t", Ŧ: "T", ð: "d", Ð: "D",
  þ: "th", Þ: "Th", ə: "e", Ə: "E", ʻ: "'", ʼ: "'", "‐": "-",
};

/** QuickDraw's italic style bit. */
const ITALIC = 2;

/** The face's own italic strike, when `f` asks for italic and the family has one. */
function realItalic(f: LabelFace): DeckerFont | null {
  if (!f.italic) return null;
  const real = getRealFace(f.font, ITALIC, f.size);
  return real && real.covered & ITALIC ? real.font : null;
}

function face(f: LabelFace): DeckerFont {
  return realItalic(f) ?? resolveFont(f.font, {}, f.size);
}

/** Italic still to slant here: asked for, and no italic strike draws it. */
function slanted(f: LabelFace): boolean {
  return Boolean(f.italic) && !realItalic(f);
}

/** The strike and slot that draw `ch` (its page, or a look-alike), or undefined. */
function glyphOf(font: DeckerFont, ch: string): { font: DeckerFont; ordinal: number } | undefined {
  const cp = ch.codePointAt(0)!;
  return locateGlyph(font, cp) ?? lookalikeGlyph(font, cp);
}

function hasGlyph(font: DeckerFont, ch: string): boolean {
  return glyphOf(font, ch) !== undefined;
}

/**
 * `text` as the face can draw it: letters it lacks become their plain
 * forms (Ł → L, ő → o). `null` when much of it still can't be drawn, which
 * is what a name in a script the fonts don't have looks like.
 */
export function printable(text: string, labelFace: LabelFace): string | null {
  // Every frame of a new zoom asks again for the same names; each is worked out once.
  const key = `${labelFace.font}|${labelFace.size ?? ""}|${labelFace.italic ? 1 : 0}|${labelFace.upper ? 1 : 0}|${text}`;
  const known = printed.get(key);
  if (known !== undefined) return known;
  const result = printableNow(text, labelFace);
  if (printed.size >= PRINTED_CAPACITY) printed.clear();
  printed.set(key, result);
  return result;
}

/** Names already made printable, by face; cleared when it fills rather than tracking age. */
const printed = new Map<string, string | null>();
const PRINTED_CAPACITY = 20_000;

function printableNow(text: string, labelFace: LabelFace): string | null {
  const font = face(labelFace);
  const source = labelFace.upper ? text.toUpperCase() : text;
  let out = "";
  let missing = 0;
  for (const ch of source) {
    if (hasGlyph(font, ch)) {
      out += ch;
      continue;
    }
    const plain = PLAIN[ch] ?? ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (plain && [...plain].every((c) => hasGlyph(font, c))) out += plain;
    else missing++;
  }
  out = out.trim();
  if (!out || missing > source.length / 4) return null;
  return out;
}

/** Rows of slant at row `y` of a cell `height` tall: QuickDraw's italic, one pixel every two rows. */
function slant(y: number, height: number): number {
  return Math.floor((height - 3 - y) / 2) + 1;
}

const images = new Map<string, LabelImage>();
const IMAGE_CACHE = 600;

function render(text: string, labelFace: LabelFace): LabelImage {
  const key = `${labelFace.font}|${labelFace.size ?? ""}|${labelFace.italic ? 1 : 0}|${labelFace.tracking ?? 0}|${text}`;
  const cached = images.get(key);
  if (cached) {
    images.delete(key);
    images.set(key, cached);
    return cached;
  }
  const font = face(labelFace);
  const cellHeight = font.glyphHeight;
  const glyphs = [...text].map((ch) => glyphOf(font, ch));
  // Accents on capitals can stand above the cell (Apple's strikes keep them
  // there); the box grows only by the rows this text actually inks.
  let top = 0;
  let bottom = cellHeight;
  for (const glyph of glyphs) {
    if (!glyph) continue;
    const rowsAbove = glyph.font.inkAbove ?? 0;
    const rowsBelow = glyph.font.inkBelow ?? 0;
    for (let gy = -rowsAbove; gy < cellHeight + rowsBelow; gy++) {
      if (gy >= top && gy < bottom) continue;
      for (let gx = 0; gx < getGlyphWidth(glyph.font, glyph.ordinal); gx++) {
        if (!getGlyphPixel(glyph.font, glyph.ordinal, gx, gy)) continue;
        top = Math.min(top, gy);
        bottom = Math.max(bottom, gy + 1);
        break;
      }
    }
  }
  const lean = slanted(labelFace) ? slant(top, cellHeight) : 0;
  const textWidth = advance(text, labelFace);
  const width = textWidth + lean + 3;
  const height = bottom - top + 2;
  const ink = new Uint8Array(width * height);
  let pen = 1;
  for (const glyph of glyphs) {
    if (!glyph) continue;
    const { font: strike, ordinal } = glyph;
    const glyphWidth = getGlyphWidth(strike, ordinal);
    const left = pen - glyphOriginX(strike, ordinal);
    for (let gy = top; gy < bottom; gy++) {
      const shift = lean ? slant(gy, cellHeight) : 0;
      for (let gx = 0; gx < glyphWidth; gx++) {
        if (!getGlyphPixel(strike, ordinal, gx, gy)) continue;
        const x = left + gx + shift;
        if (x >= 0 && x < width) ink[(gy - top + 1) * width + x] = 1;
      }
    }
    pen += glyphAdvance(strike, ordinal) + font.spacing + (labelFace.tracking ?? 0);
  }
  const halo = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) halo[yy * width + xx] = 1;
        }
      }
    }
  }
  const image = { width, height, ink, halo };
  images.set(key, image);
  if (images.size > IMAGE_CACHE) images.delete(images.keys().next().value!);
  return image;
}

function advance(text: string, labelFace: LabelFace): number {
  const font = face(labelFace);
  let width = 0;
  for (const ch of text) {
    const glyph = glyphOf(font, ch);
    if (glyph) width += glyphAdvance(glyph.font, glyph.ordinal) + font.spacing + (labelFace.tracking ?? 0);
  }
  return width - font.spacing - (labelFace.tracking ?? 0);
}

/** The box a label takes, halo included: `[width, height]` as it reads. */
export function labelSize(text: string, labelFace: LabelFace): [number, number] {
  const image = render(text, labelFace);
  return [image.width, image.height];
}

/**
 * Letter `text` with the top-left of its box at (x, y); `upright` turns it a
 * quarter to read from bottom to top, the box then `height × width`.
 * `inverse` letters it white in a black halo, for a black box.
 */
export function drawLabel(target: Bitmap, text: string, labelFace: LabelFace, x: number, y: number, upright = false, inverse = false): void {
  const { width, height, ink, halo } = render(text, labelFace);
  const px = target.pixels;
  const stride = target.width;
  for (let iy = 0; iy < height; iy++) {
    for (let ix = 0; ix < width; ix++) {
      const i = iy * width + ix;
      if (!halo[i]) continue;
      const tx = upright ? x + iy : x + ix;
      const ty = upright ? y + (width - 1 - ix) : y + iy;
      if (tx < 0 || ty < 0 || tx >= stride || ty >= target.height) continue;
      px[ty * stride + tx] = inverse ? 1 - ink[i]! : ink[i]!;
    }
  }
}
