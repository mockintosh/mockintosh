/**
 * Boots the whole OS on the headless platform and drives it like a user
 * would — proving the shell needs nothing from a browser, and that platform
 * events reach the UI through `bootOS`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "@mockintosh/ui";
import { createEffect, useApp, type AppContext, type AppServices } from "@mockintosh/sdk";
import { createElement, setProp } from "@mockintosh/ui/renderer";
import { bootOS, type BootedOS } from "./boot";
import { createHeadlessPlatform, type HeadlessPlatform } from "../platform/headless";
import { registerApp } from "./apps";
import { declaredApp } from "./appDeclaration";
import { MIME } from "@mockintosh/fs";
import { getActiveAppId, getActiveWindowId, getWindows, isMenubarHidden, setWindowFullScreen } from "./state";
import { TITLE_BAR_H, titleBarOuterHeight } from "./windowGeometry";
import { buildTinyTtf } from "../platform/fontRaster/tinyTtf";
import type { HostToProcess, ProcessPort, ProcessToHost } from "./process/protocol";
import Foundry from "@/apps/Foundry";

const WIDTH = 512;
const HEIGHT = 342;
const MENUBAR_HEIGHT = 20;

/** `<box width="100%" height="100%" background={ink} />` without JSX (this file is `.ts`). */
function fillBox(ink: 0 | 1): JSX.Element {
  const node = createElement("box");
  setProp(node, "width", "100%");
  setProp(node, "height", "100%");
  setProp(node, "background", ink);
  return node as unknown as JSX.Element;
}

function blackBox(): JSX.Element {
  return fillBox(1);
}

function whiteBox(): JSX.Element {
  return fillBox(0);
}

/** Fraction of black pixels in a rectangle of the last presented frame. */
function inkCoverage(frame: Uint8Array, x0: number, y0: number, w: number, h: number): number {
  let black = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) black += frame[y * WIDTH + x];
  }
  return black / (w * h);
}

/** Solid black rows in the title-bar interior, away from close box and title. */
function titleBarStripeLines(frame: Uint8Array, winX: number, winY: number): number {
  let lines = 0;
  for (let y = winY + 1; y < winY + TITLE_BAR_H - 1; y++) {
    if (inkCoverage(frame, winX + 24, y, 12, 1) === 1) lines++;
  }
  return lines;
}

describe("bootOS on the headless platform", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: WIDTH, height: HEIGHT });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000); // dismiss the splash
    platform.tick();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  it("draws the Finder desktop: white menubar over a dithered desktop", () => {
    const frame = platform.lastFrame()!;
    expect(frame).not.toBeNull();
    expect(platform.frameCount).toBeGreaterThan(0);

    // Menubar background is white with a black bottom rule and some titles.
    expect(inkCoverage(frame, 0, 0, WIDTH, MENUBAR_HEIGHT - 1)).toBeLessThan(0.2);
    expect(inkCoverage(frame, 0, MENUBAR_HEIGHT - 1, WIDTH, 1)).toBe(1);

    // The desktop pattern is a 50% checkerboard.
    const desktop = inkCoverage(frame, 40, 100, 64, 64);
    expect(desktop).toBeGreaterThan(0.45);
    expect(desktop).toBeLessThan(0.55);
  });

  it("only presents a frame when something changed", () => {
    const before = platform.frameCount;
    platform.tick();
    platform.tick();
    expect(platform.frameCount).toBe(before);

    platform.pointer({ type: "move", x: 100, y: 100 });
    expect(platform.frameCount).toBe(before + 1);
  });

  it("stamps the cursor on move without waiting for the frame loop", () => {
    const idle = platform.lastFrame()!;
    platform.pointer({ type: "move", x: 80, y: 200 });
    const stamped = platform.lastFrame()!;
    expect(stamped[200 * WIDTH + 80]).toBe(1);

    platform.pointer({ type: "move", x: 400, y: 300 });
    const moved = platform.lastFrame()!;
    expect(moved[300 * WIDTH + 400]).toBe(1);
    // The previous 16×16 is restored from the clean desktop (idle cursor is elsewhere).
    for (let y = 192; y < 216; y++) {
      for (let x = 72; x < 96; x++) {
        expect(moved[y * WIDTH + x], `restored (${x}, ${y})`).toBe(idle[y * WIDTH + x]);
      }
    }
  });

  it("opens a menu when its title is clicked and closes it on the next click", () => {
    // Find the Apple menu: the first black pixels in the menubar row.
    const frame = platform.lastFrame()!;
    let appleX = -1;
    for (let x = 0; x < WIDTH && appleX < 0; x++) {
      if (frame[10 * WIDTH + x]) appleX = x;
    }
    expect(appleX).toBeGreaterThan(0);

    platform.click(appleX + 3, 10);
    platform.tick();
    const open = platform.lastFrame()!;
    // A dropdown with a black frame now hangs below the menubar at the left.
    expect(inkCoverage(open, 0, MENUBAR_HEIGHT, 120, 40)).toBeGreaterThan(0.1);
    expect(inkCoverage(open, 0, MENUBAR_HEIGHT, 120, 40)).toBeLessThan(0.45); // not desktop pattern

    platform.click(300, 200); // click on the desktop dismisses it
    platform.tick();
    const closed = platform.lastFrame()!;
    const desktopAgain = inkCoverage(closed, 0, MENUBAR_HEIGHT + 2, 120, 40);
    expect(desktopAgain).toBeGreaterThan(0.45);
    expect(desktopAgain).toBeLessThan(0.55);
  });

  it("loads an app registered from its declaration before running it on its own thread", async () => {
    const module = {
      default: {
        id: "declared-test",
        title: "Declared",
        icon: "x",
        defaultSize: { width: 60, height: 40 },
        Component: blackBox,
      },
    };
    const load = vi.fn(async () => module);
    registerApp(declaredApp({ id: "declared-test", title: "Declared", icon: "x", defaultSize: { width: 60, height: 40 } }, load));
    os.services.openApp("declared-test");
    expect(getWindows().some((w) => w.appId === "declared-test")).toBe(false);
    await vi.waitFor(() => expect(getWindows().some((w) => w.appId === "declared-test")).toBe(true));
    expect(load).toHaveBeenCalledTimes(1);
    // Loaded once: opening again doesn't load it again.
    os.services.openApp("declared-test");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("sends keys typed after a click in a process window's header or footer band to its worker", async () => {
    const toWorker: HostToProcess[] = [];
    const port: ProcessPort = {
      postMessage: (message) => void toWorker.push(message as HostToProcess),
      onmessage: null,
      onerror: null,
      terminate: () => {},
    };
    const fromWorker = (data: ProcessToHost) => port.onmessage!({ data });
    platform.processes = { defaultRuntime: "main", canRun: () => true, spawn: () => port };
    registerApp({ id: "band-test", title: "Bands", icon: "x", runtime: "worker", defaultSize: { width: 120, height: 60 }, Component: () => null });
    os.services.openApp("band-test");
    fromWorker({ t: "call", id: 0, method: "window.open", args: ["window-1", { title: "Bands", position: { x: 40, y: 60 }, size: { width: 120, height: 60 }, hasGoAway: false }] });
    fromWorker({ t: "started" });
    platform.tick();
    expect(toWorker.some((m) => m.t === "window.attach" && m.key === "window-1")).toBe(true);
    fromWorker({ t: "call", id: 0, method: "window.setBands", args: ["window-1", 20, 16] });
    await os.render();

    const win = getWindows().find((w) => w.appId === "band-test")!;
    expect(win.headerHeight).toBe(20);
    const headerY = win.y + titleBarOuterHeight(win) + 8;
    const footerY = win.y + titleBarOuterHeight(win) + 20 + win.height + 8;
    const none = { shift: false, ctrl: false, alt: false, meta: false };
    const keysSent = () => toWorker.filter((m) => m.t === "key" && m.key === "window-1" && m.kind !== "keyup").map((m) => m.t === "key" && `${m.kind}:${m.value}`);
    for (const [y, row] of [[headerY, 8], [footerY, 20 + win.height + 8]]) {
      toWorker.length = 0;
      platform.click(win.x + 20, y);
      platform.tick();
      // The click lands on the band's rows of the worker's picture.
      expect(toWorker.find((m) => m.t === "pointer" && m.kind === "mousedown")).toMatchObject({ y: row });
      for (const key of ["a", "Enter", "Escape", "ArrowLeft"]) {
        platform.key({ type: "down", key, modifiers: none });
        platform.key({ type: "up", key, modifiers: none });
      }
      expect(keysSent()).toEqual(["keydown:a", "keypress:a", "keydown:Enter", "keydown:Escape", "keydown:ArrowLeft"]);
    }
  });

  it("eraseDisk formats the volume and restores the first-boot desktop", async () => {
    const desktop = os.services.fs.locate("desktop")!;
    await os.services.fs.writeJSON(desktop.id, "scratch", { n: 1 }, { type: MIME.json });
    os.services.openApp("terminal");
    platform.tick();
    expect(getWindows().some((w) => w.appId === "terminal")).toBe(true);

    await os.services.eraseDisk();
    platform.tick();

    expect(getWindows()).toEqual([]);
    const names = os.services.fs.children(os.services.fs.locate("desktop")!.id).map((n) => n.name);
    expect(names).toContain("App Store");
    expect(names).not.toContain("Canvas");
    expect(names).not.toContain("scratch");
  });

  it("refuses to launch an app whose `requires` this platform lacks, and says why", () => {
    registerApp({
      id: "test-camera-app",
      title: "Snapshot",
      icon: "icon/computer",
      requires: ["camera"],
      defaultSize: { width: 100, height: 100 },
      Component: () => null,
    });
    const before = getWindows().length;

    os.services.openApp("test-camera-app");
    platform.tick();

    const windows = getWindows();
    expect(windows.length).toBe(before + 1);
    const dialog = windows[windows.length - 1];
    expect(dialog.appId).toBe("__dialog__");
    expect(dialog.props?.message).toBe(
      '"Snapshot" needs a camera, which this Macintosh does not have.'
    );
  });

  it("draws a dBoxProc alert: 1px / 2px white / 2px band, stop icon, default-ring OK", () => {
    void os.services.showDialog({
      message: 'The application "Decker" could not be found.',
      buttons: ["OK"],
    });
    platform.tick();

    const dialog = getWindows().find((w) => w.appId === "__dialog__");
    expect(dialog).toBeDefined();
    expect(dialog!.kind).toBe("alert");
    expect(dialog!.width).toBe(376);
    expect(dialog!.height).toBe(112);
    expect(dialog!.x).toBe(Math.floor((WIDTH - 376) / 2));

    const frame = platform.lastFrame()!;
    const { x, y } = dialog!;
    const inset = 1 + 2 + 2;

    // Square picture frame: 1px outer, 2px white, 2px inner.
    expect(inkCoverage(frame, x + 20, y, 40, 1)).toBe(1);
    expect(inkCoverage(frame, x + 20, y + 1, 40, 2)).toBe(0);
    expect(inkCoverage(frame, x + 20, y + 3, 40, 2)).toBe(1);
    // Stop-hand ink in the icon cell (inside the frame + 16px pad).
    expect(inkCoverage(frame, x + inset + 16, y + inset + 16, 32, 32)).toBeGreaterThan(0.25);
    // Default-ring OK sits on the bottom-left (20px face + 4px ring + 16px pad).
    const btnTop = y + inset + 112 - 16 - 28;
    const btnLeft = x + inset + 16;
    expect(inkCoverage(frame, btnLeft + 10, btnTop, 40, 3)).toBe(1);

    // CDEF FontInfo: Chicago 12 in a 20px face → baseline 14, caps on 5–13.
    // The label now sits on the FontInfo line box (15px) centered in the face,
    // so the same caps land two rows higher than a face-filling measure.
    const faceTop = btnTop + 4;
    const faceLeft = btnLeft + 4;
    let inkMin = 20;
    let inkMax = -1;
    for (let row = 1; row < 19; row++) {
      if (inkCoverage(frame, faceLeft + 18, faceTop + row, 24, 1) > 0) {
        if (row < inkMin) inkMin = row;
        if (row > inkMax) inkMax = row;
      }
    }
    expect(inkMin).toBe(3);
    expect(inkMax).toBeGreaterThanOrEqual(13);
  });

  it("wraps a long alert message inside the frame and grows the alert to fit it", () => {
    void os.services.showDialog({
      message:
        '"showreel" stopped: Uncaught Error: [REACTIVE_WRITE_IN_OWNED_SCOPE] Writing to reactive state inside an owned scope (component, computation) is not allowed. Move the write outside or set the `ownedWrite` option if this is intentional.',
    });
    platform.tick();

    const dialog = getWindows().find((w) => w.appId === "__dialog__")!;
    expect(dialog.height).toBeGreaterThan(112);

    const frame = platform.lastFrame()!;
    const inset = 1 + 2 + 2;
    const top = dialog.y + inset;
    // No message ink in the right padding, inside the inner frame.
    const right = dialog.x + dialog.width - inset - 16;
    expect(inkCoverage(frame, right, top, 16, dialog.height)).toBe(0);
    // The OK ring still starts below the last line of the message.
    const btnTop = top + dialog.height - 16 - 28;
    expect(inkCoverage(frame, dialog.x + inset + 16, btnTop - 8, 150, 6)).toBe(0);
  });

  it("switches the front application from the menu at the right of the menubar", () => {
    registerApp({
      id: "switch-a",
      title: "Aaa",
      icon: "icon/computer",
      defaultSize: { width: 80, height: 40 },
      Component: () => whiteBox(),
    });
    registerApp({
      id: "switch-b",
      title: "Bee",
      icon: "icon/computer",
      defaultSize: { width: 80, height: 40 },
      Component: () => blackBox(),
    });
    os.services.openApp("switch-a");
    platform.tick();
    os.services.openApp("switch-b");
    platform.tick();
    expect(getActiveAppId()).toBe("switch-b");

    platform.click(WIDTH - 8, 10);
    platform.tick();
    // Finder, then Aaa, then Bee. Aaa is the second row of the dropdown.
    platform.click(WIDTH - 30, 47);
    platform.tick();
    expect(getActiveAppId()).toBe("switch-a");
    expect(getWindows().filter((w) => w.appId === "switch-a").at(-1)?.id).toBe(getActiveWindowId());
  });

  it("runs ⌘-shortcuts from the active menubar (⌘N creates a folder on the desktop)", () => {
    const before = platform.lastFrame()!.slice();
    const meta = { shift: false, ctrl: false, alt: false, meta: true };
    platform.key({ type: "down", key: "n", modifiers: meta });
    platform.key({ type: "up", key: "n", modifiers: meta });
    platform.tick();
    const after = platform.lastFrame()!;
    let changed = 0;
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) changed++;
    expect(changed).toBeGreaterThan(100); // a new folder icon + label appeared
  });

  // Regression: a z-order bump used to remount every IconCell mid-press, so the
  // pointer dispatcher never delivered the click that starts inline rename.
  it("renames a desktop icon after a second click on its selected label", async () => {
    const meta = { shift: false, ctrl: false, alt: false, meta: true };
    const none = { shift: false, ctrl: false, alt: false, meta: false };
    platform.key({ type: "down", key: "n", modifiers: meta });
    platform.key({ type: "up", key: "n", modifiers: meta });
    platform.tick();

    const fs = os.services.fs;
    const desktop = fs.locate("desktop");
    expect(desktop).toBeTruthy();
    const folder = fs.children(desktop!.id).find((n) => n.name === "untitled folder");
    expect(folder).toBeTruthy();

    const pos = desktopCellPos(fs, folder!.id);
    expect(pos).not.toBeNull();

    // First click: the icon sprite (not the label) selects the icon.
    platform.click(pos!.iconX, pos!.iconY);
    platform.tick();

    // Second click: the label of the already-selected icon. Far enough from
    // the sprite that bootOS does not treat this as a double-click.
    platform.click(pos!.labelX, pos!.labelY);
    platform.tick();
    vi.advanceTimersByTime(350);
    await os.render();
    await Promise.resolve(); // TextInput autoFocus is scheduled on a microtask
    await os.render();

    platform.key({ type: "down", key: "a", modifiers: meta });
    platform.key({ type: "up", key: "a", modifiers: meta });
    for (const ch of "Renamed") {
      platform.key({ type: "down", key: ch, modifiers: none });
      platform.key({ type: "up", key: ch, modifiers: none });
    }
    platform.key({ type: "down", key: "Enter", modifiers: none });
    platform.key({ type: "up", key: "Enter", modifiers: none });
    platform.tick();

    expect(fs.node(folder!.id)?.name).toBe("Renamed");
  });

  it("lets an app decide what opening it does: `onOpen` may open no window at all", () => {
    const onOpen = vi.fn();
    registerApp({
      id: "test-windowless",
      title: "Windowless",
      icon: "icon/computer",
      defaultSize: { width: 100, height: 100 },
      Component: () => null,
      onOpen,
    });
    const before = getWindows().length;

    os.services.openApp("test-windowless", { fileId: "f1", title: "Doc" });
    platform.tick();

    expect(getWindows().length).toBe(before);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const [context, props] = onOpen.mock.calls[0] as [AppContext, Record<string, unknown>];
    expect(props).toEqual({ fileId: "f1", title: "Doc" });
    expect(typeof context.openWindow).toBe("function");
    expect(context.fs).toBe(os.services.fs);
  });

  it("opens a window after an await only while onOpen holds keepAlive", async () => {
    for (const hold of [false, true]) {
      let ready!: () => void;
      const loaded = new Promise<void>((resolve) => { ready = resolve; });
      const id = `test-late-${hold}`;
      registerApp({
        id,
        title: id,
        icon: "icon/computer",
        defaultSize: { width: 100, height: 60 },
        Component: () => whiteBox(),
        onOpen(app, props) {
          const release = hold ? app.keepAlive?.() : undefined;
          void loaded.then(() => app.openWindow({ props })).finally(() => release?.());
        },
      });
      os.services.openApp(id, { fileId: "f1", title: "Doc" });
      ready();
      await loaded;
      await Promise.resolve();
      platform.tick();
      expect(getWindows().some((w) => w.appId === id)).toBe(hold);
    }
  });

  it("opens another window when launched with a url the open windows do not have", () => {
    registerApp({
      id: "test-browser",
      title: "Browser",
      icon: "icon/computer",
      defaultSize: { width: 100, height: 60 },
      Component: () => whiteBox(),
    });
    os.services.openApp("test-browser");
    os.services.openApp("test-browser", { url: "https://example.com/" });
    os.services.openApp("test-browser", { url: "https://example.com/" });
    const wins = getWindows().filter((w) => w.appId === "test-browser");
    expect(wins).toHaveLength(2);
    expect(wins.map((w) => w.props.url)).toEqual([undefined, "https://example.com/"]);
  });

  it("opens windows of the kind an app asks for: a `plain` box has a frame but no title bar", () => {
    registerApp({
      id: "test-kinds",
      title: "Kinds",
      icon: "icon/computer",
      defaultSize: { width: 100, height: 60 },
      Component: () => null,
      onOpen(app) {
        app.openWindow({ kind: "plain", position: { x: 40, y: 80 }, size: { width: 100, height: 50 } });
        app.openWindow({ kind: "document", position: { x: 300, y: 80 }, size: { width: 100, height: 50 } });
      },
    });

    os.services.openApp("test-kinds");
    platform.tick();

    const wins = getWindows().filter((w) => w.appId === "test-kinds");
    expect(wins.map((w) => w.kind)).toEqual(["plain", "document"]);

    const frame = platform.lastFrame()!;
    // Both draw their top frame line…
    expect(inkCoverage(frame, 41, 80, 98, 1)).toBe(1);
    expect(inkCoverage(frame, 301, 80, 98, 1)).toBe(1);
    // …but only the document window has a title bar, whose separator sits at TITLE_BAR_H - 1;
    // inside the plain box those rows are blank content.
    expect(inkCoverage(frame, 301, 80 + TITLE_BAR_H - 1, 98, 1)).toBe(1);
    expect(inkCoverage(frame, 41, 81, 98, TITLE_BAR_H - 1)).toBe(0);
  });

  it("paints six title-bar stripe lines whether the window sits on an even or odd row", () => {
    registerApp({
      id: "test-stripes",
      title: "X",
      icon: "icon/computer",
      defaultSize: { width: 180, height: 50 },
      Component: () => null,
      onOpen(app) {
        app.openWindow({ position: { x: 40, y: 80 }, size: { width: 180, height: 50 }, title: "X" });
        app.openWindow({ position: { x: 280, y: 81 }, size: { width: 180, height: 50 }, title: "X" });
      },
    });

    os.services.openApp("test-stripes");
    platform.tick();

    const even = getWindows().find((w) => w.appId === "test-stripes" && w.y === 80)!;
    const odd = getWindows().find((w) => w.appId === "test-stripes" && w.y === 81)!;
    expect(even).toBeDefined();
    expect(odd).toBeDefined();

    // The second window is frontmost. Sample a strip just right of the close
    // box, left of the title, so only the chrome stripes can fill a row.
    expect(titleBarStripeLines(platform.lastFrame()!, odd.x, odd.y)).toBe(6);

    platform.click(even.x + 50, even.y + 8);
    platform.tick();
    expect(titleBarStripeLines(platform.lastFrame()!, even.x, even.y)).toBe(6);
  });

  it("opens submenus on hover, runs their items, and binds their shortcuts", () => {
    const ran: string[] = [];
    registerApp({
      id: "test-submenus",
      title: "Subs",
      icon: "icon/computer",
      defaultSize: { width: 80, height: 60 },
      Component: () => whiteBox(),
      menus: [
        {
          label: "Things",
          items: [
            { label: "A", onClick: () => ran.push("A") },
            {
              type: "submenu",
              label: "B",
              items: [
                { label: "C", onClick: () => ran.push("C") },
                { type: "submenu", label: "D", items: [{ label: "E", shortcut: "J", onClick: () => ran.push("E") }] },
              ],
            },
            { type: "submenu", label: "F", disabled: true, items: [{ label: "G", shortcut: "K", onClick: () => ran.push("G") }] },
          ],
        },
      ],
    });
    os.services.openApp("test-submenus");
    platform.tick();

    const meta = { shift: false, ctrl: false, alt: false, meta: true };
    for (const key of ["j", "k"]) {
      platform.key({ type: "down", key, modifiers: meta });
      platform.key({ type: "up", key, modifiers: meta });
    }
    expect(ran).toEqual(["E"]);

    // Short labels keep every panel at the 80px minimum width; rows are 16px
    // below a 4px pad, and a submenu's first row lines up with its item.
    const hover = (x: number, y: number) => {
      platform.pointer({ type: "move", x, y });
      platform.tick();
    };
    const openThings = () => {
      platform.click(34, 10);
      platform.tick();
    };

    openThings();
    hover(50, 47); // B
    hover(130, 47); // C, in B's submenu beside the first panel
    platform.click(130, 47);
    platform.tick();
    expect(ran).toEqual(["E", "C"]);

    openThings();
    hover(50, 47);
    hover(130, 47);
    hover(130, 63); // D
    hover(200, 63); // E, a level deeper
    platform.click(200, 63);
    platform.tick();
    expect(ran).toEqual(["E", "C", "E"]);
  });

  it("a window can go full screen — covering the menubar — and come back, by menu shortcut too", () => {
    let services: AppServices | undefined;
    registerApp({
      id: "test-fullscreen",
      title: "Show",
      icon: "icon/computer",
      defaultSize: { width: 120, height: 80 },
      Component: () => {
        services = useApp();
        return blackBox();
      },
      menus: [
        {
          label: "View",
          items: [{ label: "Menu Bar", shortcut: "M", onClick: () => services!.window.setFullScreen(false) }],
        },
      ],
    });

    os.services.openApp("test-fullscreen");
    platform.tick();
    expect(services).toBeDefined();
    const win = getWindows().find((w) => w.appId === "test-fullscreen")!;
    const windowed = { x: win.x, y: win.y, width: win.width, height: win.height };
    expect(services!.window.kind()).toBe("document");

    services!.window.setFullScreen(true);
    platform.tick();
    expect(services!.window.kind()).toBe("fullscreen");
    expect(services!.window.width()).toBe(WIDTH);
    expect(services!.window.height()).toBe(HEIGHT);
    // The app's black content is everywhere, menubar row included (only the cursor shows through).
    expect(inkCoverage(platform.lastFrame()!, 8, 0, WIDTH - 16, MENUBAR_HEIGHT)).toBe(1);
    expect(inkCoverage(platform.lastFrame()!, 8, 8, WIDTH - 16, HEIGHT - 16)).toBeGreaterThan(0.999);

    // The hidden menubar's shortcuts still work: this is the way back.
    const meta = { shift: false, ctrl: false, alt: false, meta: true };
    platform.key({ type: "down", key: "m", modifiers: meta });
    platform.key({ type: "up", key: "m", modifiers: meta });
    platform.tick();

    const restored = getWindows().find((w) => w.appId === "test-fullscreen")!;
    expect(restored.kind).toBe("document");
    expect({ x: restored.x, y: restored.y, width: restored.width, height: restored.height }).toEqual(windowed);
    expect(inkCoverage(platform.lastFrame()!, 0, 0, WIDTH, MENUBAR_HEIGHT - 1)).toBeLessThan(0.2);
  });

  it("slides the menubar down from a touch on the top edge, then back up", () => {
    let presses = 0;
    registerApp({
      id: "test-reveal",
      title: "Show",
      icon: "icon/computer",
      defaultSize: { width: 120, height: 80 },
      Component: () => {
        const node = blackBox();
        setProp(node, "onMouseDown", () => {
          presses++;
        });
        return node;
      },
    });

    os.services.openApp("test-reveal");
    platform.tick();
    const win = getWindows().find((w) => w.appId === "test-reveal")!;
    setWindowFullScreen(win.id, true, { width: WIDTH, height: HEIGHT });
    platform.tick();
    expect(inkCoverage(platform.lastFrame()!, 8, 0, WIDTH - 16, MENUBAR_HEIGHT)).toBe(1);

    platform.pointer({ type: "down", x: 40, y: 1, button: 0 });
    platform.pointer({ type: "up", x: 40, y: 1, button: 0 });
    expect(presses).toBe(0);
    for (let i = 0; i < MENUBAR_HEIGHT; i++) platform.tick();
    expect(inkCoverage(platform.lastFrame()!, 0, 0, WIDTH, MENUBAR_HEIGHT - 1)).toBeLessThan(0.2);
    expect(inkCoverage(platform.lastFrame()!, 0, MENUBAR_HEIGHT - 1, WIDTH, 1)).toBe(1);

    platform.click(40, 80);
    expect(presses).toBe(1);
    for (let i = 0; i < MENUBAR_HEIGHT; i++) platform.tick();
    expect(inkCoverage(platform.lastFrame()!, 200, 0, 80, MENUBAR_HEIGHT)).toBe(1);
  });

  it("slides the menubar down when the pointer passes above the screen", () => {
    registerApp({
      id: "test-pass",
      title: "Show",
      icon: "icon/computer",
      defaultSize: { width: 120, height: 80 },
      Component: () => blackBox(),
    });
    os.services.openApp("test-pass");
    platform.tick();
    const win = getWindows().find((w) => w.appId === "test-pass")!;
    setWindowFullScreen(win.id, true, { width: WIDTH, height: HEIGHT });
    platform.tick();

    platform.pointer({ type: "move", x: 40, y: -4 });
    for (let i = 0; i < MENUBAR_HEIGHT; i++) platform.tick();
    expect(inkCoverage(platform.lastFrame()!, 200, 0, 80, MENUBAR_HEIGHT - 1)).toBe(0);
  });

  it("keeps an untitled utility palette lit beside the key document, and above full screen", () => {
    registerApp({
      id: "test-palette",
      title: "Palette",
      icon: "icon/computer",
      defaultSize: { width: 80, height: 40 },
      Component: () => blackBox(),
      onOpen(app) {
        app.openWindow({
          title: "P",
          size: { width: 120, height: 40 },
          position: { x: 200, y: 80 },
          Component: () => blackBox(),
        });
        app.openWindow({
          kind: "utility",
          title: "",
          size: { width: 70, height: 36 },
          position: { x: 16, y: 40 },
          Component: () => whiteBox(),
        });
      },
    });

    os.services.openApp("test-palette");
    platform.tick();
    const picture = getWindows().find((w) => w.appId === "test-palette" && w.kind === "document")!;
    const tools = getWindows().find((w) => w.appId === "test-palette" && w.kind === "utility")!;
    expect(tools.title).toBe("");
    expect(titleBarOuterHeight(tools)).toBe(12);
    expect(getActiveWindowId()).toBe(picture.id);
    // Document keeps racing stripes. The palette's drag bar is 25% gray, not stripes.
    expect(titleBarStripeLines(platform.lastFrame()!, picture.x, picture.y)).toBe(6);
    const gray = inkCoverage(platform.lastFrame()!, tools.x + 28, tools.y + 2, 24, 6);
    expect(gray).toBeGreaterThan(0.15);
    expect(gray).toBeLessThan(0.4);

    // A click in the palette does not take the key window.
    platform.click(tools.x + 20, tools.y + titleBarOuterHeight(tools) + 8);
    platform.tick();
    expect(getActiveWindowId()).toBe(picture.id);
    expect(titleBarStripeLines(platform.lastFrame()!, picture.x, picture.y)).toBe(6);

    const x0 = tools.x;
    const y0 = tools.y;
    platform.pointer({ type: "down", x: x0 + 30, y: y0 + 5, button: 0 });
    platform.pointer({ type: "move", x: x0 + 70, y: y0 + 20, button: 0 });
    platform.pointer({ type: "up", x: x0 + 70, y: y0 + 20, button: 0 });
    platform.tick();
    const moved = getWindows().find((w) => w.id === tools.id)!;
    expect(moved.x).toBeGreaterThan(x0);
    expect(titleBarStripeLines(platform.lastFrame()!, picture.x, picture.y)).toBe(6);

    setWindowFullScreen(picture.id, true, { width: WIDTH, height: HEIGHT });
    platform.tick();
    expect(isMenubarHidden()).toBe(true);
    expect(inkCoverage(platform.lastFrame()!, moved.x + 8, moved.y + titleBarOuterHeight(moved) + 6, 16, 8)).toBe(0);

    setWindowFullScreen(picture.id, false, { width: WIDTH, height: HEIGHT });
    platform.tick();
    const restored = getWindows().find((w) => w.id === picture.id)!;
    expect(restored.kind).toBe("document");
    expect(isMenubarHidden()).toBe(false);
    expect(titleBarStripeLines(platform.lastFrame()!, picture.x, picture.y)).toBe(6);
  });

  it("File → Quit, installed by the app, ends every window of that launch", () => {
    registerApp({
      id: "test-quit",
      title: "Quitter",
      icon: "icon/computer",
      defaultSize: { width: 80, height: 40 },
      Component: () => {
        const app = useApp();
        createEffect(() => true, () => {
          app.setMenus([
            { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
          ]);
        });
        return whiteBox();
      },
      onOpen(app) {
        app.openWindow({ title: "A", position: { x: 40, y: 40 } });
        app.openWindow({ title: "B", position: { x: 200, y: 40 } });
      },
    });

    os.services.openApp("test-quit");
    platform.tick();
    expect(getWindows().filter((w) => w.appId === "test-quit")).toHaveLength(2);

    const meta = { shift: false, ctrl: false, alt: false, meta: true };
    platform.key({ type: "down", key: "q", modifiers: meta });
    platform.key({ type: "up", key: "q", modifiers: meta });
    platform.tick();
    expect(getWindows().filter((w) => w.appId === "test-quit")).toHaveLength(0);
  });

  it("opens Foundry on a TTF and rasterizes a 1-bit strike", async () => {
    registerApp(Foundry);
    const desktop = os.services.fs.locate("desktop")!;
    const file = await os.services.fs.writeFile(desktop.id, "tiny.ttf", buildTinyTtf(), {
      type: MIME.truetype,
    });
    os.services.openApp("foundry", { fileId: file.id, title: file.name });
    platform.tick();
    const win = getWindows().find((w) => w.appId === "foundry");
    expect(win).toBeDefined();
    await vi.waitFor(() => {
      platform.tick();
      const frame = platform.lastFrame()!;
      const coverage = inkCoverage(frame, win!.x + 10, win!.y + TITLE_BAR_H + 4, 120, 40);
      expect(coverage).toBeGreaterThan(0.02);
    });
    const caller = os.kernel.createSession();
    const nodes = (await os.kernel.invoke(caller, "inspect", { window: win!.id })) as Array<{
      name?: string;
      bounds: { x: number; y: number; width: number; height: number };
    }>;
    expect(nodes.some((n) => n.name === "glyph-strip")).toBe(true);
    const cells = nodes.filter((n) => n.name?.startsWith("glyph-") && n.name !== "glyph-strip");
    expect(cells.map((n) => n.name)).toEqual(expect.arrayContaining(["glyph-32", "glyph-65"]));
    const right = win!.x + win!.width;
    for (const cell of cells) {
      expect(cell.bounds.width).toBeGreaterThan(0);
      expect(cell.bounds.x + cell.bounds.width).toBeLessThanOrEqual(right);
    }
  });

  it("writes a dropped host TrueType font onto the desktop", async () => {
    const desktop = os.services.fs.locate("desktop")!;
    expect(os.services.fs.child(desktop.id, "tiny.ttf")).toBeUndefined();
    platform.drop({
      x: 80,
      y: 80,
      files: [{ name: "tiny.ttf", type: "font/ttf", bytes: new Uint8Array([0, 1, 0, 0]) }],
    });
    await vi.waitFor(() => {
      expect(os.services.fs.child(desktop.id, "tiny.ttf")).toMatchObject({
        kind: "file",
        type: "font/ttf",
      });
    });
  });

  it("writes a dropped host image onto the desktop", async () => {
    const desktop = os.services.fs.locate("desktop")!;
    expect(os.services.fs.child(desktop.id, "face.png")).toBeUndefined();
    platform.drop({
      x: 80,
      y: 80,
      files: [{ name: "face.png", type: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) }],
    });
    await vi.waitFor(() => {
      expect(os.services.fs.child(desktop.id, "face.png")).toMatchObject({
        kind: "file",
        type: "image/png",
      });
    });
  });
});

describe("host display resize", () => {
  it("adopts a new framebuffer when the host reports a new logical size", async () => {
    vi.useFakeTimers();
    const platform = createHeadlessPlatform({ width: 80, height: 40 });
    const listeners = new Set<(width: number, height: number) => void>();
    platform.hostDisplay = {
      resolutions: [{ id: "classic", label: "80 × 40", width: 80, height: 40 }],
      state: () => ({ resolution: "classic", width: 80, height: 40, scale: "auto", maxScale: 1 }),
      setResolution() {},
      setScale() {},
      onResize(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      subscribe: () => () => {},
    };
    const os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    for (const listener of listeners) listener(120, 50);
    platform.tick();
    expect(os.services.resolution.width).toBe(120);
    expect(os.services.resolution.height).toBe(50);
    expect(platform.lastFrame()).toHaveLength(120 * 50);
    os.shutdown();
    vi.useRealTimers();
  });
});

/** Layout constants mirrored from Finder.solid — desktop icons without a stored position. */
const DESKTOP_ICON_CELL_W = 64;
const DESKTOP_ICON_CELL_H = 64;
const DESKTOP_PADDING_TOP = 8;
const ICON_SIZE = 32;

function desktopCellPos(
  fs: BootedOS["services"]["fs"],
  nodeId: string,
): { iconX: number; iconY: number; labelX: number; labelY: number } | null {
  const ids: string[] = [];
  for (const vol of fs.volumes()) ids.push(vol.id);
  for (const vol of fs.volumes()) {
    const desktop = fs.locate("desktop", vol.id);
    if (!desktop) continue;
    for (const node of fs.children(desktop.id)) ids.push(node.id);
  }
  const trash = fs.locate("trash");
  if (trash && !ids.includes(trash.id)) ids.push(trash.id);

  const index = ids.indexOf(nodeId);
  if (index < 0) return null;

  const desktopH = HEIGHT - MENUBAR_HEIGHT;
  const maxRows = Math.max(1, Math.floor((desktopH - DESKTOP_PADDING_TOP) / DESKTOP_ICON_CELL_H));
  const col = Math.floor(index / maxRows);
  const row = index % maxRows;
  const cellX = WIDTH - (col + 1) * DESKTOP_ICON_CELL_W;
  const cellY = MENUBAR_HEIGHT + row * DESKTOP_ICON_CELL_H + DESKTOP_PADDING_TOP;
  const iconOffsetX = Math.floor((DESKTOP_ICON_CELL_W - ICON_SIZE) / 2);
  return {
    iconX: cellX + iconOffsetX + ICON_SIZE / 2,
    iconY: cellY + ICON_SIZE / 2,
    labelX: cellX + DESKTOP_ICON_CELL_W / 2,
    labelY: cellY + ICON_SIZE + 7,
  };
}
