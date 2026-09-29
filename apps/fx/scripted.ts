/**
 * Test doubles for fx: an agent runtime that plays back scripted turns and
 * runs the tools they name, and an in-memory `AppStorage`.
 */
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  AgentSessionOptions,
  AgentStopReason,
  AgentToolResult,
  AgentTurn,
  AppStorage,
} from "@mockintosh/sdk";

/** One step of a scripted turn: an event to emit, or a tool to call with this input. */
export type ScriptStep = AgentEvent | { type: "call"; name: string; input: Record<string, unknown> };

export interface ScriptedTurn {
  steps: ScriptStep[];
  stopReason?: AgentStopReason;
  /** Make `result` reject with this message after the steps. */
  fail?: string;
  /** Wait for `release()` before finishing, so a test can cancel mid-turn. */
  hold?: boolean;
}

export interface ScriptedRuntime extends AgentRuntime {
  readonly sessions: AgentSessionOptions[];
  readonly prompts: string[];
  readonly toolResults: AgentToolResult[];
  closed: number;
  /** Let a held turn finish. */
  release(): void;
}

export function createScriptedRuntime(turns: ScriptedTurn[]): ScriptedRuntime {
  const queue = [...turns];
  let releaseHeld = () => {};
  const runtime: ScriptedRuntime = {
    engine: "scripted",
    sessions: [],
    prompts: [],
    toolResults: [],
    closed: 0,
    release: () => releaseHeld(),
    async createSession(options): Promise<AgentSession> {
      runtime.sessions.push(options);
      let turnCount = 0;
      return {
        prompt(text): AgentTurn {
          runtime.prompts.push(text);
          const script = queue.shift() ?? { steps: [{ type: "text", delta: "ok" }] };
          const controller = new AbortController();
          let settle: (reason: AgentStopReason) => void = () => {};
          let fail: (error: Error) => void = () => {};
          const result = new Promise<{ stopReason: AgentStopReason }>((resolve, reject) => {
            settle = (stopReason) => resolve({ stopReason });
            fail = reject;
          });
          turnCount += 1;
          return {
            result,
            cancel: () => controller.abort(),
            async *[Symbol.asyncIterator]() {
              for (const step of script.steps) {
                if (controller.signal.aborted) break;
                if (step.type !== "call") {
                  yield step;
                  continue;
                }
                const tool = options.tools?.find((candidate) => candidate.name === step.name);
                const id = `call-${turnCount}-${step.name}`;
                yield { type: "tool-start", id, name: step.name };
                const output = tool
                  ? await tool.execute(step.input, { signal: controller.signal })
                  : `unknown tool ${step.name}`;
                runtime.toolResults.push(output);
                yield { type: "tool-end", id, name: step.name, isError: !tool };
              }
              if (script.hold && !controller.signal.aborted) {
                await new Promise<void>((resolve) => {
                  releaseHeld = resolve;
                  controller.signal.addEventListener("abort", () => resolve());
                });
              }
              if (script.fail) fail(new Error(script.fail));
              else settle(controller.signal.aborted ? "cancelled" : (script.stopReason ?? "end"));
            },
          };
        },
        async checkpoint() {
          return new TextEncoder().encode(`checkpoint after ${runtime.prompts.length}`);
        },
        async close() {
          runtime.closed += 1;
        },
      };
    },
  };
  return runtime;
}

export function createMemoryStorage(): AppStorage & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async read(key) {
      const bytes = files.get(key);
      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    async write(key, value) {
      files.set(key, new TextEncoder().encode(value));
    },
    async readBytes(key) {
      return files.get(key) ?? null;
    },
    async writeBytes(key, bytes) {
      files.set(key, bytes.slice());
    },
    async remove(key) {
      files.delete(key);
    },
    async list() {
      return [...files.keys()];
    },
  };
}
