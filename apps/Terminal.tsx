import { createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { TextInput } from "@mockintosh/ui";
import { defineApp, useApp } from "@mockintosh/sdk";
import { sprites } from "./terminal/icons";

function Terminal(): JSX.Element {
  const app = useApp();
  const kernel = app.kernel!;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const release = app.keepAlive?.();
  let session: string | undefined;
  let cwd = "/disk";
  const [input, setInput] = createSignal(""),
    [scrollback, setScrollback] = createSignal("Mockintosh shell S1. Type help.\n"),
    [busy, setBusy] = createSignal(false);
  const history: string[] = [];
  let index = 0,
    controller: AbortController | undefined,
    closed = false;
  const append = (text: string) => {
    if (!closed) setScrollback(old => (old + text).slice(-16384));
  };
  async function submit(command: string) {
    if (busy()) return;
    history.push(command);
    index = history.length;
    setInput("");
    setBusy(true);
    append(`${cwd}> ${command}\n`);
    controller = new AbortController();
    try {
      const result = await kernel.invoke("run_shell", {
        command,
        ...(session ? { session } : { keepAlive: true }),
      }, {
        signal: controller.signal,
        stdout: bytes => append(new TextDecoder().decode(bytes)),
        stderr: bytes => append(new TextDecoder().decode(bytes)),
      }) as { session: string; cwd: string; truncated: { stdout: boolean; stderr: boolean } };
      session = result.session;
      cwd = result.cwd;
      if (result.truncated.stdout || result.truncated.stderr) append("[output truncated]\n");
    } finally {
      if (!closed) setBusy(false);
    }
  }
  onCleanup(() => {
    closed = true;
    controller?.abort();
    if (session) void kernel.invoke("shell_close", { session }).catch(() => {});
    release?.();
  });
  return <box width={app.window.width()} height={app.window.height()} padding={6} gap={4} background={0}>
    <box height={Math.max(0, app.window.height() - 32)} overflow="scroll" scrollOffset={Math.max(0, scrollback().split("\n").length * 14 - app.window.height() + 50)}>
      <text font="mono" wrap>{scrollback()}</text>
    </box>
    <TextInput name="terminal-command" value={input()} onChange={value => {
      if (!busy()) setInput(value);
    }} onSubmit={value => {
      void submit(value);
    }} width={app.window.width() - 12} autoFocus onInterrupt={() => controller?.abort()} onHistory={direction => {
      index = Math.max(0, Math.min(history.length, index + direction));
      setInput(history[index] ?? "");
    }} />
  </box>;
}
export default defineApp({
  id: "terminal",
  title: "Terminal",
  icon: "terminal/icon",
  smallIcon: "terminal/icon-16x16",
  sprites,
  defaultSize: {
    width: 460,
    height: 260
  },
  singleInstance: false,
  scrollable: false,
  permissions: ["kernel:run_shell", "kernel:shell_close"],
  Component: Terminal
});
