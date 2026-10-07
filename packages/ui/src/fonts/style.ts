import {
  bold as boldFace,
  italic as italicFace,
  outline as outlineFace,
  type Style,
} from "@mockintosh/quickdraw";
import type { DeckerFont } from "./font";
import { carryAdvances, getGlyphPixel, getGlyphWidth } from "./font";
import { smearDeckerFontBold } from "./boldSmear";
import { outlineDeckerFont, padDeckerShadow } from "./outlineSmear";
import { getRealFace, requireFont, spacedFontName } from "./registry";

/**
 * Synthesized type style. Bold, italic, outline, and shadow are Font Manager
 * extras on the named face — not separate face names. Any combination is valid.
 */
export interface FontStyle {
  bold?: boolean;
  italic?: boolean;
  /** 1px ring in the text color; the stem is inverted. */
  outline?: boolean;
  /** Same as outline, plus a 1px south-east drop of the ring. */
  shadow?: boolean;
  /** Drawn by the UI on the face baseline (`underline.ts`); never changes the strike or its advance. */
  underline?: boolean;
}

const STYLE_BOLD = 1;
const STYLE_ITALIC = 2;
const STYLE_OUTLINE = 4;
const STYLE_SHADOW = 8;

let styleCache: WeakMap<DeckerFont, Map<number, DeckerFont>> | undefined;
function styleCacheMap(): WeakMap<DeckerFont, Map<number, DeckerFont>> {
  return (styleCache ??= new WeakMap());
}

export function fontStyleFromProps(props: Record<string, unknown> | undefined): FontStyle {
  return {
    bold: Boolean(props?.["bold"]),
    italic: Boolean(props?.["italic"]),
    outline: Boolean(props?.["outline"]),
    shadow: Boolean(props?.["shadow"]),
    underline: Boolean(props?.["underline"]),
  };
}

/** The node's `font`, re-spaced when it sets `spacing`. */
export function fontNameFromProps(props: Record<string, unknown> | undefined): string {
  const name = (props?.["font"] as string | undefined) ?? "body";
  const spacing = props?.["spacing"];
  return typeof spacing === "number" ? spacedFontName(name, spacing) : name;
}

export function fontSizeFromProps(props: Record<string, unknown> | undefined): number | undefined {
  const size = props?.["size"];
  return typeof size === "number" && size > 0 ? size : undefined;
}

/** Named face + optional native size + style extras, as `<text>` measures it. */
export function fontFromProps(props: Record<string, unknown> | undefined): DeckerFont {
  return resolveFont(fontNameFromProps(props), fontStyleFromProps(props), fontSizeFromProps(props));
}

/** QuickDraw `txFace` bits for this style. Underline is not one: see `underline.ts`. */
export function textFace(style: FontStyle): Style {
  return (
    (style.bold ? boldFace : 0) |
    (style.italic ? italicFace : 0) |
    (style.outline ? outlineFace : 0)
  );
}

function styleBits(style: FontStyle): number {
  return (
    (style.bold ? STYLE_BOLD : 0) |
    (style.italic ? STYLE_ITALIC : 0) |
    (style.outline ? STYLE_OUTLINE : 0) |
    (style.shadow ? STYLE_SHADOW : 0)
  );
}

/**
 * The Decker face used for measure / wrap / selection.
 * Bold smears 1px; italic grows the advance 1px (FM `extra`).
 * Outline grows the cell 2px. Shadow is outline plus 1px right and down.
 * FontInfo stays on the base name. Drawing uses {@link textFace}.
 */
export function resolveFont(name: string = "body", style: FontStyle = {}, size?: number): DeckerFont {
  // A real Bold / Italic face (suitcase strike or outline) replaces the smear / slant.
  const wanted = (style.bold ? STYLE_BOLD : 0) | (style.italic ? STYLE_ITALIC : 0);
  const real = wanted ? getRealFace(name, wanted, size) : null;
  if (real?.covered) {
    style = {
      ...style,
      bold: style.bold && !(real.covered & STYLE_BOLD),
      italic: style.italic && !(real.covered & STYLE_ITALIC),
    };
  }
  const base = real?.covered ? real.font : requireFont(name, size);
  const bits = styleBits(style);
  if (bits === 0) return base;

  let byStyle = styleCacheMap().get(base);
  if (!byStyle) {
    byStyle = new Map();
    styleCacheMap().set(base, byStyle);
  }
  const cached = byStyle.get(bits);
  if (cached) return cached;

  let next = base;
  if (style.bold) next = smearDeckerFontBold(next, base.name);
  if (style.italic) next = widenDeckerAdvance(next, 1, base.name);
  if (style.outline || style.shadow) next = outlineDeckerFont(next, base.name);
  if (style.shadow) next = padDeckerShadow(next, base.name);
  byStyle.set(bits, next);
  return next;
}

/** Font Manager italic/bold `extra`: each glyph advance grows, pixels stay. */
export function widenDeckerAdvance(font: DeckerFont, extra: number, name: string): DeckerFont {
  if (extra < 1) return font;
  const maxWidth = font.maxWidth + extra;
  const glyphHeight = font.glyphHeight;
  const above = font.inkAbove ?? 0;
  const below = font.inkBelow ?? 0;
  const glyphStride = Math.ceil(maxWidth / 8) * (above + glyphHeight + below);
  const glyphWidths = new Uint8Array(256);
  const glyphData = new Uint8Array(256 * glyphStride);
  const byteWidth = Math.ceil(maxWidth / 8);

  for (let glyphIndex = 0; glyphIndex < 256; glyphIndex++) {
    const width = getGlyphWidth(font, glyphIndex);
    if (width < 1) continue;
    const nextWidth = width + extra;
    glyphWidths[glyphIndex] = nextWidth;
    const dest = glyphIndex * glyphStride;
    for (let y = -above; y < glyphHeight + below; y++) {
      for (let x = 0; x < width; x++) {
        if (!getGlyphPixel(font, glyphIndex, x, y)) continue;
        glyphData[dest + (y + above) * byteWidth + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }

  return {
    name,
    size: font.size,
    maxWidth,
    glyphHeight,
    spacing: font.spacing,
    glyphStride,
    glyphWidths,
    glyphData,
    ...carryAdvances(font, glyphWidths),
    sourceFormat: "FNT1",
    outlinePad: font.outlinePad,
    shadowPad: font.shadowPad,
  };
}
