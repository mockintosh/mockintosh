/**
 * Selecting text in the terminal: drag by cell, double-click a word,
 * triple-click a line, Shift-click to extend. Positions are buffer lines
 * (scrollback included) and columns, so a selection stays on its text while
 * the view scrolls. `to` is exclusive.
 */

export interface CellPosition {
  line: number;
  col: number;
}

export type SelectionUnit = "char" | "word" | "line";

export interface SelectionRange {
  from: CellPosition;
  to: CellPosition;
}

/** A word is a run of these; everything else stops it. Paths and URLs count as words. */
const WORD = /[\p{L}\p{N}_\-./~:@%+=?&#$]/u;

export function compare(a: CellPosition, b: CellPosition): number {
  return a.line - b.line || a.col - b.col;
}

export class SelectionModel {
  private anchor: SelectionRange | null = null;
  private head: SelectionRange | null = null;
  private unit: SelectionUnit = "char";

  /** `lineText(line)` returns the line's characters, one per cell. */
  constructor(private lineText: (line: number) => string, private cols: () => number) {}

  get active(): boolean {
    const r = this.range();
    return r !== null && compare(r.from, r.to) < 0;
  }

  start(at: CellPosition, unit: SelectionUnit = "char"): void {
    this.unit = unit;
    this.anchor = this.expand(at);
    this.head = this.anchor;
  }

  /** Drag or Shift-click to `at`. Starts a selection when there is none. */
  extend(at: CellPosition): void {
    if (!this.anchor) {
      this.start(at);
      return;
    }
    this.head = this.expand(at);
  }

  clear(): void {
    this.anchor = this.head = null;
  }

  selectAll(lines: number): void {
    this.unit = "line";
    this.anchor = { from: { line: 0, col: 0 }, to: { line: 0, col: this.cols() } };
    this.head = { from: { line: lines - 1, col: 0 }, to: { line: lines - 1, col: this.cols() } };
  }

  range(): SelectionRange | null {
    if (!this.anchor || !this.head) return null;
    const from = compare(this.anchor.from, this.head.from) <= 0 ? this.anchor.from : this.head.from;
    const to = compare(this.anchor.to, this.head.to) >= 0 ? this.anchor.to : this.head.to;
    return { from, to };
  }

  contains(line: number, col: number): boolean {
    const r = this.range();
    if (!r) return false;
    const at = { line, col };
    return compare(at, r.from) >= 0 && compare(at, r.to) < 0;
  }

  /** Lines dropped off the top of scrollback: keep the selection on its text. */
  shift(lines: number): void {
    const move = (r: SelectionRange | null) => r && {
      from: { line: r.from.line - lines, col: r.from.col },
      to: { line: r.to.line - lines, col: r.to.col },
    };
    this.anchor = move(this.anchor);
    this.head = move(this.head);
    const r = this.range();
    if (r && r.to.line < 0) this.clear();
  }

  private expand(at: CellPosition): SelectionRange {
    const cols = this.cols();
    const col = Math.max(0, Math.min(cols, at.col));
    if (this.unit === "line") return { from: { line: at.line, col: 0 }, to: { line: at.line, col: cols } };
    if (this.unit === "word") {
      const text = this.lineText(at.line);
      const chars = Array.from(text);
      const isWord = (i: number) => i >= 0 && i < chars.length && WORD.test(chars[i]!);
      const c = Math.min(col, cols - 1);
      if (!isWord(c)) return { from: { line: at.line, col: c }, to: { line: at.line, col: c + 1 } };
      let a = c, b = c;
      while (isWord(a - 1)) a--;
      while (isWord(b + 1)) b++;
      return { from: { line: at.line, col: a }, to: { line: at.line, col: b + 1 } };
    }
    return { from: { line: at.line, col }, to: { line: at.line, col } };
  }
}
