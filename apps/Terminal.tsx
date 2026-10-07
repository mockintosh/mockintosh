import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useUIServices, type JSX } from "@mockintosh/ui";
import { defineApp, useApp, type AppContext } from "@mockintosh/sdk";
import { Pty, exitBuiltin, kernelProcesses, runShell } from "@mockintosh/terminal";
import { BashRunner } from "@mockintosh/terminal/bash";
import { TerminalView, type TerminalHandle } from "@mockintosh/terminal/view";
import { sprites } from "./terminal/icons";
import { terminalPrograms } from "./terminal/programs";

const HISTORY_KEY = "bash_history";
const HISTORY_SIZE = 500;
const THEME_KEY = "theme";

type Theme = "light" | "dark";

/** Every Terminal window shares the theme; dark unless the user chose light. */
const [theme, setTheme] = createSignal<Theme>("dark", { ownedWrite: true });
let themeLoaded = false;

function loadTheme(app: AppContext): void {
  if (themeLoaded) return;
  themeLoaded = true;
  void app.storage.read(THEME_KEY).then((saved) => {
    if (saved === "light" || saved === "dark") setTheme(saved);
  });
}

function chooseTheme(app: AppContext, next: Theme): void {
  setTheme(next);
  void app.storage.write(THEME_KEY, next);
}

/** The usual hint to programs about the terminal's colours: foreground;background. */
const colorFgBg = (t: Theme) => (t === "dark" ? "15;0" : "0;15");

/** 80×24 in Monaco 9 cells, plus the view's margins. */
const DEFAULT_SIZE = { width: 80 * 6 + 4, height: 24 * 11 + 2 };

function startShell(app: AppContext, pty: Pty, onKilled: () => void, clipboard?: { writeText(text: string): Promise<void> }): BashRunner {
  const runner = new BashRunner({
    kernel: app.kernel!,
    env: { COLORFGBG: colorFgBg(untrack(theme)) },
    programs: terminalPrograms(app, clipboard),
    banner: "Mockintosh bash. Your disk is ~ (/disk). Type help for commands, mac help for the Macintosh's own, fx for the coding agent.\n",
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
  return runner;
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
  loadTheme(app);
  const runner = startShell(app, pty, () => win.close(), clipboard);
  createEffect(theme, (t) => runner.session.setVariable("COLORFGBG", colorFgBg(t)));
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
    () => [exited(), theme()] as const,
    ([code, current]) => {
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
          label: "View",
          items: [
            {
              type: "radiogroup",
              value: current,
              onValueChange: (value) => chooseTheme(app, value as Theme),
              items: [
                { label: "Dark", value: "dark" },
                { label: "Light", value: "light" },
              ],
            },
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
      theme={theme()}
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
  icon: "terminal/icon",
  smallIcon: "terminal/icon-16x16",
  sprites,
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
