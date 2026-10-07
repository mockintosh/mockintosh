import { createSignal, createEffect, createMemo, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Show } from "solid-js";
import { getFocusManager } from "../focusContext";
import { useRadius } from "../theme";
import { useUIServices } from "../services";
import { measureText } from "../fonts/bridge";
import type { CanvasNode, Modifiers } from "../nodes";
import { createTextClicks, wordRangeAt, type TextClickSelection } from "../textClicks";

export interface TextInputProps {
  name?: string;
  onHistory?: (direction: -1 | 1) => void;
  onInterrupt?: () => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  font?: string;
  size?: number;
  width?: number;
  height?: number;
  /**
   * Uniform inner padding (and click→caret inset). When omitted, the field
   * uses 4px on x and 2px on y so the 16px face still fits the glyph cell.
   */
  padding?: number;
  /** Omit the field border (e.g. inline rename over a label). */
  borderless?: boolean;
  /**
   * Where the line sits: `"middle"` (default) centres its caps in the field;
   * `"top"` sets it at the top padding like a plain `<text>`, so a field laid
   * over a label keeps the label's text where it was.
   */
  verticalAlign?: "top" | "middle";
  disabled?: boolean;
  password?: boolean;
  /** Most characters the field holds; typing past it is ignored. */
  maxLength?: number;
  autoFocus?: boolean;
  selectAllOnFocus?: boolean;
  /**
   * Caret index on mount (e.g. from a click on a label entering edit mode).
   * When set, overrides the default end-of-text caret and disables the first
   * `selectAllOnFocus` pass (so the click position wins).
   */
  initialCaretIndex?: number;
}

export function TextInput(props: TextInputProps): JSX.Element {
  let rootNode: CanvasNode | null = null;

  // Capture focus manager at init time — useContext only works during
  // component initialization, not inside event callbacks.
  const focusManager = getFocusManager();
  const { clipboard, scheduler } = useUIServices();
  const radius = useRadius("md");

  const initialLen = props.value.length;
  const initialCaret =
    props.initialCaretIndex !== undefined
      ? Math.max(0, Math.min(initialLen, Math.floor(props.initialCaretIndex)))
      : initialLen;
  // Locals stay current across staged Solid 2 writes so sequential keystrokes
  // (keydown select-all, then keypress insert) see the caret we just moved.
  let cursorAt = initialCaret;
  let selLo: number | null = null;
  let selHi: number | null = null;
  let draft: string | null = null;
  const valueNow = () => draft ?? props.value;
  const signalOpts = { ownedWrite: true as const };
  const [cursorPos, setCursorPos] = createSignal(initialCaret, signalOpts);
  const [selStart, setSelStart] = createSignal<number | null>(null, signalOpts);
  const [selEnd, setSelEnd] = createSignal<number | null>(null, signalOpts);

  function writeCursor(n: number): void {
    cursorAt = n;
    setCursorPos(n);
  }
  function writeSel(start: number | null, end: number | null): void {
    selLo = start;
    selHi = end;
    setSelStart(start);
    setSelEnd(end);
  }
  const [cursorVisible, setCursorVisible] = createSignal(true, signalOpts);
  const [isFocused, setIsFocused] = createSignal(false, signalOpts);

  const fontName = () => props.font ?? "body";
  const fontSize = () => props.size;
  const padY = () => props.padding ?? 2;
  const padX = () => props.padding ?? 4;
  const bordered = () => !props.borderless;
  const borderW = () => (bordered() ? 1 : 0);
  const fieldWidth = () => props.width ?? 120;
  const fieldHeight = () => props.height ?? 16;
  const innerTextH = () => Math.max(1, fieldHeight() - (padY() + borderW()) * 2);
  const contentWidth = () => Math.max(1, fieldWidth() - (padX() + borderW()) * 2);
  /** Pointer x (border-box local) → x within the content box. */
  const localToContentX = (lx: number) => lx - borderW() - padX();
  /** Horizontal pan so the caret stays inside the clipped content box. */
  const [scrollX, setScrollX] = createSignal(0, signalOpts);

  // --- Focus management ---
  let isInitialFocus = true;

  /** Double-click selects a word (a password is one word, like the Mac); triple, everything. */
  const clicks = createTextClicks({
    word: (text, index) => (props.password ? { start: 0, end: text.length } : wordRangeAt(text, index)),
    now: scheduler && (() => scheduler.now()),
  });

  function handleFocus(): void {
    setIsFocused(true);
    setCursorVisible(true);
    if (props.selectAllOnFocus && isInitialFocus) {
      isInitialFocus = false;
      if (props.initialCaretIndex === undefined) {
        writeSel(0, props.value.length);
        writeCursor(props.value.length);
      }
    }
    props.onFocus?.();
  }

  function handleBlur(): void {
    setIsFocused(false);
    props.onBlur?.();
  }

  onSettled(() => {
    if (props.autoFocus) {
      Promise.resolve().then(() => {
        if (rootNode) focusManager.focus(rootNode);
      });
    }
  });

  // Cursor blink — the signal update triggers setProperty in the renderer,
  // which calls the repaint hook automatically. No explicit scheduleRender needed.
  createEffect(
    () => isFocused(),
    (focused) => {
      if (!focused) return;
      const id = setInterval(() => setCursorVisible((v) => !v), 530);
      return () => clearInterval(id);
    },
  );

  const resetBlink = () => setCursorVisible(true);

  /**
   * Parents may replace `value` without remounting (ChatGippity send,
   * Terminal submit). The caret is local state — clamp it so Backspace
   * still deletes instead of walking phantom positions past the end.
   */
  createEffect(
    () => ({
      value: props.value,
      len: props.value.length,
      cursor: cursorPos(),
      ss: selStart(),
      se: selEnd(),
    }),
    ({ value, len, cursor, ss, se }) => {
      if (draft === value) draft = null;
      else if (draft !== null && draft.length !== len) draft = null;
      if (cursor > len) writeCursor(len);
      if (ss === null || se === null) return;
      if (Math.min(ss, se) >= len || ss === se) {
        writeSel(null, null);
        return;
      }
      if (ss > len) writeSel(len, se > len ? len : se);
      else if (se > len) writeSel(ss, len);
    },
  );

  // --- Display text ---
  const displayValue = () =>
    props.password ? "\u2022".repeat(props.value.length) : props.value;

  // --- Pixel offset helpers ---
  function charOffsetToPixels(index: number): number {
    const sub = displayValue().slice(0, index);
    return measureText(sub, fontName(), {}, fontSize());
  }

  function pixelsToCharIndex(px: number): number {
    const text = displayValue();
    let accumulated = 0;
    for (let i = 0; i < text.length; i++) {
      const cw = measureText(text[i], fontName(), {}, fontSize());
      if (px < accumulated + cw / 2) return i;
      accumulated += cw;
    }
    return text.length;
  }

  // --- Text insertion ---
  function insertText(chars: string): void {
    if (props.disabled) return;
    resetBlink();
    const text = valueNow();
    const cur = cursorAt;
    const ss = selLo;
    const se = selHi;

    if (props.maxLength !== undefined) {
      const replaced = ss !== null && se !== null ? Math.abs(se - ss) : 0;
      chars = chars.slice(0, Math.max(0, props.maxLength - (text.length - replaced)));
      if (!chars) return;
    }

    if (ss !== null && se !== null) {
      const lo = Math.min(ss, se), hi = Math.max(ss, se);
      const next = text.slice(0, lo) + chars + text.slice(hi);
      draft = next;
      props.onChange(next);
      writeCursor(lo + chars.length);
      writeSel(null, null);
    } else {
      const next = text.slice(0, cur) + chars + text.slice(cur);
      draft = next;
      props.onChange(next);
      writeCursor(cur + chars.length);
    }
  }

  // --- Keyboard ---
  function handleKeyDown(key: string, mod: Modifiers): void {
    if (props.onInterrupt && mod.ctrl && key.toLowerCase() === "c") { props.onInterrupt(); return; }
    if (!props.disabled && props.onHistory && (key === "ArrowUp" || key === "ArrowDown")) { props.onHistory(key === "ArrowUp" ? -1 : 1); writeCursor(props.value.length); writeSel(null, null); resetBlink(); return; }
    if (props.disabled) return;
    resetBlink();
    const text = valueNow();
    const cur = cursorAt;
    const ss = selLo;
    const se = selHi;

    if (key === "ArrowLeft") {
      if (mod.shift) {
        const anchor = ss ?? cur;
        const newCur = Math.max(0, cur - 1);
        if (newCur < anchor) writeSel(newCur, anchor);
        else writeSel(anchor, newCur);
        writeCursor(newCur);
      } else {
        writeSel(null, null);
        writeCursor(ss !== null ? Math.min(ss, se ?? ss) : Math.max(0, cur - 1));
      }
      return;
    }
    if (key === "ArrowRight") {
      if (mod.shift) {
        const anchor = ss ?? cur;
        const newCur = Math.min(text.length, cur + 1);
        if (newCur > anchor) writeSel(anchor, newCur);
        else writeSel(newCur, anchor);
        writeCursor(newCur);
      } else {
        writeSel(null, null);
        writeCursor(se !== null ? Math.max(ss ?? se, se) : Math.min(text.length, cur + 1));
      }
      return;
    }
    if (key === "Home") {
      writeSel(null, null); writeCursor(0);
      return;
    }
    if (key === "End") {
      writeSel(null, null); writeCursor(text.length);
      return;
    }
    if (key === "Backspace") {
      if (ss !== null && se !== null) {
        const lo = Math.min(ss, se), hi = Math.max(ss, se);
        const next = text.slice(0, lo) + text.slice(hi);
        draft = next;
        props.onChange(next);
        writeCursor(lo);
        writeSel(null, null);
      } else if (cur > 0) {
        const next = text.slice(0, cur - 1) + text.slice(cur);
        draft = next;
        props.onChange(next);
        writeCursor(cur - 1);
      }
      return;
    }
    if (key === "Delete") {
      if (ss !== null && se !== null) {
        const lo = Math.min(ss, se), hi = Math.max(ss, se);
        const next = text.slice(0, lo) + text.slice(hi);
        draft = next;
        props.onChange(next);
        writeCursor(lo);
        writeSel(null, null);
      } else if (cur < text.length) {
        const next = text.slice(0, cur) + text.slice(cur + 1);
        draft = next;
        props.onChange(next);
      }
      return;
    }
    if ((mod.ctrl || mod.meta) && key.toLowerCase() === "a") {
      writeSel(0, text.length); writeCursor(text.length);
      return;
    }
    if ((mod.ctrl || mod.meta) && key.toLowerCase() === "c") {
      if (ss !== null && se !== null) {
        const lo = Math.min(ss, se), hi = Math.max(ss, se);
        clipboard?.writeText(text.slice(lo, hi)).catch(() => {});
      }
      return;
    }

    if (key === "Enter" || key === "Return") {
      props.onSubmit?.(valueNow());
      return;
    }
    if (key === "Escape") {
      props.onCancel?.();
      return;
    }

    // Skip modifier-key combos (Ctrl+X, Meta+X, etc.)
    if (mod.ctrl || mod.meta) return;

    // Printable characters: host sends `keypress` after `keydown` (see solidMain);
    // insert only there so each key yields one character.
  }

  function handleKeyPress(char: string): void {
    if (props.disabled) return;
    if (char.length !== 1) return;
    insertText(char);
  }

  // --- Mouse ---
  function indexAtPointer(lx: number): number {
    return pixelsToCharIndex(localToContentX(lx) + scrollX());
  }

  function select({ anchor, caret }: TextClickSelection): void {
    writeSel(anchor === caret ? null : Math.min(anchor, caret), anchor === caret ? null : Math.max(anchor, caret));
    writeCursor(caret);
  }

  function handleMouseDown(lx: number, ly: number): void {
    if (props.disabled) return;
    if (rootNode) focusManager.focus(rootNode);
    select(clicks.down(lx, ly, valueNow(), indexAtPointer(lx)));
  }

  function handleDoubleClick(lx: number, ly: number): void {
    if (props.disabled) return;
    const sel = clicks.doubleClick(lx, ly, valueNow(), indexAtPointer(lx));
    if (!sel) return;
    if (rootNode) focusManager.focus(rootNode);
    select(sel);
  }

  function handleDrag(lx: number): void {
    select(clicks.drag(valueNow(), indexAtPointer(lx)));
  }

  // Keep the insertion point inside the clipped content box.
  createEffect(
    () => ({
      caret: charOffsetToPixels(cursorPos()),
      view: contentWidth(),
      maxScroll: Math.max(0, charOffsetToPixels(displayValue().length) - contentWidth()),
    }),
    ({ caret, view, maxScroll }) => {
      setScrollX((prev) => {
        let next = Math.min(prev, maxScroll);
        if (caret < next) next = caret;
        if (caret + 1 > next + view) next = caret + 1 - view;
        return Math.max(0, Math.min(maxScroll, next));
      });
    },
  );

  // --- Computed pixel positions ---
  // Nudge 1px left so the bar sits in the gap between glyphs (metrics skew it right).
  const cursorPixelX = () =>
    Math.max(padX(), charOffsetToPixels(cursorPos()) + padX() - 1) - scrollX();
  const selPixelStart = () => {
    const ss = selStart(), se = selEnd();
    if (ss === null || se === null) return 0;
    return charOffsetToPixels(Math.min(ss, se)) + padX() - scrollX();
  };
  const selPixelWidth = () => {
    const ss = selStart(), se = selEnd();
    if (ss === null || se === null) return 0;
    const lo = Math.min(ss, se), hi = Math.max(ss, se);
    return charOffsetToPixels(hi) - charOffsetToPixels(lo);
  };

  const showPlaceholder = () => !props.value && !isFocused() && !!props.placeholder;

  /** Non-empty character range when the user has an active selection. */
  const selectionRange = createMemo((): { lo: number; hi: number } | null => {
    const ss = selStart(), se = selEnd();
    if (ss === null || se === null) return null;
    const lo = Math.min(ss, se);
    const hi = Math.max(ss, se);
    if (lo >= hi) return null;
    return { lo, hi };
  });

  // Own memos — `<Show when>{(v) => …}</Show>` runs the callback untracked,
  // so a slice captured on the first drag tick would never grow.
  const selectedSlice = createMemo(() => {
    const r = selectionRange();
    return r ? displayValue().slice(r.lo, r.hi) : "";
  });
  const selectedSliceLeft = createMemo(() => {
    const r = selectionRange();
    return r ? padX() + charOffsetToPixels(r.lo) - scrollX() : 0;
  });

  return (
    <box
      semantic={{ name: props.name, role: "textbox", value: props.value, password: props.password, enabled: !props.disabled }}
      ref={(el: CanvasNode) => { rootNode = el; }}
      width={fieldWidth()}
      height={fieldHeight()}
      background={0}
      borderColor={bordered() ? 1 : undefined}
      borderStyle={bordered() ? "solid" : undefined}
      borderWidth={bordered() ? 1 : 0}
      borderRadius={bordered() ? radius() : undefined}
      paddingTop={padY()}
      paddingBottom={padY()}
      paddingLeft={padX()}
      paddingRight={padX()}
      justifyContent="center"
      overflow="hidden"
      tabIndex={props.disabled ? undefined : 0}
      cursor={props.disabled ? "default" : "text"}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseDown={(x: number, y: number) => handleMouseDown(x, y)}
      onDoubleClick={(x: number, y: number) => handleDoubleClick(x, y)}
      onDrag={(lx) => handleDrag(lx)}
      onKeyDown={(key: string, mod: Modifiers) => handleKeyDown(key, mod)}
      onKeyPress={(char: string) => handleKeyPress(char)}
    >
      <Show when={selStart() !== null}>
        <box
          position="absolute"
          left={selPixelStart()}
          top={padY()}
          width={selPixelWidth()}
          height={innerTextH()}
          background={1}
        />
      </Show>

      <Show when={!!displayValue()}>
        <text
          position="absolute"
          left={padX() - scrollX()}
          top={padY()}
          height={innerTextH()}
          font={fontName()}
          size={fontSize()}
          color={1}
          verticalAlign={props.verticalAlign ?? "middle"}
          nowrap
        >
          {displayValue()}
        </text>
      </Show>

      {/* Selected slice in white so it stays visible on the black highlight bar */}
      <Show when={selectedSlice()}>
        <text
          position="absolute"
          left={selectedSliceLeft()}
          top={padY()}
          height={innerTextH()}
          font={fontName()}
          size={fontSize()}
          color={0}
          verticalAlign={props.verticalAlign ?? "middle"}
          nowrap
        >
          {selectedSlice()}
        </text>
      </Show>

      <Show when={isFocused() && cursorVisible() && selStart() === null}>
        <box
          position="absolute"
          left={cursorPixelX()}
          top={padY()}
          width={1}
          height={innerTextH()}
          background={1}
        />
      </Show>

      <Show when={showPlaceholder()}>
        <text
          position="absolute"
          left={padX()}
          top={padY()}
          height={innerTextH()}
          font={fontName()}
          size={fontSize()}
          color={1}
          verticalAlign={props.verticalAlign ?? "middle"}
          nowrap
        >
          {props.placeholder}
        </text>
      </Show>
    </box>
  );
}
