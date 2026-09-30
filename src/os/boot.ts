import {createRoot, createStore, flush} from "solid-js";
import SourceEditor from "../../apps/SourceEditor";
import { registerProjects } from "./projects";
import { AppInstances } from "./instances";
import { registerFileOperations } from "./kernel/files";
/**
 * bootOS — bring the operating system up on a `Platform`.
 *
 * Owns the boot order (QuickDraw → sprites → UI → file system → apps →
 * peripherals), the frame loop, input translation from platform events to
 * UI dispatches, and the `OSServices` the Solid tree runs on. It knows
 * nothing about where the pixels go or where events come from: that is the
 * platform's job, so this file compiles without DOM types. Which apps are
 * bundled is likewise the entry point's decision (`systemApps.ts` for the
 * web build); the boot sequence only knows about the Finder and dialogs.
 */

import { InitGraf, InitCursor, SetCursor, cursorState, globals as qd, type Rect } from "@mockintosh/quickdraw";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { copyBitMapBytes, createDoubleClickTracker, createUI, moveSoftwareCursor, type Modifiers, type UIImageService } from "@mockintosh/ui";
import { FileSystem } from "@mockintosh/fs";
import type { AppContext } from "@mockintosh/sdk";
import type { Platform, PlatformDropEvent, PlatformKeyEvent, PlatformPointerEvent } from "../platform/types";
import { importHostFile, isImportableHostFile, resolveImportTarget } from "./hostImport";
import { SpriteRegistry, registerBuiltinSprites } from "./sprites";
import { liveCursor } from "./cursor";
import { cursorForName, cursors } from "./cursors";
import { animateZoomRect, type AnimRect } from "./zoomAnimation";
import { buildFolderWindow, windowOuterRect } from "../../apps/Finder.solid";
import { bootstrapFileSystem } from "./fsBootstrap";
import { createFontFolder } from "./fontFolder";
import { resolveOpenAction } from "./openers";
import { claimMenubarEdge, stepMenubarReveal } from "./menubarReveal";
import { createScreenshots, type Screenshots } from "./screenshot";
import { makeOSRoot } from "./OSRoot.solid";
import {
  setSplashVisible,
  openOSWindow,
  closeOSWindow,
  closeAllWindows,
  getWindows,
  getActiveWindowId,
  setWindowOutline,
  setScreenshotMarquee,
  bringToFront,
  getMenubarMenus,
  isMenubarHidden,
  setOpenMenuIndex,
} from "./state";
import type { OSServices } from "./context";
import { getAllApps, getApp, registerApp } from "./apps";
import { bundledApps } from "./bundledApps";
import { createAppContext } from "./appContext";
import { AppProcess } from "./process/host";
import { processBlocker } from "./process/eligible";
import { appSource } from "./process/sources";
import { processWindowComponent } from "./components/ProcessWindow.solid";
import { buildAppWindow } from "./appWindow";
import { DialogApp } from "./components/Dialog.solid";
import { SignInSheet, type SignInSheetProps } from "./components/SignInSheet.solid";
import type { SystemSignIn } from "./signIn";
import { createAppInstaller, migrateBundledDesktopShortcuts } from "./installedApps";
import {
  describeMissingCapabilities,
  missingCapabilities,
  platformCapabilities,
} from "./capabilities";
import { createSystemPrinters } from "./printers/manager";

import { createDesktopSettings, registerDesktopSettings } from "./kernel/settings";
import { menuCommands, runMenuItem } from "./kernel/menus";
import { registerShell } from "./shell";
import { registerUIOperations } from "./kernel/uiService";
import { Cancellation } from "./kernel/cancellation";
import { ServiceError } from "./kernel";
import Terminal from "../../apps/Terminal";
import { Kernel } from "./kernel";

const MENUBAR_HEIGHT = 20;
const SPLASH_MS = 800;


/** What opening an app does unless it says otherwise (`SolidApp.onOpen`): open its main window. */
function defaultOnOpen(app: AppContext, props: Record<string, unknown>): void {
  app.openWindow({ props });
}

export type OSRootFactory = (services: OSServices, menubarHeight: number) => () => import("@mockintosh/ui").JSX.Element;

export interface BootOptions {
  /** Override the mounted tree. Device bring-up uses a slimmer root. */
  root?: OSRootFactory;
}

export interface BootedOS {
  kernel: Kernel;
  input: {
    pointer(event: PlatformPointerEvent): void;
    key(event: PlatformKeyEvent): void;
    drop(event: PlatformDropEvent): void;
  };
  render(cancellation?: Cancellation): Promise<void>;
  /** The running OS, for hosts that open apps or dialogs themselves (kiosk mode, tests). */
  services: OSServices;
  /** Force a repaint on the next frame. */
  scheduleRepaint(): void;
  /** Unmount the UI tree. */
  shutdown(): void;
}

function bootTrace(message: string): void {
  const write = (globalThis as { trace?: (s: string) => void }).trace;
  if (typeof write === "function") write(`${message}\n`);
}

export async function bootOS(platform: Platform, options?: BootOptions): Promise<BootedOS> {
  let stopped = false;
  const { display, scheduler } = platform;
  const [resolution, setResolutionSize] = createStore({ width: display.width, height: display.height });

  // --- QuickDraw framebuffer ---
  bootTrace("qd");
  InitGraf(display.framebuffer ?? newBitMap(display.width, display.height));
  let screen = qd.screenBits;
  let presentBits = newBitMap(display.width, display.height);
  let cursorRect: Rect | null = null;
  let framed = false;
  /** Zoom XOR paints on `screen`; the cursor lives on `presentBits`. */
  const presentScreen = () => { if (!stopped) display.present(screen); };
  const presentComposite = () => { if (!stopped) display.present(presentBits); };

  InitCursor();

  // --- Sprites: built-ins, then whatever the bundled apps brought along ---
  const sprites = new SpriteRegistry();
  registerBuiltinSprites(sprites);
  for (const app of getAllApps()) if (app.sprites) sprites.registerAll(app.sprites);
  for (const listing of bundledApps()) if (listing.sprites) sprites.registerAll(listing.sprites);

  // --- Frame scheduling ---
  let screenDirty = true;
  /** True while a zoom animation owns the framebuffer — blocks the frame loop. */
  let animating = false;
  function scheduleRepaint() {
    screenDirty = true;
  }

  const instances = new AppInstances(id => closeOSWindow(id));

  /** The host's image decoder as `<image>` sources want it: bytes, or a URL fetched first. Processes get it too. */
  const uiImages: UIImageService | undefined = platform.images
    ? {
        async decode(source, options) {
          const images = platform.images!;
          if (typeof source !== "string") {
            return images.decode(source, options?.type, options);
          }
          if (!platform.fetch) throw new Error("This Macintosh cannot fetch images.");
          const response = await platform.fetch(source);
          if (!response.ok) throw new Error(`Could not fetch image (${response.status})`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          return images.decode(
            bytes,
            options?.type ?? response.headers.get("content-type") ?? undefined,
            options,
          );
        },
      }
    : undefined;

  // --- UI instance (full-screen Solid renderer) ---
  bootTrace("ui");
  const ui = createUI({
    screen,
    scheduleRender: scheduleRepaint,
    services: {
      clipboard: platform.clipboard,
      images: uiImages,
      onError(error) {
        const active = getWindows().find((window) => window.id === getActiveWindowId());
        if (active?.instanceId) instances.note(active.instanceId, error, "handler");
      },
    },
  });

  // --- File system ---
  bootTrace("fs");
  const fs = await FileSystem.open({ backend: platform.storage });
  await bootstrapFileSystem(fs);
  const kernel = new Kernel();
  registerFileOperations(kernel, fs, platform.source);
  const desktopSettings = await createDesktopSettings(fs);
  const fontFolder = await createFontFolder(fs);

  // --- Installed apps (manifests live in /Applications) ---
  const capabilities = platformCapabilities(platform);
  const installer = createAppInstaller({
    fs,
    sprites,
    capabilities,
    loadModule: platform.loadModule,
  });
  await migrateBundledDesktopShortcuts(fs, installer);
  await installer.loadInstalled();

  // --- Printers ---
  const printers =
    platform.printerLinks || platform.printer
      ? await createSystemPrinters({
          fs,
          links: platform.printerLinks,
          fixed: platform.printer ? { transport: platform.printer, profile: platform.printerProfile } : undefined,
        })
      : undefined;

  // Assigned once `osServices` exists, before the frame loop or any input.
  let screenshotCapture!: Screenshots;

  function readScreen() {
    ui.frame();
    return {
      width: resolution.width,
      height: resolution.height,
      rowBytes: screen.rowBytes,
      bytes: screen.baseAddr.slice(),
    };
  }

  // --- OS services (passed to Solid components via context) ---
  const osServices: OSServices = {
    kernel,
    instances,
    desktopSettings,
    sprites,
    fs,
    resolution,
    hostDisplay: platform.hostDisplay,
    menubarHeight: MENUBAR_HEIGHT,
    env: platform.env,
    scheduler: platform.scheduler,
    capabilities,
    fetch: platform.fetch,
    printers,
    download: platform.download,
    images: platform.images,
    video: platform.video,
    camera: platform.camera,
    audio: platform.audio,
    microphone: platform.microphone,
    agentRuntime: platform.agentRuntime,
    fonts: platform.fonts,
    fontFolder,
    crypto: platform.crypto,
    browser: platform.browser,
    signIn: platform.signInRelay && systemSignIn(platform.signInRelay),
    installer,
    openApp(appId, props = {}, fromRect?) {
      const app = getApp(appId);
      if (!app) {
        console.warn(`Unknown app: ${appId}`);
        return;
      }
      const missing = missingCapabilities(app.requires, capabilities);
      if (missing.length > 0) {
        void osServices.showDialog({ message: describeMissingCapabilities(app.title, missing) });
        return;
      }
      const existing = getWindows().find((w) => {
        if (w.appId !== appId) return false;
        const a = w.props ?? {};
        const b = props ?? {};
        if (a.fileId || b.fileId) return a.fileId === b.fileId;
        if (a.directoryId || b.directoryId) return a.directoryId === b.directoryId;
        if (typeof b.url === "string") return a.url === b.url;
        return app.singleInstance !== false;
      });
      if (existing) {
        bringToFront(existing.id);
        return;
      }
      // The app's `main`: it decides which windows to open, if any.
      const instanceId = instances.create(appId, osServices.projects?.selectedBuild(appId));
      const context = createAppContext(osServices, appId, { fromRect, instanceId });
      if (platform.processes && processBlocker(app, platform.processes) === null) {
        // The app's `main` runs in its own process; it holds the launch until `onOpen` has run there.
        const proc = new AppProcess({
          port: platform.processes.spawn(appId),
          appId,
          instanceId,
          source: appSource(appId),
          props,
          context,
          os: osServices,
          clipboard: platform.clipboard,
          images: uiImages,
          titleSuffix: app.processStats ? " (Worker)" : "",
          stats: !!app.processStats,
          windowComponent: (process, key) => processWindowComponent(process, key, !!app.processStats),
        });
        instances.own(instanceId, () => proc.stop());
        instances.finishOpen(instanceId);
        return;
      }
      const onOpen = app.onOpen ?? defaultOnOpen;
      try { createRoot(dispose => { instances.own(instanceId, dispose); onOpen(context, props); }); instances.finishOpen(instanceId); } catch (error) { instances.stop(instanceId); throw error; }
    },
    openWindow(appId, spec = {}, fromRect?, instanceId?) {
      const app = getApp(appId);
      if (!app) throw new Error(`Cannot open a window for unknown app: ${appId}`);
      const win = buildAppWindow(app, spec, {
        screen: resolution,
        menubarHeight: MENUBAR_HEIGHT,
        openWindowCount: getWindows().length,
      });
      win.Component ??= app.Component;
      win.instanceId = instanceId ?? instances.create(appId, osServices.projects?.selectedBuild(appId));
      instances.addWindow(win.instanceId, win.id);
      win.openedFromRect = fromRect;
      const doOpen = () => { if (!win.instanceId || instances.alive(win.instanceId)) openOSWindow(win); };
      if (fromRect) {
        renderFrame();
        playZoomAnimation(fromRect, windowOuterRect(win), doOpen);
      } else {
        doOpen();
      }
      return win.id;
    },
    busy: (work) => runBusy(work),
    showDialog(options) {
      return new Promise<string | null>((resolve) => {
        osServices.openWindow("__dialog__", {
          props: {
            message: options.message,
            buttons: options.buttons ?? ["OK"],
            showInput: options.showInput,
            inputDefault: options.inputDefault,
            variant: options.variant ?? "stop",
            resolve,
          },
          size: {
            width: 376,
            height: options.showInput ? 148 : 112,
          },
        });
      });
    },
    openFolderWindow(title, directoryId, fromRect?) {
      const win = buildFolderWindow(fs, {
        title,
        directoryId,
        x: 60,
        y: MENUBAR_HEIGHT + 50,
        width: Math.min(400, resolution.width - 80),
        height: Math.min(200, resolution.height - MENUBAR_HEIGHT - 60),
        openedFromRect: fromRect,
      });
      const doOpen = () => { if (!win.instanceId || instances.alive(win.instanceId)) openOSWindow(win); };
      if (fromRect) {
        renderFrame(); // snapshot current screen into port
        playZoomAnimation(fromRect, windowOuterRect(win), doOpen);
      } else {
        doOpen();
      }
    },
    openFSNode(nodeId, fromRect?) {
      void openFSNodeImpl(nodeId, fromRect);
    },
    closeWindow(id) {
      const win = getWindows().find((w) => w.id === id);
      const fromRect: AnimRect | null = win ? windowOuterRect(win) : null;
      const toRect: AnimRect | null = win?.openedFromRect ?? null;
      closeOSWindow(id);
      instances.removeWindow(id);
      if (fromRect && toRect) {
        renderFrame(); // render state without the closed window
        playZoomAnimation(fromRect, toRect);
      }
    },
    playWindowOpenAnimation(fromRect, toRect, onDone) {
      renderFrame();
      playZoomAnimation(fromRect, toRect, onDone);
    },
    showWindowOutline(rect, _onCommit) {
      setWindowOutline(rect);
    },
    hideWindowOutline() {
      setWindowOutline(null);
    },
    scheduleRepaint,
    beforeFrame(hook) {
      beforeFrameHooks.add(hook);
      return () => beforeFrameHooks.delete(hook);
    },
    screenshots: {
      captureEntireScreen: () => screenshotCapture.captureEntireScreen(),
      beginPortionCapture() {
        screenshotCapture.beginPortionCapture();
        trackCursor();
      },
      settled: () => screenshotCapture.settled(),
    },
    async eraseDisk() {
      await fs.erase();
      if (platform.reload) {
        platform.reload();
        return;
      }
      await bootstrapFileSystem(fs);
      closeAllWindows();
    },
  };

  screenshotCapture = createScreenshots({
    fs,
    bounds: () => ({ width: resolution.width, height: resolution.height }),
    readScreen,
    setOutline: setScreenshotMarquee,
    scheduleRepaint,
    onError(message) {
      void osServices.showDialog({ message, buttons: ["OK"] });
    },
  });

  registerApp({
    id: "__dialog__",
    title: "",
    icon: "icon/computer",
    defaultSize: { width: 376, height: 112 },
    windowKind: "alert",
    scrollable: false,
    resizable: false,
    singleInstance: false,
    Component: DialogApp as any,
  });

  registerApp({
    id: "__signin__",
    title: "Sign In",
    icon: "icon/computer",
    defaultSize: { width: 360, height: 172 },
    windowKind: "dialog",
    scrollable: false,
    resizable: false,
    singleInstance: false,
    Component: SignInSheet as any,
  });

  function systemSignIn(relay: NonNullable<Platform["signInRelay"]>): SystemSignIn {
    const browser = platform.browser;
    return {
      redirectUri: relay.redirectUri,
      show(request, instanceId) {
        return new Promise((resolve, reject) => {
          let disown = () => {};
          const props = {
            request,
            relay,
            openExternal: browser && ((url) => void browser.openExternal(url)),
            resolve(params) {
              disown();
              resolve(params);
            },
            reject(error: Error) {
              disown();
              reject(error);
            },
          } satisfies SignInSheetProps;
          const windowId = osServices.openWindow("__signin__", { title: "Sign In", props });
          if (instanceId) disown = instances.own(instanceId, () => osServices.closeWindow(windowId));
        });
      },
    };
  }

  async function openFSNodeImpl(nodeId: string, fromRect?: AnimRect): Promise<void> {
    const action = await resolveOpenAction(fs, nodeId);
    switch (action.kind) {
      case "folder":
        osServices.openFolderWindow(action.title, action.directoryId, fromRect);
        return;
      case "launch":
        osServices.openApp(action.appId, action.props, fromRect);
        return;
      case "none": {
        const name = fs.file(nodeId)?.name ?? "this document";
        if (action.reason === "unknown-type") {
          await osServices.showDialog({
            message: `There is no application to open "${name}".`,
            buttons: ["OK"],
          });
        } else if (action.reason === "unknown-app") {
          await osServices.showDialog({
            message: `The application "${name}" could not be found.`,
            buttons: ["OK"],
          });
        } else if (action.reason === "unavailable") {
          await osServices.showDialog({
            message: describeMissingCapabilities(action.title, action.missing),
            buttons: ["OK"],
          });
        }
        return;
      }
    }
  }

  registerApp(Terminal);
  registerApp(SourceEditor);

  // --- Mount Solid tree ---
  bootTrace("root");
  let unmount: () => void;
  try {
    unmount = ui.render((options?.root ?? makeOSRoot)(osServices, MENUBAR_HEIGHT));
    bootTrace("root ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bootTrace(`root fail: ${message}`);
    throw error;
  }

  // --- Boot: dismiss splash after a short delay ---
  let splashPending = true;
  const splashTimer = setTimeout(() => { splashPending = false; if (!stopped) setSplashVisible(false); }, SPLASH_MS);

  // --- Cursor position (plain vars — not signals, cursor drawn directly) ---
  let cursorX = Math.floor(resolution.width / 2);
  let cursorY = Math.floor(resolution.height / 2);
  platform.hostDisplay?.onResize((width, height) => {
    if (stopped || (width === resolution.width && height === resolution.height)) return;
    const next = newBitMap(width, height);
    qd.screenBits = next;
    screen = next;
    // The old composite no longer matches the screen; the next frame rebuilds it.
    presentBits = newBitMap(width, height);
    cursorRect = null;
    framed = false;
    ui.resize(next);
    setResolutionSize((size) => {
      size.width = width;
      size.height = height;
    });
    flush();
    cursorX = Math.min(cursorX, Math.max(0, width - 1));
    cursorY = Math.min(cursorY, Math.max(0, height - 1));
    scheduleRepaint();
  });

  function stampCursor(prev: Rect | null): Rect | null {
    return moveSoftwareCursor(screen, presentBits, prev, liveCursor(), cursorX, cursorY);
  }

  /** Restamp the cursor on the last clean frame. No tree paint. */
  function presentCursor(): void {
    if (stopped || animating || !framed) return;
    const prev = cursorRect;
    cursorRect = stampCursor(prev);
    presentComposite();
  }

  function compositeFrame(): void {
    copyBitMapBytes(screen, presentBits);
    cursorRect = stampCursor(null);
    framed = true;
    presentComposite();
  }

  // --- Busy work, under the watch ---
  /** Busy work waiting for a frame with the watch in it; started once that frame is visible. */
  const busyStarts: Array<() => void> = [];
  /** Busy work started and not yet settled. The watch stays up while there is any. */
  let busyCount = 0;

  /** Choose the cursor for the pointer at (x, y): crosshair while framing a shot, else the watch while busy. */
  function trackCursor(x = cursorX, y = cursorY): void {
    if (screenshotCapture.selecting()) {
      SetCursor(cursors.cross);
      return;
    }
    SetCursor(busyCount > 0 ? cursors.watch : cursorForName(ui.cursorAt(x, y)));
  }

  function runBusy<T>(work: () => T | Promise<T>): Promise<T> {
    busyCount++;
    trackCursor();
    scheduleRepaint();
    const done = new Promise<void>((start) => busyStarts.push(start)).then(work);
    const settle = () => {
      busyCount--;
      trackCursor();
      scheduleRepaint();
    };
    done.then(settle, settle);
    return done;
  }

  // --- Frame loop ---
  const beforeFrameHooks = new Set<() => void>();
  function renderFrame() {
    if (stopped) return;
    ui.frame();
    compositeFrame();
    if (busyStarts.length > 0) {
      // Busy work may freeze the screen, so it waits until the watch is seen.
      const starts = busyStarts.splice(0);
      const startAll = () => { if (!stopped) for (const start of starts) start(); };
      if (display.whenVisible) display.whenVisible(startAll);
      else startAll();
    }
  }

  /**
   * Play a zoom-open or zoom-close animation directly on the screen port
   * without going through the frame loop, which is blocked for the duration
   * so it doesn't overwrite the XOR frames.
   *
   * @param onDone  called after the last frame is erased (screen is clean again)
   */
  function playZoomAnimation(from: AnimRect, to: AnimRect, onDone?: () => void): void {
    animating = true;
    void animateZoomRect({
      port: ui.port,
      present: presentScreen,
      from,
      to,
      cancelled: () => stopped,
      onEnd: () => {
        if (stopped) return;
        animating = false;
        scheduleRepaint();
        onDone?.();
      },
    });
  }

  function frameLoop() {
    if (stopped) return;
    scheduler.requestFrame(frameLoop);
    for (const hook of beforeFrameHooks) hook();
    if (stepMenubarReveal(scheduler.now())) scheduleRepaint();
    if (!screenDirty || animating) return;
    screenDirty = false;
    renderFrame();
  }
  scheduler.requestFrame(frameLoop);

  // --- Input ---
  const doubleClick = createDoubleClickTracker();

  function onPointer(e: PlatformPointerEvent): void {
    if (stopped) throw new ServiceError("disconnect", "Boot has ended");
    if (screenshotCapture.selecting()) {
      if (e.type !== "scroll") {
        cursorX = Math.max(0, Math.min(resolution.width - 1, Math.floor(e.x)));
        cursorY = Math.max(0, Math.min(resolution.height - 1, Math.floor(e.y)));
        cursorState.obscured = false;
      }
      screenshotCapture.pointer(e);
      trackCursor(cursorX, cursorY);
      scheduleRepaint();
      return;
    }
    if (claimMenubarEdge(e, scheduler.now())) {
      // y < 0 is the page above the canvas. Don't park the cursor there;
      // only a full-screen pass needs a repaint so the bar can slide.
      if (e.y >= 0 && e.type !== "scroll") {
        cursorX = e.x;
        cursorY = e.y;
        cursorState.obscured = false;
        scheduleRepaint();
      } else if (isMenubarHidden()) {
        scheduleRepaint();
      }
      return;
    }
    switch (e.type) {
      case "move":
        cursorX = e.x;
        cursorY = e.y;
        cursorState.obscured = false;
        ui.dispatchPointer("mousemove", e.x, e.y, { modifiers: e.modifiers });
        trackCursor(e.x, e.y);
        presentCursor();
        return;
      case "down": {
        cursorX = e.x;
        cursorY = e.y;
        ui.dispatchPointer("mousedown", e.x, e.y, { modifiers: e.modifiers });
        if (doubleClick.down(e.x, e.y, scheduler.now())) {
          ui.dispatchPointer("dblclick", e.x, e.y);
        }
        trackCursor(e.x, e.y);
        scheduleRepaint();
        return;
      }
      case "up":
        cursorX = e.x;
        cursorY = e.y;
        ui.dispatchPointer("mouseup", e.x, e.y, { modifiers: e.modifiers });
        trackCursor(e.x, e.y);
        scheduleRepaint();
        return;
      case "scroll":
        cursorX = e.x;
        cursorY = e.y;
        ui.dispatchPointer("scroll", e.x, e.y, { deltaY: e.deltaY ?? 0 });
        scheduleRepaint();
        return;
    }
  }

  /** ⌘-shortcut from the current menubar, if any. Returns true when handled. */
  function runMenuShortcut(key: string): boolean {
    for (const menu of getMenubarMenus()) {
      for (const item of menuCommands(menu.items)) {
        if (item.type === "radiogroup") continue;
        if (item.shortcut && item.shortcut.toLowerCase() === key.toLowerCase() && !item.disabled) {
          if (item.onClick) runMenuItem(item);
          setOpenMenuIndex(null);
          return true;
        }
      }
    }
    return false;
  }

  function pasteFromClipboard(): void {
    platform.clipboard
      ?.readText()
      .then((text) => {
        if (stopped) return;
        for (const ch of text) ui.dispatchKeyboard("keypress", ch, {});
        scheduleRepaint();
      })
      .catch(() => {
        // Clipboard read denied or unavailable — nothing to paste.
      });
  }

  function onKey(e: PlatformKeyEvent): void {
    if (stopped) throw new ServiceError("disconnect", "Boot has ended");
    if (screenshotCapture.key(e)) {
      trackCursor();
      scheduleRepaint();
      return;
    }
    const mods: Modifiers = e.modifiers;
    if (e.type === "up") {
      ui.dispatchKeyboard("keyup", e.key, mods);
      return;
    }
    const command = mods.meta || mods.ctrl;
    // An app's own enabled Paste owns ⌘V; otherwise the host clipboard types in.
    if (command && e.key.toLowerCase() === "v") {
      if (!(mods.meta && runMenuShortcut(e.key))) pasteFromClipboard();
      scheduleRepaint();
      return;
    }
    if (mods.meta && e.key.length === 1 && runMenuShortcut(e.key)) {
      scheduleRepaint();
      return;
    }
    ui.dispatchKeyboard("keydown", e.key, mods);
    if (e.key.length === 1 && !command) {
      ui.dispatchKeyboard("keypress", e.key, mods);
    }
    scheduleRepaint();
  }

  async function onDrop(e: PlatformDropEvent): Promise<void> {
    if (stopped) return;
    const accepted = e.files.filter(isImportableHostFile);
    if (accepted.length === 0) {
      if (e.files.length > 0) {
        await osServices.showDialog({ message: "Only image and font files can be imported.", buttons: ["OK"] });
      }
      return;
    }
    const target = resolveImportTarget(fs, getWindows(), e.x, e.y, MENUBAR_HEIGHT);
    if (!target) return;
    const imported = [];
    for (let i = 0; i < accepted.length; i++) {
      imported.push(
        await importHostFile(fs, target.parentId, accepted[i], {
          x: target.position.x + i * 16,
          y: target.position.y + i * 16,
        }),
      );
    }
    if (stopped) return;
    scheduleRepaint();
    if (target.openIn) {
      for (const file of imported) {
        osServices.openApp(target.openIn, { fileId: file.id, title: file.name });
      }
    }
  }

  const offPointer = platform.input.onPointer(onPointer);
  const offKey = platform.input.onKey(onKey);
  const offDrop = platform.input.onDrop?.(onDrop);

  const renderWaits = new Set<Cancellation>();
  async function renderBarrier(token = new Cancellation()) {
    token.check();
    if (stopped) throw new ServiceError("disconnect", "Boot has ended");
    renderWaits.add(token);
    try {
      while (animating || splashPending) await token.delay(8);
      await token.wait(desktopSettings.settled());
      token.check();
      if (stopped) throw new ServiceError("disconnect", "Boot has ended");
      screenDirty = false;
      renderFrame();
    } catch (error) {
      if (stopped) throw new ServiceError("disconnect", "Boot has ended");
      throw error;
    } finally {
      renderWaits.delete(token);
    }
  }
  registerUIOperations(kernel, osServices, { ui, beginGesture: () => { doubleClick.reset(); }, pointer: onPointer, key: onKey, render: renderBarrier,
    capture: () => {
      const bits = framed ? presentBits : screen;
      return { width: resolution.width, height: resolution.height, rowBytes: bits.rowBytes, bytes: Array.from(bits.baseAddr) };
    } });

  registerDesktopSettings(kernel, desktopSettings);
  osServices.projects = await registerProjects(kernel, osServices, platform, renderBarrier);
  osServices.shell = registerShell(kernel);

  return {
    input: { pointer: onPointer, key: onKey, drop: onDrop },
    render: renderBarrier,
    kernel,
    services: osServices,
    scheduleRepaint,
    shutdown() {
      if (stopped) return;
      stopped = true;
      clearTimeout(splashTimer);
      for (const token of renderWaits) token.cancel();
      kernel.shutdown();
      osServices.projects?.close();
      desktopSettings.shutdown();
      offPointer();
      offKey();
      offDrop?.();
      instances.close();
      unmount();
      closeAllWindows();
    },
  };
}
