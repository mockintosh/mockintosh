import { describe, expect, it } from "vitest";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { measureText } from "../src/fonts/bridge";

function mount(ui: ReturnType<typeof createUI>, view: () => unknown) {
  const dispose = ui.render(view as () => import("solid-js").JSX.Element);
  ui.frame();
  return dispose;
}

function copyKeys(ui: ReturnType<typeof createUI>) {
  ui.dispatchKeyboard("keydown", "c", { meta: true });
}

describe("text selectable", () => {
  it("schedules a host render when a drag changes the selection", () => {
    let scheduled = 0;
    const ui = createUI({
      screen: newBitMap(240, 80),
      scheduleRender: () => {
        scheduled += 1;
      },
    });
    const dispose = ui.render(() => (
      <box width={220}>
        <text wrap selectable>
          You: hello there
        </text>
      </box>
    ));
    ui.frame();
    scheduled = 0;
    ui.dispatchPointer("mousedown", 12, 6);
    ui.dispatchPointer("mousemove", 80, 6);
    expect(scheduled).toBeGreaterThan(0);
    dispose();
  });

  it("copies a drag selection and ⌘A from a wrapped host text node", () => {
    const copied: string[] = [];
    const ui = createUI({
      screen: newBitMap(240, 80),
      services: { clipboard: { readText: async () => "", writeText: async (text) => { copied.push(text); } } },
    });
    const dispose = ui.render(() => (
      <box width={220}>
        <text wrap selectable semantic={{ name: "chat-user" }}>
          You: hello there
        </text>
      </box>
    ));
    ui.frame();
    const node = ui.inspect().find((n) => n.name === "chat-user");
    expect(node).toBeTruthy();
    const { x, y } = node!.bounds;
    ui.dispatchPointer("mousedown", x + 2, y + 2);
    ui.dispatchPointer("mousemove", x + 80, y + 2);
    ui.dispatchPointer("mouseup", x + 80, y + 2);
    ui.dispatchKeyboard("keydown", "c", { meta: true });
    expect(copied.at(-1)).toBeTruthy();
    expect("You: hello there".startsWith(copied.at(-1)!)).toBe(true);

    ui.dispatchKeyboard("keydown", "a", { meta: true });
    ui.dispatchKeyboard("keydown", "c", { meta: true });
    expect(copied.at(-1)).toBe("You: hello there");
    dispose();
  });

  it("replaces the previous selection when a second node is selected", () => {
    const copied: string[] = [];
    const ui = createUI({
      screen: newBitMap(240, 80),
      services: { clipboard: { readText: async () => "", writeText: async (text) => { copied.push(text); } } },
    });
    const dispose = mount(ui, () => (
      <box width={220} flexDirection="column" gap={4}>
        <text wrap selectable semantic={{ name: "a" }}>alpha</text>
        <text wrap selectable semantic={{ name: "b" }}>bravo</text>
      </box>
    ));
    const a = ui.inspect().find((n) => n.name === "a")!.bounds;
    const b = ui.inspect().find((n) => n.name === "b")!.bounds;
    ui.dispatchPointer("mousedown", a.x + 2, a.y + 2);
    ui.dispatchKeyboard("keydown", "a", { meta: true });
    copyKeys(ui);
    expect(copied.at(-1)).toBe("alpha\nbravo");

    ui.dispatchPointer("mousedown", b.x + 2, b.y + 2);
    ui.dispatchPointer("mousemove", b.x + 40, b.y + 2);
    ui.dispatchPointer("mouseup", b.x + 40, b.y + 2);
    copyKeys(ui);
    expect(copied.at(-1)).toBe("bravo");
    expect(copied.at(-1)).not.toContain("alpha");
    dispose();
  });

  it("selects across sibling text nodes in one drag", () => {
    const copied: string[] = [];
    const ui = createUI({
      screen: newBitMap(240, 80),
      services: { clipboard: { readText: async () => "", writeText: async (text) => { copied.push(text); } } },
    });
    const dispose = mount(ui, () => (
      <box width={220} flexDirection="column" gap={4}>
        <text wrap selectable semantic={{ name: "a" }}>alpha</text>
        <text wrap selectable semantic={{ name: "b" }}>bravo</text>
      </box>
    ));
    const a = ui.inspect().find((n) => n.name === "a")!.bounds;
    const b = ui.inspect().find((n) => n.name === "b")!.bounds;
    ui.dispatchPointer("mousedown", a.x + 1, a.y + 2);
    ui.dispatchPointer("mousemove", b.x + Math.max(2, b.width - 2), b.y + 2);
    ui.dispatchPointer("mouseup", b.x + Math.max(2, b.width - 2), b.y + 2);
    copyKeys(ui);
    expect(copied.at(-1)).toBe("alpha\nbravo");
    dispose();
  });

  /** Like the web host: every press is a mousedown, the second also a dblclick. */
  function clicks(ui: ReturnType<typeof createUI>, x: number, y: number, count: number) {
    for (let i = 1; i <= count; i++) {
      ui.dispatchPointer("mousedown", x, y);
      if (i === 2) ui.dispatchPointer("dblclick", x, y);
      ui.dispatchPointer("mouseup", x, y);
    }
  }

  function twoParagraphs() {
    const copied: string[] = [];
    const ui = createUI({
      screen: newBitMap(240, 80),
      services: { clipboard: { readText: async () => "", writeText: async (text) => { copied.push(text); } } },
    });
    const dispose = mount(ui, () => (
      <box width={220} flexDirection="column" gap={4}>
        <text selectable semantic={{ name: "a" }}>see foo.bar now</text>
        <text selectable semantic={{ name: "b" }}>next line</text>
      </box>
    ));
    const a = ui.inspect().find((n) => n.name === "a")!.bounds;
    const b = ui.inspect().find((n) => n.name === "b")!.bounds;
    const xOf = (prefix: string) => a.x + measureText(prefix) + 1;
    return { ui, copied, dispose, a, b, xOf };
  }

  it("selects the word under a double-click", () => {
    const { ui, copied, dispose, a, xOf } = twoParagraphs();
    clicks(ui, xOf("see f"), a.y + 4, 2);
    copyKeys(ui);
    expect(copied.at(-1)).toBe("foo");
    dispose();
  });

  it("selects the paragraph under a triple-click", () => {
    const { ui, copied, dispose, a, xOf } = twoParagraphs();
    clicks(ui, xOf("see f"), a.y + 4, 3);
    copyKeys(ui);
    expect(copied.at(-1)).toBe("see foo.bar now");
    dispose();
  });

  it("keeps the double-clicked word when dragging into the next node", () => {
    const { ui, copied, dispose, a, b, xOf } = twoParagraphs();
    clicks(ui, xOf("see f"), a.y + 4, 1);
    ui.dispatchPointer("mousedown", xOf("see f"), a.y + 4);
    ui.dispatchPointer("dblclick", xOf("see f"), a.y + 4);
    ui.dispatchPointer("mousemove", b.x + measureText("ne") + 1, b.y + 4);
    ui.dispatchPointer("mouseup", b.x + measureText("ne") + 1, b.y + 4);
    copyKeys(ui);
    expect(copied.at(-1)).toBe("foo.bar now\nne");
    dispose();
  });
});
