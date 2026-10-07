/**
 * fx, with a real model, builds an app from Terminal on a headless
 * Macintosh. Opt-in: it spends tokens. Run with a Vercel AI Gateway key in a
 * file (never in the repo):
 *
 *   FX_LIVE_KEY_FILE=/path/to/key FX_LIVE_LOG=/tmp/fx-live.log npx vitest run packages/terminal/tests/fx.live.test.ts
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "@mockintosh/sdk";
import { withHeadless } from "../../../scripts/companion/headless";
import { fxTerminalOptions } from "../../../src/platform/web/agentRuntime";
import { BashRunner, fxProgram, type KernelLike } from "../src/bash/index";
import { createTerminalScreen, Pty, runShell, exitBuiltin, type TerminalScreen } from "../src/index";
import { Cancellation } from "../../../src/os/kernel/cancellation";

const keyFile = process.env.FX_LIVE_KEY_FILE;
const log = process.env.FX_LIVE_LOG;
const note = (text: string) => {
  if (log) appendFileSync(log, text + "\n");
};

function visible(screen: TerminalScreen): string[] {
  return screen.frame().rows.map((r) => r.cells.map((c) => c.text || " ").join("").trimEnd());
}

describe.skipIf(!keyFile)("fx with a live model", () => {
  it("builds and launches an app from Terminal", async () => {
    if (log) writeFileSync(log, "");
    const key = readFileSync(keyFile!, "utf8").trim();
    const libfx = await import("libfx/node");
    await withHeadless(async (os) => {
      const caller = os.kernel.createSession();
      const kernel: KernelLike = {
        invoke(name, args = {}, options = {}) {
          const token = new Cancellation();
          options.signal?.addEventListener("abort", () => token.cancel(), { once: true });
          return os.kernel.invoke(caller, name, args, token, { stdout: options.stdout, stderr: options.stderr });
        },
      };
      await kernel.invoke("write", { path: "/disk/.bashrc", body: `export AI_GATEWAY_API_KEY=${key}\n` });
      const runtime: AgentRuntime = {
        engine: "fx (node)",
        createSession: async () => {
          throw new Error("not used");
        },
        async createTerminal(options) {
          // Log each command fx runs and what it got back.
          const workspace = options.workspace!;
          const logged = {
            ...workspace,
            async exec(request: Parameters<typeof workspace.exec>[0]) {
              const result = await workspace.exec(request);
              note(`$ ${request.command}\n${result.stdout}${result.stderr}[exit ${result.exitCode}]\n`);
              return result;
            },
          };
          const fx = await libfx.createFxTerminal(fxTerminalOptions({ ...options, workspace: logged }, globalThis.fetch.bind(globalThis)) as never);
          return { interactive: fx.interactive, exited: fx.exited, abort: () => fx.abort() };
        },
      };
      const screen = createTerminalScreen({ size: { cols: 100, rows: 40 } });
      const pty = new Pty();
      pty.master.onOutput((data) => void screen.write(data));
      screen.onInput((data) => pty.master.write(data));
      pty.master.resize(screen.size);
      const runner = new BashRunner({ kernel, programs: [fxProgram({ runtime, kernel })] });
      void runShell(pty.slave, runner, { exitCommand: exitBuiltin });
      const type = (s: string) => screen.input(s);
      const until = async (predicate: () => boolean | Promise<boolean>, ms: number) => {
        const start = Date.now();
        while (!(await predicate())) {
          if (Date.now() - start > ms) return false;
          await new Promise((r) => setTimeout(r, 500));
        }
        return true;
      };
      await until(() => visible(screen).some((l) => l.endsWith("~ $")), 10000);
      type("cd /disk && fx\r");
      await until(() => visible(screen).some((l) => l.includes("Run /help for commands")), 30000);
      type("Build and launch a small Mockintosh app titled Hello Fx (app id hello_fx) whose window shows the text Hello from fx. Keep it minimal.");
      type("\r");
      const launched = async () => {
        const windows = (await kernel.invoke("windows")) as { title: string; app: string }[];
        return windows.some((w) => w.app === "hello_fx");
      };
      const ok = await until(launched, 6 * 60 * 1000);
      // Let fx finish its turn so the log shows how it reported.
      await until(() => !visible(screen).some((l) => /Thinking|Generating|Running/.test(l)), 60000);
      note(`--- screen ---\n${visible(screen).join("\n")}`);
      const nodes = (await kernel.invoke("inspect")) as { text: string; windowId?: string }[];
      note(`--- inspect ---\n${nodes.map((n) => n.text).filter(Boolean).join(" | ")}`);
      expect(ok).toBe(true);
      expect(nodes.some((n) => n.text.includes("Hello from fx"))).toBe(true);
      type("\x03\x03");
    });
  }, 8 * 60 * 1000);
});
