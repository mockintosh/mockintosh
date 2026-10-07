/**
 * Map lettering, drawn straight into the map's bitmap from the system's
 * bitmap fonts, with a one-pixel white halo so a name stays legible over
 * roads and patterns. Italic (water) is the Font Manager's slant, applied
 * here because a strike's pixels are upright; street names along north–south
 * roads are turned to read upwards.
 */
import {
  getGlyphIndexForChar,
  getGlyphPixel,
  getGlyphWidth,
  glyphAdvance,
  glyphOriginX,
  resolveFont,
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

/** The glyph `getGlyphIndexForChar` falls back to for a character the font lacks. */
const QUESTION = "?".charCodeAt(0);

/** Letters no system font draws, for the ones `normalize("NFD")` can't take apart. */
const PLAIN: Readonly<Record<string, string>> = {
  ł: "l", Ł: "L", đ: "d", Đ: "D", ħ: "h", Ħ: "H", ı: "i", ŀ: "l", Ŀ: "L", ŧ: "t", Ŧ: "T", ð: "d", Ð: "D",
  þ: "th", Þ: "Th", ə: "e", Ə: "E", ʻ: "'", ʼ: "'", "‐": "-",
};

function face(f: LabelFace) {
  return resolveFont(f.font, {}, f.size);
}

function hasGlyph(font: ReturnType<typeof resolveFont>, ch: string): boolean {
  const index = getGlyphIndexForChar(font, ch);
  return index >= 0 && (index !== QUESTION || ch === "?");
}

/**
 * `text` as the face can draw it: letters it lacks become their plain
 * forms (Ł → L, ő → o). `null` when much of it still can't be drawn, which
 * is what a name in a script the fonts don't have looks like.
 */
export function printable(text: string, labelFace: LabelFace): string | null {
  // Every frame of a new zoom asks again for the same names; each is worked out once.
  const key = `${labelFace.font}|${labelFace.size ?? ""}|${labelFace.upper ? 1 : 0}|${text}`;
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
  const lean = labelFace.italic ? slant(0, cellHeight) : 0;
  const textWidth = advance(text, labelFace);
  const width = textWidth + lean + 3;
  const height = cellHeight + 2;
  const ink = new Uint8Array(width * height);
  let pen = 1;
  for (const ch of text) {
    const index = getGlyphIndexForChar(font, ch);
    if (index < 0) continue;
    const glyphWidth = getGlyphWidth(font, index);
    const left = pen - glyphOriginX(font, index);
    for (let gy = 0; gy < cellHeight; gy++) {
      const shift = labelFace.italic ? slant(gy, cellHeight) : 0;
      for (let gx = 0; gx < glyphWidth; gx++) {
        if (!getGlyphPixel(font, index, gx, gy)) continue;
        const x = left + gx + shift;
        if (x >= 0 && x < width) ink[(gy + 1) * width + x] = 1;
      }
    }
    pen += glyphAdvance(font, index) + font.spacing + (labelFace.tracking ?? 0);
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
    const index = getGlyphIndexForChar(font, ch);
    if (index >= 0) width += glyphAdvance(font, index) + font.spacing + (labelFace.tracking ?? 0);
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
