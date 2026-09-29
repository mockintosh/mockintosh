/**
 * The slice of the Event, Window and Dialog Managers MacPaint.p calls, run
 * as a cooperative coroutine. The Pascal program polls — `StillDown`,
 * `GetNextEvent`, `REPEAT UNTIL TickCount > t` — so every routine that
 * waits is a generator here, and each wait `yield`s back to the driver,
 * which resumes it on the next pointer event, key, animation frame or
 * settled promise.
 */

import { GetPort, type BitMap, type GrafPort, type Point, type Rect } from "@mockintosh/quickdraw";
import { copyPt, pt } from "./bits";

/** Why a coroutine gave up control. */
export type Wait = { readonly kind: "tick" } | { readonly kind: "promise"; readonly promise: Promise<unknown> };

/** A routine that may wait: `yield*` it from another. */
export type Co<T = void> = Generator<Wait, T, unknown>;

const TICK: Wait = { kind: "tick" };

/** Let time pass: resume on the next frame or input. */
export function* tick(): Co {
  yield TICK;
}

/** Wait for `promise`, as the synchronous File Manager calls it replaces did. */
export function* awaitPromise<T>(promise: Promise<T>): Co<T> {
  let settled = false;
  let failed = false;
  let value: T | undefined;
  let error: unknown;
  promise.then(
    (v) => {
      settled = true;
      value = v;
    },
    (e: unknown) => {
      settled = true;
      failed = true;
      error = e;
    },
  );
  yield { kind: "promise", promise };
  while (!settled) yield TICK;
  if (failed) throw error;
  return value as T;
}

export interface EventModifiers {
  shift: boolean;
  option: boolean;
  command: boolean;
}

export const NO_MODIFIERS: EventModifiers = { shift: false, option: false, command: false };

/** `FindWindow`'s part codes that MacPaint distinguishes. */
export type WindowPart = "inMenuBar" | "inContent" | "inGoAway" | "inDesk";

export type EventWhat = "mouseDown" | "mouseUp" | "keyDown" | "autoKey" | "activateEvt";

/** An `EventRecord`, with `FindWindow` (and for the menubar `MenuSelect`) already answered. */
export interface EventRecord {
  what: EventWhat;
  /** Ticks. */
  when: number;
  /** Global coordinates. */
  where: Point;
  modifiers: EventModifiers;
  /** `keyDown`: the character, `CHR(BitAnd(message, 255))`. */
  key: string;
  /** `mouseDown`: which part of which window was hit. */
  part: WindowPart;
  window: MacWindow | null;
  /** `inMenuBar`: the command chosen. */
  menu: number;
  item: number;
  /** `activateEvt`: whether MacPaint became active. */
  active: boolean;
}

/** A window MacPaint draws into: its port, its pixels, and where its content sits on the screen. */
export interface MacWindow {
  port: GrafPort;
  /** Global position of the content's top-left. */
  origin: Point;
  /** The window's pixels, over its content in window coordinates. */
  bits: BitMap;
}

/** Ticks between two clicks that make a double click (`GetDblTime`). */
export const DOUBLE_TIME = 32;
/** Ticks the caret stays on and off (`GetCaretTime`). */
export const CARET_TIME = 32;

export class Toolbox {
  /** The mouse in global coordinates. */
  mouse: Point = pt(0, 0);
  private buttonDown = false;
  private readonly queue: EventRecord[] = [];
  private readonly windows = new Map<GrafPort, MacWindow>();

  constructor(private readonly now: () => number) {}

  tickCount(): number {
    return Math.floor((this.now() * 60) / 1000);
  }

  setButton(down: boolean): void {
    this.buttonDown = down;
  }

  /** `Button`. */
  button(): boolean {
    return this.buttonDown;
  }

  /** `StillDown`: the button is down and no mouse event is waiting. */
  stillDown(): boolean {
    return this.buttonDown && !this.queue.some((e) => e.what === "mouseDown" || e.what === "mouseUp");
  }

  postEvent(event: EventRecord): void {
    this.queue.push(event);
  }

  /** `GetNextEvent(everyEvent, …)`: the next event, or `null` for a null event. */
  getNextEvent(): EventRecord | null {
    return this.queue.shift() ?? null;
  }

  hasEvents(): boolean {
    return this.queue.length > 0;
  }

  flushEvents(): void {
    this.queue.length = 0;
  }

  addWindow(win: MacWindow): void {
    this.windows.set(win.port, win);
  }

  removeWindow(win: MacWindow): void {
    this.windows.delete(win.port);
  }

  windowList(): MacWindow[] {
    return [...this.windows.values()];
  }

  private currentWindow(): MacWindow | undefined {
    const port = GetPort();
    return port ? this.windows.get(port) : undefined;
  }

  /** `GlobalToLocal` in `thePort`. */
  globalToLocal(p: Point): Point {
    const win = this.currentWindow();
    if (!win) return copyPt(p);
    return pt(p.h - win.origin.h + win.port.portRect.left, p.v - win.origin.v + win.port.portRect.top);
  }

  /** `LocalToGlobal` in `thePort`. */
  localToGlobal(p: Point): Point {
    const win = this.currentWindow();
    if (!win) return copyPt(p);
    return pt(p.h + win.origin.h - win.port.portRect.left, p.v + win.origin.v - win.port.portRect.top);
  }

  /** `GetMouse`: the mouse in `thePort`'s local coordinates. */
  getMouse(): Point {
    return this.globalToLocal(this.mouse);
  }

  /** `PtInRect` against a window's content, in global coordinates. */
  static contentRect(win: MacWindow): Rect {
    const w = win.bits.bounds.right - win.bits.bounds.left;
    const h = win.bits.bounds.bottom - win.bits.bounds.top;
    return { left: win.origin.h, top: win.origin.v, right: win.origin.h + w, bottom: win.origin.v + h };
  }
}

/** A null-ish event with every field filled, for building real ones from. */
export function makeEvent(what: EventWhat, when: number, where: Point, modifiers: EventModifiers): EventRecord {
  return { what, when, where: copyPt(where), modifiers: { ...modifiers }, key: "", part: "inDesk", window: null, menu: 0, item: 0, active: false };
}
