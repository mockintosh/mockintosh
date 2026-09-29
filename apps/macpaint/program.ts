/**
 * Runs MacPaint.p. The program is one coroutine (`paintMain`); input is
 * posted to its event queue, and it is stepped to its next wait on every
 * input, frame and settled promise. After each step the windows whose
 * pixels changed are reported, so the UI repaints exactly those.
 */

import { GetPort, SetPort, type GrafPort, type Point, type Rect } from "@mockintosh/quickdraw";
import type { CursorFace, CursorSpec } from "@mockintosh/ui";
import { paintMain, menuModel, type PaintMenu } from "./commands";
import { Paint, type PaintFileRef, type PaintHost, type ToolCursor } from "./state";
import { makeEvent, Toolbox, type Co, type EventModifiers, type EventRecord, type MacWindow } from "./toolbox";

export type ProgramListener = (changed: ReadonlySet<MacWindow>) => void;

export class PaintProgram {
  readonly tb: Toolbox;
  readonly paint: Paint;
  private readonly routine: Co;
  /** The program's `thePort`, kept across yields while the UI draws with its own. */
  private port: GrafPort | null = null;
  private running = false;
  private finished = false;
  private readonly snapshots = new Map<MacWindow, Uint8Array>();
  private readonly listeners = new Set<ProgramListener>();
  private faceFor: { cursor: ToolCursor; face: CursorFace } | null = null;

  constructor(host: PaintHost, now: () => number, screen: Rect, firstFile: PaintFileRef | null) {
    this.tb = new Toolbox(now);
    const savePort = GetPort();
    this.paint = new Paint(host, this.tb, screen);
    this.port = GetPort();
    if (savePort) SetPort(savePort);
    this.routine = paintMain(this.paint, firstFile);
  }

  get done(): boolean {
    return this.finished;
  }

  subscribe(listener: ProgramListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Run the program to its next wait. */
  step(): void {
    if (this.running || this.finished) return;
    this.running = true;
    const uiPort = GetPort();
    if (this.port) SetPort(this.port);
    try {
      const result = this.routine.next();
      const wait = result.value;
      if (result.done) this.finished = true;
      else if (wait && wait.kind === "promise") {
        const resume = (): void => this.step();
        wait.promise.then(resume, resume);
      }
    } catch (error) {
      this.finished = true;
      console.error("MacPaint stopped:", error);
      this.paint.host.quit();
    } finally {
      this.port = GetPort();
      if (uiPort) SetPort(uiPort);
      this.running = false;
    }
    this.report();
  }

  private report(): void {
    const changed = new Set<MacWindow>();
    for (const win of this.tb.windowList()) {
      const pixels = win.bits.baseAddr;
      const snap = this.snapshots.get(win);
      if (!snap || snap.length !== pixels.length || !sameBytes(snap, pixels)) {
        changed.add(win);
        this.snapshots.set(win, pixels.slice());
      }
    }
    for (const win of [...this.snapshots.keys()]) {
      if (!this.tb.windowList().includes(win)) this.snapshots.delete(win);
    }
    for (const listener of this.listeners) listener(changed);
  }

  private post(event: EventRecord): void {
    this.tb.postEvent(event);
    this.step();
  }

  private at(win: MacWindow, local: Point): Point {
    return { h: win.origin.h + local.h, v: win.origin.v + local.v };
  }

  mouseDown(win: MacWindow, local: Point, modifiers: EventModifiers): void {
    this.tb.mouse = this.at(win, local);
    this.tb.setButton(true);
    const event = makeEvent("mouseDown", this.tb.tickCount(), this.tb.mouse, modifiers);
    event.part = "inContent";
    event.window = win;
    this.post(event);
  }

  mouseMove(win: MacWindow, local: Point): void {
    this.tb.mouse = this.at(win, local);
    this.step();
  }

  mouseUp(win: MacWindow, local: Point, modifiers: EventModifiers): void {
    this.tb.mouse = this.at(win, local);
    this.step();
    this.tb.setButton(false);
    this.post(makeEvent("mouseUp", this.tb.tickCount(), this.tb.mouse, modifiers));
  }

  keyDown(key: string, modifiers: EventModifiers, repeat = false): void {
    const event = makeEvent(repeat ? "autoKey" : "keyDown", this.tb.tickCount(), this.tb.mouse, modifiers);
    event.key = key;
    this.post(event);
  }

  /** A menu item chosen: `MenuSelect`'s answer to a click in the menubar. */
  menu(menu: number, item: number): void {
    const event = makeEvent("mouseDown", this.tb.tickCount(), this.tb.mouse, this.paint.host.heldModifiers());
    event.part = "inMenuBar";
    event.menu = menu;
    event.item = item;
    this.post(event);
  }

  goAway(): void {
    const event = makeEvent("mouseDown", this.tb.tickCount(), this.tb.mouse, this.paint.host.heldModifiers());
    event.part = "inGoAway";
    event.window = this.paint.myWind;
    this.post(event);
  }

  activate(active: boolean): void {
    if (active === this.paint.active) return;
    const event = makeEvent("activateEvt", this.tb.tickCount(), this.tb.mouse, this.paint.host.heldModifiers());
    event.active = active;
    this.post(event);
  }

  /** A document opened from the Finder while MacPaint is already running. */
  open(file: PaintFileRef): void {
    this.paint.pendingOpen = file;
    this.step();
  }

  menus(): PaintMenu[] {
    return menuModel(this.paint);
  }

  /** What `SetCursor` last installed. */
  cursor(): CursorSpec {
    const p = this.paint;
    if (p.cursor === "watch") return "wait";
    if (p.cursor === "arrow") return "arrow";
    if (this.faceFor?.cursor !== p.toolCursor) {
      this.faceFor = { cursor: p.toolCursor, face: faceFromWords(p.toolCursor) };
    }
    return this.faceFor.face;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A 'CURS' as a cursor face: `data` and `mask` rows, MSB leftmost. */
function faceFromWords(cursor: ToolCursor): CursorFace {
  const size = 16;
  const data = new Uint8Array(size * size);
  const mask = new Uint8Array(size * size);
  for (let v = 0; v < size; v++) {
    for (let h = 0; h < size; h++) {
      const bit = 0x8000 >> h;
      data[v * size + h] = (cursor.data[v] ?? 0) & bit ? 1 : 0;
      mask[v * size + h] = (cursor.mask[v] ?? 0) & bit ? 1 : 0;
    }
  }
  return { sprite: { width: size, height: size, data, mask }, hotSpot: { h: cursor.hotSpot.h, v: cursor.hotSpot.v } };
}
