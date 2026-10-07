import { For, createSignal, createMemo, createEffect, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, TextInput } from "@mockintosh/ui";
import { useApp, defineApp } from "@mockintosh/sdk";
import { allAgentTools, runAgent } from "@mockintosh/agent";
import type { ChatMessage, CompleteResult, OpenAITool } from "@mockintosh/sdk";

interface Line {
  kind: "user" | "assistant" | "activity";
  text: string;
}

const HISTORY_KEY = "session.json";
const BUILD_INTENT = /\b(build|create|make|write)\b.*\b(app|counter|drawing|notes)\b/i;

function ChatGippity(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const fetch = app.fetch!;
  const kernel = app.kernel!;
  const tools = allAgentTools(kernel.describe());
  const [lines, setLines] = createSignal<Line[]>([], { ownedWrite: true });
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let history: ChatMessage[] = [];
  let mode: "chat" | "build" = "chat";
  let controller = new AbortController();
  let closed = false;

  onCleanup(() => {
    closed = true;
    controller.abort();
  });

  const restored = createMemo(async () => {
    const raw = await app.storage.read(HISTORY_KEY);
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw) as ChatMessage[];
      return Array.isArray(saved) && saved.length ? saved : null;
    } catch {
      await app.storage.remove(HISTORY_KEY);
      return null;
    }
  });
  createEffect(
    () => restored(),
    (saved) => {
      if (!saved) return;
      history = saved;
      mode = saved.some((m) => m.role === "assistant" && m.tool_calls?.some((c) => c.function.name === "project_create"))
        ? "build"
        : "chat";
      setLines([{ kind: "assistant", text: "I still have our last session. Send a message to continue, or start a new request." }]);
    },
  );

  const invoke = (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    kernel.invoke(name, args, { signal: signal ?? controller.signal });

  async function persist(messages: ChatMessage[]): Promise<void> {
    await app.storage.write(HISTORY_KEY, JSON.stringify(messages));
  }

  async function complete(messages: ChatMessage[], nextTools: OpenAITool[]): Promise<CompleteResult> {
    await persist(messages);
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, tools: nextTools, mode }),
    });
    const data = (await resp.json()) as CompleteResult & { error?: unknown };
    if (data.error && !data.message && !data.tool_calls) throw new Error(String(data.error));
    return data;
  }

  async function generateImage(prompt: string): Promise<string> {
    const resp = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = (await resp.json()) as { b64?: string; error?: string };
    if (data.b64) return JSON.stringify({ ok: true });
    return JSON.stringify({ error: data.error ?? "Image generation failed" });
  }

  async function send(): Promise<void> {
    const text = draft().trim();
    if (!text || busy()) return;
    setDraft("");
    setLines((rows) => [...rows, { kind: "user", text }]);
    history = [...history, { role: "user", content: text }];
    if (BUILD_INTENT.test(text)) mode = "build";
    setBusy(true);
    controller.abort();
    controller = new AbortController();
    try {
      const result = await runAgent({
        complete,
        invoke,
        tools,
        messages: history,
        signal: controller.signal,
        http: { generateImage },
        onBeforeComplete: persist,
        onActivity: (label) => {
          if (!closed) setLines((rows) => [...rows, { kind: "activity", text: label }]);
          if (label.startsWith("Writing source") || label.includes("project_create")) mode = "build";
        },
      });
      history = result.messages;
      await persist(history);
      if (!closed) setLines((rows) => [...rows, { kind: "assistant", text: result.reply }]);
    } catch (error) {
      if (!closed) {
        setLines((rows) => [
          ...rows,
          { kind: "assistant", text: error instanceof Error ? error.message : "(network error)" },
        ]);
      }
    }
    if (!closed) setBusy(false);
  }

  function cancel(): void {
    controller.abort();
  }

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={0}>
      <box
        overflow="scroll"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        padding={6}
        flexDirection="column"
        gap={4}
      >
        <For each={lines()}>
          {(line) => (
            <text
              font="body"
              wrap
              selectable
              semantic={{
                name: line.kind === "user" ? "chat-user" : line.kind === "activity" ? "chat-activity" : "chat-assistant",
              }}
            >
              {line.kind === "user"
                ? `You: ${line.text}`
                : line.kind === "activity"
                  ? `… ${line.text}`
                  : `Gippity: ${line.text}`}
            </text>
          )}
        </For>
      </box>
      <box
        flexDirection="row"
        gap={4}
        padding={2}
        borderColor={1}
        borderWidth={1}
        alignItems="center"
      >
        <TextInput
          value={draft()}
          onChange={setDraft}
          onSubmit={() => void send()}
          width={win.width() - 70}
          placeholder="Message…"
          disabled={busy()}
        />
        <Button
          label={busy() ? "Stop" : "Send"}
          onClick={() => (busy() ? cancel() : void send())}
        />
      </box>
    </box>
  );
}

export default defineApp({
  id: "chatgippity",
  requires: ["network"],
  title: "ChatGippity",
  icon: "icon/computer",
  smallIcon: "icon/computer-16x16",
  defaultSize: { width: 360, height: 260 },
  permissions: ["kernel:*"],
  Component: ChatGippity,
});
