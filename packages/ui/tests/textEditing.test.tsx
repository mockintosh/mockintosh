import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { noteModifiers } from "../src/modifiers";
import { createTextHistory, editingKey, type TextEditState, type TextLines } from "../src/textEditing";
import { EditableText } from "../src/widgets/EditableText";
import { TextEditor } from "../src/widgets/TextEditor";
import { TextInput } from "../src/widgets/TextInput";

const NONE = { shift: false, ctrl: false, alt: false, meta: false };
const SHIFT = { ...NONE, shift: true };
const ALT = { ...NONE, alt: true };
const CMD = { ...NONE, meta: true };

/** `value` with `|` for a caret, or `[` and `]` for a selection whose caret is at `]`. */
function at(text: string): TextEditState {
  if (text.includes("|")) {
    const caret = text.indexOf("|");
    return { value: text.replace("|", ""), anchor: caret, caret };
  }
  const anchor = text.indexOf("[");
  const caret = text.indexOf("]") - 1;
  return { value: text.replace("[", "").replace("]", ""), anchor, caret };
}

function show(state: TextEditState): string {
  if (state.anchor === state.caret) return `${state.value.slice(0, state.caret)}|${state.value.slice(state.caret)}`;
  const lo = Math.min(state.anchor, state.caret);
  const hi = Math.max(state.anchor, state.caret);
  return `${state.value.slice(0, lo)}[${state.value.slice(lo, hi)}]${state.value.slice(hi)}`;
}

/** Lines split at line breaks, ↑ ↓ keeping the column. */
function plainLines(value: string): TextLines {
  const starts = [0];
  for (let i = 0; i < value.length; i++) if (value[i] === "\n") starts.push(i + 1);
  const rowOf = (index: number) => starts.filter((start) => start <= index).length - 1;
  const endOf = (row: number) => (row + 1 < starts.length ? starts[row + 1]! - 1 : value.length);
  return {
    lineAt: (index) => ({ start: starts[rowOf(index)]!, end: endOf(rowOf(index)) }),
    vertical: (index, rows) => {
      const row = rowOf(index) + rows;
      if (row < 0) return 0;
      if (row >= starts.length) return value.length;
      return Math.min(starts[row]! + index - starts[rowOf(index)]!, endOf(row));
    },
  };
}

describe("editingKey", () => {
  const cases: Array<[string, string, typeof NONE, string]> = [
    ["ArrowLeft", "ab|c", NONE, "a|bc"],
    ["ArrowLeft", "a[bc]", NONE, "a|bc"],
    ["ArrowRight", "[ab]c", NONE, "ab|c"],
    ["ArrowLeft", "ab|c", SHIFT, "a[b]c"],
    ["ArrowLeft", "one two thr|ee", ALT, "one two |three"],
    ["ArrowLeft", "one two |three", ALT, "one |two three"],
    ["ArrowRight", "one| two three", ALT, "one two| three"],
    ["ArrowLeft", "one\ntwo th|ree", CMD, "one\n|two three"],
    ["ArrowRight", "one\ntwo| three\nfour", CMD, "one\ntwo three|\nfour"],
    ["ArrowUp", "one\ntwo|", CMD, "|one\ntwo"],
    ["ArrowDown", "o|ne\ntwo", CMD, "one\ntwo|"],
    ["ArrowUp", "one\ntw|o", NONE, "on|e\ntwo"],
    ["ArrowDown", "o|ne\ntwo", SHIFT, "o[ne\nt]wo"],
    ["Home", "one\ntw|o", NONE, "one\n|two"],
    ["End", "o|ne\ntwo", NONE, "one|\ntwo"],
    ["Backspace", "ab|c", NONE, "a|c"],
    ["Backspace", "|abc", NONE, "|abc"],
    ["Backspace", "a[bc]", NONE, "a|"],
    ["Backspace", "one two|", ALT, "one |"],
    ["Backspace", "one\ntwo thr|ee", CMD, "one\n|ee"],
    ["Delete", "a|bc", NONE, "a|c"],
    ["Delete", "one| two three", ALT, "one| three"],
    ["a", "a|bc", CMD, "[abc]"],
  ];
  for (const [key, before, mods, after] of cases) {
    const name = `${Object.entries(mods).filter(([, on]) => on).map(([k]) => k).join("+") || "plain"} ${key}`;
    it(`${name}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`, () => {
      const state = at(before);
      const result = editingKey(state, key, mods, plainLines(state.value));
      expect(show(result.state ?? state)).toBe(after);
    });
  }

  it("takes ↑ and ↓ to a one-line field's ends", () => {
    expect(show(editingKey(at("ab|c"), "ArrowUp", NONE).state!)).toBe("|abc");
    expect(show(editingKey(at("a|bc"), "ArrowDown", NONE).state!)).toBe("abc|");
  });

  it("copies and cuts the selection, and asks for undo and redo", () => {
    expect(editingKey(at("a[bc]"), "c", CMD)).toEqual({ copy: "bc" });
    const cut = editingKey(at("a[bc]"), "x", CMD);
    expect([cut.copy, show(cut.state!)]).toEqual(["bc", "a|"]);
    expect(editingKey(at("a|"), "z", CMD)).toEqual({ history: "undo" });
    expect(editingKey(at("a|"), "z", { ...CMD, shift: true })).toEqual({ history: "redo" });
    expect(editingKey(at("a|"), "Enter", NONE)).toEqual({});
  });
});

describe("createTextHistory", () => {
  it("undoes a run of typing in one step, and other edits each in one", () => {
    const history = createTextHistory();
    history.record(at("|"), "typing");
    history.record(at("a|"), "typing");
    history.record(at("ab|"), "other");
    expect(show(history.undo(at("|"))!)).toBe("ab|");
    expect(show(history.undo(at("ab|"))!)).toBe("|");
    expect(history.undo(at("|"))).toBeNull();
    expect(show(history.redo(at("|"))!)).toBe("ab|");
  });

  it("starts a new step for typing after the caret moved", () => {
    const history = createTextHistory();
    history.record(at("|"), "typing");
    history.breakTyping();
    history.record(at("a|"), "typing");
    expect(show(history.undo(at("ab|"))!)).toBe("a|");
  });
});

/** The keys every text widget now shares, pressed in each widget. */
describe("text widgets share their editing", () => {
  type Mount = (value: () => string, setValue: (value: string) => void) => unknown;
  const widgets: Array<[string, Mount]> = [
    ["TextInput", (value, setValue) => <TextInput name="edit" value={value()} onChange={setValue} width={180} autoFocus />],
    ["EditableText", (value, setValue) => <EditableText name="edit" value={value()} onChange={setValue} width={180} height={60} autoFocus />],
    ["TextEditor", (value, setValue) => <TextEditor name="edit" value={value()} onChange={setValue} width={180} height={60} />],
  ];

  async function setup(mount: Mount, initial: string) {
    const ui = createUI({ screen: newBitMap(200, 80) });
    const [value, setValue] = createSignal(initial);
    ui.render(() => mount(value, setValue) as never);
    for (let i = 0; i < 3; i++) {
      ui.frame();
      await Promise.resolve();
    }
    // Focus it with a click at its far end, past the text: the caret goes to the end.
    const box = ui.inspect().find((n) => n.name === "edit")!;
    ui.dispatchPointer("mousedown", box.bounds.x + box.bounds.width - 4, box.bounds.y + box.bounds.height - 4);
    ui.dispatchPointer("mouseup", box.bounds.x + box.bounds.width - 4, box.bounds.y + box.bounds.height - 4);
    ui.frame();
    const press = (key: string, mods = NONE) => {
      ui.dispatchKeyboard("keydown", key, mods);
      if (key.length === 1 && !mods.meta && !mods.ctrl) ui.dispatchKeyboard("keypress", key, mods);
      ui.frame();
    };
    return { ui, value, press };
  }

  for (const [name, mount] of widgets) {
    it(`${name}: words, lines, undo and redo`, async () => {
      const { value, press } = await setup(mount, "one two");
      press("Backspace", ALT);
      expect(value()).toBe("one ");
      for (const ch of "six") press(ch);
      expect(value()).toBe("one six");
      press("z", CMD);
      expect(value()).toBe("one ");
      press("z", CMD);
      expect(value()).toBe("one two");
      press("z", { ...CMD, shift: true });
      expect(value()).toBe("one ");
      // "one |": back past the space, select the word, cut it.
      press("ArrowLeft");
      press("ArrowLeft", { ...ALT, shift: true });
      press("x", CMD);
      expect(value()).toBe(" ");
      press("ArrowRight", CMD);
      press("Backspace", CMD);
      expect(value()).toBe("");
    });
  }

  it("extends a TextEditor's selection with a ⇧-click", async () => {
    const { ui, value, press } = await setup(widgets[2]![1], "alpha beta gamma");
    press("ArrowUp", CMD);
    const box = ui.inspect().find((n) => n.name === "edit")!;
    noteModifiers(SHIFT);
    ui.dispatchPointer("mousedown", box.bounds.x + box.bounds.width - 4, box.bounds.y + 6);
    ui.dispatchPointer("mouseup", box.bounds.x + box.bounds.width - 4, box.bounds.y + 6);
    noteModifiers(NONE);
    press("x");
    expect(value()).toBe("x");
  });

  it("scrolls a TextEditor to keep the caret in view, and back", async () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const { ui, press } = await setup(widgets[2]![1], long);
    const shown = () => ui.inspect().filter((n) => n.text.startsWith("line ")).map((n) => n.text);
    expect(shown()).toContain("line 20");
    expect(shown()).not.toContain("line 1");
    press("ArrowUp", CMD);
    expect(shown()).toContain("line 1");
    expect(shown()).not.toContain("line 20");
  });
});
