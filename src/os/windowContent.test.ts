/**
 * Closing a window runs the app's cleanups where writing state is allowed,
 * whichever way the window goes: an app's teardown must never halt the
 * reactive runtime the whole OS shares.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal, defineApp, onCleanup, useApp } from "@mockintosh/sdk";
import type { InspectionNode, JSX } from "@mockintosh/ui";
import { createElement, setProp } from "@mockintosh/ui/renderer";
import { bootOS, type BootedOS } from "./boot";
import { registerApp } from "./apps";
import { getWindows } from "./state";
import { createHeadlessPlatform, type HeadlessPlatform } from "../platform/headless";

const SIZE = { width: 120, height: 80 };
const COMMAND = { shift: false, ctrl: false, alt: false, meta: true };

/** `<box semantic={{ name }} />` without JSX (this file is `.ts`). */
function namedBox(name: string): JSX.Element {
  const node = createElement("box");
  setProp(node, "width", "100%");
  setProp(node, "height", "100%");
  setProp(node, "semantic", { name });
  return node as unknown as JSX.Element;
}

/** The pattern that used to freeze the OS: a cleanup that writes a signal, through a listener. */
function Writer(): JSX.Element {
  const app = useApp();
  const [, setStatus] = createSignal("open");
  const listeners = new Set<(state: string) => void>([setStatus]);
  app.setMenus([{ label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] }]);
  onCleanup(() => listeners.forEach((listener) => listener("closed")));
  return namedBox("writer");
}

function Thrower(): JSX.Element {
  onCleanup(() => {
    throw new Error("cleanup failed");
  });
  return namedBox("thrower");
}

const WriterApp = defineApp({ id: "cleanup_writer", title: "Writer", icon: "icon/computer", defaultSize: SIZE, Component: Writer });
const ThrowerApp = defineApp({ id: "cleanup_thrower", title: "Thrower", icon: "icon/computer", defaultSize: SIZE, Component: Thrower });
const ProbeApp = defineApp({ id: "cleanup_probe", title: "Probe", icon: "icon/computer", defaultSize: SIZE, Component: () => namedBox("probe") });

describe("closing a window", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 512, height: 342 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    for (const app of [WriterApp, ThrowerApp, ProbeApp]) registerApp(app);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    os.shutdown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const settle = async () => {
    // Window zoom animations run on timers.
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 5; i++) platform.tick();
    await vi.advanceTimersByTimeAsync(0);
  };
  const inspect = async () => (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
  const open = async (appId: string) => {
    os.services.openApp(appId, {}, { x: 20, y: 60, width: 32, height: 32 });
    await settle();
    const win = getWindows().find((w) => w.appId === appId);
    expect(win).toBeTruthy();
    return win!;
  };
  const clickCloseBox = async (windowId: string) => {
    const close = (await inspect()).find((n) => n.name === "close" && n.windowId === windowId)!;
    const x = close.bounds.x + close.bounds.width / 2;
    const y = close.bounds.y + close.bounds.height / 2;
    platform.pointer({ type: "move", x, y });
    platform.pointer({ type: "down", x, y, button: 0 });
    platform.pointer({ type: "up", x, y, button: 0 });
    await settle();
  };
  /** A halted runtime draws nothing new: a freshly opened window never shows up. */
  const expectOSResponds = async () => {
    await open("cleanup_probe");
    expect((await inspect()).some((n) => n.name === "probe")).toBe(true);
  };

  it("from the close box, lets the app's cleanup write state", async () => {
    const win = await open("cleanup_writer");
    await clickCloseBox(win.id);
    expect(getWindows().some((w) => w.appId === "cleanup_writer")).toBe(false);
    await expectOSResponds();
  });

  it("from File › Quit, lets the app's cleanup write state", async () => {
    await open("cleanup_writer");
    platform.key({ type: "down", key: "q", modifiers: COMMAND });
    platform.key({ type: "up", key: "q", modifiers: COMMAND });
    await settle();
    expect(getWindows().some((w) => w.appId === "cleanup_writer")).toBe(false);
    await expectOSResponds();
  });

  it("survives a cleanup that throws, and reports it", async () => {
    const win = await open("cleanup_thrower");
    await clickCloseBox(win.id);
    expect(getWindows().some((w) => w.appId === "cleanup_thrower")).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("cleanup_thrower"), new Error("cleanup failed"));
    await expectOSResponds();
  });
});
