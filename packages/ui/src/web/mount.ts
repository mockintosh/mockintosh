import { CopyBits, srcCopy, type BitMap, type Rect } from "@mockintosh/quickdraw";
import { bitMapHeight, bitMapWidth, makeRect, newBitMap } from "@mockintosh/quickdraw/bits";
import type { JSX } from "../jsx-runtime";
import { cssCursor, DEFAULT_CURSOR, type CursorCSSTable } from "../cursor";
import { copyBitMapBytes, moveSoftwareCursor } from "../cursorComposite";
import { cursorFromFaceCached, type CursorFaceTable } from "../cursorFace";
import { resolveMacCursorFace } from "../cursors/mac";
import type { UIServices } from "../services";
import { createDoubleClickTracker } from "../pointer";
import { createUI, type UIInstance } from "../ui";
import type { UITheme } from "../theme";
import { CanvasPresenter } from "./CanvasPresenter";
import { createWebImageService } from "./decode";
import { copyHostPalette, DEFAULT_HOST_PALETTE, type HostPalette } from "./palette";
import { hostKeyStrokes } from "./hostKeyboard";
import { hostPresentsCursor, pointerKind } from "./hostPointer";
import { wheelDeltaY, wheelIsPinchZoom } from "./hostWheel";
import { createScreenCanvas, type ScreenCanvasSize } from "./screenCanvas";

export type CanvasSize = ScreenCanvasSize;

/**
 * How the web host presents node `cursor` names.
 * `"css"` — CSS keywords. `"mac"` — hide the host pointer and blit 1-bit faces.
 * `"none"` — leave the compositor alone (OS `drawCursor`).
 */
export type CursorPresentation = "css" | "mac" | "none";

export interface CanvasUIOptions {
  root: HTMLElement;
  component: () => JSX.Element;
  services?: UIServices;
  /** Logical framebuffer. Use `{ mode: "viewport", scale }` to follow the window. */
  size?: CanvasSize;
  /** Shorthand for `size: { width, height }`. */
  width?: number;
  height?: number;
  /**
   * `"css"` (default) maps `cursor` names to `canvas.style.cursor`.
   * `"mac"` paints System 7.5.3-style 1-bit faces into the framebuffer.
   * `"none"` leaves the OS/software compositor in charge.
   */
  cursors?: CursorPresentation;
  /** Replace the CSS value for a named cursor (`pointer` → `url(...) 1 1, pointer`). */
  cursorCSS?: CursorCSSTable;
  /** Replace any Macintosh face when `cursors` is `"mac"`. */
  cursorFaces?: CursorFaceTable;
  /** Ink / paper colors when expanding the 1-bit framebuffer. */
  palette?: HostPalette;
  /** Chrome tokens (radius). Live updates go through `host.setTheme`. */
  theme?: Partial<UITheme>;
}

export interface CanvasUIHost {
  readonly canvas: HTMLCanvasElement;
  readonly ui: UIInstance;
  setCursors(mode: CursorPresentation): void;
  setCursorFaces(faces?: CursorFaceTable): void;
  /** Recolor ink (bit 1) and paper (bit 0). Does not change the framebuffer. */
  setPalette(palette: HostPalette): void;
  /** Update chrome tokens. Widgets that read the theme repaint. */
  setTheme(theme: Partial<UITheme>): void;
  /** Copy of the current framebuffer. */
  snapshot(): BitMap;
  /** Copy a rectangle out of the current framebuffer. */
  snapshotRect(x: number, y: number, width: number, height: number): BitMap;
  /** Flush Solid, layout, and paint. Does not present. */
  paint(): void;
  /**
   * While set, each tick stamps `bitmap` at `(x, y)`. The live tree is
   * framed only when dirty (header hover, etc.). `tick` runs first.
   * Pointer events reach the live tree unless `blockPointer` is set.
   * Pass `null` to resume.
   */
  setOverlay(layer: CanvasOverlay | null): void;
  dispose(): void;
}

/** A 1-bit layer composited over the live tree after `frame()`. */
export interface CanvasOverlay {
  bitmap: BitMap;
  x: number;
  y: number;
  tick?: () => void;
  /** When true, pointer events that hit the overlay rect are dropped. */
  blockPointer?: boolean;
}

function copyBitMap(src: BitMap): BitMap {
  const dst = newBitMap(bitMapWidth(src), bitMapHeight(src));
  dst.baseAddr.set(src.baseAddr);
  return dst;
}

function resolveSize(options: CanvasUIOptions): CanvasSize {
  if (options.size) return options.size;
  if (options.width != null && options.height != null) {
    return { width: options.width, height: options.height };
  }
  throw new Error("mountCanvasUI requires size or width and height");
}

function webClipboard(): UIServices["clipboard"] {
  return typeof navigator !== "undefined" && navigator.clipboard
    ? {
        readText: () => navigator.clipboard.readText(),
        writeText: (text) => navigator.clipboard.writeText(text),
      }
    : undefined;
}

/** Mount a Solid tree on a 1-bit canvas. The default web host for the kit. */
export function mountCanvasUI(options: CanvasUIOptions): CanvasUIHost {
  const { root, component } = options;
  const size = resolveSize(options);

  let presenter: CanvasPresenter | null = null;
  let ui: UIInstance | null = null;
  let disposed = false;
  let dirty = true;
  let frameId = 0;
  let overlay: CanvasOverlay | null = null;
  let palette = copyHostPalette(options.palette ?? DEFAULT_HOST_PALETTE);

  const screenEl = createScreenCanvas(root, size, {
    onLogicalSize: (width, height) => {
      if (disposed) return;
      applyFramebuffer(width, height);
    },
  });
  const { canvas, toScreen } = screenEl;

  let screen = newBitMap(screenEl.width, screenEl.height);
  let presentBits = newBitMap(screenEl.width, screenEl.height);
  let cursorRect: Rect | null = null;
  let framed = false;
  function applyFramebuffer(width: number, height: number): void {
    screen = newBitMap(width, height);
    presentBits = newBitMap(width, height);
    cursorRect = null;
    framed = false;
    presenter = new CanvasPresenter(screen, screenEl.ctx, palette);
    overlay = null;
    if (ui) ui.resize(screen);
    dirty = true;
  }
  applyFramebuffer(screenEl.width, screenEl.height);

  ui = createUI({
    screen,
    scheduleRender: () => {
      dirty = true;
    },
    theme: options.theme,
    services: {
      images: createWebImageService(),
      clipboard: webClipboard(),
      ...options.services,
    },
  });

  const unmount = ui.render(component);

  const doubleClick = createDoubleClickTracker();
  const presentableCursor = (mode: CursorPresentation): CursorPresentation =>
    mode !== "none" && !hostPresentsCursor() ? "none" : mode;

  let cursorMode: CursorPresentation = presentableCursor(options.cursors ?? "css");
  let cursorFaces = options.cursorFaces;
  let pointerX = 0;
  let pointerY = 0;
  let pointerOnCanvas = false;

  const usesComposite = (): boolean => cursorMode === "mac" || overlay !== null;

  const macCursor = () => {
    if (cursorMode !== "mac" || !pointerOnCanvas) return undefined;
    const face = resolveMacCursorFace(ui!.cursorAt(pointerX, pointerY), cursorFaces);
    return face ? cursorFromFaceCached(face) : undefined;
  };

  const presentCanvas = (): void => {
    if (!presenter) return;
    presenter.present(usesComposite() ? presentBits : screen);
  };
  const unsubInvalidate = screenEl.subscribeInvalidate(() => {
    dirty = true;
    presentCanvas();
  });

  const presentCursorRects = (prev: Rect | null, next: Rect | null): void => {
    if (!presenter) return;
    if (prev) presenter.presentRect(presentBits, prev);
    if (next) presenter.presentRect(presentBits, next);
  };

  /** Stamp the software cursor onto the last clean frame. No tree paint. */
  const stampMacCursor = (): void => {
    if (!framed || cursorMode !== "mac" || overlay) return;
    const prev = cursorRect;
    cursorRect = moveSoftwareCursor(screen, presentBits, prev, macCursor(), pointerX, pointerY);
    presentCursorRects(prev, cursorRect);
  };

  const compositeFrame = (): void => {
    copyBitMapBytes(screen, presentBits);
    if (overlay) {
      const w = bitMapWidth(overlay.bitmap);
      const h = bitMapHeight(overlay.bitmap);
      CopyBits(
        overlay.bitmap,
        presentBits,
        overlay.bitmap.bounds,
        makeRect(overlay.y, overlay.x, overlay.y + h, overlay.x + w),
        srcCopy,
        null,
      );
    }
    cursorRect = moveSoftwareCursor(screen, presentBits, null, macCursor(), pointerX, pointerY);
    framed = true;
    presentCanvas();
  };

  const applyHostCursor = (x: number, y: number, stamp = true) => {
    pointerX = x;
    pointerY = y;
    pointerOnCanvas = true;
    if (cursorMode === "none") return;
    if (cursorMode === "mac") {
      canvas.style.cursor = "none";
      if (stamp) stampMacCursor();
      return;
    }
    canvas.style.cursor = cssCursor(ui!.cursorAt(x, y), options.cursorCSS);
  };
  const syncHostCursor = () => {
    if (cursorMode === "mac") canvas.style.cursor = "none";
    else if (cursorMode === "css") {
      canvas.style.cursor = pointerOnCanvas
        ? cssCursor(ui!.cursorAt(pointerX, pointerY), options.cursorCSS)
        : cssCursor(DEFAULT_CURSOR, options.cursorCSS);
    }
  };
  syncHostCursor();

  const overlayHits = (x: number, y: number): boolean => {
    if (!overlay?.blockPointer) return false;
    const w = bitMapWidth(overlay.bitmap);
    const h = bitMapHeight(overlay.bitmap);
    return x >= overlay.x && y >= overlay.y && x < overlay.x + w && y < overlay.y + h;
  };

  const onPointerDown = (e: PointerEvent) => {
    const { x, y } = toScreen(e);
    applyHostCursor(x, y);
    if (overlayHits(x, y)) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const kind = pointerKind(e);
    ui!.dispatchPointer("mousedown", x, y, { kind });
    if (doubleClick.down(x, y, performance.now())) {
      ui!.dispatchPointer("dblclick", x, y, { kind });
    }
  };
  let pendingMove: PointerEvent | null = null;
  const flushMove = () => {
    const ev = pendingMove;
    pendingMove = null;
    if (!ev || disposed) return;
    const pos = toScreen(ev);
    applyHostCursor(pos.x, pos.y, false);
    if (overlayHits(pos.x, pos.y)) return;
    ui!.dispatchPointer("mousemove", pos.x, pos.y, { kind: pointerKind(ev) });
  };
  const finishPointer = (e: PointerEvent, cancel: boolean) => {
    // A same-frame flick would otherwise mouseup before the rAF move.
    flushMove();
    const { x, y } = toScreen(e);
    applyHostCursor(x, y);
    const kind = pointerKind(e);
    if (!overlayHits(x, y)) {
      ui!.dispatchPointer("mouseup", x, y, { kind, cancel });
    }
    // A finger leaves no pointer. Unstamp the software cursor so it
    // does not sit at the last tap.
    if (kind === "touch") onPointerLeave();
  };
  const onPointerUp = (e: PointerEvent) => {
    finishPointer(e, false);
  };
  const onPointerCancel = (e: PointerEvent) => {
    finishPointer(e, true);
  };
  const onPointerMove = (e: PointerEvent) => {
    const { x, y } = toScreen(e);
    applyHostCursor(x, y);
    if (pendingMove) {
      pendingMove = e;
      return;
    }
    pendingMove = e;
    requestAnimationFrame(flushMove);
  };
  const onPointerLeave = () => {
    pointerOnCanvas = false;
    if (cursorMode === "css") {
      canvas.style.cursor = cssCursor(DEFAULT_CURSOR, options.cursorCSS);
    } else if (cursorMode === "mac" && framed && !overlay) {
      const prev = cursorRect;
      cursorRect = moveSoftwareCursor(screen, presentBits, prev, undefined, 0, 0);
      presentCursorRects(prev, null);
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (wheelIsPinchZoom(e)) {
      e.preventDefault();
      // Pinch can evict the GPU texture without a Solid mutation.
      dirty = true;
      presentCanvas();
      return;
    }
    const { x, y } = toScreen(e);
    if (overlayHits(x, y)) {
      e.preventDefault();
      return;
    }
    if (ui!.dispatchPointer("scroll", x, y, { deltaY: wheelDeltaY(e, canvas.clientHeight) })) {
      e.preventDefault();
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const mods = {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    };
    for (const type of hostKeyStrokes(e.key, mods)) {
      ui!.dispatchKeyboard(type, e.key, mods);
    }
    if (e.key === "Tab" || e.key === "Backspace" || e.key === " " || (e.key.length === 1 && !mods.ctrl && !mods.meta)) {
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    ui!.dispatchKeyboard("keyup", e.key, {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);

  const paintTree = () => {
    ui!.frame();
    if (usesComposite()) compositeFrame();
    else {
      framed = true;
      presenter?.present(screen);
    }
  };
  const tick = () => {
    if (disposed) return;
    if (overlay) {
      overlay.tick?.();
      if (overlay) {
        if (dirty) {
          dirty = false;
          try {
            paintTree();
          } catch (error) {
            dirty = true;
            throw error;
          }
        } else {
          compositeFrame();
        }
      }
    } else if (dirty) {
      dirty = false;
      try {
        paintTree();
      } catch (error) {
        dirty = true;
        throw error;
      }
    }
    frameId = requestAnimationFrame(tick);
  };
  try {
    paintTree();
    dirty = false;
  } catch (error) {
    dirty = true;
    console.error(error);
  }
  frameId = requestAnimationFrame(tick);

  return {
    canvas,
    ui,
    setCursors(mode) {
      cursorMode = presentableCursor(mode);
      syncHostCursor();
      dirty = true;
    },
    setCursorFaces(faces) {
      cursorFaces = faces;
      dirty = true;
    },
    setPalette(next) {
      palette = copyHostPalette(next);
      presenter?.setPalette(palette);
      dirty = true;
    },
    setTheme(next) {
      ui!.setTheme(next);
    },
    snapshot() {
      return copyBitMap(usesComposite() ? presentBits : screen);
    },
    snapshotRect(x, y, width, height) {
      const w = Math.max(0, width | 0);
      const h = Math.max(0, height | 0);
      const dest = newBitMap(w, h);
      if (w < 1 || h < 1) return dest;
      const src = usesComposite() ? presentBits : screen;
      CopyBits(src, dest, makeRect(y, x, y + h, x + w), dest.bounds, srcCopy, null);
      return dest;
    },
    paint() {
      ui!.frame();
    },
    setOverlay(layer) {
      overlay = layer;
      if (!layer) dirty = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      unmount();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      unsubInvalidate();
      screenEl.dispose();
    },
  };
}
