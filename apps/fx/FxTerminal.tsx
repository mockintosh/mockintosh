import { createEffect, createSignal, onCleanup } from "solid-js";
import { useUIServices, type JSX } from "@mockintosh/ui";
import { useApp } from "@mockintosh/sdk";
import { TerminalBridge } from "@mockintosh/terminal";
import { BashSession, HOME, bashWorkspace, shellAgentInstructions } from "@mockintosh/terminal/bash";
import { TerminalView, type TerminalHandle } from "@mockintosh/terminal/view";
import { readSettings } from "./settings";

/** fx's terminal interface fills a window of this many cells. */
export const FX_TERMINAL_SIZE = { width: 85 * 6 + 4, height: 29 * 11 + 2 };

/**
 * fx as it runs in a terminal: its own full-screen interface, drawn by a
 * Mockintosh terminal. Its shell tool runs bash on this Macintosh's disk,
 * asking before each command.
 */
export function FxTerminal(): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { clipboard } = useUIServices();
  const bridge = new TerminalBridge();
  const [title, setTitle] = createSignal("fx", { ownedWrite: true });
  let handle: TerminalHandle | undefined;
  let abort: (() => void) | undefined;
  let closed = false;
  bridge.onClosed(() => abort?.());
  onCleanup(() => {
    closed = true;
    abort?.();
  });

  void (async () => {
    const settings = await readSettings(app.storage);
    const runtime = app.agentRuntime;
    const say = (text: string) => bridge.terminal.write(text.replace(/\n/g, "\r\n"));
    if (!runtime?.createTerminal) {
      say("This Macintosh can't run fx's terminal interface.\n");
      bridge.exit(1);
      return;
    }
    if (!settings.apiKey) {
      say("fx needs a Vercel AI Gateway key. Set one with File › API Key… in fx's main window, then open this again.\n");
      bridge.exit(1);
      return;
    }
    await bridge.ready;
    if (closed) return;
    say("Starting fx…\n");
    try {
      const fx = await runtime.createTerminal({
        apiKey: settings.apiKey,
        instructions: await shellAgentInstructions(new BashSession({ kernel: app.kernel! }).bash.fs, HOME),
        screen: bridge.terminal,
        workspace: bashWorkspace(app.kernel!),
        storage: app.storage,
        openUrl: async (url) => {
          if (!app.browser) return false;
          await app.browser.openExternal(url);
          return true;
        },
        ...(clipboard ? { clipboard } : {}),
      });
      abort = () => fx.abort();
      if (closed) fx.abort();
      bridge.exit(await fx.exited);
    } catch (error) {
      say(`\nfx couldn't start: ${error instanceof Error ? error.message : String(error)}\n`);
      bridge.exit(1);
    }
  })();

  createEffect(title, (t) => win.setTitle(t || "fx"));

  createEffect(
    () => true,
    () => {
      app.setMenus([
        {
          label: "File",
          items: [
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
              disabled: !clipboard,
              onClick: () => void clipboard?.readText().then((text) => handle?.paste(text)).catch(() => {}),
            },
            { type: "separator" },
            { label: "Select All", shortcut: "A", onClick: () => handle?.selectAll() },
          ],
        },
      ]);
    },
  );

  return (
    <TerminalView
      process={bridge.process}
      width={win.width()}
      height={win.height()}
      active={win.isActive()}
      scheduler={app.scheduler}
      name="fx-terminal"
      onReady={(h) => (handle = h)}
      onTitle={setTitle}
      onExit={() => setTitle("fx — Completed")}
    />
  );
}
