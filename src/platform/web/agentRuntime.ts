import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  AgentStopReason,
  AgentTool,
  AgentTurn,
} from "@mockintosh/sdk";
import type { FxHostTool, FxTurn, FxTurnEvent } from "libfx/browser";

const FX_VERSION = "0.0.11";

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
