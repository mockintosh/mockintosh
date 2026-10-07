import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntime, AgentTerminalOptions } from "@mockintosh/sdk";
import { BashRunner, fxProgram, SHELL_AGENT_BRIEF } from "../src/bash/index";
import { createTerminalScreen, Pty, runShell, exitBuiltin, type TerminalScreen } from "../src/index";
import { kernelRig } from "./support/kernelRig";
import { fxTerminalOptions } from "../../../src/platform/web/agentRuntime";

function visible(screen: TerminalScreen): string[] {
  return screen.frame().rows.map((r) => r.cells.map((c) => c.text || " ").join("").trimEnd());
}

async function terminal(runtime: AgentRuntime | undefined, setup?: (client: Awaited<ReturnType<typeof kernelRig>>["client"]) => Promise<void>) {
  const rig = await kernelRig();
  await setup?.(rig.client);
  const screen = createTerminalScreen({ size: { cols: 70, rows: 16 } });
  const pty = new Pty();
  pty.master.onOutput((data) => void screen.write(data));
  screen.onInput((data) => pty.master.write(data));
  pty.master.resize(screen.size);
  const runner = new BashRunner({ kernel: rig.client, programs: [fxProgram({ runtime, kernel: rig.client })] });
  void runShell(pty.slave, runner, { exitCommand: exitBuiltin });
  const until = async (predicate: (lines: string[]) => boolean, ms = 15000) => {
    const start = Date.now();
    while (!predicate(visible(screen))) {
      if (Date.now() - start > ms) throw new Error(`Timed out; the screen shows:\n${visible(screen).join("\n")}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { ...rig, screen, pty, until, type: (s: string) => screen.input(s) };
}

/** An agent runtime whose terminal is driven by the test. */
function scriptedRuntime() {
  const runs: { options: AgentTerminalOptions; typed: string[]; exit(code: number): void }[] = [];
  const runtime: AgentRuntime = {
    engine: "scripted",
    createSession: async () => {
      throw new Error("not used");
    },
    async createTerminal(options) {
      let exit!: (code: number) => void;
      const exited = new Promise<number>((resolve) => (exit = resolve));
      const run = { options, typed: [] as string[], exit };
      options.screen.onData((data) => run.typed.push(data));
      options.screen.write(`fx here ${options.screen.cols}x${options.screen.rows}\r\n`);
      runs.push(run);
      return { interactive: Promise.resolve(), exited, abort: () => exit(130) };
    },
  };
  return { runtime, runs };
}

describe("fx in Terminal", () => {
  it("asks for a key in the environment first", async () => {
    const { runtime } = scriptedRuntime();
    const { type, until } = await terminal(runtime);
    await until((l) => l[0] === "~ $");
    type("fx\r");
    await until((l) => l.some((x) => x.includes("export AI_GATEWAY_API_KEY=")));
    type("echo $?\r");
    await until((l) => l.includes("1"));
  });

  it("says so on a Macintosh without fx's engine", async () => {
    const { type, until } = await terminal(undefined);
    await until((l) => l[0] === "~ $");
    type("fx\r");
    await until((l) => l.some((x) => x.includes("can't run fx")));
  });

  it("runs on the tty in the current directory, with the brief and AGENTS.md, and returns to the prompt", async () => {
    const { runtime, runs } = scriptedRuntime();
    const { type, until, pty } = await terminal(runtime, async (client) => {
      await client.invoke("mkdir", { path: "/disk/proj" });
      await client.invoke("write", { path: "/disk/proj/AGENTS.md", body: "Use tabs, not spaces." });
      await client.invoke("write", { path: "/disk/.bashrc", body: "export AI_GATEWAY_API_KEY=vck_from_bashrc\n" });
    });
    await until((l) => l.includes("~ $"));
    type("cd proj && FX_MODEL=grok-5 fx --continue\r");
    await until(() => runs.length === 1);
    const run = runs[0]!;
    expect(run.options).toMatchObject({ apiKey: "vck_from_bashrc", args: ["--continue"], env: { FX_MODEL: "grok-5" } });
    // The workspace is the sandbox: fx runs commands without review.
    expect(run.options.workspace!.permission).toBe("allow");
    expect(run.options.instructions).toContain(SHELL_AGENT_BRIEF);
    expect(run.options.instructions).toContain("Project instructions from /disk/proj/AGENTS.md:\n\nUse tabs, not spaces.");
    expect(run.options.workspace!.root).toBe("/disk/proj");
    await until((l) => l.some((x) => x === "fx here 70x16"));
    // Raw: ⌃C is fx's key, not an interrupt, and nothing is echoed.
    expect(pty.slave.getAttr()).toMatchObject({ canonical: false, echo: false, signals: false });
    type("hi\x03");
    await until(() => run.typed.join("") === "hi\x03");
    const ran = await run.options.workspace!.exec({ command: "pwd; cat AGENTS.md", cwd: "/disk/proj", signal: new AbortController().signal, timeoutMs: 5000, outputLimitBytes: 4096 });
    expect(ran).toMatchObject({ exitCode: 0, stdout: "/disk/proj\nUse tabs, not spaces." });
    run.exit(0);
    await until((l) => l.some((x) => x === "~/proj $"));
    // The shell has its terminal back.
    type("echo back\r");
    await until((l) => l.includes("back"));
  }, 20000);
});

describe("real fx in Terminal, against a scripted gateway", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("lets the model run commands in bash on the disk, with the Mockintosh brief in its context", async () => {
    let libfx: typeof import("libfx/node");
    try {
      libfx = await import("libfx/node");
      // fx's terminal core is WebAssembly with JSPI, which Node 24 has.
      const info = await libfx.getBackendInfo({ surface: "terminal", backend: "auto" });
      if (info.backend === "unavailable") return;
    } catch {
      return;
    }
    const requests: string[] = [];
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const sse = (parts: unknown[]) => new Response(parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
    const gateway = (async (_url: string, init?: RequestInit) => {
      requests.push(typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body as Uint8Array));
      if (requests.length === 1) {
        return sse([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "call_1", toolName: "shell", input: JSON.stringify({ action: "run", command: "pwd; echo made-by-fx > note.txt; mac pwd" }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
        ]);
      }
      return sse([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Wrote note.txt." }, { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]);
    }) as typeof fetch;
    const runtime: AgentRuntime = {
      engine: "fx (node)",
      createSession: async () => {
        throw new Error("not used");
      },
      async createTerminal(options) {
        const fx = await libfx.createFxTerminal(fxTerminalOptions(options, gateway) as never);
        return { interactive: fx.interactive, exited: fx.exited, abort: () => fx.abort() };
      },
    };
    const { type, until, fs, screen } = await terminal(runtime, async (client) => {
      await client.invoke("mkdir", { path: "/disk/work" });
    });
    await until((l) => l[0] === "~ $");
    type("export AI_GATEWAY_API_KEY=vck_test; cd work; fx\r");
    await until((l) => l.some((x) => x.includes("Run /help for commands")), 30000);
    type("write a note");
    type("\r");
    await until((l) => l.some((x) => x.includes("Wrote note.txt.")), 30000);
    expect(requests[0]).toContain("You are running inside Mockintosh");
    // The tool result went back to the model: bash's pwd, and S1's.
    expect(requests[1]).toContain("/disk/work\\n/disk/work");
    const work = fs.child(fs.locate("volume")!.id, "work")!;
    expect(await fs.readText(fs.child(work.id, "note.txt")!.id)).toBe("made-by-fx\n");
    // fx's own quit command hands the terminal back to bash.
    for (const ch of "/quit") type(ch);
    type("\r");
    await until((l) => l.some((x) => x === "~/work $"), 30000);
    expect(visible(screen).join("\n")).toContain("~/work $");
  }, 60000);
});
