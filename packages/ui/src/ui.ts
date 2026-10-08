/**
 * createUI — framework entrypoint.
 *
 * The host provides only a pixel buffer and dimensions.
 * createUI() initialises QuickDraw, decodes the built-in fonts,
 * installs the font bridge, and returns a UIInstance ready to render.
 *
 * Single-instance constraint: `_setRepaintHook` and QuickDraw's
 * `installFontManager` are module-level. One createUI() per process.
 */

import { debugInspectTree, type DebugNode } from "./debugInspect";
import { inspectTree, type InspectionNode } from "./inspection";
import { render, _setRepaintHook } from "./renderer";
import { createNode, markDirty } from "./nodes";
import { computeLayout } from "./layout";
import { notifyLayoutChanges } from "./layoutObserver";
import { settleScrollOffsets } from "./scroll";
import { createMeasureFunc, MeasureContext } from "./measure";
import { createDrawContext, drawTree, resizeDrawContext } from "./draw";
import { createFocusManager, applyPendingAutoFocus, registerFocusRoot } from "./focus";
import { FocusContext } from "./focusContext";
import { installFontBridge } from "./fonts/bridge";
import { onFontsChanged, registerFont as registerFontInRegistry } from "./fonts/registry";
import { measureText } from "./fonts/bridge";
import { createPointerDispatcher, type PointerDispatcher, type PointerExtras, type PointerType } from "./pointer";
import { noteModifiers } from "./modifiers";
import { cursorAt as resolveCursorAt, type CursorSpec } from "./cursor";
import type { CanvasNode, Modifiers } from "./nodes";
import type { FocusManager } from "./focus";
import { type BitMap, type GrafPort } from "@mockintosh/quickdraw";
import { bitMapHeight, bitMapWidth } from "@mockintosh/quickdraw/bits";
import { createComponent, createSignal, flush } from "solid-js";
import type { JSX } from "./jsx-runtime";
import { UIServicesContext, type UIServices } from "./services";
import { DEFAULT_THEME, ThemeContext, type UITheme } from "./theme";
import { ViewportContext, type ViewportSize } from "./viewport";
import { OverlayHost, dismissOverlayModal } from "./widgets/Overlay";

export interface UIConfig {
  /** The packed 1-bit framebuffer to draw into; the tree fills its bounds. */
  screen: BitMap;
  /**
   * Called whenever the Solid tree changes (property update, node insert/remove,
   * text change). The host should schedule a repaint when this fires.
   * Defaults to a no-op if not provided.
   */
  scheduleRender?: () => void;
  /** Host services components may use (clipboard, …). All optional. */
  services?: UIServices;
  /** Chrome tokens. Widgets read radius; a host can change it live. */
  theme?: Partial<UITheme>;
}

export interface UIInstance {
  inspect(): readonly InspectionNode[];
  /**
   * Hierarchical host tree for catalog / DevTools. Includes Solid owners
   * and reconstructed JSX attrs. Not the automation snapshot (`inspect`).
   */
  debugInspect(): DebugNode;
  /**
   * Mount a Solid component tree. Returns a cleanup function that
   * unmounts the tree and stops reactive effects.
   */
  render(component: () => JSX.Element): () => void;

  /**
   * Run one frame: compute layout → draw.
   * The host calls this every dirty frame and presents `screen` on the display.
   */
  frame(): void;

  /**
   * Dispatch a pointer event. Hit-tests the live node tree with capture.
   * `"scroll"` returns whether a scroll view or `onScroll` handler consumed
   * the delta. Other pointer types return false.
   */
  dispatchPointer(
    type: PointerType,
    x: number,
    y: number,
    extras?: PointerExtras
  ): boolean;

  /**
   * Dispatch a keyboard event to the currently focused element.
   */
  dispatchKeyboard(
    type: "keydown" | "keyup" | "keypress",
    key: string,
    modifiers?: Partial<Modifiers>
  ): void;

  /** Paste `text` into the focused element: its `onPaste`, else key-presses. */
  dispatchPaste(text: string): void;

  /** The focused element takes raw keys (`rawKeys`): the host sends it ⌃V and Tab as keys. */
  focusedTakesRawKeys(): boolean;

  /**
   * Cursor name for the box under `(x, y)` — walk ancestors for `cursor`.
   * Hosts map the name to CSS or a 1-bit face; widgets only declare intent.
   */
  cursorAt(x: number, y: number): CursorSpec;

  /**
   * Point the tree at a new framebuffer. Relayouts on the next `frame()`.
   * Does not remount the Solid tree.
   */
  resize(screen: BitMap): void;

  /**
   * Register a custom font from a %%FNT0 / %%FNT1 data block string.
   * Custom fonts can override built-in names (body, menu, mono, pixel).
   */
  registerFont(name: string, data: string): void;

  /** Merge chrome tokens. Widgets that read `useTheme` repaint. */
  setTheme(theme: Partial<UITheme>): void;
  readonly theme: UITheme;

  readonly root: CanvasNode;
  readonly focusManager: FocusManager;
  /** The GrafPort that drawTree paints into — its portBits is the current screen. */
  readonly port: GrafPort;
}

const DEFAULT_MODIFIERS: Modifiers = {
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
};

function hostTrace(message: string): void {
  const write = (globalThis as { trace?: (s: string) => void }).trace;
  if (typeof write === "function") write(`${message}\n`);
}

export function createUI(config: UIConfig): UIInstance {
  let screen = config.screen;
  const services: UIServices = config.services ?? {};
  hostTrace("ui:signals");
  const [theme, setThemeSignal] = createSignal<UITheme>(
    { ...DEFAULT_THEME, ...config.theme },
    { ownedWrite: true },
  );
  const themeContextValue = { theme };
  let width = bitMapWidth(screen);
  let height = bitMapHeight(screen);
  const [viewport, setViewport] = createSignal<ViewportSize>(
    { width, height },
    { ownedWrite: true },
  );
  const viewportContextValue = { size: viewport };
  const scheduleRender = config.scheduleRender ?? (() => {});

  _setRepaintHook(scheduleRender);

  hostTrace("ui:fonts");
  installFontBridge();

  hostTrace("ui:draw");
  const drawCtx = createDrawContext(screen);

  const root = createNode("_root");
  root.style.width = width;
  root.style.height = height;
  root.layout = { x: 0, y: 0, width, height };

  const focusManager = createFocusManager(root);
  registerFocusRoot(root);
  drawCtx.focusManager = focusManager;

  const measureFunc = createMeasureFunc();
  const measureApi = { measureText };

  const pointer: PointerDispatcher = createPointerDispatcher(
    root,
    focusManager,
    (error) => services.onError?.(error),
    services.scheduler,
  );

  // Installing or removing a font can change any text's metrics.
  onFontsChanged(() => {
    markDirty(root);
    scheduleRender();
  });

  function layoutIfDirty(): void {
    if (!root._dirty) return;
    computeLayout(root, width, height, measureFunc);
    settleScrollOffsets(root);
    notifyLayoutChanges(root);
  }

  let flushing = false;
  function uiFlush(): void {
    if (flushing) return;
    flushing = true;
    try {
      flush();
    } finally {
      flushing = false;
    }
  }

  const instance: UIInstance = {
    inspect() {
      uiFlush();
      layoutIfDirty();
      return inspectTree(root, focusManager);
    },
    debugInspect() {
      uiFlush();
      layoutIfDirty();
      return debugInspectTree(root);
    },
    render(component: () => JSX.Element): () => void {
      let disposed = false;
      const focusContextValue = {
        manager: focusManager,
        getNode: () => null,
      };

      const cleanup = render(
        () =>
          UIServicesContext({
            value: services,
            get children() {
              return ViewportContext({
                value: viewportContextValue,
                get children() {
                  return ThemeContext({
                    value: themeContextValue,
                    get children() {
                      return MeasureContext({
                        value: measureApi,
                        get children() {
                          return FocusContext({
                            value: focusContextValue,
                            get children() {
                              return createComponent(OverlayHost, {
                                get children() {
                                  return component();
                                },
                              });
                            },
                          });
                        },
                      });
                    },
                  });
                },
              });
            },
          }) as unknown as CanvasNode,
        root
      );

      Promise.resolve().then(() => {
        uiFlush();
        if (!disposed) applyPendingAutoFocus(root, focusManager);
      });

      return () => {
        disposed = true;
        pointer.stopFlick();
        cleanup();
      };
    },

    frame(): void {
      uiFlush();
      applyPendingAutoFocus(root, focusManager);
      layoutIfDirty();
      // Content that moved under a still pointer gets its leave and enter, so
      // a tooltip closes as its trigger scrolls away; what they change lays out
      // before this frame is drawn.
      if (pointer.refreshHover()) {
        uiFlush();
        layoutIfDirty();
      }
      drawTree(root, drawCtx);
    },

    dispatchPointer(type, x, y, extras) {
      if (extras?.modifiers) noteModifiers(extras.modifiers);
      const consumed = pointer.dispatch(type, x, y, extras);
      uiFlush();
      // Selection, hover, and focus paint without mutating the Solid tree.
      scheduleRender();
      return consumed;
    },

    cursorAt(x, y) {
      uiFlush();
      layoutIfDirty();
      return resolveCursorAt(root, x, y);
    },

    dispatchKeyboard(
      type: "keydown" | "keyup" | "keypress",
      key: string,
      modifiers?: Partial<Modifiers>
    ): void {
      const mods: Modifiers = { ...DEFAULT_MODIFIERS, ...modifiers };
      if (type !== "keypress") noteModifiers(mods);
      uiFlush();
      try {
        if (type === "keydown" && key === "Escape" && dismissOverlayModal()) {
          uiFlush();
          scheduleRender();
          return;
        }
        focusManager.dispatchKeyboard(type, key, mods);
      } catch (error) {
        services.onError?.(error);
      }
      uiFlush();
      scheduleRender();
    },

    dispatchPaste(text: string): void {
      uiFlush();
      try {
        focusManager.dispatchPaste(text);
      } catch (error) {
        services.onError?.(error);
      }
      uiFlush();
      scheduleRender();
    },

    focusedTakesRawKeys(): boolean {
      return focusManager.takesRawKeys();
    },

    resize(next: BitMap): void {
      if (next === screen) return;
      screen = next;
      width = bitMapWidth(next);
      height = bitMapHeight(next);
      if (viewport().width !== width || viewport().height !== height) {
        setViewport({ width, height });
      }
      resizeDrawContext(drawCtx, next);
      root.style.width = width;
      root.style.height = height;
      root.layout = { x: 0, y: 0, width, height };
      markDirty(root);
      scheduleRender();
    },

    registerFont(name: string, data: string): void {
      registerFontInRegistry(name, data);
    },

    setTheme(next: Partial<UITheme>): void {
      setThemeSignal((prev) => ({ ...prev, ...next }));
      uiFlush();
      scheduleRender();
    },

    get theme(): UITheme {
      return theme();
    },

    get root(): CanvasNode {
      return root;
    },

    get focusManager(): FocusManager {
      return focusManager;
    },

    get port(): GrafPort {
      return drawCtx.port;
    },
  };

  hostTrace("ui:done");
  return instance;
}
