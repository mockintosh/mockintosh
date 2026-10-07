/**
 * The part of libfx 0.0.13's browser entry the web platform uses. The
 * package ships no declarations; these follow its documentation and source
 * (`fx-sdk.js`). Keep them in step when the pinned version changes.
 */
declare module "libfx/browser" {
  export interface FxImage {
    type: "image";
    data: string;
    mimeType: string;
  }

  /** A tool result with pictures; a plain string or JSON value also works. */
  export interface FxTypedToolResult {
    type: "libfx.tool-result";
    text: string;
    images: FxImage[];
    isError?: boolean;
  }

  export interface FxHostTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute(input: Record<string, unknown>, context: { signal: AbortSignal }): Promise<string | FxTypedToolResult>;
  }

  export interface FxAgentOptions {
    apiKey: string;
    model?: string;
    instructions?: string | string[];
    tools?: FxHostTool[];
    checkpoint?: Uint8Array;
    fetch?: typeof fetch;
    wasm?: string | URL | Response | Uint8Array | WebAssembly.Module;
  }

  export type FxTurnEvent =
    | { type: "text_delta"; delta: string }
    | { type: "reasoning_delta"; delta: string }
    | { type: "user_message"; text: string }
    | { type: "tool_start"; id: string; name: string }
    | { type: "tool_end"; id: string; name: string; content?: string; isError: boolean };

  export interface FxTurn extends AsyncIterable<FxTurnEvent> {
    readonly result: Promise<{ stopReason: string }>;
    cancel(): void;
  }

  export interface FxAgent {
    prompt(input: string, options?: { signal?: AbortSignal }): FxTurn;
    checkpoint(): Promise<Uint8Array>;
    close(): Promise<void>;
  }

  export function createFxAgent(options: FxAgentOptions): Promise<FxAgent>;

  /** What `createFxTerminal` drives: `xtermAdapter(term)`'s shape. */
  export interface FxTerminalAdapter {
    write(bytes: Uint8Array | string): void;
    onData(callback: (data: string) => void): () => void;
    onKeyData?(callback: (data: string) => void): () => void;
    readonly cols: number;
    readonly rows: number;
    onResize(callback: (size: { cols: number; rows: number }) => void): () => void;
    drain?(): Promise<void>;
  }

  export interface FxWorkspaceAdapter {
    info: { version: 1; root: string; cwd: string; home: string; gitAvailable: false; ephemeral: true };
    permission: "allow-sandboxed" | "prompt";
    exec(request: { command: string; cwd: string; signal: AbortSignal; timeoutMs: number; outputLimitBytes: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  }

  export interface FxRevisioned {
    bytes: Uint8Array;
    revision: string;
  }

  export interface FxTerminalOptions {
    terminal: FxTerminalAdapter;
    /** Every model request goes through it (`globalThis.fetch` by default). */
    fetch?: typeof fetch;
    env?: Record<string, string>;
    args?: string[];
    workspace?: FxWorkspaceAdapter;
    openUrl?(url: string): Promise<boolean> | boolean;
    clipboard?: { writeText(text: string): Promise<unknown> } | null;
    configStore?: { get(id: string): Promise<string | null>; set(id: string, value: string): Promise<void> };
    promptHistoryStore?: {
      load(workspaceRoot: string, limit: number): Promise<string[]>;
      append(workspaceRoot: string, value: string, timestampMs: number): Promise<"ok" | "duplicate" | "record_too_large" | void>;
      clear(workspaceRoot: string): Promise<void>;
    };
    sessionStore?: {
      load(id: string): Promise<FxRevisioned | null>;
      commit(id: string, bytes: Uint8Array, expectedRevision?: string): Promise<{ revision: string }>;
      list(): Promise<unknown[]>;
      remove(id: string): Promise<void>;
    };
    oauthSessionStore?: {
      load(): Promise<FxRevisioned | null>;
      commit(bytes: Uint8Array, expectedRevision?: string): Promise<{ revision: string }>;
      remove(expectedRevision?: string): Promise<boolean | "missing" | void>;
    };
    wasm?: string | URL | Response | Uint8Array | WebAssembly.Module;
  }

  export interface FxTerminalRuntime {
    readonly interactive: Promise<void>;
    readonly exited: Promise<number>;
    write(data: string): void;
    resize(): void;
    abort(): void;
  }

  export function createFxTerminal(options: FxTerminalOptions): Promise<FxTerminalRuntime>;
  export function supportsJspi(): boolean;
}
