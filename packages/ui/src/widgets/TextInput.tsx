import { createSignal, createEffect, createMemo, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Show } from "solid-js";
import { getFocusManager } from "../focusContext";
import { useRadius } from "../theme";
import { useUIServices } from "../services";
import { measureText } from "../fonts/bridge";
import type { CanvasNode, Modifiers } from "../nodes";
import type { Sprite } from "../sprite";
import { createTextClicks, wordRangeAt, type TextClickSelection } from "../textClicks";
import { createCaretBlink, createTextEditing } from "../textEditing";
import { heldModifiers } from "../modifiers";

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
  /** Corner radius of the border; the theme's when omitted. */
  borderRadius?: number;
  /** Drawn inset at the field's left, before the text, as a search field's magnifying glass. */
  icon?: Sprite;
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

/** Between an icon and the text after it. */
const ICON_GAP = 3;

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
  const editing = createTextEditing({
    value: () => props.value,
    onChange: (value) => props.onChange(value),
    disabled: () => props.disabled === true,
    // A password field keeps what's in it off the clipboard.
    clipboard: props.password ? undefined : clipboard,
    maxLength: () => props.maxLength,
    initialCaret,
    // One line: a pasted line break or tab is a space.
    clean: (text) => text.replace(/\r\n?|\n|\t/g, " "),
  });
  const valueNow = editing.valueNow;
  const cursorPos = editing.caret;
  /** The selection's ends, or null for a bare caret. */
  const selStart = () => (editing.anchor() === editing.caret() ? null : Math.min(editing.anchor(), editing.caret()));
  const selEnd = () => (editing.anchor() === editing.caret() ? null : Math.max(editing.anchor(), editing.caret()));
  const signalOpts = { ownedWrite: true as const };
  const [isFocused, setIsFocused] = createSignal(false, signalOpts);
  const cursorVisible = createCaretBlink(isFocused, editing.caret);

  const fontName = () => props.font ?? "body";
  const fontSize = () => props.size;
  const padY = () => props.padding ?? 2;
  const padX = () => props.padding ?? 4;
  const bordered = () => !props.borderless;
  const borderW = () => (bordered() ? 1 : 0);
  const fieldWidth = () => props.width ?? 120;
  const fieldHeight = () => props.height ?? 16;
  const innerTextH = () => Math.max(1, fieldHeight() - (padY() + borderW()) * 2);
  /** The left padding: an icon sits in it, before the text. */
  const padLeft = () => padX() + (props.icon ? props.icon.width + ICON_GAP : 0);
  const contentWidth = () => Math.max(1, fieldWidth() - padLeft() - padX() - borderW() * 2);
  /** Pointer x (border-box local) → x within the content box. */
  const localToContentX = (lx: number) => lx - borderW() - padLeft();
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
    if (props.selectAllOnFocus && isInitialFocus) {
      isInitialFocus = false;
      if (props.initialCaretIndex === undefined) editing.select(valueNow().length, 0);
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

  // --- Keyboard ---
  function handleKeyDown(key: string, mod: Modifiers): void {
    if (props.onInterrupt && mod.ctrl && key.toLowerCase() === "c") { props.onInterrupt(); return; }
    if (!props.disabled && props.onHistory && (key === "ArrowUp" || key === "ArrowDown")) { props.onHistory(key === "ArrowUp" ? -1 : 1); editing.select(props.value.length); return; }
    if (props.disabled) return;
    if (editing.key(key, mod)) return;
    if (key === "Enter" || key === "Return") props.onSubmit?.(valueNow());
    else if (key === "Escape") props.onCancel?.();
  }

  /** Typed characters, and pasted text one character at a time; the host sends a keypress after each keydown. */
  function handleKeyPress(char: string): void {
    if (props.disabled || char.length !== 1) return;
    editing.insert(char);
  }

  // --- Mouse ---
  function indexAtPointer(lx: number): number {
    return pixelsToCharIndex(localToContentX(lx) + scrollX());
  }

  function select({ anchor, caret }: TextClickSelection): void {
    editing.select(caret, anchor);
  }

  function handleMouseDown(lx: number, ly: number): void {
    if (props.disabled) return;
    if (rootNode) focusManager.focus(rootNode);
    select(clicks.down(lx, ly, valueNow(), indexAtPointer(lx), heldModifiers().shift ? editing.anchor() : undefined));
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
    Math.max(padLeft(), charOffsetToPixels(cursorPos()) + padLeft() - 1) - scrollX();
  const selPixelStart = () => {
    const ss = selStart(), se = selEnd();
    if (ss === null || se === null) return 0;
    return charOffsetToPixels(Math.min(ss, se)) + padLeft() - scrollX();
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
    return r ? padLeft() + charOffsetToPixels(r.lo) - scrollX() : 0;
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
      borderRadius={bordered() ? props.borderRadius ?? radius() : undefined}
      paddingTop={padY()}
      paddingBottom={padY()}
      paddingLeft={padLeft()}
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
      onPaste={(text: string) => editing.insert(text, "other")}
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
          left={padLeft() - scrollX()}
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
          left={padLeft()}
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

      {/* The icon on white over its padding, so text scrolled left slides under it. */}
      <Show when={props.icon}>
        {(icon) => (
          <box position="absolute" left={0} top={padY()} width={padLeft()} height={innerTextH()} background={0} paddingLeft={padX()} justifyContent="center">
            <image src={icon()} width={icon().width} height={icon().height} />
          </box>
        )}
      </Show>
    </box>
  );
}
