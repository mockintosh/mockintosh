import { createComponent, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { newBitMap, pixelsFromBitMap } from "@mockintosh/quickdraw/bits";
import { TextInput } from "../src/widgets/TextInput";
import { measureText } from "../src/fonts/bridge";
import { createUI } from "../src/ui";

function type(ui: ReturnType<typeof createUI>, text: string) {
  for (const ch of text) {
    ui.dispatchKeyboard("keydown", ch);
    ui.dispatchKeyboard("keypress", ch);
  }
}

function backspace(ui: ReturnType<typeof createUI>) {
  ui.dispatchKeyboard("keydown", "Backspace");
}

function draftValue(ui: ReturnType<typeof createUI>): string | undefined {
  return ui.inspect().find((node) => node.name === "draft")?.value;
}

describe("TextInput", () => {
  it("deletes after the parent clears the value", async () => {
    const ui = createUI({ screen: newBitMap(200, 40) });
    const [value, setValue] = createSignal("");
    const dispose = ui.render(() =>
      createComponent(TextInput, {
        name: "draft",
        get value() { return value(); },
        onChange: setValue,
        autoFocus: true,
        width: 180,
      }),
    );
    ui.frame();
    await Promise.resolve();
    ui.frame();

    type(ui, "hello");
    expect(value()).toBe("hello");

    // ChatGippity send(): same mounted field, value wiped from outside.
    setValue("");
    type(ui, "ab");
    backspace(ui);

    expect(value()).toBe("a");
    expect(draftValue(ui)).toBe("a");
    dispose();
  });

  it("clips glyphs to the field instead of painting past the border", async () => {
    const W = 80;
    const H = 24;
    const fieldW = 32;
    const screen = newBitMap(W, H);
    const ui = createUI({ screen });
    const [value, setValue] = createSignal("");
    const dispose = ui.render(() =>
      createComponent(TextInput, {
        name: "draft",
        get value() { return value(); },
        onChange: setValue,
        autoFocus: true,
        width: fieldW,
      }),
    );
    ui.frame();
    await Promise.resolve();
    ui.frame();

    type(ui, "WWWWWWWWWWWWWWWW");
    ui.frame();

    const pixels = pixelsFromBitMap(screen);
    expect(pixels[fieldW - 1]).toBe(1);
    for (let y = 0; y < 16; y++) {
      expect(pixels[y * W + fieldW]).toBe(0);
    }
    dispose();
  });

  it("ignores typing past maxLength, but replaces a selection", async () => {
    const ui = createUI({ screen: newBitMap(200, 40) });
    const [value, setValue] = createSignal("");
    const dispose = ui.render(() =>
      createComponent(TextInput, {
        name: "draft",
        get value() { return value(); },
        onChange: setValue,
        autoFocus: true,
        maxLength: 5,
      }),
    );
    ui.frame();
    await Promise.resolve();
    ui.frame();

    type(ui, "abcdefg");
    expect(value()).toBe("abcde");

    ui.dispatchKeyboard("keydown", "a", { meta: true });
    type(ui, "xy");
    expect(value()).toBe("xy");
    dispose();
  });

  it("inverts every selected glyph when dragging backwards", async () => {
    const W = 200;
    const H = 24;
    const screen = newBitMap(W, H);
    const ui = createUI({ screen });
    const [value, setValue] = createSignal("");
    const dispose = ui.render(() =>
      createComponent(TextInput, {
        name: "draft",
        get value() { return value(); },
        onChange: setValue,
        autoFocus: true,
        width: 180,
      }),
    );
    ui.frame();
    await Promise.resolve();
    ui.frame();

    type(ui, "WWWW");
    ui.frame();

    const field = ui.inspect().find((node) => node.name === "draft");
    expect(field).toBeTruthy();
    const { x, y, height } = field!.bounds;
    const contentLeft = x + 5;
    const midY = y + Math.floor(height / 2);
    // Tick-by-tick so the overlay mounts on a 1-glyph range and must grow.
    ui.dispatchPointer("mousedown", contentLeft + measureText("WWWW") + 2, midY);
    ui.frame();
    ui.dispatchPointer("mousemove", contentLeft + measureText("WWW"), midY);
    ui.frame();
    ui.dispatchPointer("mousemove", contentLeft + measureText("WW"), midY);
    ui.frame();
    ui.dispatchPointer("mousemove", contentLeft + measureText("W"), midY);
    ui.frame();
    ui.dispatchPointer("mousemove", contentLeft, midY);
    ui.dispatchPointer("mouseup", contentLeft, midY);
    ui.frame();

    const pixels = pixelsFromBitMap(screen);
    const hasWhite = (gx: number): boolean => {
      for (let row = y + 3; row < y + height - 3; row++) {
        if (pixels[row * W + gx] === 0) return true;
      }
      return false;
    };
    const first = contentLeft + Math.floor(measureText("W") / 2);
    const last = contentLeft + measureText("WWW") + Math.floor(measureText("W") / 2);
    expect(hasWhite(first)).toBe(true);
    expect(hasWhite(last)).toBe(true);
    dispose();
  });

  it("blurs and stops accepting keys when the pointer lands outside", async () => {
    const ui = createUI({ screen: newBitMap(200, 40) });
    const [value, setValue] = createSignal("");
    const dispose = ui.render(() =>
      createComponent(TextInput, {
        name: "draft",
        get value() { return value(); },
        onChange: setValue,
        autoFocus: true,
        width: 80,
      }),
    );
    ui.frame();
    await Promise.resolve();
    ui.frame();

    type(ui, "hi");
    expect(value()).toBe("hi");
    expect(ui.inspect().find((node) => node.name === "draft")?.focused).toBe(true);

    ui.dispatchPointer("mousedown", 180, 20);
    ui.dispatchPointer("mouseup", 180, 20);
    ui.frame();

    expect(ui.inspect().find((node) => node.name === "draft")?.focused).toBe(false);
    type(ui, "x");
    expect(value()).toBe("hi");
    dispose();
  });

  async function mountWithText(text: string) {
    const ui = createUI({ screen: newBitMap(200, 40) });
    const [value, setValue] = createSignal("");
    const dispose = ui.render(() =>
      createComponent(TextInput, {
        name: "draft",
        get value() { return value(); },
        onChange: setValue,
        autoFocus: true,
        width: 180,
      }),
    );
    ui.frame();
    await Promise.resolve();
    ui.frame();
    type(ui, text);
    const { x, y, height } = ui.inspect().find((node) => node.name === "draft")!.bounds;
    const at = (prefix: string) => ({ x: x + 5 + measureText(prefix) + 1, y: y + Math.floor(height / 2) });
    // Like the web host: every press is a mousedown, the second also a dblclick.
    const click = (p: { x: number; y: number }, count: number) => {
      for (let i = 1; i <= count; i++) {
        ui.dispatchPointer("mousedown", p.x, p.y);
        if (i === 2) ui.dispatchPointer("dblclick", p.x, p.y);
        ui.dispatchPointer("mouseup", p.x, p.y);
        ui.frame();
      }
    };
    return { ui, value, dispose, at, click };
  }

  it("selects the word under a double-click", async () => {
    const { ui, value, dispose, at, click } = await mountWithText("hello brave world");
    click(at("hello br"), 2);
    type(ui, "new");
    expect(value()).toBe("hello new world");
    dispose();
  });

  it("selects only the word, not surrounding punctuation", async () => {
    const { ui, value, dispose, at, click } = await mountWithText("see foo.bar now");
    click(at("see f"), 2);
    type(ui, "x");
    expect(value()).toBe("see x.bar now");
    dispose();
  });

  it("selects everything on a triple-click", async () => {
    const { ui, value, dispose, at, click } = await mountWithText("hello brave world");
    click(at("hello br"), 3);
    type(ui, "x");
    expect(value()).toBe("x");
    dispose();
  });
});
