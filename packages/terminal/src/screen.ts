/**
 * The terminal's screen: a grid of character cells that a program drives
 * with text and escape sequences. Parsing, the buffers, scrollback, reflow
 * and the replies to a program's queries come from `@xterm/headless`; this
 * module is the only one that imports it, and no xterm type leaves it.
 */
import { returnWindow } from "./xtermEnv";
import * as xterm from "@xterm/headless";
import type { IBufferCell, IBufferLine } from "@xterm/headless";
import { monochromeStyle, styleKey, PLAIN_STYLE, type CellStyle, type TerminalColor } from "./style";

returnWindow();

// The ES build exports `Terminal`; Node's CommonJS build arrives as a default export.
const Terminal = (xterm.Terminal ?? (xterm as unknown as { default: typeof xterm }).default.Terminal) as typeof xterm.Terminal;

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalCell {
  /** The character, with any combining marks; "" for an empty cell or the right half of a wide character. */
  text: string;
  width: 0 | 1 | 2;
  style: CellStyle;
}

export interface TerminalRow {
  cells: readonly TerminalCell[];
  /** Changes whenever what the row draws changes. Row caches key on it. */
  key: string;
  /** The line continues onto the next one (soft wrap). */
  wrapped: boolean;
}

export interface TerminalCursor {
  x: number;
  y: number;
  visible: boolean;
}

export interface TerminalFrame {
  rows: readonly TerminalRow[];
  /** The cursor in viewport rows, or null when it is scrolled out of view. */
  cursor: TerminalCursor | null;
  /** First buffer line shown (0 = the oldest line of scrollback). */
  viewportTop: number;
  /** First line of the live screen; `viewportTop === bottom` when not scrolled back. */
  bottom: number;
  /** All lines, scrollback and screen. */
  length: number;
  alternate: boolean;
}

export interface TerminalModes {
  applicationCursorKeys: boolean;
  applicationKeypad: boolean;
  bracketedPaste: boolean;
  mouseTracking: "none" | "x10" | "vt200" | "drag" | "any";
  sendFocus: boolean;
  synchronizedOutput: boolean;
  cursorVisible: boolean;
  /** Mouse reports in SGR form (`?1006`). */
  sgrMouse: boolean;
}

export interface TerminalScreen {
  readonly size: TerminalSize;
  readonly modes: TerminalModes;
  /** Feed program output. Resolves once it has been parsed. */
  write(data: Uint8Array | string): Promise<void>;
  /** Bytes the terminal sends to the program: typed keys and replies to its queries. */
  onInput(handler: (data: string) => void): () => void;
  /** Send user input (already encoded) to the program, as if typed. */
  input(data: string): void;
  resize(size: TerminalSize): void;
  frame(): TerminalFrame;
  /** Lines of text from buffer line `from` to `to` inclusive, joining soft-wrapped lines. */
  text(from: { line: number; col: number }, to: { line: number; col: number }): string;
  /** One buffer line as text, and whether it wraps onto the next. */
  line(index: number): { text: string; wrapped: boolean } | null;
  /** Scroll the view `lines` lines (negative is back into scrollback). */
  scrollBy(lines: number): void;
  scrollToBottom(): void;
  clearScrollback(): void;
  reset(): void;
  /** After a write is parsed or the view scrolls. */
  onChange(handler: () => void): () => void;
  onTitle(handler: (title: string) => void): () => void;
  onBell(handler: () => void): () => void;
  dispose(): void;
}

export interface ScreenOptions {
  size: TerminalSize;
  scrollback?: number;
}

function colorOf(cell: IBufferCell, which: "fg" | "bg"): TerminalColor {
  const isDefault = which === "fg" ? cell.isFgDefault() : cell.isBgDefault();
  if (isDefault) return { mode: "default" };
  const value = which === "fg" ? cell.getFgColor() : cell.getBgColor();
  const rgb = which === "fg" ? cell.isFgRGB() : cell.isBgRGB();
  return rgb ? { mode: "rgb", value } : { mode: "palette", index: value };
}

function styleOf(cell: IBufferCell): CellStyle {
  if (cell.isAttributeDefault()) return PLAIN_STYLE;
  return monochromeStyle(colorOf(cell, "fg"), colorOf(cell, "bg"), {
    bold: !!cell.isBold(),
    dim: !!cell.isDim(),
    italic: !!cell.isItalic(),
    underline: !!cell.isUnderline(),
    inverse: !!cell.isInverse(),
    invisible: !!cell.isInvisible(),
    strikethrough: !!cell.isStrikethrough(),
  });
}

function rowOf(line: IBufferLine | undefined, cols: number, scratch: IBufferCell): TerminalRow {
  const cells: TerminalCell[] = [];
  let key = "";
  let lastStyle = "";
  for (let x = 0; x < cols; x++) {
    const cell = line?.getCell(x, scratch);
    if (!cell) {
      cells.push({ text: "", width: 1, style: PLAIN_STYLE });
      key += " ";
      continue;
    }
    const style = styleOf(cell);
    const width = cell.getWidth() as 0 | 1 | 2;
    const text = cell.getChars();
    cells.push({ text, width, style });
    const sk = styleKey(style);
    if (sk !== lastStyle) {
      key += `\u0000${sk}\u0000`;
      lastStyle = sk;
    }
    key += text || (width === 0 ? "\u0001" : " ");
  }
  return { cells, key, wrapped: !!line?.isWrapped };
}

export function createTerminalScreen(options: ScreenOptions): TerminalScreen {
  const term = new Terminal({
    cols: Math.max(2, options.size.cols),
    rows: Math.max(1, options.size.rows),
    scrollback: options.scrollback ?? 2000,
    allowProposedApi: true,
    // Programs that ask for a theme get the paper's: light.
    convertEol: false,
  });
  let cursorVisible = true;
  let sgrMouse = false;
  const changeHandlers = new Set<() => void>();
  const changed = () => {
    for (const handler of changeHandlers) handler();
  };
  const disposables = [
    term.onWriteParsed(changed),
    term.onScroll(changed),
    // DECTCEM: the program shows or hides the cursor. Let xterm see it too.
    term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
      if (params.includes(25)) cursorVisible = true;
      if (params.includes(1006)) sgrMouse = true;
      return false;
    }),
    term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
      if (params.includes(25)) cursorVisible = false;
      if (params.includes(1006)) sgrMouse = false;
      return false;
    }),
  ];
  const scratch = term.buffer.active.getNullCell();

  const screen: TerminalScreen = {
    get size() {
      return { cols: term.cols, rows: term.rows };
    },
    get modes(): TerminalModes {
      const m = term.modes;
      return {
        applicationCursorKeys: m.applicationCursorKeysMode,
        applicationKeypad: m.applicationKeypadMode,
        bracketedPaste: m.bracketedPasteMode,
        mouseTracking: m.mouseTrackingMode,
        sendFocus: m.sendFocusMode,
        synchronizedOutput: m.synchronizedOutputMode,
        cursorVisible,
        sgrMouse,
      };
    },
    write(data) {
      return new Promise((resolve) => term.write(data, resolve));
    },
    onInput(handler) {
      const a = term.onData(handler);
      // X10 mouse reports arrive as binary strings (one char per byte).
      const b = term.onBinary(handler);
      return () => {
        a.dispose();
        b.dispose();
      };
    },
    input(data) {
      term.input(data, true);
    },
    resize(size) {
      const cols = Math.max(2, size.cols), rows = Math.max(1, size.rows);
      if (cols === term.cols && rows === term.rows) return;
      term.resize(cols, rows);
      changed();
    },
    frame() {
      const buffer = term.buffer.active;
      const rows: TerminalRow[] = [];
      const top = buffer.viewportY;
      for (let y = 0; y < term.rows; y++) {
        const line = buffer.getLine(top + y);
        rows.push(rowOf(line, term.cols, scratch));
      }
      const cursorLine = buffer.baseY + buffer.cursorY;
      const cy = cursorLine - top;
      const cursor = cy >= 0 && cy < term.rows ? { x: Math.min(buffer.cursorX, term.cols - 1), y: cy, visible: cursorVisible } : null;
      return {
        rows,
        cursor,
        viewportTop: top,
        bottom: buffer.baseY,
        length: buffer.length,
        alternate: buffer.type === "alternate",
      };
    },
    text(from, to) {
      const buffer = term.buffer.active;
      let out = "";
      for (let y = from.line; y <= to.line; y++) {
        const line = buffer.getLine(y);
        if (!line) break;
        const start = y === from.line ? from.col : 0;
        const end = y === to.line ? to.col : term.cols;
        out += line.translateToString(y !== to.line || end >= term.cols, start, end);
        const next = buffer.getLine(y + 1);
        if (y !== to.line && !next?.isWrapped) out += "\n";
      }
      return out;
    },
    line(index) {
      const line = term.buffer.active.getLine(index);
      if (!line) return null;
      return { text: line.translateToString(false), wrapped: !!term.buffer.active.getLine(index + 1)?.isWrapped };
    },
    scrollBy(lines) {
      term.scrollLines(lines);
      changed();
    },
    scrollToBottom() {
      term.scrollToBottom();
      changed();
    },
    clearScrollback() {
      term.clear();
      changed();
    },
    reset() {
      term.reset();
      cursorVisible = true;
      sgrMouse = false;
      changed();
    },
    onChange(handler) {
      changeHandlers.add(handler);
      return () => changeHandlers.delete(handler);
    },
    onTitle(handler) {
      const d = term.onTitleChange(handler);
      return () => d.dispose();
    },
    onBell(handler) {
      const d = term.onBell(handler);
      return () => d.dispose();
    },
    dispose() {
      for (const d of disposables) d.dispose();
      changeHandlers.clear();
      term.dispose();
    },
  };
  return screen;
}
