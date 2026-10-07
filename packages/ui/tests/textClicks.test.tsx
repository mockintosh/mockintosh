import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { EditableText } from "../src/widgets/EditableText";
import { TextEditor } from "../src/widgets/TextEditor";
import { requireFont } from "../src/fonts/registry";
import { measureText } from "../src/fonts/bridge";
import { caretPoint, layoutText } from "../src/fonts/textLayout";
import { paragraphRangeAt, wordRangeAt } from "../src/textClicks";

const W = 200;
const H = 80;
const TEXT = "first line\nhello brave world\nlast";

type UI = ReturnType<typeof createUI>;

function type(ui: UI, text: string) {
  for (const ch of text) {
    ui.dispatchKeyboard("keydown", ch);
    ui.dispatchKeyboard("keypress", ch);
  }
}

/** Like the web host: every press is a mousedown, the second also a dblclick. */
function click(ui: UI, p: { x: number; y: number }, count: number) {
  for (let i = 1; i <= count; i++) {
    ui.dispatchPointer("mousedown", p.x, p.y);
    if (i === 2) ui.dispatchPointer("dblclick", p.x, p.y);
    ui.dispatchPointer("mouseup", p.x, p.y);
    ui.frame();
  }
}

async function mount(ui: UI) {
  ui.frame();
  await Promise.resolve();
  ui.frame();
}

async function editableText() {
  const ui = createUI({ screen: newBitMap(W, H) });
  const [value, setValue] = createSignal(TEXT);
  const dispose = ui.render(() => (
    <EditableText name="edit" value={value()} onChange={setValue} font="body" width={W} height={H} autoFocus />
  ));
  await mount(ui);
  const font = requireFont("body");
  const at = (index: number) => {
    const p = caretPoint(layoutText(font, TEXT, W), font, index, "left", W);
    return { x: p.x + 1, y: p.y + 2 };
  };
  return { ui, value, dispose, at };
}

async function textEditor() {
  const ui = createUI({ screen: newBitMap(W, H) });
  const [value, setValue] = createSignal(TEXT);
  const dispose = ui.render(() => <TextEditor name="edit" value={value()} onChange={setValue} width={W} height={H} />);
  await mount(ui);
  const charWidth = measureText("M", "mono");
  // Index → a point inside that character's cell (4px inset, 14px rows).
  const at = (index: number) => {
    const before = TEXT.slice(0, index).split("\n");
    return { x: 4 + (before[before.length - 1]!.length + 0.3) * charWidth, y: 4 + (before.length - 1) * 14 + 7 };
  };
  return { ui, value, dispose, at };
}

describe("text click ranges", () => {
  it("takes a word, a run of spaces, or one punctuation mark", () => {
    expect(wordRangeAt("see foo.bar now", 5)).toEqual({ start: 4, end: 7 });
    expect(wordRangeAt("see foo.bar now", 7)).toEqual({ start: 7, end: 8 });
    expect(wordRangeAt("a   b", 2)).toEqual({ start: 1, end: 4 });
    expect(wordRangeAt("don't stop", 2)).toEqual({ start: 0, end: 5 });
    expect(wordRangeAt("end", 3)).toEqual({ start: 0, end: 3 });
    expect(wordRangeAt("", 0)).toEqual({ start: 0, end: 0 });
  });

  it("takes the paragraph between line breaks", () => {
    expect(paragraphRangeAt(TEXT, 14)).toEqual({ start: 11, end: 28 });
    expect(paragraphRangeAt(TEXT, 0)).toEqual({ start: 0, end: 10 });
    expect(paragraphRangeAt(TEXT, TEXT.length)).toEqual({ start: 29, end: TEXT.length });
  });
});

for (const [name, setup] of [["EditableText", editableText], ["TextEditor", textEditor]] as const) {
  describe(`${name} clicks`, () => {
    it("selects the word under a double-click", async () => {
      const { ui, value, dispose, at } = await setup();
      click(ui, at(TEXT.indexOf("brave") + 2), 2);
      type(ui, "new");
      expect(value()).toBe("first line\nhello new world\nlast");
      dispose();
    });

    it("selects the paragraph under a triple-click", async () => {
      const { ui, value, dispose, at } = await setup();
      click(ui, at(TEXT.indexOf("brave") + 2), 3);
      type(ui, "x");
      expect(value()).toBe("first line\nx\nlast");
      dispose();
    });

    it("still places the caret on a single click", async () => {
      const { ui, value, dispose, at } = await setup();
      click(ui, at(TEXT.indexOf("brave")), 1);
      type(ui, "x");
      expect(value()).toBe("first line\nhello xbrave world\nlast");
      dispose();
    });
  });
}
