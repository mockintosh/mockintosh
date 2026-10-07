import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, Message, MessageScroller, TextInput } from "@mockintosh/ui";
import { defineApp, useApp } from "@mockintosh/sdk";
import { createConversation, type Conversation, type TranscriptLine } from "./fx/conversation";
import { FX_INSTRUCTIONS } from "./fx/instructions";
import { maskKey, readSettings, writeSettings } from "./fx/settings";
import { kernelAgentTools } from "./fx/tools";
import { FxTerminal, FX_TERMINAL_SIZE } from "./fx/FxTerminal";

const INPUT_ROW_HEIGHT = 30;

function Fx(): JSX.Element {
  const app = useApp();
  const win = app.window;
  const runtime = app.agentRuntime!;
  const kernel = app.kernel!;
  const [loaded, setLoaded] = createSignal(false, { ownedWrite: true });
  const [apiKey, setApiKey] = createSignal<string | null>(null, { ownedWrite: true });
  const [editingKey, setEditingKey] = createSignal(false);
  const [keyDraft, setKeyDraft] = createSignal("");
  const [lines, setLines] = createSignal<readonly TranscriptLine[]>([], { ownedWrite: true });
  const [busy, setBusy] = createSignal(false, { ownedWrite: true });
  const [draft, setDraft] = createSignal("");
  let conversation: Conversation | null = null;

  function connect(key: string | null): void {
    void conversation?.close();
    conversation = null;
    setLines([]);
    setBusy(false);
    if (!key) return;
    const next = createConversation({
      runtime,
      storage: app.storage,
      apiKey: key,
      instructions: FX_INSTRUCTIONS,
      tools: () => kernelAgentTools(kernel),
    });
    next.onChange(() => {
      setLines(next.lines());
      setBusy(next.busy());
    });
    conversation = next;
    void next.restore();
  }

  let disposed = false;
  void readSettings(app.storage).then((saved) => {
    if (disposed) return;
    setApiKey(saved.apiKey ?? null);
    setLoaded(true);
    connect(saved.apiKey ?? null);
  });
  onCleanup(() => {
    disposed = true;
    void conversation?.close();
  });

  async function saveKey(): Promise<void> {
    const key = keyDraft().trim();
    if (!key) return;
    await writeSettings(app.storage, { apiKey: key });
    setKeyDraft("");
    setEditingKey(false);
    setApiKey(key);
    connect(key);
  }

  async function forgetKey(): Promise<void> {
    await writeSettings(app.storage, {});
    setKeyDraft("");
    setEditingKey(false);
    setApiKey(null);
    connect(null);
  }

  function send(): void {
    const text = draft().trim();
    if (!text || busy() || !conversation) return;
    setDraft("");
    void conversation.send(text);
  }

  createEffect(
    () => [apiKey(), busy()] as const,
    ([key, working]) => {
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "New Conversation", shortcut: "N", disabled: !key, onClick: () => void conversation?.reset() },
            {
              label: "New Terminal Window",
              shortcut: "T",
              disabled: !key || !runtime.createTerminal,
              onClick: () => app.openWindow({ title: "fx", size: FX_TERMINAL_SIZE, scrollable: false, Component: FxTerminal }),
            },
            { label: "API Key…", onClick: () => setEditingKey(true) },
            { type: "separator" },
            { label: "Stop", shortcut: ".", disabled: !working, onClick: () => conversation?.cancel() },
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
      ]);
    },
  );

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={0}>
      <Show when={loaded()}>
        <Show
          when={apiKey() && !editingKey()}
          fallback={
            <KeySetup
              width={win.width()}
              current={apiKey()}
              draft={keyDraft()}
              engine={runtime.engine}
              onDraft={setKeyDraft}
              onSave={() => void saveKey()}
              onForget={() => void forgetKey()}
              onCancel={() => {
                setKeyDraft("");
                setEditingKey(false);
              }}
            />
          }
        >
          <MessageScroller height={win.height() - INPUT_ROW_HEIGHT} padding={6}>
            <Show when={lines().length === 0}>
              <text font="body" wrap semantic={{ name: "fx-empty" }}>
                Ask fx to build or change something on this Macintosh.
              </text>
            </Show>
            <For each={lines()}>{(line) => <TranscriptRow line={line} />}</For>
          </MessageScroller>
          <box
            flexDirection="row"
            gap={4}
            padding={2}
            height={INPUT_ROW_HEIGHT}
            borderColor={1}
            borderWidth={1}
            alignItems="center"
          >
            <TextInput
              name="fx-message"
              value={draft()}
              onChange={setDraft}
              onSubmit={send}
              width={win.width() - 70}
              placeholder="Message…"
              disabled={busy()}
              autoFocus
            />
            <Button label={busy() ? "Stop" : "Send"} onClick={() => (busy() ? conversation?.cancel() : send())} />
          </box>
        </Show>
      </Show>
    </box>
  );
}

function TranscriptRow(props: { line: TranscriptLine }): JSX.Element {
  const line = props.line;
  if (line.kind === "user") return <Message align="end" initials="Y">{line.text}</Message>;
  if (line.kind === "assistant") return <Message initials="fx">{line.text}</Message>;
  return (
    <text font="body" wrap semantic={{ name: `fx-${line.kind}` }}>
      {line.kind === "activity" ? `… ${line.text}` : line.text}
    </text>
  );
}

interface KeySetupProps {
  width: number;
  current: string | null;
  draft: string;
  engine: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  onForget: () => void;
  onCancel: () => void;
}

function KeySetup(props: KeySetupProps): JSX.Element {
  return (
    <box width={props.width} padding={10} flexDirection="column" gap={8}>
      <text font="body" wrap>
        {props.current
          ? `fx is using the AI Gateway key ${maskKey(props.current)}. Enter a new key to replace it.`
          : "fx needs a Vercel AI Gateway API key to talk to a model."}
      </text>
      <text font="body" wrap>
        Create one at vercel.com/ai-gateway. fx keeps it in its preferences on this Macintosh and sends it only to the
        AI Gateway.
      </text>
      <TextInput
        name="fx-api-key"
        password
        value={props.draft}
        onChange={props.onDraft}
        onSubmit={props.onSave}
        width={props.width - 20}
        placeholder="API key"
        autoFocus
      />
      <box flexDirection="row" gap={6} justifyContent="flex-end">
        <Show when={props.current}>
          <Button label="Forget Key" onClick={props.onForget} />
          <Button label="Cancel" onClick={props.onCancel} />
        </Show>
        <Button label="Save" onClick={props.onSave} />
      </box>
      <text font="body" semantic={{ name: "fx-engine" }}>{`Runs on ${props.engine}.`}</text>
    </box>
  );
}

export default defineApp({
  id: "fx",
  title: "fx",
  icon: "icon/chat",
  defaultSize: { width: 380, height: 280 },
  requires: ["network", "agent-runtime"],
  permissions: ["kernel:*"],
  Component: Fx,
});
