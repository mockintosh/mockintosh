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

import { InitGraf, InitCursor, SetCursor, cursorState, globals as qd } from "@mockintosh/quickdraw";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createDoubleClickTracker, createUI, type Modifiers } from "@mockintosh/ui";
import { FileSystem } from "@mockintosh/fs";
import type { AppContext } from "@mockintosh/sdk";
import type { Platform, PlatformDropEvent, PlatformKeyEvent, PlatformPointerEvent } from "../platform/types";
import { importHostFile, isImportableImage, resolveImportTarget } from "./hostImport";
import { SpriteRegistry, registerBuiltinSprites } from "./sprites";
import { drawCursor } from "./cursor";
import { cursorForName } from "./cursors";
import { animateZoomRect, type AnimRect } from "./zoomAnimation";
import { buildFolderWindow, windowOuterRect } from "../../apps/Finder.solid";
import { bootstrapFileSystem } from "./fsBootstrap";
import { resolveOpenAction } from "./openers";
import { claimMenubarEdge, stepMenubarReveal } from "./menubarReveal";
import { makeOSRoot } from "./OSRoot.solid";
import {
  setSplashVisible,
  openOSWindow,
  closeOSWindow,
  closeAllWindows,
  getWindows,
  getActiveWindowId,
  setWindowOutline,
  bringToFront,
  getMenubarMenus,
  isMenubarHidden,
  setOpenMenuIndex,
} from "./state";
import type { OSServices } from "./context";
import { getAllApps, getApp, registerApp } from "./apps";
import { createAppContext } from "./appContext";
import { buildAppWindow } from "./appWindow";
import { DialogApp } from "./components/Dialog.solid";
import { createAppInstaller } from "./installedApps";
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
  const present = () => { if (!stopped) display.present(screen); };

  InitCursor();

  // --- Sprites: built-ins, then whatever the bundled apps brought along ---
  const sprites = new SpriteRegistry();
  registerBuiltinSprites(sprites);
  for (const app of getAllApps()) if (app.sprites) sprites.registerAll(app.sprites);

  // --- Frame scheduling ---
  let screenDirty = true;
  /** True while a zoom animation owns the framebuffer — blocks the frame loop. */
  let animating = false;
  function scheduleRepaint() {
    screenDirty = true;
  }

  const instances = new AppInstances(id => closeOSWindow(id));

  // --- UI instance (full-screen Solid renderer) ---
  bootTrace("ui");
  const ui = createUI({
    screen,
    scheduleRender: scheduleRepaint,
    services: {
      clipboard: platform.clipboard,
      images: platform.images
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
        : undefined,
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

  // --- Installed third-party apps (manifests live in /Applications) ---
  const capabilities = platformCapabilities(platform);
  const installer = platform.loadModule
    ? createAppInstaller({ fs, sprites, capabilities, loadModule: platform.loadModule })
    : undefined;
  await installer?.loadInstalled();

  // --- Printers ---
  const printers =
    platform.printerLinks || platform.printer
      ? await createSystemPrinters({
          fs,
          links: platform.printerLinks,
          fixed: platform.printer ? { transport: platform.printer, profile: platform.printerProfile } : undefined,
        })
      : undefined;

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
    crypto: platform.crypto,
    browser: platform.browser,
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
        return app.singleInstance !== false;
      });
      if (existing) {
        bringToFront(existing.id);
        return;
      }
      // The app's `main`: it decides which windows to open, if any.
      const instanceId = instances.create(appId, osServices.projects?.selectedBuild(appId));
      const context = createAppContext(osServices, appId, { fromRect, instanceId });
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

  // --- Frame loop ---
  function renderFrame() {
    if (stopped) return;
    ui.frame();
    drawCursor(ui.port, cursorX, cursorY);
    present();
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
      present,
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
        screenDirty = true;
        SetCursor(cursorForName(ui.cursorAt(e.x, e.y)));
        ui.dispatchPointer("mousemove", e.x, e.y, { modifiers: e.modifiers });
        return;
      case "down": {
        ui.dispatchPointer("mousedown", e.x, e.y, { modifiers: e.modifiers });
        if (doubleClick.down(e.x, e.y, scheduler.now())) {
          ui.dispatchPointer("dblclick", e.x, e.y);
        }
        SetCursor(cursorForName(ui.cursorAt(e.x, e.y)));
        scheduleRepaint();
        return;
      }
      case "up":
        SetCursor(cursorForName(ui.cursorAt(e.x, e.y)));
        ui.dispatchPointer("mouseup", e.x, e.y, { modifiers: e.modifiers });
        scheduleRepaint();
        return;
      case "scroll":
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
    const mods: Modifiers = e.modifiers;
    if (e.type === "up") {
      ui.dispatchKeyboard("keyup", e.key, mods);
      return;
    }
    const command = mods.meta || mods.ctrl;
    if (command && e.key.toLowerCase() === "v") {
      pasteFromClipboard();
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
    const images = e.files.filter(isImportableImage);
    if (images.length === 0) {
      if (e.files.length > 0) {
        await osServices.showDialog({ message: "Only image files can be imported.", buttons: ["OK"] });
      }
      return;
    }
    const target = resolveImportTarget(fs, getWindows(), e.x, e.y, MENUBAR_HEIGHT);
    if (!target) return;
    const imported = [];
    for (let i = 0; i < images.length; i++) {
      imported.push(
        await importHostFile(fs, target.parentId, images[i], {
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
    capture: () => ({ width: resolution.width, height: resolution.height, rowBytes: screen.rowBytes, bytes: Array.from(screen.baseAddr) }) });

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
