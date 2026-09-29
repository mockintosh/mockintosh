/**
 * The part of libfx 0.0.11's browser entry the web platform uses. The
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
  export function supportsJspi(): boolean;
}
