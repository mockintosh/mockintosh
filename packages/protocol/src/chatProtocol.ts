/**
 * ChatGippity ↔ `/api/chat` wire types. The gateway is one LLM turn:
 * messages (and optional tools) in, a text reply or tool_calls out.
 * The live OS executes tools; this module has no kernel dependency.
 */

export interface OpenAIToolParameter {
  type: string;
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: unknown;
  enum?: unknown[];
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: OpenAIToolParameter;
  };
}

export interface OpenAIToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: ChatContent;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Raw JSON arguments when parse failed (truncated completion). */
  rawArguments?: string;
  truncated?: boolean;
}

export type FinishReason = "length" | "stop" | "tool_calls";

export interface CompleteResult {
  message?: string;
  tool_calls?: AgentToolCall[];
  finishReason?: FinishReason;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatContent = string | ContentPart[] | null;

export interface ChatRequestOptions {
  mode?: "chat" | "build";
  thinking?: "low" | "medium" | "high";
}

export const HTTP_TOOLS: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image based on a descriptive prompt. Use this when the user asks to see, draw, create, or show an image of something.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "A detailed description of the image to generate.",
          },
        },
        required: ["prompt"],
      },
    },
  },
];

const ROLES = new Set(["system", "user", "assistant", "tool"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseToolCalls(value: unknown): OpenAIToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const calls: OpenAIToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const fn = item.function;
    if (!isRecord(fn) || typeof fn.name !== "string") continue;
    const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    calls.push({
      id: item.id,
      type: "function",
      function: { name: fn.name, arguments: args },
    });
  }
  return calls.length ? calls : undefined;
}

export function parseChatMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value) || typeof value.role !== "string" || !ROLES.has(value.role)) return null;
  const role = value.role as ChatMessage["role"];
  const tool_calls = parseToolCalls(value.tool_calls);
  const content = parseContent(value.content, role, tool_calls);
  if (role !== "assistant" && role !== "tool" && content === null) return null;
  if (role === "user" && !contentHasText(content)) return null;
  if (role === "tool" && typeof value.tool_call_id !== "string") return null;
  return {
    role,
    content,
    name: typeof value.name === "string" ? value.name : undefined,
    tool_call_id: typeof value.tool_call_id === "string" ? value.tool_call_id : undefined,
    tool_calls,
  };
}

/** `{ messages }` (required). Legacy `{ prompt, conversationHistory }` is also accepted. */
export function parseChatRequest(body: unknown): ChatMessage[] | null {
  if (!isRecord(body)) return null;
  if (Array.isArray(body.messages)) {
    const messages = body.messages.map(parseChatMessage).filter((m): m is ChatMessage => !!m);
    if (!messages.some((m) => m.role === "user")) return null;
    return messages;
  }
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    const history = Array.isArray(body.conversationHistory)
      ? body.conversationHistory.map(parseChatMessage).filter((m): m is ChatMessage => !!m)
      : [];
    return [...history, { role: "user", content: body.prompt.trim() }];
  }
  return null;
}

export function parseClientTools(body: unknown): OpenAITool[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.tools)) return undefined;
  const tools: OpenAITool[] = [];
  for (const item of body.tools) {
    if (!isRecord(item) || item.type !== "function" || !isRecord(item.function)) continue;
    const name = item.function.name;
    const description = item.function.description;
    const parameters = item.function.parameters;
    if (typeof name !== "string" || typeof description !== "string" || !isRecord(parameters)) continue;
    tools.push({
      type: "function",
      function: {
        name,
        description,
        parameters: parameters as unknown as OpenAIToolParameter,
      },
    });
  }
  return tools.length ? tools : undefined;
}

export function parseArguments(raw: string): Record<string, unknown> {
  const parsed = parseArgumentsDetailed(raw);
  return parsed.value;
}

export function parseArgumentsDetailed(raw: string): { value: Record<string, unknown>; ok: boolean } {
  try {
    const value = JSON.parse(raw || "{}");
    return isRecord(value) ? { value, ok: true } : { value: {}, ok: false };
  } catch {
    return { value: {}, ok: false };
  }
}

export function parseChatOptions(body: unknown): ChatRequestOptions {
  if (!isRecord(body)) return {};
  const mode = body.mode === "build" || body.mode === "chat" ? body.mode : undefined;
  const thinking =
    body.thinking === "low" || body.thinking === "medium" || body.thinking === "high"
      ? body.thinking
      : undefined;
  return { mode, thinking };
}

export function thinkingFromText(text: string): "low" | "medium" | "high" | undefined {
  if (/\bultrathink\b/i.test(text)) return "high";
  if (/\bthink hard\b/i.test(text)) return "medium";
  if (/(^|\s)think(\s|$)/i.test(text) && !/\bthinking\b/i.test(text)) return "low";
  return undefined;
}

export function messageText(content: ChatContent | undefined): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("");
}

export function parseContent(value: unknown, role: ChatMessage["role"], tool_calls?: OpenAIToolCall[]): ChatContent {
  if (value === undefined || value === null) return role === "assistant" && tool_calls ? null : "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts: ContentPart[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== "string") continue;
    if (item.type === "text" && typeof item.text === "string") parts.push({ type: "text", text: item.text });
    if (item.type === "image_url" && isRecord(item.image_url) && typeof item.image_url.url === "string") {
      parts.push({ type: "image_url", image_url: { url: item.image_url.url } });
    }
  }
  return parts.length ? parts : null;
}

function contentHasText(content: ChatContent): boolean {
  return messageText(content).trim().length > 0;
}

/** Map one OpenAI chat-completion choice to the client complete result. */
export function completeFromLLMChoice(choice: unknown): CompleteResult {
  if (!isRecord(choice)) return { message: "" };
  const message = isRecord(choice.message) ? choice.message : {};
  const rawCalls = parseToolCalls(message.tool_calls);
  const finishReason: FinishReason | undefined =
    choice.finish_reason === "length" || choice.finish_reason === "stop" || choice.finish_reason === "tool_calls"
      ? choice.finish_reason
      : undefined;
  if (rawCalls?.length || choice.finish_reason === "tool_calls") {
    return {
      finishReason,
      tool_calls: (rawCalls ?? []).map((call) => {
        const parsed = parseArgumentsDetailed(call.function.arguments);
        const truncated = !parsed.ok && !!call.function.arguments.trim();
        return {
          id: call.id,
          name: call.function.name,
          arguments: parsed.value,
          ...(truncated ? { rawArguments: call.function.arguments, truncated: true } : {}),
        };
      }),
    };
  }
  const content = message.content;
  return { finishReason, message: typeof content === "string" ? content.trim() : "" };
}

/** How to write Solid 2 in a Mockintosh app: shared by every agent that builds apps. */
export const SOLID_IDIOMS = `Solid 2 idioms: import createSignal/createEffect/For/Loading/onSettled from @mockintosh/sdk (not solid-js/store, onMount, Index, ErrorBoundary, or Context.Provider). createEffect(compute, apply) — declare signals above the effect; compute runs immediately. Async data is createMemo(() => fs.readText(id)) under <Loading>, not a signal filled in onSettled. For is keyed by item identity (keyed={false} for index reuse). mockintosh.json sdkVersion is "3". Do not call flush().`;

export const AGENT_BRIEF = `You can operate this Mockintosh through tools that call the same OS traps as Terminal and Source Editor.

When the user asks you to build, create, or make an app:
1. Call project_create with path /disk/Applications/<Title>.app, a unique id, a title, and template "canvas" (drawing), "blank", or "counter".
2. Read before you edit. Prefer edit (exact string replace + expectedRevision) after the first write. Keep files under ~200 lines.
3. The running OS source is at /system/source. search /system/source for pointer events, JSX props, and SDK-clean exemplars (MacPaint). Model only on SDK-clean apps.
4. build_submit waits until compile finishes. After write/edit you also get project_check diagnostics.
5. app_install with the exact build id (or omit build for the latest), then inspect. For a drawing app, drag on the bitmap and screenshot. Read logs for runtime errors.
6. A file the Finder should see goes on the Desktop: fs.locate("desktop") and writeFile with MIME.text. app.storage is private prefs, not the Desktop.

${SOLID_IDIOMS}

Generated apps share this computer's JavaScript realm. A runaway app requires a reload. Do not invent trap names.
`;
