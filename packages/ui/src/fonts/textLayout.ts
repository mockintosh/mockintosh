/**
 * Text block layout — breaks a string into lines for a given font.
 *
 * This is the single source of truth for line breaking. `measure.ts` uses it
 * to size `<text>` nodes and `draw.ts` uses it to paint them, so measured and
 * drawn geometry can never disagree. Line advance is the FontInfo line box
 * (`ascent + descent + leading`). The last line trims the empty extra below
 * the strike (`text-box-trim: trim-end`): Geneva 9's cell is 10px, GetFontInfo
 * is 12, so one line is 10 and two lines are 22.
 */

import type { CanvasNode } from "../nodes";
import { textAdvance, type DeckerFont } from "./font";
import { faceMetrics } from "./metrics";

export interface TextLine {
  text: string;
  /** Advance width of the line in pixels (includes trailing glyph spacing). */
  width: number;
  /** Index of `text[0]` in the original string (or the break position if empty). */
  start: number;
}

export interface TextBlock {
  lines: TextLine[];
  /** Widest line. */
  width: number;
  /**
   * `(lines - 1) * lineHeight + lastLineHeight`.
   * The last line does not keep the empty FontInfo extra below the cell.
   */
  height: number;
  /** Vertical advance from one line to the next (FontInfo ascent + descent + leading). */
  lineHeight: number;
  /** Strike height of the last line (the Decker cell). */
  lastLineHeight: number;
}

/**
 * Lay out `text` into lines.
 *
 * - Explicit `\n` always breaks a line.
 * - When `maxWidth` is given, paragraphs are greedily word-wrapped to fit.
 *   A single word wider than `maxWidth` is broken between characters so a
 *   line never exceeds the limit.
 * - Without `maxWidth`, each paragraph is one line.
 */
export function layoutText(
  font: DeckerFont,
  text: string,
  maxWidth?: number
): TextBlock {
  const lineHeight = faceMetrics(font).lineHeight;
  const lastLineHeight = font.glyphHeight;
  const lines: TextLine[] = [];
  const wrap = maxWidth !== undefined && maxWidth > 0;
  let offset = 0;

  for (const paragraph of text.split("\n")) {
    if (!wrap) {
      lines.push(makeLine(font, paragraph, offset));
    } else {
      wrapParagraph(font, paragraph, maxWidth, offset, lines);
    }
    offset += paragraph.length + 1;
  }

  if (lines.length === 0) lines.push({ text: "", width: 0, start: 0 });

  let width = 0;
  for (const l of lines) width = Math.max(width, l.width);
  const height =
    lines.length === 0 ? 0 : (lines.length - 1) * lineHeight + lastLineHeight;
  return { lines, width, height, lineHeight, lastLineHeight };
}

interface TextLayoutCache {
  font: DeckerFont;
  text: string;
  maxWidth: number | undefined;
  block: TextBlock;
}

const textLayoutCache = new WeakMap<CanvasNode, TextLayoutCache>();

/**
 * Same as `layoutText`, but reused across measure, paint, and selection when
 * the font, string, and wrap width have not changed.
 */
export function layoutNodeText(
  node: CanvasNode,
  font: DeckerFont,
  text: string,
  maxWidth?: number,
): TextBlock {
  const hit = textLayoutCache.get(node);
  if (hit && hit.font === font && hit.text === text && hit.maxWidth === maxWidth) {
    return hit.block;
  }
  const block = layoutText(font, text, maxWidth);
  textLayoutCache.set(node, { font, text, maxWidth, block });
  return block;
}

/** Top of line `index` in a block (0 is the first line). */
export function lineTop(block: TextBlock, index: number): number {
  return Math.max(0, index) * block.lineHeight;
}

/** Height of line `index` — FontInfo stride, except the last line is the cell. */
export function lineBoxHeight(block: TextBlock, index: number): number {
  return index >= block.lines.length - 1 ? block.lastLineHeight : block.lineHeight;
}

function makeLine(font: DeckerFont, text: string, start: number): TextLine {
  return { text, width: text ? textAdvance(font, text) : 0, start };
}

function wrapParagraph(
  font: DeckerFont,
  paragraph: string,
  maxWidth: number,
  paragraphStart: number,
  out: TextLine[]
): void {
  // Leading spaces are indentation (code, a typed indent): they stay on the
  // first word rather than splitting into empty words that vanish.
  const indent = /^ */.exec(paragraph)![0];
  const words = paragraph.slice(indent.length).split(" ");
  words[0] = indent + words[0];
  let line = "";
  let lineStart = paragraphStart;
  let search = 0;

  const wordStart = (word: string): number => {
    const at = paragraph.indexOf(word, search);
    search = at + word.length + 1;
    return paragraphStart + at;
  };

  const flush = () => {
    out.push(makeLine(font, line, lineStart));
    line = "";
  };

  for (const word of words) {
    const start = wordStart(word);
    const candidate = line ? `${line} ${word}` : word;
    if (textAdvance(font, candidate) <= maxWidth) {
      if (!line) lineStart = start;
      line = candidate;
      continue;
    }
    if (line) flush();
    // Word alone overflows: break it between characters.
    if (textAdvance(font, word) > maxWidth) {
      let chunk = "";
      let chunkStart = start;
      let charIndex = 0;
      for (const ch of word) {
        const next = chunk + ch;
        if (chunk && textAdvance(font, next) > maxWidth) {
          out.push(makeLine(font, chunk, chunkStart));
          chunk = ch;
          chunkStart = start + charIndex;
        } else {
          chunk = next;
        }
        charIndex += ch.length;
      }
      line = chunk;
      lineStart = chunkStart;
    } else {
      line = word;
      lineStart = start;
    }
  }
  flush();
}

/** Left edge of `line` in a box `width` wide, as `<text align>` paints it. */
export function lineLeft(line: TextLine, align: "left" | "center" | "right", width: number): number {
  if (align === "center") return Math.floor((width - line.width) / 2);
  if (align === "right") return width - line.width;
  return 0;
}

/** Row of the line that holds caret `index`; a wrap point belongs to the line it starts. */
export function lineOfIndex(block: TextBlock, index: number): number {
  let row = 0;
  for (let i = 0; i < block.lines.length; i++) {
    if (block.lines[i]!.start <= index) row = i;
    else break;
  }
  return row;
}

/** Where the caret for `index` sits in a block laid out `width` wide and aligned `align`. */
export function caretPoint(
  block: TextBlock,
  font: DeckerFont,
  index: number,
  align: "left" | "center" | "right" = "left",
  width: number = block.width,
): { x: number; y: number; row: number } {
  const row = lineOfIndex(block, index);
  const line = block.lines[row]!;
  const column = Math.max(0, Math.min(line.text.length, index - line.start));
  return {
    x: lineLeft(line, align, width) + textAdvance(font, line.text.slice(0, column)),
    y: lineTop(block, row),
    row,
  };
}

/** Caret index in `text` for a click at `x` along the line (half-glyph rule). */
export function charIndexAtX(font: DeckerFont, text: string, x: number): number {
  let accumulated = 0;
  for (let i = 0; i < text.length; i++) {
    const cw = textAdvance(font, text[i]!);
    if (x < accumulated + cw / 2) return i;
    accumulated += cw;
  }
  return text.length;
}

/** Source index in the original string for a point in a laid-out block. */
export function indexAtPoint(
  block: TextBlock,
  font: DeckerFont,
  x: number,
  y: number,
  align: "left" | "center" | "right" = "left",
  width: number = block.width,
): number {
  if (!block.lines.length) return 0;
  const last = block.lines.length - 1;
  const lastTop = lineTop(block, last);
  const row =
    y >= lastTop
      ? last
      : Math.max(0, Math.min(last, Math.floor(y / block.lineHeight)));
  const line = block.lines[row]!;
  return line.start + charIndexAtX(font, line.text, x - lineLeft(line, align, width));
}
