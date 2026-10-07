import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { getFocusManager } from "../focusContext";
import { useUIServices } from "../services";
import { textAdvance } from "../fonts/font";
import { resolveFont } from "../fonts/style";
import {
  caretPoint,
  indexAtPoint,
  layoutText,
  lineBoxHeight,
  lineLeft,
  lineOfIndex,
  lineTop,
  type TextBlock,
} from "../fonts/textLayout";
import type { CanvasNode, Modifiers, TextAlign } from "../nodes";
import { createTextClicks, paragraphRangeAt, type TextClickSelection } from "../textClicks";

export interface EditableTextProps {
  name?: string;
  value: string;
  onChange(value: string): void;
  /** Escape. Return inserts a line break, as in a MacDraw or Figma text box. */
  onCancel?: () => void;
  onBlur?: () => void;
  font?: string;
  size?: number;
  align?: TextAlign;
  width: number;
  height: number;
  disabled?: boolean;
  autoFocus?: boolean;
  selectAllOnFocus?: boolean;
}

/** One highlighted run of a selection, in box-local pixels. */
interface SelectionRun {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/**
 * In-place editing for a wrapped `<text>` block. The text is painted by the
 * same `<text wrap align>` node a read-only view uses, and the caret and
 * selection come from the same line layout, so entering and leaving edit mode
 * never moves a glyph.
 */
export function EditableText(props: EditableTextProps): JSX.Element {
  const focusManager = getFocusManager();
  const { clipboard } = useUIServices();
  let node: CanvasNode | null = null;

  // Locals stay current across staged Solid 2 writes so keydown + keypress in
  // one turn see the caret and text we just wrote.
  let caretAt = props.value.length;
  let anchorAt = caretAt;
  let draft: string | null = null;
  const valueNow = () => draft ?? props.value;

  const signalOpts = { ownedWrite: true as const };
  const [caret, setCaret] = createSignal(caretAt, signalOpts);
  const [anchor, setAnchor] = createSignal(anchorAt, signalOpts);
  const [focused, setFocused] = createSignal(false, signalOpts);
  const [blinkOn, setBlinkOn] = createSignal(true, signalOpts);
  let firstFocus = true;

  const align = (): TextAlign => props.align ?? "left";
  const font = createMemo(() => resolveFont(props.font ?? "body", {}, props.size));
  const layoutOf = (text: string): TextBlock => layoutText(font(), text, props.width);
  const block = createMemo(() => layoutOf(props.value));

  function place(nextCaret: number, extend: boolean): void {
    const len = valueNow().length;
    caretAt = Math.max(0, Math.min(len, nextCaret));
    if (!extend) anchorAt = caretAt;
    setCaret(caretAt);
    setAnchor(anchorAt);
    setBlinkOn(true);
  }

  const range = () => ({ lo: Math.min(caretAt, anchorAt), hi: Math.max(caretAt, anchorAt) });

  createEffect(
    () => props.value,
    (value) => {
      if (draft === value) draft = null;
      else if (draft !== null && draft.length !== value.length) draft = null;
      if (caretAt > value.length || anchorAt > value.length) place(Math.min(caretAt, value.length), false);
    },
  );

  function replaceRange(text: string): void {
    if (props.disabled) return;
    const { lo, hi } = range();
    const cur = valueNow();
    const next = cur.slice(0, lo) + text + cur.slice(hi);
    draft = next;
    props.onChange(next);
    place(lo + text.length, false);
  }

  function verticalIndex(from: number, rows: -1 | 1): number {
    const text = valueNow();
    const laid = layoutOf(text);
    const row = lineOfIndex(laid, from) + rows;
    if (row < 0) return 0;
    if (row >= laid.lines.length) return text.length;
    const at = caretPoint(laid, font(), from, align(), props.width);
    return indexAtPoint(laid, font(), at.x, lineTop(laid, row), align(), props.width);
  }

  function lineBounds(index: number): { start: number; end: number } {
    const laid = layoutOf(valueNow());
    const line = laid.lines[lineOfIndex(laid, index)]!;
    return { start: line.start, end: line.start + line.text.length };
  }

  /** Double-click selects a word, triple-click the paragraph. */
  const clicks = createTextClicks({ third: paragraphRangeAt });

  function select({ anchor, caret }: TextClickSelection): void {
    anchorAt = anchor;
    place(caret, true);
  }

  function onKeyDown(key: string, mod: Modifiers): void {
    if (props.disabled) return;
    const command = mod.meta || mod.ctrl;
    const { lo, hi } = range();
    const collapsed = lo === hi;
    if (command) {
      const k = key.toLowerCase();
      if (k === "a") {
        anchorAt = 0;
        place(valueNow().length, true);
      } else if ((k === "c" || k === "x") && !collapsed) {
        void clipboard?.writeText(valueNow().slice(lo, hi)).catch(() => {});
        if (k === "x") replaceRange("");
      }
      return;
    }
    switch (key) {
      case "ArrowLeft":
        place(mod.shift || collapsed ? caretAt - 1 : lo, mod.shift);
        return;
      case "ArrowRight":
        place(mod.shift || collapsed ? caretAt + 1 : hi, mod.shift);
        return;
      case "ArrowUp":
        place(verticalIndex(caretAt, -1), mod.shift);
        return;
      case "ArrowDown":
        place(verticalIndex(caretAt, 1), mod.shift);
        return;
      case "Home":
        place(lineBounds(caretAt).start, mod.shift);
        return;
      case "End":
        place(lineBounds(caretAt).end, mod.shift);
        return;
      case "Backspace":
        if (collapsed) anchorAt = Math.max(0, caretAt - 1);
        replaceRange("");
        return;
      case "Delete":
        if (collapsed) anchorAt = Math.min(valueNow().length, caretAt + 1);
        replaceRange("");
        return;
      case "Enter":
      case "Return":
        replaceRange("\n");
        return;
      case "Escape":
        props.onCancel?.();
        return;
    }
  }

  /** Typed characters, and pasted text one character at a time (`\r\n` keeps only the `\n`). */
  function onKeyPress(char: string): void {
    if (props.disabled || !char || char === "\r") return;
    replaceRange(char === "\t" ? " " : char);
  }

  const indexAt = (lx: number, ly: number) =>
    indexAtPoint(block(), font(), lx, ly, align(), props.width);

  function onFocus(): void {
    setFocused(true);
    setBlinkOn(true);
    if (props.selectAllOnFocus && firstFocus) {
      anchorAt = 0;
      place(valueNow().length, true);
    }
    firstFocus = false;
  }

  function onBlur(): void {
    setFocused(false);
    props.onBlur?.();
  }

  onSettled(() => {
    if (!props.autoFocus) return;
    void Promise.resolve().then(() => {
      if (node) focusManager.focus(node);
    });
  });

  createEffect(
    () => focused(),
    (on) => {
      if (!on) return;
      const id = setInterval(() => setBlinkOn((v) => !v), 530);
      return () => clearInterval(id);
    },
  );

  const caretBox = createMemo(() => {
    const laid = block();
    const at = caretPoint(laid, font(), caret(), align(), props.width);
    // Sit in the gap before the glyph rather than on its first column.
    return { x: Math.max(0, at.x - 1), y: at.y, height: laid.lastLineHeight };
  });

  const selectionRuns = createMemo((): SelectionRun[] => {
    const lo = Math.min(caret(), anchor());
    const hi = Math.max(caret(), anchor());
    if (lo === hi) return [];
    const laid = block();
    const f = font();
    const runs: SelectionRun[] = [];
    laid.lines.forEach((line, row) => {
      const a = Math.max(lo, line.start) - line.start;
      const b = Math.min(hi, line.start + line.text.length) - line.start;
      if (a >= b) return;
      const text = line.text.slice(a, b);
      runs.push({
        x: lineLeft(line, align(), props.width) + textAdvance(f, line.text.slice(0, a)),
        y: lineTop(laid, row),
        width: textAdvance(f, text),
        height: lineBoxHeight(laid, row),
        text,
      });
    });
    return runs;
  });

  return (
    <box
      ref={(n: CanvasNode) => { node = n; }}
      semantic={{ name: props.name, role: "textbox", value: props.value, enabled: !props.disabled }}
      width={props.width}
      height={props.height}
      overflow="hidden"
      tabIndex={props.disabled ? undefined : 0}
      cursor={props.disabled ? "default" : "text"}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseDown={(lx: number, ly: number) => {
        if (node) focusManager.focus(node);
        select(clicks.down(lx, ly, valueNow(), indexAt(lx, ly)));
      }}
      onDrag={(lx: number, ly: number) => select(clicks.drag(valueNow(), indexAt(lx, ly)))}
      onDoubleClick={(lx: number, ly: number) => {
        const sel = clicks.doubleClick(lx, ly, valueNow(), indexAt(lx, ly));
        if (sel) select(sel);
      }}
      onKeyDown={onKeyDown}
      onKeyPress={onKeyPress}
    >
      <text font={props.font ?? "body"} size={props.size} align={align()} wrap>
        {props.value}
      </text>
      <For each={selectionRuns()} keyed={false}>
        {(run) => (
          <box position="absolute" left={run().x} top={run().y} width={run().width} height={run().height} background={1}>
            <text font={props.font ?? "body"} size={props.size} color={0} nowrap>
              {run().text}
            </text>
          </box>
        )}
      </For>
      <Show when={focused() && blinkOn() && caret() === anchor()}>
        <box position="absolute" left={caretBox().x} top={caretBox().y} width={1} height={caretBox().height} background={1} />
      </Show>
    </box>
  );
}
