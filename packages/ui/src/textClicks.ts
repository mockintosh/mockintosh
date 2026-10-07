import { DOUBLE_CLICK_DIST, DOUBLE_CLICK_MS } from "./pointer";

/** Inclusive-exclusive character range. */
export interface TextRange {
  start: number;
  end: number;
}

/** Where a pointer gesture leaves the selection: `anchor` stays, `caret` moves. */
export interface TextClickSelection {
  anchor: number;
  caret: number;
}

const WORD = /[\p{L}\p{N}_']/u;
const SPACE = /[^\S\n]/;

/**
 * The run a double-click at `index` selects: a word, a stretch of spaces,
 * or a single punctuation mark or line break.
 */
export function wordRangeAt(text: string, index: number): TextRange {
  const at = index < text.length ? index : index - 1;
  if (at < 0) return { start: 0, end: 0 };
  const kind = (ch: string) => (WORD.test(ch) ? 1 : SPACE.test(ch) ? 2 : 0);
  const k = kind(text[at]!);
  if (k === 0) return { start: at, end: at + 1 };
  let start = at;
  let end = at + 1;
  while (start > 0 && kind(text[start - 1]!) === k) start--;
  while (end < text.length && kind(text[end]!) === k) end++;
  return { start, end };
}

/** The paragraph around `index`: the text between line breaks, without them. */
export function paragraphRangeAt(text: string, index: number): TextRange {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const next = text.indexOf("\n", index);
  return { start, end: next === -1 ? text.length : next };
}

const wholeText = (text: string): TextRange => ({ start: 0, end: text.length });

export interface TextClicks {
  /** A press: 1st places the caret, 2nd selects a word, 3rd the `third` unit. */
  down(lx: number, ly: number, text: string, index: number): TextClickSelection;
  /** Drag after a press, extending by the unit the press selected. */
  drag(text: string, index: number): TextClickSelection;
  /**
   * A host `dblclick`. Hosts send it after the second mousedown, which
   * `down` already counted, so this returns null unless it arrives alone.
   */
  doubleClick(lx: number, ly: number, text: string, index: number): TextClickSelection | null;
}

/**
 * Click counting for an editable text widget. Counts presses itself (same
 * window as the host's double-click) so a triple-click is seen at all.
 */
export function createTextClicks(options?: {
  /** Double-click unit. Defaults to {@link wordRangeAt}. */
  word?: (text: string, index: number) => TextRange;
  /** Triple-click unit. Defaults to the whole text. */
  third?: (text: string, index: number) => TextRange;
}): TextClicks {
  const word = options?.word ?? wordRangeAt;
  const third = options?.third ?? wholeText;
  let count = 0;
  let lastAt = -Infinity;
  let lastX = 0;
  let lastY = 0;
  let anchor: TextRange = { start: 0, end: 0 };

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const unitAt = (text: string, index: number): TextRange =>
    count === 2 ? word(text, index) : count >= 3 ? third(text, index) : { start: index, end: index };
  const press = (lx: number, ly: number, text: string, index: number): TextClickSelection => {
    lastAt = now();
    lastX = lx;
    lastY = ly;
    anchor = unitAt(text, index);
    return { anchor: anchor.start, caret: anchor.end };
  };

  return {
    down(lx, ly, text, index) {
      const repeat =
        now() - lastAt < DOUBLE_CLICK_MS &&
        Math.abs(lx - lastX) < DOUBLE_CLICK_DIST &&
        Math.abs(ly - lastY) < DOUBLE_CLICK_DIST;
      count = repeat ? Math.min(3, count + 1) : 1;
      return press(lx, ly, text, index);
    },
    drag(text, index) {
      const unit = unitAt(text, index);
      if (unit.start < anchor.start) return { anchor: anchor.end, caret: unit.start };
      return { anchor: anchor.start, caret: Math.max(anchor.end, unit.end) };
    },
    doubleClick(lx, ly, text, index) {
      if (count >= 2) return null;
      count = 2;
      return press(lx, ly, text, index);
    },
  };
}
