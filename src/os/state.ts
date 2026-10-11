/**
 * OS state as Solid signals — the single source of truth for the Solid OS.
 *
 * All window management, menubar state, and UI state lives here.
 * Components read from these signals reactively; mutations call the
 * helper functions below, which update the signals and automatically
 * schedule a repaint via the @mockintosh/ui renderer hook.
 */

import { createSignal, createStore, flush, getObserver, runWithOwner, type StoreSetter } from "solid-js";

/** `flush()` inside an effect apply is a no-op and logs; event-handler writes still need it. */
let flushing = false;
function flushIfIdle(): void {
  if (flushing || getObserver()) return;
  flushing = true;
  try {
    flush();
  } finally {
    flushing = false;
  }
}

function runHostWrite(write: () => void): void {
  runWithOwner(null, write);
}
import type { JSX } from "@mockintosh/ui";
import { keyWindowId, orderWindowsForApp } from "./appSwitcher";
import { isModalWindow, sortWindowsForPaint, windowLayer } from "./layering";
import { tuckMenubar } from "./menubarReveal";
import { disposeAllWindowContent, disposeWindowContent } from "./windowContent";
import { windowDefinition, type OSWindowKind } from "./windowKinds";
import type { MenubarDefinition, MenubarItemDef } from "@mockintosh/sdk";
import { warnMenubarProblems } from "./shortcuts";

export type { OSWindowKind } from "./windowKinds";

/** The app that owns the desktop and folder windows; active when nothing else is. */
export const FINDER_APP_ID = "finder";

// ---------------------------------------------------------------------------
// Window types
// ---------------------------------------------------------------------------

/** Content mounted in a window. Props are whatever the opener passed (`OSWindow.props`). */
export type WindowComponent = (props: Record<string, unknown>) => JSX.Element;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The kind and bounds a window had before it went full screen. */
export interface WindowedState extends WindowBounds {
  kind: OSWindowKind;
}

export interface OSWindow {
  instanceId?: string;
  id: string;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: OSWindowKind;
  /** Content to mount; the owning app's `Component` when absent. */
  Component?: WindowComponent;
  props: Record<string, unknown>;
  scrollY: number;
  scrollX: number;
  contentHeight: number;
  contentWidth: number;
  scrollable: boolean;
  resizable: boolean;
  /** Where a resizable window without scroll bars keeps its grow box (`WindowSpec.growBox`). */
  growBox?: "band" | "overlay";
  /** `false` pins the window: its title bar does not drag. */
  movable?: boolean;
  /** Replaces closing on a close-box click; the app closes the window itself. */
  onGoAway?: () => void;
  /** Overrides the kind's modality (`windowDefinition(kind).modal`). */
  modal?: boolean;
  /** Minimum content width when resizing (default 100). */
  minWidth?: number;
  /** Minimum content height when resizing (default 60). */
  minHeight?: number;
  /** Screen rect of the icon this window was opened from (for close zoom). */
  openedFromRect?: { x: number; y: number; width: number; height: number };
  /**
   * @deprecated Prefer `WindowHeader`. Text items for the default 20px
   * header band when `headerHeight` is unset.
   */
  infoBar?: string[];
  /** Non-scrolling chrome below the title bar (app-filled via `WindowHeader`). */
  headerHeight?: number;
  /** Non-scrolling chrome below the scrollable body (`WindowFooter`). */
  footerHeight?: number;
  /**
   * Per-window menubar override. Most apps set menus once for the whole app
   * (`SolidApp.menus` / `setAppMenus`); a window sets its own only when its
   * menus depend on window state (e.g. Finder's current folder).
   */
  menus?: MenubarDefinition[];
  userBounds?: WindowBounds;
  standardBounds?: WindowBounds;
  /** Set while a window that was opened windowed is in full screen; what `setWindowFullScreen(id, false)` restores. */
  windowed?: WindowedState;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/**
 * Windows are stored in a Solid *store* (not a plain signal) so that
 * `updateOSWindow` can mutate individual properties in-place via a draft setter.
 * This keeps the object reference for each window stable across updates,
 * which means Solid's `<For>` never destroys and recreates Window components
 * during a drag — preventing stale CanvasNode ids and reset drag offsets.
 *
 * Stores and signals are created on first access, not at module evaluation.
 */
let _windowStore: { list: OSWindow[] } | undefined;
let _setWindowStoreRaw: StoreSetter<{ list: OSWindow[] }> | undefined;

function windowStore(): { list: OSWindow[] } {
  if (!_windowStore) {
    [_windowStore, _setWindowStoreRaw] = createStore<{ list: OSWindow[] }>({ list: [] });
  }
  return _windowStore;
}

const _setWindowStore: StoreSetter<{ list: OSWindow[] }> = (fn) => {
  windowStore();
  // Window open/close runs from instance `createRoot`s and effect cleanups;
  // those writes are host mutations, not component-owned state.
  runHostWrite(() => { _setWindowStoreRaw!(fn); });
};

export function getWindows(): OSWindow[] {
  return windowStore().list as OSWindow[];
}

type SignalPair<T> = ReturnType<typeof createSignal<T>>;

function lazySignal<T>(init: T): SignalPair<T> {
  let pair: SignalPair<T> | undefined;
  function ensure(): SignalPair<T> {
    pair ??= createSignal(init as Exclude<T, Function>, { ownedWrite: true }) as SignalPair<T>;
    return pair;
  }
  const get = ((...args: Parameters<SignalPair<T>[0]>) => ensure()[0](...args)) as SignalPair<T>[0];
  const set = ((...args: Parameters<SignalPair<T>[1]>) => ensure()[1](...args)) as SignalPair<T>[1];
  return [get, set];
}

export const [getActiveWindowId, setActiveWindowId] = lazySignal<string | null>(null);

// ---------------------------------------------------------------------------
// Apps and the menubar
//
// Windows belong to apps (`OSWindow.appId`). The *active app* is derived from
// the active window; the menubar shows that app's menus. Menus are owned by
// apps, not windows: `setAppMenus` registers an app's menubar, and a window
// may override it with `OSWindow.menus` when its menus depend on window state.
// ---------------------------------------------------------------------------

let _appMenus: Record<string, MenubarDefinition[]> | undefined;
let _setAppMenusRaw: StoreSetter<Record<string, MenubarDefinition[]>> | undefined;

function appMenus(): Record<string, MenubarDefinition[]> {
  if (!_appMenus) {
    [_appMenus, _setAppMenusRaw] = createStore<Record<string, MenubarDefinition[]>>({});
  }
  return _appMenus;
}

export function setAppMenus(appId: string, menus: MenubarDefinition[]): void {
  warnMenubarProblems(appId, menus);
  appMenus();
  runHostWrite(() => {
    _setAppMenusRaw!((s) => {
      s[appId] = menus;
    });
  });
}

export function getAppMenus(appId: string): MenubarDefinition[] | undefined {
  return appMenus()[appId];
}

/**
 * The window that determines the menubar: the active window, unless it is a
 * system-modal alert, in which case the frontmost non-modal window (alerts
 * borrow the menubar of whatever they interrupted). Undefined means the
 * Finder desktop.
 */
function menubarWindow(): OSWindow | undefined {
  const active = getActiveWindow();
  // No key window means the Finder desktop is front, even if other apps
  // still have windows open behind it.
  if (!active) return undefined;
  if (!isModalWindow(active)) return active;
  const stack = sortWindowsForPaint(windowStore().list as OSWindow[]);
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!isModalWindow(stack[i])) return stack[i];
  }
  return undefined;
}

/** The app whose menus the menubar shows; the Finder when no window is open. */
export function getActiveAppId(): string {
  return menubarWindow()?.appId ?? FINDER_APP_ID;
}

/** Menus currently shown in the menubar (derived; reactive). */
export function getMenubarMenus(): MenubarDefinition[] {
  const win = menubarWindow();
  return win?.menus ?? getAppMenus(win?.appId ?? FINDER_APP_ID) ?? [];
}

/**
 * Whether the menubar is off screen: the frontmost non-modal window covers
 * the screen (Macintosh "special presentation mode"). Its menus still exist —
 * ⌘ shortcuts keep working — which is how an app offers the way back.
 *
 * A tool palette of that same app stays usable on top of the picture. Clicking
 * it does not bring the menubar back; the presentation is still in progress.
 */
export function isMenubarHidden(): boolean {
  const win = menubarWindow();
  if (!win) return false;
  if (windowDefinition(win.kind).coversScreen) return true;
  if (windowLayer(win.kind) > windowLayer("fullscreen")) {
    return getWindows().some(
      (other) => other.id !== win.id && other.appId === win.appId && windowDefinition(other.kind).coversScreen,
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hidden applications — the application menu's Hide and Show All. A hidden
// app keeps running and keeps its windows; they are just not on screen until
// the app comes forward again.
// ---------------------------------------------------------------------------

const [getHiddenAppIds, setHiddenAppIds] = lazySignal<readonly string[]>([]);

export function isAppHidden(appId: string): boolean {
  return getHiddenAppIds().includes(appId);
}

function unhideApp(appId: string): void {
  if (isAppHidden(appId)) setHiddenAppIds((ids) => ids.filter((id) => id !== appId));
}

/** The app that comes forward when the front one is hidden: the owner of the frontmost visible window, else the Finder. */
function nextVisibleAppId(hidden: readonly string[]): string {
  const stack = sortWindowsForPaint(windowStore().list as OSWindow[]);
  for (let i = stack.length - 1; i >= 0; i--) {
    const win = stack[i];
    if (!hidden.includes(win.appId) && !isModalWindow(win) && !win.appId.startsWith("__")) return win.appId;
  }
  return FINDER_APP_ID;
}

/** Hide each of `appIds`; if the front app is among them, the next visible app comes forward. */
export function hideApps(appIds: readonly string[]): void {
  const hidden = [...new Set([...getHiddenAppIds(), ...appIds])];
  setHiddenAppIds(hidden);
  if (hidden.includes(getActiveAppId())) {
    const next = nextVisibleAppId(hidden);
    setActiveWindowId(keyWindowId(windowStore().list as OSWindow[], next));
    unhideApp(next);
  }
  flushIfIdle();
}

export function showAllApps(): void {
  setHiddenAppIds([]);
  flushIfIdle();
}

export const [getOpenMenuIndex, setOpenMenuIndex] = lazySignal<number | null>(null);
export const [getHighlightedMenuItem, setHighlightedMenuItem] = lazySignal<number | null>(null);

/** A contextual menu popped up by a secondary click, at its screen position. */
export interface ContextMenuState {
  items: MenubarItemDef[];
  x: number;
  y: number;
}

export const [getContextMenu, setContextMenu] = lazySignal<ContextMenuState | null>(null);

/**
 * Pop up a contextual menu at screen (x, y), as Mac OS 8 does on ⌃-click.
 * Call it from an `onContextMenu` handler; the press that opened it can
 * drag onto an item and let go, or click and choose afterwards.
 */
export function openContextMenu(items: MenubarItemDef[], x: number, y: number): void {
  setOpenMenuIndex(null);
  setContextMenu({ items, x, y });
}

export function closeContextMenu(): void {
  if (getContextMenu()) setContextMenu(null);
}

export const [getSplashVisible, setSplashVisible] = lazySignal(true);

/** XOR window drag/resize outline, in screen coordinates. */
export const [getWindowOutline, setWindowOutline] = lazySignal<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null>(null);

/** Rubber-band rectangle while dragging a screenshot selection, in screen pixels. */
export const [getScreenshotMarquee, setScreenshotMarquee] = lazySignal<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null>(null);

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

export function openOSWindow(win: OSWindow): void {
  if (windowDefinition(win.kind).coversScreen) tuckMenubar();
  const def = windowDefinition(win.kind);
  _setWindowStore((s) => {
    // Remove any duplicate with the same id before adding
    const idx = s.list.findIndex((w) => w.id === win.id);
    if (idx >= 0) s.list.splice(idx, 1);
    const firstOwn = def.backdrop ? s.list.findIndex((w) => w.appId === win.appId) : -1;
    if (firstOwn >= 0) s.list.splice(firstOwn, 0, win);
    else s.list.push(win);
  });
  unhideApp(win.appId);
  // A palette or desk joins an already-front app without taking the key window,
  // so the document keeps its stripes while the palette's drag bar stays filled.
  const active = getActiveWindow();
  const joinsFrontApp = def.toolPalette || def.backdrop;
  if (!joinsFrontApp || !active || active.appId !== win.appId) {
    setActiveWindowId(win.id);
  }
  flushIfIdle();
}

export function closeOSWindow(id: string): void {
  disposeWindowContent(id);
  const closing = windowStore().list.find((w) => w.id === id);
  _setWindowStore((s) => {
    const idx = s.list.findIndex((w) => w.id === id);
    if (idx >= 0) s.list.splice(idx, 1);
  });
  setActiveWindowId((prev) => {
    if (prev !== id) return prev;
    const remaining = windowStore().list.filter((w) => w.id !== id && !isAppHidden(w.appId)) as OSWindow[];
    // The app stays front while it has windows left (a desk, a palette).
    const sameApp = closing ? keyWindowId(remaining, closing.appId) : null;
    return sameApp ?? (remaining.length > 0 ? remaining[remaining.length - 1].id : null);
  });
  flushIfIdle();
}

/** Close every window — what shutting the machine down does. */
export function closeAllWindows(): void {
  disposeAllWindowContent();
  _setWindowStore((s) => {
    s.list = [];
  });
  setActiveWindowId(null);
  flushIfIdle();
}

/** Bring an application's windows forward and make it the active app. */
export function activateApp(appId: string): void {
  unhideApp(appId);
  _setWindowStore((s) => {
    const next = orderWindowsForApp(s.list, appId);
    s.list.splice(0, s.list.length, ...next);
  });
  setActiveWindowId(keyWindowId(windowStore().list as OSWindow[], appId));
  flushIfIdle();
}

export function bringToFront(id: string): void {
  const desk = windowStore().list.find((w) => w.id === id);
  if (desk) unhideApp(desk.appId);
  if (desk && windowDefinition(desk.kind).backdrop) {
    activateApp(desk.appId);
    return;
  }
  _setWindowStore((s) => {
    const target = s.list.find((w) => w.id === id);
    if (!target) return;
    // An app with a desk owns the screen: its desk must come forward too, or
    // other apps' windows would sit between the desk and the window.
    if (s.list.some((w) => w.appId === target.appId && windowDefinition(w.kind).backdrop)) {
      const next = orderWindowsForApp(s.list, target.appId);
      s.list.splice(0, s.list.length, ...next);
    }
    const idx = s.list.findIndex((w) => w.id === id);
    const win = s.list[idx];
    const layer = windowLayer(win.kind);
    // Insert after the last window of the same or lower layer.
    s.list.splice(idx, 1);
    let insertAt = s.list.length;
    for (let i = s.list.length - 1; i >= 0; i--) {
      if (windowLayer(s.list[i].kind) <= layer) {
        insertAt = i + 1;
        break;
      }
      insertAt = i;
    }
    s.list.splice(insertAt, 0, win);
  });
  setActiveWindowId(id);
  flushIfIdle();
}

/**
 * Update individual properties of a window in-place.
 * Draft setters keep the store proxy reference stable so that
 * `<For>` never recreates the Window component — critical for smooth dragging.
 */
export function updateOSWindow(id: string, updates: Partial<OSWindow>): void {
  _setWindowStore((s) => {
    const win = s.list.find((w) => w.id === id);
    if (win && updates.menus) warnMenubarProblems(win.appId, updates.menus);
    if (win) Object.assign(win, updates);
  });
}

export function getActiveWindow(): OSWindow | undefined {
  const id = getActiveWindowId();
  return id ? windowStore().list.find((w) => w.id === id) : undefined;
}

/**
 * Bounds of a window that covers the screen: `width` is the outer width and
 * `height` the content height, and a `fullscreen` window has no chrome, so
 * both are simply the screen's.
 */
export function fullScreenBounds(screen: { width: number; height: number }): WindowBounds {
  return { x: 0, y: 0, width: screen.width, height: screen.height };
}

/**
 * Switch a window into or out of full screen in place — the content stays
 * mounted, as when the zoom box toggles `standardBounds`. Entering remembers
 * the kind and bounds to come back to; leaving restores them. A window that
 * was opened as `fullscreen` has no windowed form and leaving is a no-op.
 */
export function setWindowFullScreen(
  id: string,
  on: boolean,
  screen: { width: number; height: number }
): void {
  const win = windowStore().list.find((w) => w.id === id);
  if (!win) return;
  const isFullScreen = windowDefinition(win.kind).coversScreen;
  if (on && !isFullScreen) {
    tuckMenubar();
    updateOSWindow(id, {
      windowed: { kind: win.kind, x: win.x, y: win.y, width: win.width, height: win.height },
      kind: "fullscreen",
      ...fullScreenBounds(screen),
    });
    bringToFront(id);
  } else if (!on && isFullScreen && win.windowed) {
    updateOSWindow(id, { ...win.windowed, windowed: undefined });
    // Entering flushes via bringToFront. Leaving has to flush itself, or the
    // restored kind stays batched until some later repaint.
    flushIfIdle();
  }
}
