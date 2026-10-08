import { describe, expect, it } from "vitest";
import { newBitMap, pixelsFromBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { cursorAt } from "../src/cursor";
import { layoutRuns, runAtPoint } from "../src/fonts/runLayout";
import { measureText } from "../src/fonts/bridge";
import type { TextRun } from "../src/nodes";
import { requireFont } from "../src/fonts/registry";
import { faceMetrics } from "../src/fonts/metrics";
import { underlineRow, underlineSpans } from "../src/fonts/underline";

const FACE = { fontName: "body", size: undefined, style: {} };
const W = 160;
const H = 60;

function paint(view: () => unknown): Uint8Array {
  const screen = newBitMap(W, H);
  const ui = createUI({ screen });
  const dispose = ui.render(view as () => import("solid-js").JSX.Element);
  ui.frame();
  const pixels = pixelsFromBitMap(screen);
  dispose();
  return pixels;
}

describe("layoutRuns", () => {
  it("wraps across runs and keeps touching words together", () => {
    const runs: TextRun[] = [
      { text: "Read the " },
      { text: "manual", onClick: () => {} },
      { text: ", then try again later." },
    ];
    const width = measureText("Read the manual") + 2;
    const block = layoutRuns(FACE, runs, width);
    const lines = block.lines.map((line) => line.fragments.map((f) => f.text).join(""));
    expect(lines[0]).toBe("Read the");
    expect(lines[1]!.startsWith("manual,")).toBe(true);
    expect(block.lines[1]!.fragments[0]).toMatchObject({ run: 1, text: "manual", x: 0 });
  });

  it("collapses spaces and never starts a line with one", () => {
    const block = layoutRuns(FACE, [{ text: "  a   b  " }]);
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]!.fragments[0]!.text).toBe("a b");
  });

  it("breaks explicit newlines and over-long words", () => {
    const block = layoutRuns(FACE, [{ text: "one\nabcdefghijklmnop" }], measureText("abcde"));
    expect(block.lines[0]!.fragments[0]!.text).toBe("one");
    expect(block.lines.length).toBeGreaterThan(2);
    for (const line of block.lines) expect(line.width).toBeLessThanOrEqual(measureText("abcde"));
  });

  it("finds the run under a point", () => {
    const block = layoutRuns(FACE, [{ text: "go " }, { text: "here" }]);
    const hereX = measureText("go ") + 1;
    expect(runAtPoint(block, 1, 2, "left", 200)).toBe(0);
    expect(runAtPoint(block, hereX, 2, "left", 200)).toBe(1);
    expect(runAtPoint(block, 199, 2, "left", 200)).toBe(-1);
  });
});

describe("<text runs>", () => {
  it("paints a plain run exactly like the same text as children", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const plain = paint(() => <box width={W}><text wrap>{text}</text></box>);
    const runs = paint(() => <box width={W}><text wrap runs={[{ text }]} /></box>);
    expect(runs).toEqual(plain);
  });

  it("paints bold and underline runs differently from plain ones", () => {
    const plain = paint(() => <text runs={[{ text: "word" }]} />);
    const bold = paint(() => <text runs={[{ text: "word", bold: true }]} />);
    const underlined = paint(() => <text runs={[{ text: "word", underline: true }]} />);
    expect(bold).not.toEqual(plain);
    expect(underlined).not.toEqual(plain);
  });

  it("underlines one row below the cap baseline, inside the cell, and breaks around descenders", () => {
    const font = requireFont("body");
    const row = underlineRow(font);
    expect(row).toBe(faceMetrics(font).capAscent + 1);
    expect(row).toBeLessThan(font.glyphHeight);

    const pixels = paint(() => <text runs={[{ text: "Hi gap", underline: true }]} />);
    const inked = (x: number) => pixels[row * W + x] === 1;
    const width = measureText("Hi gap");
    const spans = underlineSpans(font, "Hi gap");
    expect(spans.length).toBeGreaterThan(1);
    for (let x = 0; x < width; x++) {
      const covered = spans.some((span) => x >= span.left && x < span.right);
      if (covered) expect(inked(x), `x=${x}`).toBe(true);
    }
    expect(inked(spans[0]!.right)).toBe(false);
  });

  it("clicks the run under the pointer and shows the pointer cursor over links", () => {
    const clicks: string[] = [];
    const screen = newBitMap(W, H);
    const ui = createUI({ screen });
    const dispose = ui.render(() => (
      <box width={W}>
        <text runs={[{ text: "see " }, { text: "docs", underline: true, onClick: () => clicks.push("docs") }]} />
      </box>
    ));
    ui.frame();
    const linkX = measureText("see ") + 2;
    ui.dispatchPointer("mousemove", linkX, 4);
    expect(cursorAt(ui.root, linkX, 4)).toBe("pointer");
    ui.dispatchPointer("mousedown", linkX, 4);
    ui.dispatchPointer("mouseup", linkX, 4);
    ui.dispatchPointer("mousemove", 2, 4);
    expect(cursorAt(ui.root, 2, 4)).not.toBe("pointer");
    ui.dispatchPointer("mousedown", 2, 4);
    ui.dispatchPointer("mouseup", 2, 4);
    expect(clicks).toEqual(["docs"]);
    dispose();
  });
});

describe("wrapped runs beside a marker", () => {
  it("is as tall as the lines it wraps to at the width it is drawn, so what follows clears it", () => {
    // A list item, as a page draws one: a number, then its title and a line under it.
    const marker = "2.";
    const title = "Show HN: a title that fits the row but not beside its number";
    const runs: TextRun[] = [{ text: title }, { text: "\n1 points by tosh" }];
    const rowWidth = measureText(title) + 4;
    const ui = createUI({ screen: newBitMap(rowWidth + 20, 120) });
    ui.render(() => (
      <box width={rowWidth} flexDirection="column">
        <box flexDirection="row" gap={4}>
          <text font="body" nowrap>{marker}</text>
          <text semantic={{ name: "item" }} font="body" wrap flexGrow={1} flexShrink={1} runs={runs} />
        </box>
        <text semantic={{ name: "next" }} font="body">3. Next item</text>
      </box>
    ));
    ui.frame();
    const item = ui.inspect().find((n) => n.name === "item")!;
    const next = ui.inspect().find((n) => n.name === "next")!;
    const drawn = layoutRuns(FACE, runs, item.bounds.width);
    expect(drawn.lines).toHaveLength(3);
    expect(item.bounds.height).toBe(drawn.height);
    expect(next.bounds.y).toBeGreaterThanOrEqual(item.bounds.y + drawn.height);
  });
});
