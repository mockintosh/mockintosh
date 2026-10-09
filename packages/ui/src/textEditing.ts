/**
 * Editing keys for every text widget: one field, a wrapped text box, a code
 * editor. Pure: text and selection in, text and selection out; each widget
 * keeps its own drawing, and its own keys (Return, Escape) on top.
 *
 * The keys are the Mac's: ← → by character, ⌥ by word, ⌘ to the line's
 * ends; ↑ ↓ by line, ⌘ to the text's ends; ⇧ extends; ⌫ ⌦ delete a
 * character, ⌥ a word, ⌘ to the line's end; ⌘A ⌘C ⌘X; ⌘Z and ⇧⌘Z undo and
 * redo. Control counts as Command, as everywhere in Mockintosh.
 */

import { createEffect, createSignal, type Accessor } from "solid-js";
import type { Modifiers } from "./nodes";
import type { UIClipboard } from "./services";

/** The text, and the selection in it: `anchor` stays, `caret` moves. Equal for a bare caret. */
export interface TextEditState {
  value: string;
  anchor: number;
  caret: number;
}

/**
 * Where lines are, for a widget whose text has them. A one-line field
 * leaves this out: its line is the whole text, and ↑ ↓ go to its ends.
 */
export interface TextLines {
  /** The start and end of the line (as laid out, wrapped or not) `index` is on. */
  lineAt(index: number): { start: number; end: number };
  /** The index a line up (`-1`) or down (`1`) from `index`, under the same x. */
  vertical(index: number, rows: -1 | 1): number;
}

/** What a key did: the next state, text to put on the clipboard, or an undo or redo to make. */
export interface TextKeyResult {
  state?: TextEditState;
  copy?: string;
  history?: "undo" | "redo";
}

const WORD = /[\p{L}\p{N}_']/u;

/** The start of the word before `index`, past any spaces and punctuation first, as ⌥← goes. */
export function wordStartBefore(text: string, index: number): number {
  let at = index;
  while (at > 0 && !WORD.test(text[at - 1]!)) at--;
  while (at > 0 && WORD.test(text[at - 1]!)) at--;
  return at;
}

/** The end of the word after `index`, as ⌥→ goes. */
export function wordEndAfter(text: string, index: number): number {
  let at = index;
  while (at < text.length && !WORD.test(text[at]!)) at++;
  while (at < text.length && WORD.test(text[at]!)) at++;
  return at;
}

export function selectionRange(state: TextEditState): { lo: number; hi: number } {
  return { lo: Math.min(state.anchor, state.caret), hi: Math.max(state.anchor, state.caret) };
}

/** `text` typed or pasted over the selection; the caret after it. */
export function insertText(state: TextEditState, text: string): TextEditState {
  const { lo, hi } = selectionRange(state);
  const value = state.value.slice(0, lo) + text + state.value.slice(hi);
  return { value, anchor: lo + text.length, caret: lo + text.length };
}

/** ⌘-keys `editingKey` acts on in a focused editor, which a host should not also act on (⌘← is a browser's Back). */
const EDITING_CHORD_KEYS = new Set(["a", "c", "x", "z", "y", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace", "Delete"]);

export function isEditingChord(key: string): boolean {
  return EDITING_CHORD_KEYS.has(key.length === 1 ? key.toLowerCase() : key);
}

const oneLine = (text: string): TextLines => ({
  lineAt: () => ({ start: 0, end: text.length }),
  vertical: (_index, rows) => (rows < 0 ? 0 : text.length),
});

/**
 * What `key` does to `state`, or `{}` when it isn't an editing key (Return,
 * Escape, Tab and anything else the widget decides itself).
 */
export function editingKey(state: TextEditState, key: string, mods: Modifiers, lines: TextLines = oneLine(state.value)): TextKeyResult {
  const command = mods.meta || mods.ctrl;
  const { value, caret } = state;
  const { lo, hi } = selectionRange(state);
  const collapsed = lo === hi;
  const clamp = (index: number) => Math.max(0, Math.min(value.length, index));
  /** The caret to `index`, the selection extended there under ⇧. */
  const go = (index: number): TextKeyResult => {
    const to = clamp(index);
    return { state: { value, anchor: mods.shift ? state.anchor : to, caret: to } };
  };
  /** The selection, or else `from` to the caret, deleted. */
  const remove = (from: number): TextKeyResult => {
    if (!collapsed) return { state: insertText(state, "") };
    const a = Math.min(clamp(from), caret);
    const b = Math.max(clamp(from), caret);
    return a === b ? {} : { state: { value: value.slice(0, a) + value.slice(b), anchor: a, caret: a } };
  };

  if (command) {
    const k = key.toLowerCase();
    if (k === "a") return { state: { value, anchor: 0, caret: value.length } };
    if (k === "c") return collapsed ? {} : { copy: value.slice(lo, hi) };
    if (k === "x") return collapsed ? {} : { copy: value.slice(lo, hi), state: insertText(state, "") };
    if (k === "z") return { history: mods.shift ? "redo" : "undo" };
    if (k === "y") return { history: "redo" };
  }

  switch (key) {
    case "ArrowLeft":
      if (command) return go(lines.lineAt(caret).start);
      if (mods.alt) return go(wordStartBefore(value, caret));
      return go(!collapsed && !mods.shift ? lo : caret - 1);
    case "ArrowRight":
      if (command) return go(lines.lineAt(caret).end);
      if (mods.alt) return go(wordEndAfter(value, caret));
      return go(!collapsed && !mods.shift ? hi : caret + 1);
    case "ArrowUp":
      if (command) return go(0);
      return go(lines.vertical(!collapsed && !mods.shift ? lo : caret, -1));
    case "ArrowDown":
      if (command) return go(value.length);
      return go(lines.vertical(!collapsed && !mods.shift ? hi : caret, 1));
    case "Home":
      return go(lines.lineAt(caret).start);
    case "End":
      return go(lines.lineAt(caret).end);
    case "Backspace":
      if (command) return remove(lines.lineAt(caret).start);
      if (mods.alt) return remove(wordStartBefore(value, caret));
      return remove(caret - 1);
    case "Delete":
      if (command) return remove(lines.lineAt(caret).end);
      if (mods.alt) return remove(wordEndAfter(value, caret));
      return remove(caret + 1);
  }
  return {};
}

/**
 * Undo and redo for a text widget. Typing a run of characters is one step,
 * as on the Mac; anything else (a deletion, a paste, a cut) is its own.
 */
export interface TextHistory {
  /** Note `before`, the state an edit of `kind` is about to change. */
  record(before: TextEditState, kind: "typing" | "other"): void;
  /** The caret moved: the next typing starts a step of its own. */
  breakTyping(): void;
  /** The state to go back to from `current`, or null with nothing to undo. */
  undo(current: TextEditState): TextEditState | null;
  redo(current: TextEditState): TextEditState | null;
}

export function createTextHistory(limit = 100): TextHistory {
  const past: TextEditState[] = [];
  const future: TextEditState[] = [];
  let typing = false;
  return {
    record(before, kind) {
      future.length = 0;
      if (kind === "typing" && typing) return;
      typing = kind === "typing";
      past.push(before);
      if (past.length > limit) past.shift();
    },
    breakTyping() {
      typing = false;
    },
    undo(current) {
      typing = false;
      const back = past.pop();
      if (!back) return null;
      future.push(current);
      return back;
    },
    redo(current) {
      typing = false;
      const forward = future.pop();
      if (!forward) return null;
      past.push(current);
      return forward;
    },
  };
}

export interface TextEditingOptions {
  value: () => string;
  onChange: (value: string) => void;
  disabled?: () => boolean;
  clipboard?: UIClipboard;
  /** Where the lines are, now; a one-line field leaves it out. */
  lines?: () => TextLines;
  /** Turns typed or pasted text into what goes in: `\r\n` to `\n`, tabs to spaces, a field's one line. */
  clean?: (text: string) => string;
  /** Most characters the text may hold; typing past it is ignored. */
  maxLength?: () => number | undefined;
  initialCaret?: number;
}

/** A text widget's editing state and keys, shared by every text widget in the kit. */
export interface TextEditing {
  /** The text as typed so far: ahead of `value` until the parent passes the change back. */
  valueNow(): string;
  anchor: Accessor<number>;
  caret: Accessor<number>;
  /** The selection now, read outside reactive code (keydown and keypress in one turn). */
  selection(): { lo: number; hi: number };
  /** The caret to `caret`, keeping `anchor` (or moving it there too when omitted). */
  select(caret: number, anchor?: number): void;
  /** Text typed or pasted over the selection. */
  insert(text: string, kind?: "typing" | "other"): void;
  /** A whole new state, as a toolbar's edit makes; one undo step. */
  replace(next: TextEditState): void;
  /** An editing key: true when it was one, and done. */
  key(key: string, mods: Modifiers): boolean;
}

export function createTextEditing(options: TextEditingOptions): TextEditing {
  const disabled = () => options.disabled?.() === true;
  const initial = Math.max(0, Math.min(options.value().length, options.initialCaret ?? options.value().length));
  // Locals stay current across staged Solid 2 writes, so a keydown and the
  // keypress after it in one turn see the caret and text just written.
  let draft: string | null = null;
  let anchorAt = initial;
  let caretAt = initial;
  const signalOpts = { ownedWrite: true as const };
  const [anchor, setAnchor] = createSignal(initial, signalOpts);
  const [caret, setCaret] = createSignal(initial, signalOpts);
  const history = createTextHistory();
  const valueNow = () => draft ?? options.value();
  const stateNow = (): TextEditState => ({ value: valueNow(), anchor: anchorAt, caret: caretAt });

  function place(caretIndex: number, anchorIndex: number): void {
    const len = valueNow().length;
    caretAt = Math.max(0, Math.min(len, caretIndex));
    anchorAt = Math.max(0, Math.min(len, anchorIndex));
    setCaret(caretAt);
    setAnchor(anchorAt);
  }

  function apply(next: TextEditState, kind: "typing" | "other"): void {
    if (next.value !== valueNow()) {
      history.record(stateNow(), kind);
      draft = next.value;
      options.onChange(next.value);
    } else {
      history.breakTyping();
    }
    place(next.caret, next.anchor);
  }

  // A parent may replace the text without remounting (a chat's send, a
  // form's reset): drop the draft, and keep the caret inside the text.
  createEffect(
    () => options.value(),
    (value) => {
      if (draft === value) draft = null;
      else if (draft !== null && draft.length !== value.length) draft = null;
      if (caretAt > value.length || anchorAt > value.length) place(Math.min(caretAt, value.length), Math.min(anchorAt, value.length));
    },
  );

  const editing: TextEditing = {
    valueNow,
    anchor,
    caret,
    selection: () => selectionRange(stateNow()),
    select(caretIndex, anchorIndex = caretIndex) {
      history.breakTyping();
      place(caretIndex, anchorIndex);
    },
    insert(text, kind = "typing") {
      if (disabled()) return;
      let clean = options.clean ? options.clean(text) : text;
      const max = options.maxLength?.();
      if (max !== undefined) {
        const { lo, hi } = editing.selection();
        clean = clean.slice(0, Math.max(0, max - (valueNow().length - (hi - lo))));
        if (!clean) return;
      }
      apply(insertText(stateNow(), clean), kind);
    },
    replace(next) {
      if (disabled()) return;
      apply(next, "other");
    },
    key(key, mods) {
      const result = editingKey(stateNow(), key, mods, options.lines?.());
      if (result.copy !== undefined) void options.clipboard?.writeText(result.copy).catch(() => {});
      if (result.history) {
        if (disabled()) return true;
        const back = result.history === "undo" ? history.undo(stateNow()) : history.redo(stateNow());
        if (back) {
          draft = back.value;
          options.onChange(back.value);
          place(back.caret, back.anchor);
        }
        return true;
      }
      if (!result.state) return result.copy !== undefined;
      if (result.state.value !== valueNow() && disabled()) return true;
      apply(result.state, "other");
      return true;
    },
  };
  return editing;
}

/**
 * A caret that blinks while `active` (the widget focused), and shows at
 * once whenever `moved` changes, as the Mac's does after each key.
 */
export function createCaretBlink(active: () => boolean, moved: () => unknown, every = 530): Accessor<boolean> {
  const [on, setOn] = createSignal(true, { ownedWrite: true });
  createEffect(
    () => ({ active: active(), moved: moved() }),
    ({ active: focused }) => {
      setOn(true);
      if (!focused) return;
      const id = setInterval(() => setOn((v) => !v), every);
      return () => clearInterval(id);
    },
  );
  return on;
}
