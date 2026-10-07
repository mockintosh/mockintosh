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

/**
 * The terminal an agent's own full-screen interface draws on: bytes out to
 * the screen, keys (already encoded) and the terminal's replies back.
 * `@mockintosh/terminal`'s screen and pseudo-terminal both fit.
 */
export interface AgentTerminalScreen {
  write(data: Uint8Array | string): void;
  onData(handler: (data: string) => void): () => void;
  readonly cols: number;
  readonly rows: number;
  onResize(handler: (size: { cols: number; rows: number }) => void): () => void;
}

/** One shell command the agent runs, and how long and how much it may. */
export interface AgentWorkspaceRequest {
  command: string;
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  outputLimitBytes: number;
}

/** Where the agent's shell tool runs commands: a shell on this Macintosh, not the host's. */
export interface AgentWorkspace {
  /** The working directory, and the agent's home. */
  root: string;
  exec(request: AgentWorkspaceRequest): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** "allow" runs commands without asking; "prompt" (the default) has the agent ask first. */
  permission?: "allow" | "prompt";
}

/** Small persistent key–value storage, as `AppStorage` gives an app. */
export interface AgentStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  readBytes(key: string): Promise<Uint8Array | null>;
  writeBytes(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AgentTerminalOptions {
  apiKey: string;
  model?: string;
  /** Command-line arguments, as the agent's own CLI takes them (`--resume`, `--continue`). */
  args?: string[];
  /** Environment variables for the agent's CLI (`FX_MODEL`, `FX_PERMISSION_MODE`). */
  env?: Record<string, string>;
  /**
   * Context the agent gets beside its own: where it is and how things work
   * here. Added to the system prompt of every request.
   */
  instructions?: string;
  screen: AgentTerminalScreen;
  workspace?: AgentWorkspace;
  /** Where the agent keeps its sessions, settings and prompt history between launches. */
  storage?: AgentStorage;
  /** Open a link (sign-in, a URL the agent shows). Resolves false when it couldn't. */
  openUrl?(url: string): Promise<boolean>;
  clipboard?: { writeText(text: string): Promise<void> };
}

/** An agent's interactive terminal interface, running until the user leaves it. */
export interface AgentTerminal {
  /** Resolves once the interface is drawn and takes keys. */
  readonly interactive: Promise<void>;
  /** Resolves with the exit code when the user quits. */
  readonly exited: Promise<number>;
  /** Stop it now. */
  abort(): void;
}

export interface AgentRuntime {
  /** What runs the agents, for About boxes and diagnostics ("fx 0.0.13"). */
  readonly engine: string;
  /** Start a conversation. Loading the engine may take a moment the first time. */
  createSession(options: AgentSessionOptions): Promise<AgentSession>;
  /**
   * Run the agent's own terminal interface (fx's TUI) on `screen`, when the
   * runtime has one.
   */
  createTerminal?(options: AgentTerminalOptions): Promise<AgentTerminal>;
}
