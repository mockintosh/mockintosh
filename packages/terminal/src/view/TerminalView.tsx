import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { heldModifiers, type JSX, type Modifiers } from "@mockintosh/ui";
import { createTerminalScreen, type TerminalScreen, type TerminalSize } from "../screen";
import { encodeFocus, encodeKey, encodeMouse, encodePaste, type MouseAction, type MouseButton } from "../keys";
import { SelectionModel, type CellPosition } from "../selection";
import { CELL_HEIGHT, CELL_WIDTH } from "../glyphs";
import type { TerminalProcess } from "../process";
import { GridPainter, PAD_X, PAD_Y, gridSize, type RowOverlay } from "./render";

/** What an app's menus need from its terminal. */
export interface TerminalHandle {
  readonly screen: TerminalScreen;
  /** The selected text, or null when nothing is selected. */
  selection(): string | null;
  /** Paste as the program asked (bracketed or not). */
  paste(text: string): void;
  /** Send bytes as if typed. */
  type(data: string): void;
  selectAll(): void;
  clearScrollback(): void;
  reset(): void;
}

export interface TerminalViewProps {
  /** The program on the other side; the view connects and disconnects it. */
  process: TerminalProcess | null;
  width: number;
  height: number;
  /** The window is active: a solid, blinking cursor and focus reports. */
  active?: boolean;
  scheduler: { requestFrame(callback: (timeMs: number) => void): () => void; now(): number };
  scrollback?: number;
  /** Name for inspection and automation. */
  name?: string;
  onTitle?(title: string): void;
  onExit?(code: number): void;
  onBell?(): void;
  /** Called once with the terminal's handle. */
  onReady?(handle: TerminalHandle): void;
}

const MULTI_CLICK_MS = 400;
const SYNC_RELEASE_MS = 150;

/**
 * A terminal: a screen of Monaco 9 cells in 6×11 boxes, drawn in one
 * `<raster>`, that a program drives with VT/xterm escape sequences, and a
 * keyboard and mouse that send bytes back.
 */
export function TerminalView(props: TerminalViewProps): JSX.Element {
  const initial = gridSize(untrack(() => props.width), untrack(() => props.height));
  const screen = createTerminalScreen({ size: initial, scrollback: untrack(() => props.scrollback) ?? 2000 });
  const painter = new GridPainter(untrack(() => props.width), untrack(() => props.height));
  const [revision, setRevision] = createSignal(0, { ownedWrite: true });
  const [focused, setFocused] = createSignal(false, { ownedWrite: true });
  const [blink, setBlink] = createSignal(true, { ownedWrite: true });
  const [flash, setFlash] = createSignal(false, { ownedWrite: true });
  /** The screen's text, for inspection: what automation and agents read. */
  const [screenText, setScreenText] = createSignal("", { ownedWrite: true });
  let frameRequested: (() => void) | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let process: TerminalProcess | null = null;
  let size: TerminalSize = initial;

  const selection = new SelectionModel(
    (line) => {
      const l = screen.line(line);
      return l ? l.text : "";
    },
    () => screen.size.cols,
  );

  function visibleText(): string {
    const frame = screen.frame();
    const lines = frame.rows.map((row) => row.cells.map((c) => (c.width === 0 ? "" : c.text || " ")).join("").trimEnd());
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join("\n");
  }

  function repaint(): void {
    setScreenText(visibleText());
    if (frameRequested) return;
    frameRequested = props.scheduler.requestFrame(() => {
      frameRequested = null;
      setRevision((r) => r + 1);
    });
  }

  // Draw at most once a frame, and not while the program holds synchronized
  // output — unless it holds it too long, so a crashed program can't freeze the window.
  const offChange = screen.onChange(() => {
    if (screen.modes.synchronizedOutput) {
      syncTimer ??= setTimeout(() => {
        syncTimer = null;
        repaint();
      }, SYNC_RELEASE_MS);
      return;
    }
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    repaint();
  });
  const offTitle = screen.onTitle((title) => props.onTitle?.(title));
  const offBell = screen.onBell(() => {
    if (props.onBell) {
      props.onBell();
      return;
    }
    // The visual bell: the screen flashes, as with the Mac's volume at zero.
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  });
  const offInput = screen.onInput((data) => process?.write(data));

  createEffect(
    () => props.process,
    (next) => {
      process = next;
      if (!next) return;
      let open = true;
      const off = next.onOutput((data) => {
        if (open) void screen.write(data);
      });
      next.resize(screen.size);
      void next.exited.then((code) => {
        if (open) props.onExit?.(code);
      });
      return () => {
        open = false;
        off();
        if (process === next) process = null;
      };
    },
  );

  // The window's size decides the grid; the program hears about it once it settles.
  createEffect(
    () => ({ width: props.width, height: props.height }),
    ({ width, height }) => {
      painter.resize(width, height);
      const next = gridSize(width, height);
      if (next.cols === size.cols && next.rows === size.rows) {
        repaint();
        return;
      }
      size = next;
      screen.resize(next);
      process?.resize(next);
      repaint();
    },
  );

  const cursorOn = () => focused() && props.active !== false;
  createEffect(
    () => cursorOn(),
    (on) => {
      setBlink(true);
      repaint();
      if (screen.modes.sendFocus) screen.input(encodeFocus(on));
      if (!on) return;
      const id = setInterval(() => setBlink((v) => !v), 530);
      return () => clearInterval(id);
    },
  );

  // The cursor's blink and shape, and the bell's flash, are drawn by onPaint, which nothing tracks.
  createEffect(
    () => [blink(), flash(), cursorOn()] as const,
    () => repaint(),
  );

  onCleanup(() => {
    frameRequested?.();
    if (syncTimer) clearTimeout(syncTimer);
    offChange();
    offTitle();
    offBell();
    offInput();
    screen.dispose();
  });

  // ---------------------------------------------------------------- input

  function send(data: string): void {
    selection.clear();
    screen.scrollToBottom();
    screen.input(data);
  }

  function onKeyDown(key: string, mods: Modifiers): void {
    // Scrollback keys, as in Apple's Terminal: Shift-Page Up/Down, Shift-Home/End.
    if (mods.shift && !mods.ctrl && !mods.alt && !screen.frame().alternate) {
      const page = Math.max(1, size.rows - 1);
      if (key === "PageUp") return screen.scrollBy(-page);
      if (key === "PageDown") return screen.scrollBy(page);
      if (key === "Home") return screen.scrollBy(-screen.frame().length);
      if (key === "End") return screen.scrollToBottom();
    }
    const data = encodeKey(key, mods, screen.modes);
    if (data !== null) send(data);
  }

  function onKeyPress(ch: string): void {
    send(ch);
  }

  function onPaste(text: string): void {
    send(encodePaste(text, screen.modes.bracketedPaste));
  }

  function cellAt(x: number, y: number): { col: number; row: number } {
    return {
      col: Math.max(0, Math.min(size.cols - 1, Math.floor((x - PAD_X) / CELL_WIDTH))),
      row: Math.max(0, Math.min(size.rows - 1, Math.floor((y - PAD_Y) / CELL_HEIGHT))),
    };
  }

  /** A buffer position for a point, with columns rounded to the nearer cell edge for selecting. */
  function positionAt(x: number, y: number): CellPosition {
    const frame = screen.frame();
    const row = Math.floor((y - PAD_Y) / CELL_HEIGHT);
    const col = Math.max(0, Math.min(size.cols, Math.round((x - PAD_X) / CELL_WIDTH)));
    return { line: Math.max(0, Math.min(frame.length - 1, frame.viewportTop + row)), col };
  }

  const mouse = { button: 0 as MouseButton, down: false, reported: false };
  const clicks = { count: 0, at: 0, x: -1, y: -1 };
  let wheelRemainder = 0;

  function report(action: MouseAction, x: number, y: number, mods: Modifiers): void {
    const { col, row } = cellAt(x, y);
    screen.input(encodeMouse(action, mouse.button, col, row, mods, screen.modes.sgrMouse));
  }

  /** The program asked for the mouse, and Shift isn't asking for a selection instead. */
  function reporting(mods: Modifiers): boolean {
    return screen.modes.mouseTracking !== "none" && !mods.shift;
  }

  function onMouseDown(x: number, y: number): void {
    const mods = heldModifiers();
    mouse.down = true;
    mouse.button = mods.ctrl ? 2 : 0;
    if (reporting(mods)) {
      mouse.reported = true;
      report("press", x, y, mods);
      return;
    }
    mouse.reported = false;
    const now = props.scheduler.now();
    const near = Math.abs(x - clicks.x) < 4 && Math.abs(y - clicks.y) < 4;
    clicks.count = now - clicks.at < MULTI_CLICK_MS && near ? (clicks.count % 3) + 1 : 1;
    clicks.at = now;
    clicks.x = x;
    clicks.y = y;
    const at = positionAt(x, y);
    if (mods.shift && selection.range()) selection.extend(at);
    else selection.start(at, clicks.count === 3 ? "line" : clicks.count === 2 ? "word" : "char");
    repaint();
  }

  function onDrag(x: number, y: number): void {
    const mods = heldModifiers();
    if (mouse.reported) {
      if (screen.modes.mouseTracking === "drag" || screen.modes.mouseTracking === "any") report("drag", x, y, mods);
      return;
    }
    // Dragging above or below the view scrolls it, so a selection can reach scrollback.
    if (y < PAD_Y) screen.scrollBy(-1);
    else if (y > PAD_Y + size.rows * CELL_HEIGHT) screen.scrollBy(1);
    selection.extend(positionAt(x, y));
    repaint();
  }

  function onMouseUp(x: number, y: number): void {
    mouse.down = false;
    if (mouse.reported) {
      if (screen.modes.mouseTracking !== "x10") report("release", x, y, heldModifiers());
      mouse.reported = false;
    }
  }

  function onMouseMove(x: number, y: number): void {
    if (screen.modes.mouseTracking === "any") report("move", x, y, heldModifiers());
  }

  let lastMouse = { x: 0, y: 0 };
  function onScroll(deltaY: number): void {
    wheelRemainder += deltaY;
    const lines = Math.trunc(wheelRemainder / CELL_HEIGHT);
    if (lines === 0) return;
    wheelRemainder -= lines * CELL_HEIGHT;
    const mods = heldModifiers();
    if (reporting(mods)) {
      for (let i = 0; i < Math.abs(lines); i++) report(lines < 0 ? "wheel-up" : "wheel-down", lastMouse.x, lastMouse.y, mods);
      return;
    }
    if (screen.frame().alternate) {
      // A full-screen program without the mouse: the wheel is the arrow keys, as in xterm.
      const key = encodeKey(lines < 0 ? "ArrowUp" : "ArrowDown", mods, screen.modes)!;
      screen.input(key.repeat(Math.abs(lines)));
      return;
    }
    screen.scrollBy(lines);
  }

  // ---------------------------------------------------------------- drawing

  function overlays(viewportTop: number, cursorRow: number | null, cursorCol: number, cursorWidth: 1 | 2) {
    const range = selection.active ? selection.range() : null;
    return (y: number): RowOverlay => {
      const overlay: RowOverlay = {};
      const line = viewportTop + y;
      if (range && line >= range.from.line && line <= range.to.line) {
        const from = line === range.from.line ? range.from.col : 0;
        const to = line === range.to.line ? range.to.col : size.cols;
        if (to > from) overlay.selection = [from, to];
      }
      if (y === cursorRow) {
        const shape = cursorOn() ? (blink() ? "block" : "none") : "hollow";
        overlay.cursor = { col: cursorCol, width: cursorWidth, shape };
      }
      return overlay;
    };
  }

  const handle: TerminalHandle = {
    screen,
    selection() {
      const r = selection.active ? selection.range() : null;
      if (!r) return null;
      return screen.text(r.from, { line: r.to.line, col: r.to.col });
    },
    paste: onPaste,
    type: send,
    selectAll() {
      selection.selectAll(screen.frame().length);
      repaint();
    },
    clearScrollback() {
      selection.clear();
      screen.clearScrollback();
    },
    reset() {
      selection.clear();
      screen.reset();
    },
  };
  props.onReady?.(handle);

  return (
    <raster
      width={props.width}
      height={props.height}
      revision={revision()}
      tabIndex={0}
      autoFocus
      rawKeys
      cursor="text"
      semantic={{ name: props.name ?? "terminal", role: "terminal", value: screenText() }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      onKeyPress={onKeyPress}
      onPaste={onPaste}
      onMouseDown={onMouseDown}
      onDrag={onDrag}
      onMouseUp={onMouseUp}
      onMouseMove={(x, y) => {
        lastMouse = { x, y };
        onMouseMove(x, y);
      }}
      onScroll={onScroll}
      onPaint={(surface) => {
        const frame = screen.frame();
        const cursor = frame.cursor;
        const cursorCell = cursor ? frame.rows[cursor.y]?.cells[cursor.x] : undefined;
        painter.paint(frame, overlays(frame.viewportTop, cursor?.visible ? cursor.y : null, cursor?.x ?? 0, cursorCell?.width === 2 ? 2 : 1));
        if (flash()) {
          const inverted = painter.pixels.map((p) => (p ? 0 : 1));
          surface.blitPixels(inverted, painter.width, painter.height, 0, 0);
          return;
        }
        surface.blitPixels(painter.pixels, painter.width, painter.height, 0, 0);
      }}
    />
  );
}
