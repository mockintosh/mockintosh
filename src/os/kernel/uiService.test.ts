import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "../boot";
import { createHeadlessPlatform } from "../../platform/headless";
import type { KernelSession } from "./index";
import { registerApp } from "../apps";
import { FINDER_APP_ID, getActiveWindowId, getWindows } from "../state";
import { InMemoryBackend } from "@mockintosh/fs";
import { Cancellation } from "./cancellation";
import type { InspectionNode } from "@mockintosh/ui";
import { ABOUT_THIS_COMPUTER_LABEL, APPLE_MENU_LABEL } from "./menus";
import { ABOUT_BOX_TITLE } from "../../../apps/finder/AboutBox";
import { CONTROL_PANEL_TITLE } from "../../../apps/finder/ControlPanel";
describe("visible kernel UI operations", () => {
  let os: BootedOS, caller: KernelSession;
  const invoke = (name: string, args = {}) => os.kernel.invoke(caller, name, args);
  /** Open the Control Panel the way a user does: from the Apple menu. */
  const openControlPanel = () => invoke("menu", { menu: APPLE_MENU_LABEL, item: CONTROL_PANEL_TITLE });
  /** The Control Panel is a Finder window, found by its title. */
  const controlPanelWindow = () => getWindows().find(w => w.appId === FINDER_APP_ID && w.title === CONTROL_PANEL_TITLE)!;
  beforeEach(async () => {
    vi.useFakeTimers();
    os = await bootOS(createHeadlessPlatform({
      width: 640,
      height: 480
    }));
    vi.advanceTimersByTime(1000);
    caller = os.kernel.createSession();
  });
  afterEach(async () => {
    await os.services.fs.flush();
    os.shutdown();
    vi.useRealTimers();
  });
  it("exposes desktop pattern as a typed trap backed by the Preferences file", async () => {
    expect(os.kernel.describe().some(operation => operation.name === "desktop_pattern")).toBe(true);
    expect(await invoke("desktop_pattern", {value: "black"})).toMatchObject({pattern: "black", diagnostic: ""});
    expect(os.services.desktopSettings!.pattern()).toBe("black");
    expect(await invoke("desktop_pattern", {value: "ppat:132"})).toMatchObject({pattern: "ppat:132", diagnostic: ""});
    expect(os.services.desktopSettings!.pattern()).toBe("ppat:132");
    const preferences = os.services.fs.locate("preferences")!;
    expect(await os.services.fs.readText(os.services.fs.child(preferences.id, "desktop-pattern")!.id)).toBe("ppat:132\n");
    await expect(invoke("desktop_pattern", {value: "ppat:99999"})).rejects.toMatchObject({
      code: "invalid-argument"
    });
  });
  it("saves screenshots onto the disk", async () => {
    expect(await invoke("screenshot_save", {path: "/disk/capture.pbm"})).toMatchObject({path: "/disk/capture.pbm"});
  });
  it("retains the desktop setting across reboot", async () => {
    os.shutdown();
    const backend = new InMemoryBackend();
    const reboot = async () => {
      os = await bootOS({...createHeadlessPlatform({width: 640, height: 480}), storage: backend});
      vi.advanceTimersByTime(1000);
      caller = os.kernel.createSession();
    };
    await reboot();
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "checker", diagnostic: expect.stringContaining("missing")});
    await invoke("desktop_pattern", {value: "black"});
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "black", diagnostic: ""});
    await openControlPanel();
    const window = controlPanelWindow();
    const nodes = await invoke("inspect", {window: window.id}) as InspectionNode[];
    expect(nodes.some(node => node.name === "desktop-pattern-next")).toBe(true);
    expect(nodes.some(node => node.name === "control-panel-time")).toBe(true);
    // Black is PAT# index 0; white is index 19.
    for (let i = 0; i < 19; i++) await invoke("click", {name: "desktop-pattern-next", window: window.id});
    os.shutdown();
    await reboot();
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "white", diagnostic: ""});
    const preferences = os.services.fs.locate("preferences")!;
    await os.services.fs.writeFile(preferences.id, "desktop-pattern", "invalid");
    await os.services.desktopSettings!.settled();
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "checker", diagnostic: expect.stringContaining("Expected checker")});
  });
  it("cancels nested invoke when the caller is revoked", async () => {
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    let innerCancelled = false;
    os.kernel.register({name: "pause_fixture", description: "fixture", inputSchema: {type: "object", properties: {}, required: [], additionalProperties: false}, resultSchema: {type: "null"}, handler: async (_, {cancellation: token}) => {
      started();
      try { await token.delay(10000); } finally { innerCancelled = token.cancelled; }
    }});
    os.kernel.register({name: "outer_fixture", description: "fixture", inputSchema: {type: "object", properties: {}, required: [], additionalProperties: false}, resultSchema: {type: "null"}, handler: async (_, execution) => {
      await execution.invoke("pause_fixture", {});
      return null;
    }});
    const restricted = os.kernel.createSession();
    const pending = os.kernel.invoke(restricted, "outer_fixture", {});
    const rejected = expect(pending).rejects.toMatchObject({code: "disconnect"});
    await began;
    os.kernel.revokeSession(restricted.id);
    await rejected;
    expect(innerCancelled).toBe(true);
  });
  it.each(["cancel", "shutdown"])("interrupts stalled render on %s", async mode => {
    os.shutdown();
    let release!: () => void;
    class StalledBackend extends InMemoryBackend {
      stall = false;
      override async writeBlob(id: string, bytes: Uint8Array) {
        if (this.stall) await new Promise<void>(resolve => { release = resolve; });
        return super.writeBlob(id, bytes);
      }
    }
    const backend = new StalledBackend();
    os = await bootOS({ ...createHeadlessPlatform({ width: 640, height: 480 }), storage: backend });
    vi.advanceTimersByTime(1000);
    backend.stall = true;
    const write = os.services.desktopSettings!.set("black");
    await Promise.resolve();
    const token = new Cancellation();
    let outcome = "pending";
    const rendering = os.render(token).then(() => { outcome = "rendered"; }, () => { outcome = "cancelled"; });
    if (mode === "shutdown") os.shutdown(); else token.cancel();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const observed = outcome;
    release();
    await write;
    await rendering;
    expect(observed).toBe("cancelled");
  });
  it("provides readable UI shell output while retaining direct and JSON snapshots", async () => {
    expect(await invoke("run_shell", { command: `menu ${APPLE_MENU_LABEL} 'Control Panel'; render` })).toMatchObject({ stdout: "", exitCode: 0 });
    expect(await invoke("run_shell", { command: "apps; windows; inspect; menu" })).toMatchObject({
      stdout: expect.stringContaining("desktop-pattern-next"), exitCode: 0,
    });
    const listing = await invoke("run_shell", { command: "windows" }) as { stdout: string };
    expect(listing.stdout).toContain("WINDOW");
    expect(listing.stdout).toContain("active");
    expect(listing.stdout).toContain("Control Panel");
    const snapshot = await invoke("run_shell", { command: "inspect --json" }) as { stdout: string };
    expect(JSON.parse(snapshot.stdout)).toEqual(await invoke("inspect"));
    const menu = await invoke("run_shell", { command: "menu" }) as { stdout: string };
    expect(menu.stdout).toContain("  Control Panel\n");
    expect(menu.stdout).toContain("(disabled)");
  });
  it("operates a named Control Panel setting and captures an idle frame", async () => {
    await openControlPanel();
    const nodes = (await invoke("inspect")) as InspectionNode[];
    expect(nodes.some(n => n.name === "desktop-pattern-prev")).toBe(true);
    expect(nodes.some(n => n.name === "desktop-pattern-cell-0-0")).toBe(true);
    for (let i = 0; i < 3; i++) await invoke("click", { name: "desktop-pattern-prev" });
    await os.services.fs.flush();
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "black"});
    await invoke("click", { name: "desktop-pattern-cell-0-0" });
    await os.services.fs.flush();
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "pat:7fffffffffffffff"});
    await invoke("click", { name: "desktop-pattern-next" });
    await os.services.fs.flush();
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "pat:ddff77ffddff77ff"});
    const frame = (await invoke("screenshot")) as {
      bytes: number[];
      width: number;
    };
    expect(frame.width).toBe(640);
    expect(frame.bytes.length).toBeGreaterThan(0);
    await invoke("screenshot_save", {
      path: "/disk/screen.pbm"
    });
    expect(((await invoke("read", {
      path: "/disk/screen.pbm"
    })) as string).startsWith("P4\n640 480\n")).toBe(true);
  });
  it("does not acknowledge a setting click until delayed storage commits", async () => {
    os.shutdown();
    let release: (() => void) | undefined;
    class DelayedBackend extends InMemoryBackend {
      delay = false;
      override async writeBlob(id: string, bytes: Uint8Array) {
        if (this.delay) await new Promise<void>(resolve => {
          release = resolve;
        });
        await super.writeBlob(id, bytes);
      }
    }
    const backend = new DelayedBackend(),
      platform = createHeadlessPlatform({
        width: 640,
        height: 480
      });
    os = await bootOS({
      ...platform,
      storage: backend
    });
    vi.advanceTimersByTime(1000);
    caller = os.kernel.createSession();
    await openControlPanel();
    backend.delay = true;
    let completed = false;
    const click = invoke("click", {
      name: "desktop-pattern-prev"
    }).then(() => {
      completed = true;
    });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    const acknowledgedBeforeWrite = completed;
    release?.();
    await click;
    expect(acknowledgedBeforeWrite).toBe(false);
    expect(os.services.desktopSettings!.pattern()).toBe("pat:dd77dd77dd77dd77");
  });
  /** The Terminal's screen as inspection reads it, once `predicate` holds (the shell runs between frames). */
  async function terminalScreen(predicate: (text: string) => boolean): Promise<string> {
    let text = "";
    for (let i = 0; i < 200; i++) {
      const node = ((await invoke("inspect")) as InspectionNode[]).find(n => n.role === "terminal");
      text = node?.value ?? "";
      if (predicate(text)) return text;
      await vi.advanceTimersByTimeAsync(20);
    }
    throw new Error(`Terminal never showed what was expected:\n${text}`);
  }
  it("types into Terminal and reads its screen", async () => {
    await invoke("open", {
      app: "terminal"
    });
    const view = ((await invoke("inspect")) as InspectionNode[]).find(n => n.name === "terminal")!;
    expect(view.bounds.height).toBeGreaterThan(0);
    await terminalScreen(text => text.includes("~ $"));
    await invoke("click", {
      id: view.id
    });
    await invoke("type", {
      id: view.id,
      text: "echo terminal-test | tr a-z A-Z"
    });
    await invoke("key", {
      key: "Enter"
    });
    expect(await terminalScreen(text => text.includes("\nTERMINAL-TEST\n"))).toContain("~ $ echo terminal-test | tr a-z A-Z");
  });
  it("rejects inactive and stale controls", async () => {
    await openControlPanel();
    const first = controlPanelWindow();
    const node = ((await invoke("inspect")) as InspectionNode[]).find(n => n.name === "desktop-pattern-next")!;
    await invoke("open", {
      app: "terminal"
    });
    await expect(invoke("click", {
      id: node.id
    })).rejects.toMatchObject({
      code: "permission"
    });
    await invoke("activate", {
      window: first.id
    });
    os.services.closeWindow(first.id);
    await expect(invoke("click", {
      id: node.id
    })).rejects.toMatchObject({
      code: "stale-reference"
    });
  });
  it("uses the same validated persistent setting through shell and Preferences", async () => {
    const result = (await invoke("run_shell", {
      command: "desktop_pattern white"
    })) as {
      exitCode: number;
      stdout: string;
    };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("white");
    await expect(invoke("desktop_pattern", {value: "purple"})).rejects.toMatchObject({
      code: "invalid-argument"
    });
    const fs = os.services.fs,
      preferences = fs.locate("preferences")!;
    await fs.writeFile(preferences.id, "desktop-pattern", "black\n");
    await os.services.desktopSettings!.settled();
    expect(os.services.desktopSettings!.pattern()).toBe("black");
    expect(await invoke("desktop_pattern")).toMatchObject({pattern: "black"});
  });
  it("rejects ambiguous names and controls behind a modal", async () => {
    await invoke("open", {
      app: "terminal"
    });
    await invoke("open", {
      app: "terminal"
    });
    await expect(invoke("click", {
      name: "terminal"
    })).rejects.toMatchObject({
      code: "ambiguity"
    });
    await openControlPanel();
    const panel = controlPanelWindow();
    os.services.openApp("__dialog__", {
      message: "Modal",
      buttons: ["OK"],
      resolve: () => {}
    });
    await expect(invoke("activate", {
      window: panel.id
    })).rejects.toMatchObject({
      code: "permission"
    });
    await expect(invoke("click", {
      name: "desktop-pattern-next"
    })).rejects.toMatchObject({
      code: "permission"
    });
  });
  it("opens Finder-owned About and Control Panel windows once from the Apple menu", async () => {
    const appleItems = async () => ((await invoke("menu")) as {label: string; items: {label?: string}[]}[]).find(m => m.label === APPLE_MENU_LABEL)!.items;
    expect((await appleItems())[0].label).toBe(ABOUT_THIS_COMPUTER_LABEL);
    await invoke("menu", { menu: APPLE_MENU_LABEL, item: ABOUT_THIS_COMPUTER_LABEL });
    await invoke("menu", { menu: APPLE_MENU_LABEL, item: ABOUT_THIS_COMPUTER_LABEL });
    const aboutBoxes = getWindows().filter(w => w.title === ABOUT_BOX_TITLE);
    expect(aboutBoxes).toHaveLength(1);
    expect(aboutBoxes[0]).toMatchObject({ appId: FINDER_APP_ID, kind: "dialog", width: 343, height: 160 });
    expect(getWindows().some(w => w.appId === "about" || w.appId === "control_panel")).toBe(false);
    await openControlPanel();
    await openControlPanel();
    const panels = getWindows().filter(w => w.title === CONTROL_PANEL_TITLE);
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ appId: FINDER_APP_ID, kind: "document", scrollable: true, resizable: true });
    expect(getActiveWindowId()).toBe(panels[0].id);
    // The About box stays the Finder's while a Finder window is frontmost.
    expect((await appleItems())[0].label).toBe(ABOUT_THIS_COMPUTER_LABEL);
  });
  it("names the Apple menu's first item after the frontmost app and opens its About box", async () => {
    const CustomAbout = () => null;
    registerApp({ id: "test-about", title: "Aboutful", icon: "icon/computer", defaultSize: { width: 100, height: 60 }, Component: () => null,
      about: { Component: CustomAbout, size: { width: 200, height: 90 } } });
    const firstLabel = async () => ((await invoke("menu")) as {label: string; items: {label?: string}[]}[]).find(m => m.label === APPLE_MENU_LABEL)!.items[0].label;
    await invoke("open", { app: "terminal" });
    expect(await firstLabel()).toBe("About Terminal…");
    // Terminal declares no `about`: the OS draws its standard box under the Terminal's id.
    await invoke("menu", { menu: APPLE_MENU_LABEL, item: "About Terminal…" });
    await invoke("menu", { menu: APPLE_MENU_LABEL, item: "About Terminal…" });
    const terminalAbout = getWindows().filter(w => w.appId === "terminal" && w.title === "About Terminal");
    expect(terminalAbout).toHaveLength(1);
    expect(terminalAbout[0].kind).toBe("dialog");
    expect(((await invoke("inspect", { window: terminalAbout[0].id })) as InspectionNode[]).some(n => n.text === "Terminal")).toBe(true);
    // An app with its own `about.Component` gets that, at the size it asked for.
    await invoke("open", { app: "test-about" });
    expect(await firstLabel()).toBe("About Aboutful…");
    await invoke("menu", { menu: APPLE_MENU_LABEL, item: "About Aboutful…" });
    const custom = getWindows().find(w => w.appId === "test-about" && w.title === "About Aboutful")!;
    expect(custom).toMatchObject({ kind: "dialog", width: 200, height: 90 });
    expect(custom.Component).toBe(CustomAbout);
    // Back on the Finder, the item is the Finder's again.
    for (const w of [...getWindows()]) os.services.closeWindow(w.id);
    expect(getWindows()).toHaveLength(0);
    expect(await firstLabel()).toBe(ABOUT_THIS_COMPUTER_LABEL);
  });
  it("captures exact white and black desktop pixels", async () => {
    for (const [value, expected] of [["white", 0], ["black", 1]] as const) {
      await invoke("desktop_pattern", {value});
      const frame = (await invoke("screenshot")) as {
        rowBytes: number;
        bytes: number[];
      };
      for (let y = 200; y < 208; y++) for (let x = 4; x < 12; x++) expect(frame.bytes[y * frame.rowBytes + (x >> 3)] >> 7 - (x & 7) & 1).toBe(expected);
    }
  });
  it("cancels a long typed gesture and leaves subsequent input usable", async () => {
    await invoke("open", {
      app: "terminal"
    });
    const view = ((await invoke("inspect")) as InspectionNode[]).find(n => n.name === "terminal")!;
    await terminalScreen(text => text.includes("~ $"));
    await invoke("click", {
      id: view.id
    });
    const token = new Cancellation();
    const typing = os.kernel.invoke(caller, "type", {
      id: view.id,
      text: "x".repeat(200)
    }, token);
    const rejected = expect(typing).rejects.toMatchObject({
      code: "cancellation"
    });
    for (let i = 0; i < 100; i++) await Promise.resolve();
    token.cancel();
    await rejected;
    // ⌃U clears the line the cancelled typing left behind.
    await invoke("key", {
      key: "u",
      ctrl: true
    });
    await invoke("type", {
      id: view.id,
      text: "recovered"
    });
    const screen = await terminalScreen(text => text.endsWith("recovered"));
    expect(screen.split("\n").pop()).toBe("~ $ recovered");
  });
  it("returns cancellation status and rejects work after shutdown", async () => {
    const token = new Cancellation();
    const running = os.kernel.invoke(caller, "run_shell", {
      command: "sleep 10; echo never"
    }, token);
    await Promise.resolve();
    token.cancel();
    expect(await running).toMatchObject({
      exitCode: 130
    });
    os.shutdown();
    await expect(invoke("inspect")).rejects.toMatchObject({
      code: "disconnect"
    });
  });
});
