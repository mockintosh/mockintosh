/**
 * Line breaking for `<text runs>` — a paragraph of styled runs.
 *
 * Measure, draw and hit-testing all read the same `RunBlock`, so a link is
 * clickable exactly where it is painted. Line advance comes from the node's
 * base face; bold and italic runs only widen glyph advances.
 */

import type { CanvasNode, TextAlign, TextRun } from "../nodes";
import { textAdvance, type DeckerFont } from "./font";
import { faceMetrics } from "./metrics";
import { resolveFont, type FontStyle } from "./style";

/** A stretch of one run on one line. `x` is from the line's left edge. */
export interface RunFragment {
  run: number;
  text: string;
  x: number;
  width: number;
}

export interface RunLine {
  fragments: RunFragment[];
  width: number;
}

export interface RunBlock {
  lines: RunLine[];
  width: number;
  /** `(lines - 1) * lineHeight + lastLineHeight`, as `layoutText`. */
  height: number;
  lineHeight: number;
  lastLineHeight: number;
}

/** The face a run draws in: the node's style plus the run's own. */
export interface RunFace {
  fontName: string;
  size: number | undefined;
  style: FontStyle;
}

export function runStyle(base: FontStyle, run: TextRun): FontStyle {
  return {
    ...base,
    bold: Boolean(base.bold || run.bold),
    italic: Boolean(base.italic || run.italic),
    underline: Boolean(base.underline || run.underline === true),
  };
}

export function runFont(face: RunFace, run: TextRun): DeckerFont {
  return resolveFont(face.fontName, runStyle(face.style, run), face.size);
}

type Token =
  | { kind: "word"; run: number; text: string }
  | { kind: "space"; run: number }
  | { kind: "newline" };

function tokenize(runs: readonly TextRun[]): Token[] {
  const tokens: Token[] = [];
  runs.forEach((run, index) => {
    for (const match of run.text.matchAll(/\n|[ \t\r]+|[^ \t\r\n]+/g)) {
      const piece = match[0];
      if (piece === "\n") tokens.push({ kind: "newline" });
      else if (/^[ \t\r]/.test(piece)) tokens.push({ kind: "space", run: index });
      else tokens.push({ kind: "word", run: index, text: piece });
    }
  });
  return tokens;
}

interface Piece {
  run: number;
  text: string;
  width: number;
}

/**
 * Lay out `runs` into lines no wider than `maxWidth` (no limit when omitted).
 * Words that touch across a run boundary ("link" + ",") never break apart;
 * a single word wider than the line breaks between characters.
 */
export function layoutRuns(face: RunFace, runs: readonly TextRun[], maxWidth?: number): RunBlock {
  const base = resolveFont(face.fontName, face.style, face.size);
  const metrics = faceMetrics(base);
  const fonts = runs.map((run) => runFont(face, run));
  const wrap = maxWidth !== undefined && maxWidth > 0;
  const limit = wrap ? maxWidth : Infinity;
  const measure = (run: number, text: string) => textAdvance(fonts[run]!, text);

  const lines: RunLine[] = [];
  let pieces: Piece[] = [];
  let lineWidth = 0;
  let pendingSpace: number | null = null;

  const pushLine = () => {
    lines.push(toLine(pieces));
    pieces = [];
    lineWidth = 0;
  };
  const place = (run: number, text: string, width: number) => {
    pieces.push({ run, text, width });
    lineWidth += width;
  };

  const tokens = tokenize(runs);
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i]!;
    if (token.kind === "newline") {
      pushLine();
      pendingSpace = null;
      i++;
      continue;
    }
    if (token.kind === "space") {
      if (pieces.length > 0) pendingSpace = token.run;
      i++;
      continue;
    }

    const cluster: Piece[] = [];
    while (i < tokens.length && tokens[i]!.kind === "word") {
      const word = tokens[i] as Extract<Token, { kind: "word" }>;
      cluster.push({ run: word.run, text: word.text, width: measure(word.run, word.text) });
      i++;
    }
    const clusterWidth = cluster.reduce((sum, piece) => sum + piece.width, 0);
    const spaceWidth = pendingSpace !== null ? measure(pendingSpace, " ") : 0;

    if (pieces.length === 0 || lineWidth + spaceWidth + clusterWidth <= limit) {
      if (pieces.length > 0 && pendingSpace !== null) place(pendingSpace, " ", spaceWidth);
    } else {
      pushLine();
    }
    pendingSpace = null;

    if (lineWidth + clusterWidth <= limit) {
      for (const piece of cluster) place(piece.run, piece.text, piece.width);
      continue;
    }
    for (const piece of cluster) {
      for (const ch of piece.text) {
        const width = measure(piece.run, ch);
        if (pieces.length > 0 && lineWidth + width > limit) pushLine();
        place(piece.run, ch, width);
      }
    }
  }
  if (pieces.length > 0 || lines.length === 0) pushLine();

  let width = 0;
  for (const line of lines) width = Math.max(width, line.width);
  const lastLineHeight = base.glyphHeight;
  const height = (lines.length - 1) * metrics.lineHeight + lastLineHeight;
  return { lines, width, height, lineHeight: metrics.lineHeight, lastLineHeight };
}

function toLine(pieces: Piece[]): RunLine {
  const fragments: RunFragment[] = [];
  let x = 0;
  for (const piece of pieces) {
    const last = fragments[fragments.length - 1];
    if (last && last.run === piece.run) {
      last.text += piece.text;
      last.width += piece.width;
    } else {
      fragments.push({ run: piece.run, text: piece.text, x, width: piece.width });
    }
    x += piece.width;
  }
  return { fragments, width: x };
}

interface RunLayoutCache {
  runs: readonly TextRun[];
  fontName: string;
  size: number | undefined;
  styleKey: string;
  maxWidth: number | undefined;
  block: RunBlock;
}

const runLayoutCache = new WeakMap<CanvasNode, RunLayoutCache>();

function styleKey(style: FontStyle): string {
  return `${+!!style.bold}${+!!style.italic}${+!!style.outline}${+!!style.shadow}${+!!style.underline}`;
}

/** `layoutRuns`, reused across measure, paint and hit-testing while nothing changed. */
export function layoutNodeRuns(
  node: CanvasNode,
  face: RunFace,
  runs: readonly TextRun[],
  maxWidth?: number,
): RunBlock {
  const key = styleKey(face.style);
  const hit = runLayoutCache.get(node);
  if (
    hit &&
    hit.runs === runs &&
    hit.fontName === face.fontName &&
    hit.size === face.size &&
    hit.styleKey === key &&
    hit.maxWidth === maxWidth
  ) {
    return hit.block;
  }
  const block = layoutRuns(face, runs, maxWidth);
  runLayoutCache.set(node, { runs, fontName: face.fontName, size: face.size, styleKey: key, maxWidth, block });
  return block;
}

/** Left edge of a line in a box `width` wide, as `<text align>` paints it. */
export function runLineLeft(line: RunLine, align: TextAlign, width: number): number {
  if (align === "center") return Math.floor((width - line.width) / 2);
  if (align === "right") return width - line.width;
  return 0;
}

/** Index of the run painted at content-box point `(x, y)`, or -1 between runs. */
export function runAtPoint(block: RunBlock, x: number, y: number, align: TextAlign, width: number): number {
  if (y < 0 || y >= block.height || block.lines.length === 0) return -1;
  const row = Math.min(block.lines.length - 1, Math.floor(y / block.lineHeight));
  const line = block.lines[row]!;
  const left = runLineLeft(line, align, width);
  for (const fragment of line.fragments) {
    if (x >= left + fragment.x && x < left + fragment.x + fragment.width) return fragment.run;
  }
  return -1;
}
