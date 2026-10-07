import { createSignal, createMemo, createEffect, untrack, For, Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {getFocusManager} from "../focusContext";
import {useUIServices} from "../services";
import {useRadius} from "../theme";
import {measureText} from "../fonts/bridge";
import type {CanvasNode, Modifiers} from "../nodes";
import {createTextClicks, paragraphRangeAt, type TextClickSelection} from "../textClicks";

export interface TextEditorProps {
  name?: string; value: string; onChange(value: string): void;
  width: number; height: number; disabled?: boolean; line?: number;
}
/** Multiline text editing in the canvas renderer. The document owner controls
 * saving/revisions; this widget owns only selection, caret, and viewport. */
export function TextEditor(props: TextEditorProps): JSX.Element {
  const focus = getFocusManager(), {clipboard} = useUIServices();
  const radius = useRadius("md");
  let node: CanvasNode;
  // Locals stay current across staged Solid 2 writes so keydown+keypress in
  // one turn (and the next key before paint) see the caret we just moved.
  let caretAt = 0, anchorAt = 0, lastLine: number | undefined, draft: string | null = null;
  const valueNow = () => draft ?? props.value;
  const signalOpts = { ownedWrite: true as const };
  const [caret, setCaret] = createSignal(0, signalOpts), [anchor, setAnchor] = createSignal(0, signalOpts);
  const [top, setTop] = createSignal(0, signalOpts), [left, setLeft] = createSignal(0, signalOpts), [focused, setFocused] = createSignal(false, signalOpts);
  const charWidth = measureText("M", "mono"), lineHeight = 14;
  const rows = () => Math.max(1, Math.floor((props.height - 8) / lineHeight));
  const columns = () => Math.max(1, Math.floor((props.width - 8) / charWidth));
  const lines = createMemo(() => props.value.split("\n"));
  const offsets = createMemo(() => { let offset = 0; return lines().map(line => { const start = offset; offset += line.length + 1; return start; }); });
  const location = (index: number) => { const row = Math.max(0, offsets().findIndex((start, row) => index <= start + lines()[row].length)); return {row, column: index - offsets()[row]}; };
  const indexAt = (row: number, column: number) => { row = Math.max(0, Math.min(lines().length - 1, row)); return offsets()[row] + Math.max(0, Math.min(lines()[row].length, column)); };
  function move(index: number, extend = false) {
    index = Math.max(0, Math.min(valueNow().length, index));
    caretAt = index;
    setCaret(index);
    if (!extend) {
      anchorAt = index;
      setAnchor(index);
    }
    const {row, column} = location(index);
    setTop(t => Math.max(0, row < t ? row : row >= t + rows() ? row - rows() + 1 : t));
    setLeft(l => Math.max(0, column < l ? column : column >= l + columns() ? column - columns() + 1 : l));
  }
  createEffect(
    () => ({ value: props.value, caret: caret() }),
    ({ value, caret: at }) => {
      if (draft === value) draft = null;
      if (at > value.length) move(value.length);
    },
  );
  createEffect(() => props.line, (line) => {
    if (line === undefined || line === lastLine) return;
    lastLine = line;
    untrack(() => move(indexAt(line - 1, 0)));
  });
  const range = () => ({lo: Math.min(caretAt, anchorAt), hi: Math.max(caretAt, anchorAt)});
  function insert(text: string) {
    if (props.disabled) return;
    const {lo, hi} = range();
    text = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
    const next = valueNow().slice(0, lo) + text + valueNow().slice(hi);
    draft = next;
    props.onChange(next);
    move(lo + text.length);
  }
  function key(key: string, mods: Modifiers) {
    if (props.disabled) return;
    const command = mods.meta || mods.ctrl, {lo, hi} = range(), at = location(caretAt);
    if (command) {
      if (key.toLowerCase() === "a") { anchorAt = 0; setAnchor(0); move(valueNow().length, true); }
      if (key.toLowerCase() === "c" || key.toLowerCase() === "x") {
        void clipboard?.writeText(valueNow().slice(lo, hi)).catch(() => {});
        if (key.toLowerCase() === "x" && clipboard) insert("");
      }
      return;
    }
    if (key === "ArrowLeft") move(caretAt - 1, mods.shift);
    else if (key === "ArrowRight") move(caretAt + 1, mods.shift);
    else if (key === "ArrowUp") move(indexAt(at.row - 1, at.column), mods.shift);
    else if (key === "ArrowDown") move(indexAt(at.row + 1, at.column), mods.shift);
    else if (key === "Home") move(indexAt(at.row, 0), mods.shift);
    else if (key === "End") move(indexAt(at.row, lines()[at.row].length), mods.shift);
    else if (key === "Enter") insert("\n" + (lines()[at.row].match(/^ */)?.[0] ?? ""));
    else if (key === "Tab") insert("  ");
    else if (key === "Backspace" || key === "Delete") {
      if (lo === hi) {
        const next = key === "Backspace" ? Math.max(0, caretAt - 1) : Math.min(valueNow().length, caretAt + 1);
        anchorAt = next;
        setAnchor(next);
      }
      insert("");
    }
  }
  // Double-click selects a word, triple-click the line.
  const clicks = createTextClicks({third: paragraphRangeAt});
  const pointAt = (x: number, y: number) => indexAt(top() + Math.floor((y - 4) / lineHeight), left() + Math.round((x - 4) / charWidth));
  function select({anchor: at, caret: to}: TextClickSelection) {
    anchorAt = at;
    setAnchor(at);
    move(to, true);
  }
  function pointer(x: number, y: number) {
    focus.focus(node);
    select(clicks.down(x, y, valueNow(), pointAt(x, y)));
  }
  function doubleClick(x: number, y: number) {
    const sel = clicks.doubleClick(x, y, valueNow(), pointAt(x, y));
    if (sel) { focus.focus(node); select(sel); }
  }
  return <box ref={n => node = n} semantic={{name: props.name, role: "textbox", value: props.value, enabled: !props.disabled}}
    width={props.width} height={props.height} borderWidth={1} borderColor={1} borderRadius={radius()} background={0} overflow="hidden" tabIndex={0}
    cursor={props.disabled ? "default" : "text"}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onMouseDown={(x, y) => pointer(x, y)} onDrag={(x, y) => select(clicks.drag(valueNow(), pointAt(x, y)))} onDoubleClick={doubleClick}
    onScroll={delta => setTop(t => Math.max(0, Math.min(lines().length - rows(), t + Math.sign(delta) * 3)))}
    onKeyDown={key} onKeyPress={insert}>
    <For each={lines().slice(top(), top() + rows())}>{(line, row) => {
      const start = () => offsets()[top() + row()];
      const selectedStart = () => Math.max(left(), range().lo - start());
      const selectedEnd = () => Math.min(left() + columns(), line.length, range().hi - start());
      return <box position="absolute" left={4} top={4 + row() * lineHeight} width={props.width - 8} height={lineHeight}>
        <text font="mono" nowrap>{line.slice(left(), left() + columns())}</text>
        <Show when={selectedEnd() > selectedStart()}>
          <box position="absolute" left={(selectedStart() - left()) * charWidth} top={0} width={(selectedEnd() - selectedStart()) * charWidth} height={lineHeight} background={1} />
          <text position="absolute" left={(selectedStart() - left()) * charWidth} top={0} font="mono" color={0} nowrap>{line.slice(selectedStart(), selectedEnd())}</text>
        </Show>
      </box>;
    }}</For>
    <Show when={focused()}><box position="absolute" left={4 + (location(caret()).column - left()) * charWidth} top={4 + (location(caret()).row - top()) * lineHeight} width={1} height={lineHeight} background={1} /></Show>
  </box>;
}
