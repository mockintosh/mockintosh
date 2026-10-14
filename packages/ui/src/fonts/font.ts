import { MISSING_SLOT, charForSlot, pageOfCodePoint, slotForCodePoint } from "./charmap";
import { emojiFace, emojiSequence } from "./emoji";
import { VS15, VS16, clusterEnd, isDefaultIgnorable, isRegionalIndicator, isSimpleText, isSkinTone } from "./emojiClusters";

export interface BitmapFace {
  name: string;
  /** Native bitmap point size. Role aliases share the family name (geneva, not body). */
  size?: number;
  maxWidth: number;
  glyphHeight: number;
  spacing: number;
  glyphStride: number;
  glyphWidths: Uint8Array;
  glyphData: Uint8Array;
  /** 1px inset reserved so Font Manager outline sits inside the cell. */
  outlinePad?: number;
  /** Extra 1px right/bottom so a south-east drop shadow stays in the cell. */
  shadowPad?: number;
  /**
   * Per-ordinal advance when it differs from the image width (NFNT's
   * offset/width table): an italic's ink may overhang its advance.
   */
  advances?: Uint8Array;
  /** Per-ordinal columns of image left of the pen (negative left side bearing). */
  originX?: Uint8Array;
  /**
   * Image rows above the cell top / below its bottom, for ink that leaves the
   * line box (an outline's Å with PreserveGlyph on). The cell (`glyphHeight`)
   * stays the line box; glyph rows run from `-inkAbove` to
   * `glyphHeight + inkBelow`, and `glyphStride` covers them all.
   */
  inkAbove?: number;
  inkBelow?: number;
  /** `GetFontInfo` numbers carried by the strike itself (outline-scaled strikes). */
  fontInfo?: { ascent: number; descent: number; leading: number };
  /** Set on strikes the outline scaler fills one glyph at a time (`outlineStrike.ts`). */
  outline?: OutlineGlyphSource;
  /**
   * A bitmap face's other strikes, by page (`charmap.ts`): the characters
   * outside page 0's 256 slots. Only page 0 carries them.
   */
  pages?: ReadonlyMap<number, BitmapFace>;
}

/**
 * An outline-scaled strike: glyph cells are sized up front from the font's
 * metrics, pixels arrive on first use. Characters outside page 0's 256
 * slots live on sibling "page" strikes of the same face and size.
 */
export interface OutlineGlyphSource {
  /** 1 once an ordinal's pixels are in `glyphData`. */
  readonly filled: Uint8Array;
  fill(ordinal: number): void;
  /** Name `TextFont` resolves back to this strike (family, plus a page suffix). */
  readonly faceKey: string;
  /** Which strike and ordinal draw `codePoint`; undefined when the face lacks it. */
  locate(codePoint: number): { font: BitmapFace; ordinal: number } | undefined;
  /** Pair kerning in whole pixels (0 when the family turns kerning off). */
  kern(left: number, right: number): number;
}

const QUESTION_MARK = 63;

/** Page-0 slot for a UTF-16 code unit (`charmap.ts`); -1 when it has none. */
export function ordinalForCharCode(codeUnit: number): number {
  return slotForCodePoint(codeUnit);
}

/**
 * Stand-ins for typographic characters a font may not draw: curly quotes,
 * dashes, the wider or non-breaking spaces. Used before `?`.
 */
const LOOKALIKES: ReadonlyMap<number, string> = new Map([
  ...[0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x02bc].map((code) => [code, "'"] as const),
  ...[0x201c, 0x201d, 0x201e, 0x201f, 0x2033].map((code) => [code, '"'] as const),
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((code) => [code, "-"] as const),
  ...[0x00a0, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f].map((code) => [code, " "] as const),
  [0x2039, "<"],
  [0x203a, ">"],
  [0x00b7, "\u2022"],
  [0x2219, "\u2022"],
  [0x00d7, "x"],
]);

export function getGlyphIndexForChar(font: BitmapFace, ch: string): number {
  if (!ch) return -1;
  const code = ch.charCodeAt(0);
  const ord = ordinalForCharCode(code);
  if (ord >= 0 && hasGlyph(font, ord)) return ord;
  const lookalike = LOOKALIKES.get(code);
  const lookalikeOrd = lookalike === undefined ? -1 : ordinalForCharCode(lookalike.charCodeAt(0));
  if (lookalikeOrd >= 0 && hasGlyph(font, lookalikeOrd)) return lookalikeOrd;
  return missingGlyphIndex(font);
}

/** What a strike draws for a character it lacks: its missing-character box, else `?`. */
export function missingGlyphIndex(font: BitmapFace): number {
  if (hasGlyph(font, MISSING_SLOT)) return MISSING_SLOT;
  return hasGlyph(font, QUESTION_MARK) ? QUESTION_MARK : -1;
}

/**
 * The strike and slot that draw `codePoint` in this face: page 0, one of its
 * page strikes, or an outline face's. Undefined when the face lacks it.
 */
export function locateGlyph(font: BitmapFace, codePoint: number): { font: BitmapFace; ordinal: number } | undefined {
  if (font.outline) return font.outline.locate(codePoint);
  const slot = slotForCodePoint(codePoint);
  if (slot >= 0) return hasGlyph(font, slot) ? { font, ordinal: slot } : undefined;
  const page = font.pages?.get(pageOfCodePoint(codePoint));
  const ordinal = codePoint & 0xff;
  return page && hasGlyph(page, ordinal) ? { font: page, ordinal } : undefined;
}

export function getGlyphWidth(font: BitmapFace, glyphIndex: number): number {
  if (glyphIndex < 0 || glyphIndex > 255) return 0;
  return font.glyphWidths[glyphIndex] ?? 0;
}

/** How far the pen moves after a glyph (before `spacing`). */
export function glyphAdvance(font: BitmapFace, glyphIndex: number): number {
  if (glyphIndex < 0 || glyphIndex > 255) return 0;
  return font.advances ? font.advances[glyphIndex]! : (font.glyphWidths[glyphIndex] ?? 0);
}

/** Columns of a glyph's image that sit left of the pen. */
export function glyphOriginX(font: BitmapFace, glyphIndex: number): number {
  return font.originX?.[glyphIndex] ?? 0;
}

/**
 * Advances, overhangs and overflow rows for a restyled copy of `base` (bold smear, outline
 * ring, …) whose cells grew from `base.glyphWidths` to `glyphWidths`.
 */
export function carryAdvances(
  base: BitmapFace,
  glyphWidths: Uint8Array,
): Pick<BitmapFace, "advances" | "originX" | "inkAbove" | "inkBelow"> {
  const overflow = base.inkAbove || base.inkBelow ? { inkAbove: base.inkAbove, inkBelow: base.inkBelow } : {};
  if (!base.advances) return overflow;
  const advances = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (glyphWidths[i]) advances[i] = Math.max(0, base.advances[i]! + glyphWidths[i]! - base.glyphWidths[i]!);
  }
  return { advances, originX: base.originX, ...overflow };
}

export function hasGlyph(font: BitmapFace, glyphIndex: number): boolean {
  return getGlyphWidth(font, glyphIndex) > 0;
}

export function getGlyphDataOffset(font: BitmapFace, glyphIndex: number): number {
  return glyphIndex * font.glyphStride;
}

export function getGlyphPixel(
  font: BitmapFace,
  glyphIndex: number,
  x: number,
  y: number
): boolean {
  const glyphWidth = getGlyphWidth(font, glyphIndex);
  if (glyphWidth < 1) return false;
  if (font.outline && !font.outline.filled[glyphIndex]) font.outline.fill(glyphIndex);
  const above = font.inkAbove ?? 0;
  if (x < 0 || x >= glyphWidth || y < -above || y >= font.glyphHeight + (font.inkBelow ?? 0)) return false;

  const byteWidth = Math.ceil(font.maxWidth / 8);
  const offset = getGlyphDataOffset(font, glyphIndex) + (y + above) * byteWidth + Math.floor(x / 8);
  const byte = font.glyphData[offset];
  const bit = 1 << (7 - (x % 8));
  return (byte & bit) !== 0;
}

/** Advance of one character, including trailing `spacing` (matches the FM width table). */
export function charAdvance(font: BitmapFace, ch: string): number {
  return textAdvance(font, ch);
}

/** A lookalike's glyph for a character the face lacks (curly quote → straight). */
export function lookalikeGlyph(font: BitmapFace, codePoint: number): { font: BitmapFace; ordinal: number } | undefined {
  const lookalike = LOOKALIKES.get(codePoint);
  return lookalike === undefined ? undefined : locateGlyph(font, lookalike.charCodeAt(0));
}

/** One glyph a line draws: which strike and slot, and whether it is the Emoji family's. */
export interface PlacedGlyph {
  font: BitmapFace;
  ordinal: number;
  /** From the Emoji family (`emoji.ts`): drawn plain, bottom-aligned in the face's cell. */
  emoji: boolean;
}

function emojiGlyph(font: BitmapFace, codePoint: number): PlacedGlyph | undefined {
  const face = emojiFace(font.glyphHeight);
  const hit = face && locateGlyph(face, codePoint);
  return hit && { font: hit.font, ordinal: hit.ordinal, emoji: true };
}

/**
 * The glyph a single character draws: the face's own, a lookalike, then the
 * Emoji family's, then the face's missing-character box. `preferEmoji` (the
 * character asked for emoji presentation, U+FE0F) tries the Emoji family first.
 * Undefined for characters that draw nothing (joiners, selectors).
 */
export function glyphFor(font: BitmapFace, codePoint: number, preferEmoji = false): PlacedGlyph | undefined {
  if (isDefaultIgnorable(codePoint)) return undefined;
  if (preferEmoji) {
    const emoji = emojiGlyph(font, codePoint);
    if (emoji) return emoji;
  }
  const own = locateGlyph(font, codePoint) ?? lookalikeGlyph(font, codePoint);
  if (own) return { font: own.font, ordinal: own.ordinal, emoji: false };
  const emoji = emojiGlyph(font, codePoint);
  if (emoji) return emoji;
  const missing = missingGlyphIndex(font);
  return missing < 0 ? undefined : { font, ordinal: missing, emoji: false };
}

/**
 * Visit every glyph `text` draws in `font`, with the character (cluster)
 * `[start, end)` it belongs to. A cluster the Emoji family draws whole is
 * one glyph; one it doesn't draws its parts, without the joiners,
 * selectors and skin tones. Characters that draw nothing are skipped.
 */
export function forEachGlyph(
  font: BitmapFace,
  text: string,
  visit: (glyph: PlacedGlyph, start: number, end: number, codePoint: number) => void,
): void {
  if (isSimpleText(text)) {
    for (let i = 0; i < text.length; i++) {
      const cp = text.charCodeAt(i);
      const glyph = glyphFor(font, cp);
      if (glyph) visit(glyph, i, i + 1, cp);
    }
    return;
  }
  for (let i = 0; i < text.length; ) {
    const end = clusterEnd(text, i);
    const first = text.codePointAt(i)!;
    if (end === i + (first > 0xffff ? 2 : 1)) {
      const glyph = glyphFor(font, first);
      if (glyph) visit(glyph, i, end, first);
      i = end;
      continue;
    }
    const parts: number[] = [];
    let presentation = 0;
    for (let at = i; at < end; ) {
      const cp = text.codePointAt(at)!;
      at += cp > 0xffff ? 2 : 1;
      if (cp === VS15 || cp === VS16) presentation ||= cp;
      else parts.push(cp);
    }
    const sequence = parts.length > 1 ? emojiSequence(String.fromCodePoint(...parts)) : undefined;
    const whole = sequence !== undefined ? emojiGlyph(font, sequence) : undefined;
    if (whole) {
      visit(whole, i, end, sequence!);
    } else if (parts.length === 1 || (parts.length === 2 && isRegionalIndicator(parts[0]!))) {
      // A selector on one character, or a pair of regional indicators that names no flag.
      for (const cp of parts) {
        const glyph = glyphFor(font, cp, presentation === VS16);
        if (glyph) visit(glyph, i, end, cp);
      }
    } else {
      parts.forEach((cp, k) => {
        if (k > 0 && (isSkinTone(cp) || cp === 0x20e3)) return;
        const glyph = glyphFor(font, cp, true);
        if (glyph) visit(glyph, i, end, cp);
      });
    }
    i = end;
  }
}

/** Sum of glyph advances (each plus `spacing`) over `text`, with pair kerning (no newline handling). */
export function textAdvance(font: BitmapFace, text: string): number {
  let w = 0;
  let prev = -1;
  const kern = font.outline;
  forEachGlyph(font, text, (glyph, _start, _end, cp) => {
    if (kern) {
      if (prev >= 0 && !glyph.emoji) w += kern.kern(prev, cp);
      prev = glyph.emoji ? -1 : cp;
    }
    w += glyphAdvance(glyph.font, glyph.ordinal) + font.spacing;
  });
  return w;
}

/** The character a page-0 slot draws (`charmap.ts`). Undefined for empty slots. */
export function charForOrdinal(ordinal: number): string | undefined {
  return charForSlot(ordinal);
}
