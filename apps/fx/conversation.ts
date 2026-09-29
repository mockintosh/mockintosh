import { activityLabel } from "@mockintosh/agent";
import type { AgentRuntime, AgentSession, AgentTool, AgentTurn, AppStorage } from "@mockintosh/sdk";

/** One line of the visible transcript. The agent's own history lives in the checkpoint. */
export type TranscriptLine =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "activity"; text: string; failed?: boolean }
  | { kind: "notice"; text: string };

export interface ConversationOptions {
  runtime: AgentRuntime;
  storage: AppStorage;
  apiKey: string;
  instructions: string;
  /** Called for each new session, so every conversation gets fresh tool state. */
  tools: () => AgentTool[];
}

/**
 * An fx conversation without a window: the agent session, the transcript the
 * user sees, and both saved in the app's storage so the next launch carries
 * on. The chat window renders it; a terminal window could too.
 */
export interface Conversation {
  lines(): readonly TranscriptLine[];
  busy(): boolean;
  /** Called after every change to `lines` or `busy`. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Load the transcript the last launch left. The session itself starts on the next `send`. */
  restore(): Promise<void>;
  send(text: string): Promise<void>;
  cancel(): void;
  /** Forget everything, including what's saved. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export const CHECKPOINT_KEY = "conversation.checkpoint";
export const TRANSCRIPT_KEY = "transcript.json";
const TRANSCRIPT_LIMIT = 400;
const INTERRUPTED: TranscriptLine = { kind: "notice", text: "fx was interrupted before it finished." };

export function createConversation(options: ConversationOptions): Conversation {
  const { runtime, storage } = options;
  const listeners = new Set<() => void>();
  let lines: TranscriptLine[] = [];
  let busy = false;
  let session: AgentSession | null = null;
  let turn: AgentTurn | null = null;
  let closed = false;
  let writes: Promise<void> = Promise.resolve();

  const changed = () => {
    if (!closed) listeners.forEach((listener) => listener());
  };
  const push = (line: TranscriptLine) => {
    lines = [...lines, line].slice(-TRANSCRIPT_LIMIT);
    changed();
  };
  const replaceLast = (line: TranscriptLine) => {
    lines = [...lines.slice(0, -1), line];
    changed();
  };

  async function openSession(): Promise<AgentSession> {
    if (session) return session;
    const checkpoint = await storage.readBytes(CHECKPOINT_KEY);
    session = await runtime.createSession({
      apiKey: options.apiKey,
      instructions: options.instructions,
      tools: options.tools(),
      ...(checkpoint ? { checkpoint } : {}),
    });
    return session;
  }

  /** Storage writes run one at a time, in the order they were asked for. */
  function queue(write: () => Promise<void>): Promise<void> {
    writes = writes.then(write).catch(() => {});
    return writes;
  }

  /** What the next launch shows if this one ends now: mid-turn, the reply so far and a note that it stopped. */
  function saveTranscript(): Promise<void> {
    const saved = JSON.stringify(busy ? [...lines, INTERRUPTED] : lines);
    return queue(() => storage.write(TRANSCRIPT_KEY, saved));
  }

  /** The agent's checkpoint only exists between turns, so a finished turn saves both. */
  async function save(): Promise<void> {
    const ending = session;
    if (ending) await queue(async () => storage.writeBytes(CHECKPOINT_KEY, await ending.checkpoint()));
    await saveTranscript();
  }

  async function run(current: AgentTurn): Promise<void> {
    let streaming = false;
    for await (const event of current) {
      if (closed) return;
      if (event.type === "text") {
        const last = lines.at(-1);
        if (streaming && last?.kind === "assistant") replaceLast({ kind: "assistant", text: last.text + event.delta });
        else push({ kind: "assistant", text: event.delta });
        streaming = true;
        if (event.delta.includes("\n")) void saveTranscript();
      } else if (event.type === "tool-start") {
        streaming = false;
        const label = activityLabel(event.name);
        const last = lines.at(-1);
        if (!(last?.kind === "activity" && last.text === label)) push({ kind: "activity", text: label });
        void saveTranscript();
      } else if (event.type === "tool-end" && event.isError) {
        push({ kind: "activity", text: `${activityLabel(event.name)} failed`, failed: true });
        void saveTranscript();
      }
    }
    const { stopReason } = await current.result;
    if (stopReason === "cancelled") push({ kind: "notice", text: "Stopped." });
    else if (stopReason === "limit") push({ kind: "notice", text: "fx reached its limit for one request. Send a message to continue." });
    else if (stopReason === "refused") push({ kind: "notice", text: "fx declined to answer." });
  }

  return {
    lines: () => lines,
    busy: () => busy,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async restore() {
      const raw = await storage.read(TRANSCRIPT_KEY);
      if (!raw) return;
      try {
        const saved: unknown = JSON.parse(raw);
        if (Array.isArray(saved)) {
          lines = [...saved.filter(isTranscriptLine), ...lines].slice(-TRANSCRIPT_LIMIT);
          changed();
        }
      } catch {
        await queue(() => storage.remove(TRANSCRIPT_KEY));
      }
    },

    async send(text) {
      const message = text.trim();
      if (!message || busy || closed) return;
      busy = true;
      push({ kind: "user", text: message });
      void saveTranscript();
      let agent: AgentSession | null = null;
      try {
        agent = await openSession();
        turn = agent.prompt(message);
        await run(turn);
      } catch (error) {
        push({ kind: "notice", text: `fx couldn't finish: ${error instanceof Error ? error.message : String(error)}` });
      } finally {
        turn = null;
        busy = false;
        changed();
        // A reset during the turn has already forgotten this conversation.
        const current = agent === null || session === agent;
        if (!closed && current) await save().catch(() => {});
      }
    },

    cancel() {
      turn?.cancel();
    },

    async reset() {
      turn?.cancel();
      const ending = session;
      session = null;
      lines = [];
      changed();
      await ending?.close();
      await queue(async () => {
        await storage.remove(CHECKPOINT_KEY);
        await storage.remove(TRANSCRIPT_KEY);
      });
    },

    async close() {
      if (closed) return;
      if (busy) void saveTranscript();
      closed = true;
      listeners.clear();
      turn?.cancel();
      await session?.close();
      session = null;
      await writes;
    },
  };
}

function isTranscriptLine(value: unknown): value is TranscriptLine {
  if (!value || typeof value !== "object") return false;
  const line = value as { kind?: unknown; text?: unknown };
  return typeof line.text === "string" && ["user", "assistant", "activity", "notice"].includes(line.kind as string);
}
