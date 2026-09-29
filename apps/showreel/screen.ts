/**
 * Drawing at the machine's own pixels. The `Painter` paints a resolution-free
 * stage; this draws with the OS's actual material — its bitmap fonts,
 * sprites and cursors — so everything lands on whole device pixels and is
 * scaled only by whole numbers, the way QuickDraw would.
 *
 * Layout is still placed on the 320×180 stage (`x`, `y`, `len`) so shots
 * compose the same at any window size; chrome is sized in device pixels × `z`.
 */
import { getFont, getGlyphIndexForChar, getGlyphPixel, getGlyphWidth, type DeckerFont } from "@mockintosh/ui";
import type { Sprite } from "@mockintosh/sdk";
import type { Frame, PixelRect, Stage } from "./painter";

/** 0 paper, 1 ink, `xor` flips, `gray` inks only the 50% checkerboard. */
export type Ink = 0 | 1 | "xor" | "gray";

/** An 8×8 QuickDraw pattern: eight rows, most significant bit leftmost. */
export type Pattern = readonly [number, number, number, number, number, number, number, number];

export interface FontStyle {
  font: string;
  size?: number;
  /** Whole-number magnification. */
  k?: number;
  ink?: Ink;
}

const fonts = new Map<string, DeckerFont>();

function fontFor(style: FontStyle): DeckerFont {
  const key = `${style.font}:${style.size ?? ""}`;
  let font = fonts.get(key);
  if (!font) {
    font = getFont(style.font, style.size) ?? getFont("chicago")!;
    fonts.set(key, font);
  }
  return font;
}

export class Screen {
  readonly px: Uint8Array;
  readonly width: number;
  /** Chrome magnification: 1 on a Mac-sized window, more on big screens. */
  readonly z: number;

  constructor(
    readonly frame: Frame,
    readonly stage: Stage,
    readonly clip: PixelRect,
  ) {
    this.px = frame.pixels;
    this.width = frame.width;
    this.z = Math.max(1, Math.round(stage.scale * 0.62));
  }

  /** The same screen, drawing only inside `r`. */
  within(r: PixelRect): Screen {
    const c = this.clip;
    return new Screen(this.frame, this.stage, {
      x0: Math.max(c.x0, r.x0),
      y0: Math.max(c.y0, r.y0),
      x1: Math.min(c.x1, r.x1),
      y1: Math.min(c.y1, r.y1),
    });
  }

  /** Stage x to device x. */
  x(u: number): number {
    return Math.round(this.stage.x + u * this.stage.scale);
  }

  /** Stage y to device y. */
  y(v: number): number {
    return Math.round(this.stage.y + v * this.stage.scale);
  }

  /** A stage length in device pixels. */
  len(u: number): number {
    return Math.round(u * this.stage.scale);
  }

  rect(u0: number, v0: number, u1: number, v1: number): PixelRect {
    return { x0: this.x(u0), y0: this.y(v0), x1: this.x(u1), y1: this.y(v1) };
  }

  set(x: number, y: number, ink: Ink): void {
    const c = this.clip;
    if (x < c.x0 || x >= c.x1 || y < c.y0 || y >= c.y1) return;
    const i = y * this.width + x;
    if (ink === "xor") this.px[i] ^= 1;
    else if (ink === "gray") {
      if (((x + y) & 1) === 0) this.px[i] = 1;
    } else this.px[i] = ink;
  }

  fill(x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
    const c = this.clip;
    const ax = Math.max(c.x0, Math.round(x0));
    const bx = Math.min(c.x1, Math.round(x1));
    const ay = Math.max(c.y0, Math.round(y0));
    const by = Math.min(c.y1, Math.round(y1));
    if (ax >= bx || ay >= by) return;
    for (let y = ay; y < by; y++) {
      const row = y * this.width;
      if (ink === 0 || ink === 1) this.px.fill(ink, row + ax, row + bx);
      else for (let x = ax; x < bx; x++) this.set(x, y, ink);
    }
  }

  fillRect(r: PixelRect, ink: Ink): void {
    this.fill(r.x0, r.y0, r.x1, r.y1, ink);
  }

  /** Tile a pattern, magnified by `z`, anchored so it never swims as things move. */
  pattern(x0: number, y0: number, x1: number, y1: number, pattern: Pattern, ox = 0, oy = 0): void {
    const c = this.clip;
    const ax = Math.max(c.x0, Math.round(x0));
    const bx = Math.min(c.x1, Math.round(x1));
    const ay = Math.max(c.y0, Math.round(y0));
    const by = Math.min(c.y1, Math.round(y1));
    const z = this.z;
    for (let y = ay; y < by; y++) {
      const bits = pattern[((Math.floor((y - oy) / z) % 8) + 8) % 8]!;
      const row = y * this.width;
      for (let x = ax; x < bx; x++) {
        const col = ((Math.floor((x - ox) / z) % 8) + 8) % 8;
        this.px[row + x] = (bits >> (7 - col)) & 1;
      }
    }
  }

  /** A rectangle outline `t` device pixels thick, inside the rect. */
  box(r: PixelRect, t = this.z, ink: Ink = 1): void {
    this.fill(r.x0, r.y0, r.x1, r.y0 + t, ink);
    this.fill(r.x0, r.y1 - t, r.x1, r.y1, ink);
    this.fill(r.x0, r.y0 + t, r.x0 + t, r.y1 - t, ink);
    this.fill(r.x1 - t, r.y0 + t, r.x1, r.y1 - t, ink);
  }

  /** Marching ants: a dashed outline whose dashes crawl with `phase`. */
  ants(r: PixelRect, phase: number): void {
    const z = this.z;
    const dash = (i: number) => ((Math.floor(i / (4 * z)) + phase) & 1) === 0;
    let i = 0;
    for (let x = r.x0; x < r.x1; x++, i++) if (dash(i)) this.fill(x, r.y0, x + 1, r.y0 + z, 1);
    for (let y = r.y0; y < r.y1; y++, i++) if (dash(i)) this.fill(r.x1 - z, y, r.x1, y + 1, 1);
    for (let x = r.x1 - 1; x >= r.x0; x--, i++) if (dash(i)) this.fill(x, r.y1 - z, x + 1, r.y1, 1);
    for (let y = r.y1 - 1; y >= r.y0; y--, i++) if (dash(i)) this.fill(r.x0, y, r.x0 + z, y + 1, 1);
  }

  /** A square-pen line, `pen` device pixels wide. */
  line(x0: number, y0: number, x1: number, y1: number, pen: number, ink: Ink = 1): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      if (ink === "xor") this.set(x, y, "xor");
      else this.fill(x, y, x + pen, y + pen, ink);
    }
  }

  /** Blit a sprite at whole-number magnification `k`, honouring its mask. */
  sprite(sprite: Sprite, x: number, y: number, k = 1, invert = false): void {
    for (let sy = 0; sy < sprite.height; sy++) {
      for (let sx = 0; sx < sprite.width; sx++) {
        const i = sy * sprite.width + sx;
        if (sprite.mask && !sprite.mask[i]) continue;
        const ink = (sprite.data[i]! ^ (invert ? 1 : 0)) as 0 | 1;
        this.fill(x + sx * k, y + sy * k, x + (sx + 1) * k, y + (sy + 1) * k, ink);
      }
    }
  }

  /** Width and height of `text` in device pixels. */
  measure(text: string, style: FontStyle): { width: number; height: number } {
    const font = fontFor(style);
    const k = style.k ?? this.z;
    let w = 0;
    for (const ch of text) w += getGlyphWidth(font, getGlyphIndexForChar(font, ch)) + font.spacing;
    return { width: Math.max(0, w - font.spacing) * k, height: font.glyphHeight * k };
  }

  /**
   * Set `text` with its cell's top-left at (x, y). `reveal` limits it to the
   * first n glyph columns — for typing and writing on. Returns the width.
   */
  text(text: string, x: number, y: number, style: FontStyle, reveal = Infinity): number {
    const font = fontFor(style);
    const k = style.k ?? this.z;
    const ink = style.ink ?? 1;
    let cx = 0;
    for (const ch of text) {
      const g = getGlyphIndexForChar(font, ch);
      const w = getGlyphWidth(font, g);
      for (let gx = 0; gx < w; gx++) {
        if (cx + gx >= reveal) return cx * k;
        for (let gy = 0; gy < font.glyphHeight; gy++) {
          if (!getGlyphPixel(font, g, gx, gy)) continue;
          const px = x + (cx + gx) * k;
          const py = y + gy * k;
          if (k === 1) this.set(px, py, ink);
          else this.fill(px, py, px + k, py + k, ink);
        }
      }
      cx += w + font.spacing;
    }
    return Math.max(0, cx - font.spacing) * k;
  }

  /** Set `text` centred on x. */
  centered(text: string, x: number, y: number, style: FontStyle): number {
    const { width } = this.measure(text, style);
    return this.text(text, Math.round(x - width / 2), y, style);
  }

  /**
   * The ink pixels of `text` as glyph-cell coordinates, left to right —
   * for effects that treat type as a field of pixels.
   */
  glyphPixels(text: string, style: FontStyle): { x: number; y: number }[] {
    const font = fontFor(style);
    const out: { x: number; y: number }[] = [];
    let cx = 0;
    for (const ch of text) {
      const g = getGlyphIndexForChar(font, ch);
      const w = getGlyphWidth(font, g);
      for (let gx = 0; gx < w; gx++) {
        for (let gy = 0; gy < font.glyphHeight; gy++) if (getGlyphPixel(font, g, gx, gy)) out.push({ x: cx + gx, y: gy });
      }
      cx += w + font.spacing;
    }
    return out;
  }
}
