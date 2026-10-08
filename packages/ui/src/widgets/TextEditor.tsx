import { createEffect, createMemo, createSignal, untrack, For, Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { getFocusManager } from "../focusContext";
import { useUIServices } from "../services";
import { useRadius } from "../theme";
import { textAdvance } from "../fonts/font";
import { resolveFont } from "../fonts/style";
import { caretPoint, indexAtPoint, layoutText, lineBoxHeight, lineTop } from "../fonts/textLayout";
import { blockLines } from "../fonts/textLines";
import { heldModifiers } from "../modifiers";
import type { CanvasNode, Modifiers } from "../nodes";
import { createTextClicks, paragraphRangeAt, type TextClickSelection } from "../textClicks";
import { createCaretBlink, createTextEditing } from "../textEditing";

export interface TextEditorProps {
  name?: string;
  value: string;
  onChange(value: string): void;
  width: number;
  height: number;
  disabled?: boolean;
  /** Puts the caret at the start of this line (1-based), as a compiler error's line number does. */
  line?: number;
  /** Corner radius of the border; the theme's when omitted. */
  borderRadius?: number;
  /** Face of the text: `"body"` (the default) for prose, `"mono"` for code. */
  font?: string;
  /** Wrap lines at the box's width, as prose does (the default); off, long lines scroll sideways, as code does. */
  wrap?: boolean;
  /** Shown, dimmed, while the box is empty and not focused. */
  placeholder?: string;
  /** Hands over a way to read and change the selection, for a toolbar that edits around it. */
  controller?: (controller: TextEditorController) => void;
}

/** What a toolbar can do with a TextEditor. */
export interface TextEditorController {
  /** The selection, `start` to `end` (equal for a caret). */
  selection(): { start: number; end: number };
  /** Replaces the text with `value`, selects `start` to `end`, and takes focus back. One undo step. */
  edit(value: string, start: number, end: number): void;
}

/** Between the border and the text. */
const INSET = 4;
/** Lines a wheel notch scrolls. */
const WHEEL_LINES = 3;

/**
 * Several lines of text to edit, in a bordered box that scrolls: prose
 * wrapped to the box, or code in long lines. Keys, clicks, the clipboard and
 * undo are the kit's shared text editing (`textEditing.ts`), as in every
 * text field; this draws the lines, the selection and the caret, and keeps
 * the caret in view. The owner keeps the text and saves it.
 */
export function TextEditor(props: TextEditorProps): JSX.Element {
  const focus = getFocusManager();
  const { clipboard } = useUIServices();
  const radius = useRadius("md");
  let node: CanvasNode | undefined;

  const font = createMemo(() => resolveFont(props.font ?? "body", {}));
  /** The text's box inside the border and inset. */
  const innerWidth = () => Math.max(1, props.width - 2 - INSET * 2);
  const innerHeight = () => Math.max(1, props.height - 2 - INSET * 2);
  const wraps = () => props.wrap !== false;
  const layoutOf = (text: string) => layoutText(font(), text, wraps() ? innerWidth() : undefined);
  const block = createMemo(() => layoutOf(props.value));

  const editing = createTextEditing({
    value: () => props.value,
    onChange: (value) => props.onChange(value),
    disabled: () => props.disabled === true,
    clipboard,
    lines: () => blockLines(layoutOf(editing.valueNow()), font(), "left", innerWidth()),
    clean: (text) => text.replace(/\r\n?/g, "\n").replace(/\t/g, "  "),
  });
  const { caret, anchor } = editing;
  const [focused, setFocused] = createSignal(false, { ownedWrite: true });
  const blinkOn = createCaretBlink(focused, caret);

  // The view: how far the text is scrolled, in pixels.
  const [top, setTop] = createSignal(0, { ownedWrite: true });
  const [left, setLeft] = createSignal(0, { ownedWrite: true });
  const maxTop = () => Math.max(0, block().height - innerHeight());

  // Keep the caret in view as it moves, and the view inside the text as it shrinks.
  createEffect(
    () => {
      const at = caretPoint(block(), font(), caret(), "left", innerWidth());
      return { at, height: lineBoxHeight(block(), at.row) };
    },
    ({ at, height }) => {
      setTop((t) => Math.max(0, Math.min(maxTop(), at.y < t ? at.y : at.y + height > t + innerHeight() ? at.y + height - innerHeight() : t)));
      setLeft((l) => (wraps() ? 0 : Math.max(0, at.x < l ? at.x : at.x + 1 > l + innerWidth() ? at.x + 1 - innerWidth() : l)));
    },
  );

  // A line number from outside (a compiler's error): the caret to its start.
  let lastLine: number | undefined;
  createEffect(
    () => props.line,
    (line) => {
      if (line === undefined || line === lastLine) return;
      lastLine = line;
      untrack(() => {
        const lines = editing.valueNow().split("\n");
        const row = Math.max(0, Math.min(lines.length - 1, line - 1));
        editing.select(lines.slice(0, row).reduce((sum, text) => sum + text.length + 1, 0));
      });
    },
  );

  props.controller?.({
    selection: () => {
      const { lo, hi } = editing.selection();
      return { start: lo, end: hi };
    },
    edit(value, start, end) {
      editing.replace({ value, anchor: start, caret: end });
      if (node) focus.focus(node);
    },
  });

  function onKeyDown(key: string, mods: Modifiers): void {
    if (props.disabled) return;
    if (editing.key(key, mods)) return;
    if (key === "Enter" || key === "Return") {
      // A new line keeps the indent of the one it breaks, as a code editor does.
      const text = editing.valueNow();
      const { lo } = editing.selection();
      const lineStart = text.lastIndexOf("\n", lo - 1) + 1;
      editing.insert("\n" + (text.slice(lineStart).match(/^ */)?.[0] ?? ""), "other");
    }
  }

  function onKeyPress(char: string): void {
    if (props.disabled || !char || char === "\r") return;
    editing.insert(char);
  }

  // Clicks: double selects a word, triple the paragraph; ⇧ extends.
  const clicks = createTextClicks({ third: paragraphRangeAt });
  const indexAt = (lx: number, ly: number) =>
    indexAtPoint(block(), font(), lx - 1 - INSET + left(), ly - 1 - INSET + top(), "left", innerWidth());
  function select({ anchor: from, caret: to }: TextClickSelection): void {
    editing.select(to, from);
  }

  /** The lines in view, each with where it's drawn. */
  const visible = createMemo(() => {
    const laid = block();
    const first = Math.max(0, Math.floor(top() / laid.lineHeight));
    const last = Math.min(laid.lines.length - 1, Math.ceil((top() + innerHeight()) / laid.lineHeight));
    const rows: Array<{ row: number; text: string; start: number; y: number }> = [];
    for (let row = first; row <= last; row++) {
      const line = laid.lines[row]!;
      rows.push({ row, text: line.text, start: line.start, y: INSET + lineTop(laid, row) - top() });
    }
    return rows;
  });

  /** The selection's highlight on each line in view. */
  const highlights = createMemo(() => {
    const lo = Math.min(caret(), anchor());
    const hi = Math.max(caret(), anchor());
    if (lo === hi) return [];
    const f = font();
    return visible().flatMap((line) => {
      const end = line.start + line.text.length;
      const a = Math.max(lo, line.start) - line.start;
      const b = Math.min(hi, end) - line.start;
      // A selected line break shows as a sliver past the line's end.
      const through = hi > end && lo <= end;
      if (a > b || (a === b && !through)) return [];
      const text = line.text.slice(a, b);
      const x = INSET + textAdvance(f, line.text.slice(0, a)) - left();
      return [{ x, y: line.y, width: textAdvance(f, text) + (through ? 3 : 0), height: lineBoxHeight(block(), line.row), text }];
    });
  });

  const caretBox = createMemo(() => {
    const at = caretPoint(block(), font(), caret(), "left", innerWidth());
    return { x: INSET + Math.max(0, at.x - 1) - left(), y: INSET + at.y - top(), height: lineBoxHeight(block(), at.row) };
  });

  return (
    <box
      ref={(n: CanvasNode) => {
        node = n;
      }}
      semantic={{ name: props.name, role: "textbox", value: props.value, enabled: !props.disabled }}
      width={props.width}
      height={props.height}
      borderWidth={1}
      borderColor={1}
      borderRadius={props.borderRadius ?? radius()}
      background={0}
      overflow="hidden"
      tabIndex={props.disabled ? undefined : 0}
      cursor={props.disabled ? "default" : "text"}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseDown={(lx: number, ly: number) => {
        if (props.disabled) return;
        if (node) focus.focus(node);
        select(clicks.down(lx, ly, editing.valueNow(), indexAt(lx, ly), heldModifiers().shift ? anchor() : undefined));
      }}
      onDrag={(lx: number, ly: number) => select(clicks.drag(editing.valueNow(), indexAt(lx, ly)))}
      onDoubleClick={(lx: number, ly: number) => {
        const sel = clicks.doubleClick(lx, ly, editing.valueNow(), indexAt(lx, ly));
        if (sel) {
          if (node) focus.focus(node);
          select(sel);
        }
      }}
      onScroll={(delta: number) => setTop((t) => Math.max(0, Math.min(maxTop(), t + Math.sign(delta) * WHEEL_LINES * block().lineHeight)))}
      onKeyDown={onKeyDown}
      onKeyPress={onKeyPress}
      onPaste={(text: string) => editing.insert(text, "other")}
    >
      <Show when={!props.value && !focused() && props.placeholder}>
        <text position="absolute" left={INSET} top={INSET} font={props.font ?? "body"} stipple nowrap>
          {props.placeholder}
        </text>
      </Show>
      <For each={visible()} keyed={false}>
        {(line) => (
          <text position="absolute" left={INSET - left()} top={line().y} font={props.font ?? "body"} nowrap>
            {line().text}
          </text>
        )}
      </For>
      <For each={highlights()} keyed={false}>
        {(run) => (
          <box position="absolute" left={run().x} top={run().y} width={run().width} height={run().height} background={1}>
            <text font={props.font ?? "body"} color={0} nowrap>
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
