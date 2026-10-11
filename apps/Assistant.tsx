import { For, Show, createSignal, createMemo, createEffect, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, TextInput } from "@mockintosh/ui";
import { useApp, defineApp } from "@mockintosh/sdk";
import { allAgentTools, runAgent } from "@mockintosh/agent";
import type { ChatMessage, CompleteResult, FetchRequest, OpenAITool } from "@mockintosh/sdk";

interface Line {
  kind: "user" | "assistant" | "activity";
  text: string;
}

const HISTORY_KEY = "session.json";

/** The server refused for the Computer Club's reasons: no membership (401) or no credits left (402). */
class ClubRefusal extends Error {
  constructor(readonly code: "not_a_member" | "out_of_credits", message: string) {
    super(message);
  }
}

/** The refusal in a response, if the Club is why it was refused. */
function clubRefusal(status: number, data: { error?: unknown; code?: unknown }): ClubRefusal | null {
  if ((status === 401 && data.code === "not_a_member") || (status === 402 && data.code === "out_of_credits")) {
    return new ClubRefusal(data.code, String(data.error ?? "The Computer Club refused this request."));
  }
  return null;
}
const BUILD_INTENT = /\b(build|create|make|write)\b.*\b(app|counter|drawing|notes)\b/i;

function Assistant(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const fetch = app.fetch!;
  /** The AI's endpoints: the Computer Club's, with the member's session, or this Macintosh's own. */
  const ai = (path: string, init: FetchRequest) => (app.club ? app.club.fetch(path, init) : fetch(path, init));
  const kernel = app.kernel!;
  const tools = allAgentTools(kernel.describe());
  const [lines, setLines] = createSignal<Line[]>([], { ownedWrite: true });
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  /** The member's credits, as the last answer reported them; `null` when unknown. */
  const [credits, setCredits] = createSignal<number | null>(null, { ownedWrite: true });
  void app.club?.status().then((status) => setCredits(status.credits)).catch(() => {});
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
    const resp = await ai("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, tools: nextTools, mode }),
    });
    const data = (await resp.json()) as CompleteResult & { error?: unknown; code?: unknown; credits?: unknown };
    const refusal = clubRefusal(resp.status, data);
    if (refusal) throw refusal;
    if (typeof data.credits === "number") setCredits(data.credits);
    if (data.error && !data.message && !data.tool_calls) throw new Error(String(data.error));
    return data;
  }

  async function generateImage(prompt: string): Promise<string> {
    const resp = await ai("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = (await resp.json()) as { b64?: string; error?: string; code?: unknown; credits?: unknown };
    const refusal = clubRefusal(resp.status, data);
    if (refusal) throw refusal;
    if (typeof data.credits === "number") setCredits(data.credits);
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
      if (error instanceof ClubRefusal && !closed) void offerClub(error);
    }
    if (!closed) setBusy(false);
  }

  /** Sends someone without a membership or credits to the Computer Club window. */
  async function offerClub(refusal: ClubRefusal): Promise<void> {
    const club = app.club;
    if (!club) return;
    if (refusal.code === "out_of_credits") setCredits(0);
    const open = refusal.code === "not_a_member" ? "Join…" : "Computer Club…";
    const answer = await app.os.showDialog({
      message:
        refusal.code === "not_a_member"
          ? "The Assistant is for members of the Mockintosh Computer Club. Joining is free, and comes with credits to start."
          : "You're out of Computer Club credits. Each reply and picture uses some.",
      buttons: ["Cancel", open],
      variant: "note",
    });
    if (answer === open) club.open();
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
      <Show when={credits() !== null}>
        <box flexDirection="row" paddingLeft={6} paddingRight={6}>
          <box flexGrow={1} />
          <text font="body" nowrap semantic={{ name: "chat-credits", role: "status" }}>
            {`${credits()!.toLocaleString("en-US")} credits`}
          </text>
        </box>
      </Show>
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
  id: "assistant",
  requires: ["network"],
  title: "Assistant",
  icon: "icon/chat",
  smallIcon: "icon/chat-16x16",
  defaultSize: { width: 360, height: 260 },
  permissions: ["kernel:*"],
  Component: Assistant,
});
