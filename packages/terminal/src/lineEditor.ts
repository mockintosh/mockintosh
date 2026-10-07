/**
 * A shell's line editor, the part of bash that readline is: it reads keys
 * from a terminal in raw mode, edits one line in place, and hands back the
 * line on Return. Emacs bindings, history, kill and yank, completion,
 * bracketed paste, and lines longer than the terminal is wide.
 *
 * It only writes text and cursor movement, so it works on any terminal
 * that understands VT100, and it is fed whatever bytes the terminal sends.
 */
import { charWidth, stringWidth } from "./width";

export type ReadResult = { kind: "line"; line: string } | { kind: "eof" } | { kind: "interrupt" };

export interface Completion {
  /** Index in the line where the replaced word starts. */
  start: number;
  /** Whole replacements for line[start..cursor]. A trailing "/" or " " is the candidate's own. */
  candidates: string[];
}

export interface LineEditorOptions {
  write(text: string): void;
  cols(): number;
  history?: string[];
  /** Most entries kept in history. */
  historySize?: number;
  complete?(line: string, cursor: number): Promise<Completion | null> | Completion | null;
}

type Key =
  | { t: "text"; text: string }
  | { t: "ctrl"; code: string }
  | { t: "seq"; seq: string }
  | { t: "paste"; text: string };

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Split terminal input into keys, keeping an incomplete escape sequence for the next feed. */
export class KeyReader {
  private pending = "";
  private pasting: string | null = null;

  feed(data: string): Key[] {
    let s = this.pending + data;
    this.pending = "";
    const keys: Key[] = [];
    while (s.length) {
      if (this.pasting !== null) {
        const end = s.indexOf(PASTE_END);
        if (end < 0) {
          // Keep a possible partial end marker for the next feed.
          const keep = partialSuffix(s, PASTE_END);
          this.pasting += s.slice(0, s.length - keep);
          this.pending = s.slice(s.length - keep);
          return keys;
        }
        keys.push({ t: "paste", text: this.pasting + s.slice(0, end) });
        this.pasting = null;
        s = s.slice(end + PASTE_END.length);
        continue;
      }
      const ch = s[0]!;
      if (ch === "\x1b") {
        if (s.startsWith(PASTE_START)) {
          this.pasting = "";
          s = s.slice(PASTE_START.length);
          continue;
        }
        const seq = matchEscape(s);
        if (seq === null) {
          this.pending = s;
          return keys;
        }
        keys.push({ t: "seq", seq });
        s = s.slice(seq.length);
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) {
        keys.push({ t: "ctrl", code: ch });
        s = s.slice(1);
        continue;
      }
      let end = 1;
      while (end < s.length && s.charCodeAt(end) >= 0x20 && s.charCodeAt(end) !== 0x7f && s[end] !== "\x1b") end++;
      keys.push({ t: "text", text: s.slice(0, end) });
      s = s.slice(end);
    }
    return keys;
  }

  /** A lone Escape that nothing followed: deliver it. */
  flush(): Key[] {
    if (this.pending === "\x1b") {
      this.pending = "";
      return [{ t: "seq", seq: "\x1b" }];
    }
    return [];
  }
}

function partialSuffix(s: string, marker: string): number {
  for (let n = Math.min(marker.length - 1, s.length); n > 0; n--) if (s.endsWith(marker.slice(0, n))) return n;
  return 0;
}

/** The escape sequence at the start of `s`, or null when it may be incomplete. */
function matchEscape(s: string): string | null {
  if (s.length < 2) return null;
  const second = s[1]!;
  if (second === "[") {
    for (let i = 2; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) return s.slice(0, i + 1);
    }
    return null;
  }
  if (second === "O") return s.length < 3 ? null : s.slice(0, 3);
  return s.slice(0, 2);
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

export class LineEditor {
  private chars: string[] = [];
  private cursor = 0;
  private prompt = "";
  /** Rows below the prompt's first row where the terminal cursor was left. */
  private cursorRow = 0;
  private reader = new KeyReader();
  private pendingRead: ((result: ReadResult) => void) | null = null;
  private queue: Key[] = [];
  private history: string[];
  private historyIndex = 0;
  private draft: string[] = [];
  private killRing = "";
  private lastWasTab = false;
  private busy = false;
  private search: { query: string; index: number } | null = null;

  constructor(private options: LineEditorOptions) {
    this.history = options.history ?? [];
  }

  get historyEntries(): readonly string[] {
    return this.history;
  }

  /** Show `prompt` and read one line. */
  read(prompt: string): Promise<ReadResult> {
    if (this.pendingRead) throw new Error("Already reading a line");
    this.prompt = prompt;
    this.chars = [];
    this.cursor = 0;
    this.cursorRow = 0;
    this.historyIndex = this.history.length;
    this.draft = [];
    this.search = null;
    this.options.write(prompt);
    return new Promise((resolve) => {
      this.pendingRead = resolve;
      this.drain();
    });
  }

  get reading(): boolean {
    return this.pendingRead !== null;
  }

  /** Bytes from the terminal. Typed ahead of a read, they wait for it. */
  feed(data: string): void {
    this.queue.push(...this.reader.feed(data));
    this.drain();
  }

  /** The terminal changed width: draw the line again for the new wrap. */
  redraw(): void {
    if (this.pendingRead) this.refresh();
  }

  private drain(): void {
    if (this.busy) return;
    while (this.pendingRead && this.queue.length) {
      const key = this.queue.shift()!;
      const result = this.handle(key);
      if (result instanceof Promise) {
        this.busy = true;
        void result.finally(() => {
          this.busy = false;
          this.drain();
        });
        return;
      }
    }
  }

  private finish(result: ReadResult): void {
    const resolve = this.pendingRead;
    this.pendingRead = null;
    resolve?.(result);
  }

  private handle(key: Key): void | Promise<void> {
    const wasTab = this.lastWasTab;
    this.lastWasTab = false;
    if (this.search) return this.handleSearch(key);
    switch (key.t) {
      case "text":
        this.insert(key.text);
        return;
      case "paste": {
        // Pasted lines run one after another, as if typed.
        const lines = key.text.replace(/\r\n?/g, "\n").split("\n");
        this.insert(lines[0]!.replace(/[\x00-\x1f\x7f]/g, ""));
        if (lines.length > 1) {
          const rest: Key[] = [];
          for (const line of lines.slice(1)) {
            rest.push({ t: "ctrl", code: "\r" });
            if (line) rest.push({ t: "text", text: line.replace(/[\x00-\x1f\x7f]/g, "") });
          }
          this.queue.unshift(...rest);
        }
        return;
      }
      case "ctrl":
        return this.control(key.code, wasTab);
      case "seq":
        this.sequence(key.seq);
        return;
    }
  }

  private control(code: string, wasTab: boolean): void | Promise<void> {
    switch (code) {
      case "\r":
      case "\n":
        this.moveToEnd();
        this.options.write("\r\n");
        this.accept();
        return;
      case "\x03": // ⌃C
        this.moveToEnd();
        this.options.write("^C\r\n");
        this.finish({ kind: "interrupt" });
        return;
      case "\x04": // ⌃D
        if (this.chars.length === 0) {
          this.finish({ kind: "eof" });
          return;
        }
        this.deleteAt(this.cursor);
        return;
      case "\x7f":
      case "\x08":
        if (this.cursor > 0) this.deleteAt(--this.cursor, true);
        return;
      case "\x01": return this.moveTo(0);
      case "\x05": return this.moveTo(this.chars.length);
      case "\x02": return this.moveTo(this.cursor - 1);
      case "\x06": return this.moveTo(this.cursor + 1);
      case "\x0b": // ⌃K
        this.kill(this.cursor, this.chars.length);
        return;
      case "\x15": // ⌃U
        this.kill(0, this.cursor);
        return;
      case "\x17": // ⌃W: back to whitespace, as in bash
        {
          let a = this.cursor;
          while (a > 0 && this.chars[a - 1] === " ") a--;
          while (a > 0 && this.chars[a - 1] !== " ") a--;
          this.kill(a, this.cursor);
        }
        return;
      case "\x19": // ⌃Y
        this.insert(this.killRing);
        return;
      case "\x14": // ⌃T
        if (this.cursor > 0 && this.chars.length > 1) {
          const at = this.cursor === this.chars.length ? this.cursor - 1 : this.cursor;
          [this.chars[at - 1], this.chars[at]] = [this.chars[at]!, this.chars[at - 1]!];
          this.cursor = Math.min(this.chars.length, at + 1);
          this.refresh();
        }
        return;
      case "\x0c": // ⌃L
        this.options.write("\x1b[H\x1b[2J");
        this.cursorRow = 0;
        this.options.write(this.prompt);
        this.refresh(true);
        return;
      case "\x10": return this.historyMove(-1);
      case "\x0e": return this.historyMove(1);
      case "\x12": // ⌃R
        this.search = { query: "", index: this.history.length };
        this.renderSearch();
        return;
      case "\t":
        this.lastWasTab = true;
        return this.completeWord(wasTab);
      case "\x07": // ⌃G
        this.options.write("\x07");
        return;
    }
  }

  private sequence(seq: string): void {
    switch (seq) {
      case "\x1b[D": case "\x1bOD": return this.moveTo(this.cursor - 1);
      case "\x1b[C": case "\x1bOC": return this.moveTo(this.cursor + 1);
      case "\x1b[A": case "\x1bOA": return this.historyMove(-1);
      case "\x1b[B": case "\x1bOB": return this.historyMove(1);
      case "\x1b[H": case "\x1bOH": case "\x1b[1~": return this.moveTo(0);
      case "\x1b[F": case "\x1bOF": case "\x1b[4~": return this.moveTo(this.chars.length);
      case "\x1b[3~": this.deleteAt(this.cursor); return;
      case "\x1bb": case "\x1b[1;3D": case "\x1b[1;5D": return this.moveTo(this.wordLeft());
      case "\x1bf": case "\x1b[1;3C": case "\x1b[1;5C": return this.moveTo(this.wordRight());
      case "\x1bd": this.kill(this.cursor, this.wordRight()); return;
      case "\x1b\x7f": this.kill(this.wordLeft(), this.cursor); return;
    }
  }

  private accept(): void {
    const line = this.chars.join("");
    if (line.trim() && this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      const max = this.options.historySize ?? 1000;
      if (this.history.length > max) this.history.splice(0, this.history.length - max);
    }
    this.finish({ kind: "line", line });
  }

  private insert(text: string): void {
    if (!text) return;
    const add = Array.from(text);
    this.chars.splice(this.cursor, 0, ...add);
    this.cursor += add.length;
    if (this.cursor === this.chars.length && !this.wraps()) {
      // Typing at the end: just echo, the common case.
      this.options.write(text);
      return;
    }
    this.refresh();
  }

  /** True when the line runs to the terminal's right edge, where echoing alone loses track of the cursor. */
  private wraps(): boolean {
    return stringWidth(this.prompt) + this.width(this.chars) >= this.options.cols();
  }

  private deleteAt(index: number, backwards = false): void {
    if (index < 0 || index >= this.chars.length) return;
    const [removed] = this.chars.splice(index, 1);
    if (backwards && this.cursor === this.chars.length && !this.wraps() && charWidth(removed!.codePointAt(0)!) === 1) {
      this.options.write("\b \b");
      return;
    }
    this.refresh();
  }

  private kill(from: number, to: number): void {
    if (to <= from) return;
    this.killRing = this.chars.slice(from, to).join("");
    this.chars.splice(from, to - from);
    this.cursor = from;
    this.refresh();
  }

  private moveTo(index: number): void {
    const next = Math.max(0, Math.min(this.chars.length, index));
    if (next === this.cursor) return;
    this.cursor = next;
    this.placeCursor();
  }

  private moveToEnd(): void {
    this.cursor = this.chars.length;
    this.placeCursor();
  }

  private wordLeft(): number {
    let a = this.cursor;
    while (a > 0 && !isWordChar(this.chars[a - 1]!)) a--;
    while (a > 0 && isWordChar(this.chars[a - 1]!)) a--;
    return a;
  }

  private wordRight(): number {
    let b = this.cursor;
    while (b < this.chars.length && !isWordChar(this.chars[b]!)) b++;
    while (b < this.chars.length && isWordChar(this.chars[b]!)) b++;
    return b;
  }

  private historyMove(delta: number): void {
    const next = this.historyIndex + delta;
    if (next < 0 || next > this.history.length) return;
    if (this.historyIndex === this.history.length) this.draft = this.chars;
    this.historyIndex = next;
    this.chars = next === this.history.length ? this.draft : Array.from(this.history[next]!);
    this.cursor = this.chars.length;
    this.refresh();
  }

  private async completeWord(again: boolean): Promise<void> {
    const complete = this.options.complete;
    if (!complete) {
      this.insert("\t");
      return;
    }
    const line = this.chars.join("");
    const before = this.chars.slice(0, this.cursor).join("");
    const result = await complete(line, before.length);
    if (!result || result.candidates.length === 0) {
      this.options.write("\x07");
      return;
    }
    const word = before.slice(result.start);
    const common = commonPrefix(result.candidates);
    if (common.length > word.length) {
      const startIndex = Array.from(before.slice(0, result.start)).length;
      this.chars.splice(startIndex, this.cursor - startIndex, ...Array.from(common));
      this.cursor = startIndex + Array.from(common).length;
      this.refresh();
      return;
    }
    if (result.candidates.length === 1) return;
    if (!again) {
      this.options.write("\x07");
      return;
    }
    // Second Tab: list the candidates under the line, then draw it again.
    this.moveToEnd();
    this.options.write("\r\n" + columns(result.candidates.map(displayName), this.options.cols()));
    this.cursorRow = 0;
    this.options.write(this.prompt);
    this.refresh(true);
  }

  private handleSearch(key: Key): void {
    const search = this.search!;
    if (key.t === "text") {
      search.query += key.text;
      this.findMatch(search.index);
      return;
    }
    if (key.t === "ctrl" && key.code === "\x12") {
      this.findMatch(search.index - 1);
      return;
    }
    if (key.t === "ctrl" && (key.code === "\x7f" || key.code === "\x08")) {
      search.query = search.query.slice(0, -1);
      this.findMatch(this.history.length);
      return;
    }
    // Any other key ends the search, keeping the match, and then does what it does.
    this.search = null;
    this.clearLine();
    this.options.write(this.prompt);
    this.cursorRow = 0;
    this.refresh(true);
    if (key.t === "ctrl" && (key.code === "\x07" || key.code === "\x03")) return;
    this.queue.unshift(key);
  }

  private findMatch(from: number): void {
    const search = this.search!;
    for (let i = Math.min(from, this.history.length - 1); i >= 0; i--) {
      if (search.query && this.history[i]!.includes(search.query)) {
        search.index = i;
        this.chars = Array.from(this.history[i]!);
        this.cursor = this.chars.length;
        break;
      }
    }
    this.renderSearch();
  }

  private renderSearch(): void {
    this.clearLine();
    const label = `(reverse-i-search)'${this.search!.query}': `;
    this.options.write(label + this.chars.join(""));
    const width = stringWidth(label) + this.width(this.chars);
    this.cursorRow = Math.floor(Math.max(0, width - 1) / this.options.cols());
  }

  /** Back to the prompt's first row, column 0, and erase everything below. */
  private clearLine(): void {
    let out = "\r";
    if (this.cursorRow > 0) out += `\x1b[${this.cursorRow}A`;
    this.options.write(out + "\x1b[J");
    this.cursorRow = 0;
  }

  private width(chars: readonly string[]): number {
    let w = 0;
    for (const ch of chars) w += charWidth(ch.codePointAt(0)!);
    return w;
  }

  /** Where index `n` of the line sits: rows below the prompt's row, and column. */
  private position(n: number): { row: number; col: number } {
    const cols = this.options.cols();
    const w = stringWidth(this.prompt) + this.width(this.chars.slice(0, n));
    return { row: Math.floor(w / cols), col: w % cols };
  }

  /** Draw the line again from the prompt's end. `fresh`: the prompt was just written. */
  private refresh(fresh = false): void {
    let out = "";
    if (!fresh) {
      out += "\r";
      if (this.cursorRow > 0) out += `\x1b[${this.cursorRow}A`;
      out += this.prompt;
    }
    const text = this.chars.join("");
    out += text;
    const end = this.position(this.chars.length);
    // At the right edge the terminal holds the cursor on the last column: make it wrap.
    if (end.col === 0 && end.row > 0) out += " \r";
    out += "\x1b[J";
    const at = this.position(this.cursor);
    if (end.row > at.row) out += `\x1b[${end.row - at.row}A`;
    out += "\r";
    if (at.col > 0) out += `\x1b[${at.col}C`;
    this.options.write(out);
    this.cursorRow = at.row;
  }

  private placeCursor(): void {
    const at = this.position(this.cursor);
    let out = "";
    if (at.row < this.cursorRow) out += `\x1b[${this.cursorRow - at.row}A`;
    else if (at.row > this.cursorRow) out += `\x1b[${at.row - this.cursorRow}B`;
    out += "\r";
    if (at.col > 0) out += `\x1b[${at.col}C`;
    this.options.write(out);
    this.cursorRow = at.row;
  }
}

function commonPrefix(words: string[]): string {
  if (words.length === 0) return "";
  let prefix = words[0]!;
  for (const w of words) while (!w.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}

/** A candidate as listed: its last path component, keeping a directory's "/". */
function displayName(candidate: string): string {
  const trimmed = candidate.replace(/ $/, "");
  const slash = trimmed.lastIndexOf("/", trimmed.length - 2);
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Names in columns that fit `cols`, filled down then across, as `ls` does. */
export function columns(names: string[], cols: number): string {
  if (names.length === 0) return "";
  const widest = Math.max(...names.map(stringWidth)) + 2;
  const perRow = Math.max(1, Math.floor(cols / widest));
  const rows = Math.ceil(names.length / perRow);
  let out = "";
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < perRow; c++) {
      const name = names[c * rows + r];
      if (name === undefined) continue;
      const last = (c + 1) * rows + r >= names.length;
      line += last ? name : name + " ".repeat(widest - stringWidth(name));
    }
    out += line + "\r\n";
  }
  return out;
}
