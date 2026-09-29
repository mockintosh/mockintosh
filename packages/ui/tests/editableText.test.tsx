import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { newBitMap, pixelsFromBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { EditableText } from "../src/widgets/EditableText";
import { requireFont } from "../src/fonts/registry";
import { caretPoint, indexAtPoint, layoutText } from "../src/fonts/textLayout";
import type { TextAlign } from "../src/nodes";

const W = 120;
const H = 60;
const TEXT = "The quick brown fox jumps over the lazy dog";

async function settle(ui: ReturnType<typeof createUI>): Promise<void> {
  ui.frame();
  await Promise.resolve();
  ui.frame();
}

function displayPixels(align: TextAlign, text: string): Uint8Array {
  const screen = newBitMap(W, H);
  const ui = createUI({ screen });
  const dispose = ui.render(() => (
    <box width={W} height={H} overflow="hidden">
      <text font="body" align={align} wrap>{text}</text>
    </box>
  ));
  ui.frame();
  const pixels = pixelsFromBitMap(screen);
  dispose();
  return pixels;
}

async function editorPixels(
  align: TextAlign,
  text: string,
  focus: boolean,
): Promise<{ pixels: Uint8Array; ui: ReturnType<typeof createUI>; value: () => string; dispose: () => void }> {
  const screen = newBitMap(W, H);
  const ui = createUI({ screen });
  const [value, setValue] = createSignal(text);
  const dispose = ui.render(() => (
    <EditableText
      name="edit"
      value={value()}
      onChange={setValue}
      font="body"
      align={align}
      width={W}
      height={H}
      autoFocus={focus}
    />
  ));
  await settle(ui);
  return { pixels: pixelsFromBitMap(screen), ui, value, dispose };
}

describe("EditableText", () => {
  for (const align of ["left", "center", "right"] as const) {
    it(`paints ${align}-aligned wrapped text exactly where <text> does`, async () => {
      const shown = displayPixels(align, TEXT);
      expect(shown.includes(1)).toBe(true);
      const { pixels, dispose } = await editorPixels(align, TEXT, false);
      expect(Array.from(pixels)).toEqual(Array.from(shown));
      dispose();
    });
  }

  it("draws a one-line caret and leaves every glyph where it was", async () => {
    const shown = displayPixels("left", TEXT);
    const { pixels, dispose } = await editorPixels("left", TEXT, true);
    const font = requireFont("body");
    const block = layoutText(font, TEXT, W);
    const changed: { x: number; y: number }[] = [];
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] !== shown[i]) changed.push({ x: i % W, y: Math.floor(i / W) });
    }
    const at = caretPoint(block, font, TEXT.length, "left", W);
    expect(changed.length).toBeGreaterThan(0);
    expect(new Set(changed.map((p) => p.x)).size).toBe(1);
    expect(changed[0]!.x).toBe(at.x - 1);
    for (const p of changed) {
      expect(p.y).toBeGreaterThanOrEqual(at.y);
      expect(p.y).toBeLessThan(at.y + block.lastLineHeight);
    }
    dispose();
  });

  it("types at the caret, breaks lines on Return, and clicks land on aligned lines", async () => {
    const { ui, value, dispose } = await editorPixels("center", "ab", true);
    ui.dispatchKeyboard("keydown", "Enter");
    for (const ch of "cd") {
      ui.dispatchKeyboard("keydown", ch);
      ui.dispatchKeyboard("keypress", ch);
    }
    expect(value()).toBe("ab\ncd");

    const font = requireFont("body");
    const block = layoutText(font, value(), W);
    const start = caretPoint(block, font, 3, "center", W);
    ui.frame();
    ui.dispatchPointer("mousedown", start.x, start.y + 2);
    ui.dispatchPointer("mouseup", start.x, start.y + 2);
    ui.dispatchKeyboard("keydown", "x");
    ui.dispatchKeyboard("keypress", "x");
    expect(value()).toBe("ab\nxcd");
    expect(indexAtPoint(block, font, start.x, start.y, "center", W)).toBe(3);
    dispose();
  });

  it("moves between wrapped lines with the arrow keys", async () => {
    const { ui, value, dispose } = await editorPixels("left", TEXT, true);
    ui.dispatchKeyboard("keydown", "ArrowUp");
    ui.dispatchKeyboard("keydown", "ArrowUp");
    ui.dispatchKeyboard("keydown", "ArrowUp");
    ui.dispatchKeyboard("keydown", "ArrowUp");
    ui.dispatchKeyboard("keydown", "Home");
    ui.dispatchKeyboard("keydown", "!");
    ui.dispatchKeyboard("keypress", "!");
    expect(value()).toBe(`!${TEXT}`);
    dispose();
  });
});
