/**
 * Language-model agents run by the host. The app brings the instructions,
 * the tools and the user's key; the host brings the engine (fx's
 * WebAssembly core in the browser). Apps never see WebAssembly or a
 * provider's wire format, so the same app runs against a scripted runtime
 * in tests.
 */

/** A picture a tool hands back for the model to look at (a screenshot). */
export interface AgentImage {
  mimeType: string;
  /** Base64, without a `data:` prefix. */
  data: string;
}

/** What a tool returns: plain text, or text with pictures. */
export type AgentToolResult =
  | string
  | { text: string; images: readonly AgentImage[]; isError?: boolean };

export interface AgentToolContext {
  /** Aborted when the turn is cancelled; stop the work. */
  signal: AbortSignal;
}

/**
 * Something the agent may call. The runtime does no approval of its own:
 * validate and authorise inside `execute`.
 */
export interface AgentTool {
  /** Letters, digits, `_` and `-`; at most 64 characters. */
  name: string;
  description: string;
  /** A JSON Schema object describing `input`. */
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult>;
}

export interface AgentSessionOptions {
  /** The provider key. Apps ask the user for it and keep it in `storage`. */
  apiKey: string;
  /** A model id; the runtime's default when omitted. */
  model?: string;
  /** The whole system context. The runtime adds no hidden prompt. */
  instructions?: string;
  tools?: readonly AgentTool[];
  /** Bytes from an earlier `checkpoint()`, to carry on that conversation. */
  checkpoint?: Uint8Array;
}

/** What a turn reports while it runs, in order. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-start"; id: string; name: string }
  | { type: "tool-end"; id: string; name: string; isError: boolean };

/**
 * Why a turn ended: the model finished, the app cancelled, a token or step
 * limit was reached, or the model declined.
 */
export type AgentStopReason = "end" | "cancelled" | "limit" | "refused";

export interface AgentTurnResult {
  stopReason: AgentStopReason;
}

/**
 * One prompt's worth of work. Iterate the events, then await `result`;
 * events are not buffered forever, so a turn nobody reads stalls.
 */
export interface AgentTurn extends AsyncIterable<AgentEvent> {
  /** Rejects when the provider can't be reached or refuses the key. */
  readonly result: Promise<AgentTurnResult>;
  cancel(): void;
}

/** One conversation. One turn runs at a time. */
export interface AgentSession {
  prompt(text: string, options?: { signal?: AbortSignal }): AgentTurn;
  /** The conversation so far as opaque bytes, for `AgentSessionOptions.checkpoint`. Call while idle. */
  checkpoint(): Promise<Uint8Array>;
  /** End the conversation. The OS also closes sessions when their app quits. */
  close(): Promise<void>;
}

export interface AgentRuntime {
  /** What runs the agents, for About boxes and diagnostics ("fx 0.0.11"). */
  readonly engine: string;
  /** Start a conversation. Loading the engine may take a moment the first time. */
  createSession(options: AgentSessionOptions): Promise<AgentSession>;
}
