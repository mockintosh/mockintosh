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
import { createCaretBlink, createTextEditing } from "../textEditing";
import { heldModifiers } from "../modifiers";
import { blockLines } from "../fonts/textLines";

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

  const [focused, setFocused] = createSignal(false, { ownedWrite: true });
  let firstFocus = true;

  const align = (): TextAlign => props.align ?? "left";
  const font = createMemo(() => resolveFont(props.font ?? "body", {}, props.size));
  const layoutOf = (text: string): TextBlock => layoutText(font(), text, props.width);
  const block = createMemo(() => layoutOf(props.value));

  const editing = createTextEditing({
    value: () => props.value,
    onChange: (value) => props.onChange(value),
    disabled: () => props.disabled === true,
    clipboard,
    lines: () => blockLines(layoutOf(editing.valueNow()), font(), align(), props.width),
    // Pasted text comes a character at a time: `\r\n` keeps only the `\n`, a tab is a space.
    clean: (text) => text.replace(/\r\n?/g, "\n").replace(/\t/g, " "),
  });
  const { caret, anchor } = editing;
  const blinkOn = createCaretBlink(focused, caret);

  /** Double-click selects a word, triple-click the paragraph. */
  const clicks = createTextClicks({ third: paragraphRangeAt });

  function select({ anchor, caret }: TextClickSelection): void {
    editing.select(caret, anchor);
  }

  function onKeyDown(key: string, mod: Modifiers): void {
    if (props.disabled) return;
    if (editing.key(key, mod)) return;
    if (key === "Enter" || key === "Return") editing.insert("\n", "other");
    else if (key === "Escape") props.onCancel?.();
  }

  function onKeyPress(char: string): void {
    if (props.disabled || !char || char === "\r") return;
    editing.insert(char);
  }

  const indexAt = (lx: number, ly: number) =>
    indexAtPoint(block(), font(), lx, ly, align(), props.width);

  function onFocus(): void {
    setFocused(true);
    if (props.selectAllOnFocus && firstFocus) editing.select(editing.valueNow().length, 0);
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
        select(clicks.down(lx, ly, editing.valueNow(), indexAt(lx, ly), heldModifiers().shift ? anchor() : undefined));
      }}
      onDrag={(lx: number, ly: number) => select(clicks.drag(editing.valueNow(), indexAt(lx, ly)))}
      onDoubleClick={(lx: number, ly: number) => {
        const sel = clicks.doubleClick(lx, ly, editing.valueNow(), indexAt(lx, ly));
        if (sel) select(sel);
      }}
      onKeyDown={onKeyDown}
      onKeyPress={onKeyPress}
      onPaste={(text: string) => editing.insert(text, "other")}
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
