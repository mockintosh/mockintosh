import { createEffect, createSignal, onCleanup } from "solid-js";
import { useUIServices, type JSX } from "@mockintosh/ui";
import { defineApp, useApp, type AppContext } from "@mockintosh/sdk";
import { Pty, exitBuiltin, kernelProcesses, runShell } from "@mockintosh/terminal";
import { BashRunner } from "@mockintosh/terminal/bash";
import { TerminalView, type TerminalHandle } from "@mockintosh/terminal/view";
import { terminalPrograms } from "./terminal/programs";

const HISTORY_KEY = "bash_history";
const HISTORY_SIZE = 500;

/** 80×24 in Monaco 9 cells, plus the view's margins. */
const DEFAULT_SIZE = { width: 80 * 6 + 4, height: 24 * 11 + 2 };

function startShell(app: AppContext, pty: Pty, onKilled: () => void): void {
  const runner = new BashRunner({
    kernel: app.kernel!,
    programs: terminalPrograms(app),
    banner: "Mockintosh bash. Your disk is ~ (/disk). Type help for commands, mac help for the Macintosh's own.\n",
    loadHistory: async () => {
      const saved = await app.storage.read(HISTORY_KEY);
      return saved ? saved.split("\n").filter(Boolean) : [];
    },
    saveHistory: (lines) => app.storage.write(HISTORY_KEY, lines.slice(-HISTORY_SIZE).join("\n")),
  });
  void runShell(pty.slave, runner, { exitCommand: exitBuiltin, processes: kernelProcesses(app.kernel!), name: "bash", onKilled }).then(
    (code) => pty.exit(code),
    (error) => {
      pty.slave.write(`\r\nbash: ${error instanceof Error ? error.message : String(error)}\r\n`);
      pty.exit(1);
    },
  );
}

function Terminal(): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { clipboard } = useUIServices();
  const release = app.keepAlive?.();
  const pty = new Pty();
  let handle: TerminalHandle | undefined;
  const [exited, setExited] = createSignal<number | null>(null, { ownedWrite: true });
  const [title, setTitle] = createSignal("", { ownedWrite: true });
  startShell(app, pty, () => win.close());
  onCleanup(() => {
    pty.hangUp();
    release?.();
  });

  createEffect(
    () => [title(), exited()] as const,
    ([programTitle, code]) => {
      const cols = Math.floor((win.width() - 4) / 6), rows = Math.floor((win.height() - 2) / 11);
      const name = programTitle || "bash";
      win.setTitle(code === null ? `Terminal — ${name} — ${cols}×${rows}` : "Terminal — Completed");
    },
  );

  createEffect(
    () => exited(),
    (code) => {
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "New Window", shortcut: "N", onClick: () => app.openWindow({ title: "Terminal" }) },
            { label: "Close Window", shortcut: "W", onClick: () => win.close() },
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "Edit",
          items: [
            {
              label: "Copy",
              shortcut: "C",
              disabled: !clipboard,
              onClick: () => {
                const text = handle?.selection();
                if (text) void clipboard?.writeText(text).catch(() => {});
              },
            },
            {
              label: "Paste",
              shortcut: "V",
              disabled: !clipboard || code !== null,
              onClick: () => {
                void clipboard?.readText().then((text) => handle?.paste(text)).catch(() => {});
              },
            },
            { type: "separator" },
            { label: "Select All", shortcut: "A", onClick: () => handle?.selectAll() },
            { label: "Clear Scrollback", shortcut: "K", onClick: () => handle?.clearScrollback() },
          ],
        },
        {
          label: "Shell",
          items: [
            { label: "Send Interrupt (⌃C)", shortcut: ".", disabled: code !== null, onClick: () => handle?.type("\x03") },
            { label: "Send End of Input (⌃D)", disabled: code !== null, onClick: () => handle?.type("\x04") },
            { type: "separator" },
            { label: "Reset Terminal", onClick: () => handle?.reset() },
          ],
        },
      ]);
    },
  );

  return (
    <TerminalView
      process={pty.master}
      width={win.width()}
      height={win.height()}
      active={win.isActive()}
      scheduler={app.scheduler}
      name="terminal"
      onReady={(h) => (handle = h)}
      onTitle={setTitle}
      onExit={(code) => {
        setExited(code);
        pty.slave.write("\n[Process completed]\n");
      }}
    />
  );
}

export default defineApp({
  id: "terminal",
  title: "Terminal",
  icon: "icon/computer",
  defaultSize: DEFAULT_SIZE,
  minSize: { width: 20 * 6 + 4, height: 5 * 11 + 2 },
  singleInstance: false,
  scrollable: false,
  permissions: [
    "kernel:run_shell", "kernel:shell_close",
    "kernel:stat", "kernel:list", "kernel:read_bytes", "kernel:write_bytes",
    "kernel:mkdir", "kernel:remove", "kernel:move", "kernel:copy",
    "kernel:process_start", "kernel:process_exit", "kernel:process_signals", "kernel:ps", "kernel:kill", "kernel:wait",
  ],
  Component: Terminal,
});
