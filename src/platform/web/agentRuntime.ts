import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  AgentStopReason,
  AgentStorage,
  AgentTerminal,
  AgentTerminalOptions,
  AgentTool,
  AgentTurn,
} from "@mockintosh/sdk";
import type { FxHostTool, FxRevisioned, FxTerminalOptions, FxTurn, FxTurnEvent } from "libfx/browser";
import { fetchWithInstructions } from "./agentInstructions";

const FX_VERSION = "0.0.13";

/**
 * Agents on the web: fx's WebAssembly core through libfx. The engine needs
 * JavaScript Promise Integration (Chrome, Safari 27+), so the service is
 * absent without it and apps that require it say why. libfx and its 2 MB
 * core load on the first session, not at boot.
 */
export function createWebAgentRuntime(): AgentRuntime | undefined {
  if (typeof (WebAssembly as { Suspending?: unknown }).Suspending !== "function") return undefined;
  return {
    engine: `fx ${FX_VERSION}`,
    async createSession(options): Promise<AgentSession> {
      const { createFxAgent } = await import("libfx/browser");
      const agent = await createFxAgent({
        apiKey: options.apiKey,
        ...(options.model ? { model: options.model } : {}),
        ...(options.instructions ? { instructions: options.instructions } : {}),
        tools: (options.tools ?? []).map(fxTool),
        ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}),
      });
      return {
        prompt: (text, promptOptions) => agentTurn(agent.prompt(text, promptOptions)),
        checkpoint: () => agent.checkpoint(),
        close: () => agent.close(),
      };
    },
    createTerminal,
  };
}

/**
 * fx's own terminal interface (its 4.9 MB terminal core, loaded on first
 * use) on a Mockintosh terminal. Its shell tool runs commands through the
 * app's workspace, and it keeps its sessions, settings, prompt history and
 * sign-in in the app's storage.
 */
async function createTerminal(options: AgentTerminalOptions): Promise<AgentTerminal> {
  const { createFxTerminal } = await import("libfx/browser");
  const runtime = await createFxTerminal(fxTerminalOptions(options, globalThis.fetch.bind(globalThis)));
  return { interactive: runtime.interactive, exited: runtime.exited, abort: () => runtime.abort() };
}

/** libfx's terminal options for an agent terminal: any libfx build takes them (the Node one, in tests). */
export function fxTerminalOptions(options: AgentTerminalOptions, fetch: typeof globalThis.fetch): FxTerminalOptions {
  const screen = options.screen;
  return {
    terminal: {
      write: (bytes) => screen.write(bytes),
      onData: (callback) => screen.onData(callback),
      get cols() {
        return screen.cols;
      },
      get rows() {
        return screen.rows;
      },
      onResize: (callback) => screen.onResize(callback),
    },
    env: { ...options.env, AI_GATEWAY_API_KEY: options.apiKey, HOME: options.workspace?.root ?? "/" },
    args: [...(options.model ? ["--model", options.model] : []), ...(options.args ?? [])],
    fetch: options.instructions ? fetchWithInstructions(fetch, options.instructions) : fetch,
    ...(options.workspace
      ? {
          workspace: {
            info: { version: 1, root: options.workspace.root, cwd: options.workspace.root, home: options.workspace.root, gitAvailable: false, ephemeral: true },
            permission: options.workspace.permission === "allow" ? "allow-sandboxed" : "prompt",
            exec: (request) => options.workspace!.exec(request),
          },
        }
      : {}),
    openUrl: options.openUrl ? (url) => options.openUrl!(url) : () => false,
    clipboard: options.clipboard ?? null,
    ...(options.storage ? fxStores(options.storage) : {}),
  };
}

/** A storage key from an fx id: ids may hold characters a file name can't. */
function keyFor(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
}

/** Revisioned bytes: the content, and a counter beside it that a commit must match. */
function revisioned(storage: AgentStorage, key: string, conflictCode: string) {
  return {
    async load(): Promise<FxRevisioned | null> {
      const bytes = await storage.readBytes(`${key}.bin`);
      if (!bytes) return null;
      return { bytes, revision: (await storage.read(`${key}.rev`)) ?? "1" };
    },
    async commit(bytes: Uint8Array, expectedRevision?: string): Promise<{ revision: string }> {
      const current = await storage.read(`${key}.rev`);
      if (expectedRevision !== undefined && current !== null && expectedRevision !== current) {
        throw Object.assign(new Error("revision conflict"), { code: conflictCode });
      }
      const revision = String(Number(current ?? "0") + 1);
      await storage.writeBytes(`${key}.bin`, bytes);
      await storage.write(`${key}.rev`, revision);
      return { revision };
    },
    async remove(expectedRevision?: string): Promise<boolean> {
      const current = await storage.read(`${key}.rev`);
      if (current === null) return false;
      if (expectedRevision !== undefined && expectedRevision !== current) {
        throw Object.assign(new Error("revision conflict"), { code: conflictCode });
      }
      await storage.remove(`${key}.bin`);
      await storage.remove(`${key}.rev`);
      return true;
    },
  };
}

function fxStores(storage: AgentStorage): Pick<FxTerminalOptions, "configStore" | "promptHistoryStore" | "sessionStore" | "oauthSessionStore"> {
  const HISTORY = "fx-history.json";
  const history = async (): Promise<Record<string, string[]>> => {
    try {
      return JSON.parse((await storage.read(HISTORY)) ?? "{}") as Record<string, string[]>;
    } catch {
      return {};
    }
  };
  const oauth = revisioned(storage, "fx-oauth", "FX_OAUTH_SESSION_REVISION_CONFLICT");
  return {
    configStore: {
      get: (id) => storage.read(keyFor("fx-config", id)),
      set: (id, value) => storage.write(keyFor("fx-config", id), value),
    },
    promptHistoryStore: {
      async load(root, limit) {
        return ((await history())[root] ?? []).slice(-limit);
      },
      async append(root, value) {
        const all = await history();
        const entries = all[root] ?? [];
        if (entries[entries.length - 1] === value) return "duplicate";
        if (value.length > 64 * 1024) return "record_too_large";
        all[root] = [...entries, value].slice(-500);
        await storage.write(HISTORY, JSON.stringify(all));
        return "ok";
      },
      async clear(root) {
        const all = await history();
        delete all[root];
        await storage.write(HISTORY, JSON.stringify(all));
      },
    },
    sessionStore: {
      load: (id) => revisioned(storage, keyFor("fx-session", id), "FX_SESSION_REVISION_CONFLICT").load(),
      commit: (id, bytes, expected) => revisioned(storage, keyFor("fx-session", id), "FX_SESSION_REVISION_CONFLICT").commit(bytes, expected),
      // fx resumes a session by id; listing them for a picker isn't offered yet.
      list: async () => [],
      remove: async (id) => {
        await revisioned(storage, keyFor("fx-session", id), "FX_SESSION_REVISION_CONFLICT").remove();
      },
    },
    oauthSessionStore: {
      load: () => oauth.load(),
      commit: (bytes, expected) => oauth.commit(bytes, expected),
      remove: (expected) => oauth.remove(expected),
    },
  };
}

function fxTool(tool: AgentTool): FxHostTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input, context) {
      const result = await tool.execute(input, context);
      if (typeof result === "string") return result;
      return {
        type: "libfx.tool-result",
        text: result.text,
        images: result.images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType })),
        ...(result.isError ? { isError: true } : {}),
      };
    },
  };
}

function agentTurn(turn: FxTurn): AgentTurn {
  return {
    result: turn.result.then((value) => ({ stopReason: stopReason(value.stopReason) })),
    cancel: () => turn.cancel(),
    async *[Symbol.asyncIterator]() {
      for await (const event of turn) {
        const mapped = agentEvent(event);
        if (mapped) yield mapped;
      }
    },
  };
}

function agentEvent(event: FxTurnEvent): AgentEvent | null {
  switch (event.type) {
    case "text_delta":
      return { type: "text", delta: event.delta };
    case "reasoning_delta":
      return { type: "reasoning", delta: event.delta };
    case "tool_start":
      return { type: "tool-start", id: event.id, name: event.name };
    case "tool_end":
      return { type: "tool-end", id: event.id, name: event.name, isError: event.isError };
    default:
      return null;
  }
}

/** libfx reports the Agent Client Protocol's stop reasons. */
function stopReason(reason: string): AgentStopReason {
  switch (reason) {
    case "cancelled":
      return "cancelled";
    case "max_tokens":
    case "max_turn_requests":
      return "limit";
    case "refusal":
      return "refused";
    default:
      return "end";
  }
}
