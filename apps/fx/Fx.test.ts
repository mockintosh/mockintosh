/**
 * fx on a headless Macintosh with a scripted agent runtime: it asks for a
 * key, keeps it in its preferences, sends a message with the kernel traps
 * as tools, and streams the reply into the window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { getWindows } from "@/src/os/state";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import type { InspectionNode } from "@mockintosh/ui";
import Fx from "../Fx";
import { createScriptedRuntime, type ScriptedRuntime } from "./scripted";

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };

describe("fx on the headless platform", () => {
  let platform: HeadlessPlatform;
  let runtime: ScriptedRuntime;
  let os: BootedOS;

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(0);
      platform.tick();
    }
  }

  async function screen(): Promise<InspectionNode[]> {
    return (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
  }

  function typeKeys(text: string): void {
    for (const key of text) {
      platform.key({ type: "down", key, modifiers: NO_MODS });
      platform.key({ type: "up", key, modifiers: NO_MODS });
    }
    platform.key({ type: "down", key: "Enter", modifiers: NO_MODS });
    platform.key({ type: "up", key: "Enter", modifiers: NO_MODS });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    runtime = createScriptedRuntime([
      {
        steps: [
          { type: "call", name: "windows", input: {} },
          { type: "text", delta: "One window " },
          { type: "text", delta: "is open." },
        ],
      },
    ]);
    platform = createHeadlessPlatform({ width: 512, height: 342, agentRuntime: runtime });
    platform.fetch = (async () => ({})) as never;
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Fx);
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  it("asks for a key, then talks to the agent with the kernel traps as tools", async () => {
    os.services.openApp("fx");
    await settle();
    expect(getWindows().some((w) => w.appId === "fx")).toBe(true);

    let nodes = await screen();
    expect(nodes.some((node) => node.name === "fx-api-key")).toBe(true);
    expect(nodes.find((node) => node.name === "fx-engine")?.text).toBe("Runs on scripted.");

    typeKeys("vck_test_1234");
    await settle();
    const fs = os.services.fs;
    const prefs = fs.child(fs.locate("preferences")!.id, "fx")!;
    const settings = fs.child(prefs.id, "settings.json")!;
    expect(JSON.parse(await fs.readText(settings.id))).toEqual({ apiKey: "vck_test_1234" });

    nodes = await screen();
    expect(nodes.some((node) => node.name === "fx-message")).toBe(true);
    expect(nodes.some((node) => node.name === "fx-empty")).toBe(true);

    typeKeys("what is open?");
    await settle();

    expect(runtime.prompts).toEqual(["what is open?"]);
    const session = runtime.sessions[0]!;
    expect(session.apiKey).toBe("vck_test_1234");
    const toolNames = session.tools!.map((tool) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(["read", "edit", "build_submit", "screenshot", "windows"]));
    expect(JSON.parse(runtime.toolResults[0] as string)).toEqual(expect.any(Array));

    nodes = await screen();
    const thread = nodes.filter((node) => node.role === "listitem").map((node) => node.value);
    expect(thread).toEqual(["what is open?", "One window is open."]);
    expect(nodes.find((node) => node.name === "fx-activity")?.text).toBe("… Trying the app");
  });

  it("shows the last conversation again after quitting and reopening", async () => {
    os.services.openApp("fx");
    await settle();
    typeKeys("vck_test_1234");
    await settle();
    typeKeys("what is open?");
    await settle();

    os.services.closeWindow(getWindows().find((w) => w.appId === "fx")!.id);
    await settle();
    expect(getWindows().some((w) => w.appId === "fx")).toBe(false);

    os.services.openApp("fx");
    await settle();
    const thread = (await screen()).filter((node) => node.role === "listitem").map((node) => node.value);
    expect(thread).toEqual(["what is open?", "One window is open."]);
  });

  it("opens fx's own terminal interface in a terminal window, with bash as its workspace", async () => {
    const typed: string[] = [];
    let workspaceRoot = "";
    runtime.createTerminal = async (options) => {
      workspaceRoot = options.workspace!.root;
      options.screen.write(`fx terminal ${options.screen.cols}x${options.screen.rows}\r\n`);
      options.screen.onData((data) => typed.push(data));
      const ran = await options.workspace!.exec({ command: "echo $((40 + 2))", cwd: workspaceRoot, signal: new AbortController().signal, timeoutMs: 5000, outputLimitBytes: 1024 });
      options.screen.write(`workspace says ${ran.stdout.trim()}\r\n`);
      return { interactive: Promise.resolve(), exited: new Promise(() => {}), abort() {} };
    };
    os.services.openApp("fx");
    await settle();
    typeKeys("vck_test_1234");
    await settle();
    const menus = (await os.kernel.invoke(os.kernel.createSession(), "menu", {})) as { label: string; items: { label?: string; disabled?: boolean }[] }[];
    expect(menus.find((m) => m.label === "File")!.items.find((i) => i.label === "New Terminal Window")?.disabled).not.toBe(true);
    await os.kernel.invoke(os.kernel.createSession(), "menu", { menu: "File", item: "New Terminal Window" });
    let text = "";
    for (let i = 0; i < 50 && !text.includes("workspace says"); i++) {
      await settle();
      text = (await screen()).find((node) => node.name === "fx-terminal")?.value ?? "";
    }
    // The window fits the 512×342 screen, so it is smaller than fx asks for.
    expect(text).toMatch(/^Starting fx…\nfx terminal \d+x\d+\nworkspace says 42$/);
    expect(workspaceRoot).toBe("/disk");
    platform.key({ type: "down", key: "x", modifiers: NO_MODS });
    await settle();
    expect(typed).toEqual(["x"]);
  });

  it("says why it can't open on a Macintosh without an agent runtime", async () => {
    os.shutdown();
    platform = createHeadlessPlatform({ width: 512, height: 342 });
    platform.fetch = (async () => ({})) as never;
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Fx);
    os.services.openApp("fx");
    await settle();
    expect(getWindows().some((w) => w.appId === "fx")).toBe(false);
    const alert = (await screen()).map((node) => node.text).join("\n");
    expect(alert).toContain('"fx" needs a way to run AI agents, which this Macintosh does not have.');
  });
});
