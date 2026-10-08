import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { RichTextEditor } from "../src/widgets/RichTextEditor";
import { applyMarkdownEdit, type MarkdownEdit } from "../src/widgets/markdownEdits";

/** `value` with `[` and `]` marking the selection, as the cases below write it. */
function marked(value: string): { value: string; start: number; end: number } {
  const start = value.indexOf("[");
  const end = value.indexOf("]") - 1;
  return { value: value.replace("[", "").replace("]", ""), start, end };
}

function show({ value, start, end }: { value: string; start: number; end: number }): string {
  return `${value.slice(0, start)}[${value.slice(start, end)}]${value.slice(end)}`;
}

describe("applyMarkdownEdit", () => {
  const cases: Array<[MarkdownEdit, string, string]> = [
    ["bold", "a [word] here", "a **[word]** here"],
    ["bold", "a **[word]** here", "a [word] here"],
    ["bold", "caret[]", "caret**[]**"],
    ["italic", "[word]", "_[word]_"],
    ["code", "run [ls]", "run `[ls]`"],
    ["code", "[one\ntwo]", "```\n[one\ntwo]\n```"],
    ["link", "see [docs]", "see [docs]([url])"],
    ["heading", "Ti[]tle", "### Ti[]tle"],
    ["heading", "### Ti[]tle", "Ti[]tle"],
    ["quote", "[one\ntwo]", "[> one\n> two]"],
    ["bullets", "[one\ntwo]", "[- one\n- two]"],
    ["numbers", "[one\ntwo\nthree]", "[1. one\n2. two\n3. three]"],
    ["numbers", "[1. one\n2. two]", "[one\ntwo]"],
  ];
  for (const [edit, before, after] of cases) {
    it(`${edit}: ${JSON.stringify(before)}`, () => {
      expect(show(applyMarkdownEdit(edit, marked(before)))).toBe(after);
    });
  }
});

describe("RichTextEditor", () => {
  async function settle(ui: ReturnType<typeof createUI>): Promise<void> {
    for (let i = 0; i < 4; i++) {
      ui.frame();
      await Promise.resolve();
    }
    ui.frame();
  }

  function click(ui: ReturnType<typeof createUI>, name: string): void {
    const node = ui.inspect().find((n) => n.name === name);
    expect(node, name).toBeDefined();
    const { x, y, width, height } = node!.bounds;
    ui.dispatchPointer("mousedown", x + Math.floor(width / 2), y + Math.floor(height / 2));
    ui.dispatchPointer("mouseup", x + Math.floor(width / 2), y + Math.floor(height / 2));
  }

  it("marks up what's selected from its toolbar, and shows it formatted under Preview", async () => {
    const ui = createUI({ screen: newBitMap(360, 220) });
    const [value, setValue] = createSignal("make this loud");
    ui.render(() => (
      <box padding={4}>
        <RichTextEditor
          name="body"
          value={value()}
          onChange={setValue}
          width={340}
          height={120}
          preview={(text) => <text semantic={{ name: "rendered", value: text }} font="body">{text.replace(/\*\*/g, "")}</text>}
        />
      </box>
    ));
    await settle(ui);
    // Select "loud" with a double-click, then Bold.
    const box = ui.inspect().find((n) => n.name === "body" && n.role === "textbox")!;
    const loud = box.bounds.x + 4 + 12 * 6;
    for (let press = 0; press < 2; press++) {
      ui.dispatchPointer("mousedown", loud, box.bounds.y + 8);
      ui.dispatchPointer("mouseup", loud, box.bounds.y + 8);
    }
    ui.dispatchPointer("dblclick", loud, box.bounds.y + 8);
    await settle(ui);
    click(ui, "body:bold");
    await settle(ui);
    expect(value()).toBe("make this **loud**");

    click(ui, "body:tabs:preview");
    await settle(ui);
    expect(ui.inspect().find((n) => n.name === "rendered")?.value).toBe("make this **loud**");
    expect(ui.inspect().some((n) => n.name === "body:bold")).toBe(false);

    click(ui, "body:tabs:write");
    await settle(ui);
    expect(ui.inspect().find((n) => n.name === "body" && n.role === "textbox")?.value).toBe("make this **loud**");
  });

  it("has no Preview tab without a way to draw one", async () => {
    const ui = createUI({ screen: newBitMap(360, 220) });
    ui.render(() => <RichTextEditor name="body" value="" onChange={() => {}} width={340} height={120} />);
    await settle(ui);
    expect(ui.inspect().some((n) => n.name === "body:tabs:preview")).toBe(false);
    expect(ui.inspect().some((n) => n.name === "body:bold")).toBe(true);
  });
});
