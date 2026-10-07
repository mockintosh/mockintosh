import { MOCKINTOSH_CHAT_CONTEXT } from "./mockintosh-context.js";
import { envLimit, guardRequest, type RouteLimits } from "./_guard.js";
import { TYPE_DIGEST, SOURCE_MAP } from "./mockintosh-context.generated.js";
import {
  AGENT_BRIEF,
  HTTP_TOOLS,
  completeFromLLMChoice,
  messageText,
  parseChatOptions,
  parseChatRequest,
  parseClientTools,
  thinkingFromText,
  type ChatMessage,
  type OpenAITool,
} from "../src/shared/chatProtocol.js";

const LLM_API_URL =
  process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-5.6-sol";

const CHAT_PERSONA = `You are ChatGippity, a friendly and witty AI assistant living inside Mockintosh, a 1-bit Macintosh simulator running in the browser. Keep your responses concise and conversational. You can help with general questions, creative writing, brainstorming, coding advice, casual chat, and building Mockintosh apps. You have a retro personality that fits the Mac aesthetic — think 1984, think different.

You have the ability to generate images. Use the generate_image tool whenever the user asks you to draw, generate, create, or show an image of something.`;

const BUILD_PERSONA = `You are ChatGippity building a Mockintosh app. Do not be concise at the expense of correctness. Prefer edit over write after the first version. Keep files under ~200 lines and split modules.

Procedure: plan → scaffold (project_create with the right template) → engine module → view → build_submit → app_install → drag + screenshot → iterate → short report.
For a drawing app use template "canvas". Read /system/source/apps/MacPaint.tsx and packages/ui/src/pointer.ts rather than guessing bitmap APIs.
Saving to the Desktop is fs.locate("desktop") + writeFile (see Photo Booth and the App Developer Guide), not app.storage.
When users ask about Mockintosh, use the digest and source volume; do not invent trap names.`;

const STATIC_GUIDE = `${AGENT_BRIEF}

${MOCKINTOSH_CHAT_CONTEXT}

## Type digest
${TYPE_DIGEST}

## Source volume
${SOURCE_MAP}`;

const CACHE_BOUNDARY = "--- session ---";

export function buildSystemPrompt(mode: "chat" | "build"): string {
  const persona = mode === "build" ? BUILD_PERSONA : CHAT_PERSONA;
  return `${persona}

${STATIC_GUIDE}`;
}

export function thinkingLevel(messages: ChatMessage[], requested?: "low" | "medium" | "high"): "low" | "medium" | "high" | undefined {
  if (requested) return requested;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    return thinkingFromText(messageText(messages[i].content));
  }
  return undefined;
}

const usesCompletionTokens = (model: string) => /^gpt-5/i.test(model) || /^o\d/i.test(model);

/**
 * `gpt-5.6-sol` (and likely other reasoning models) reject function tools
 * together with a non-`none` `reasoning_effort` on `/v1/chat/completions`.
 * Keep thinking only when this request has no tools, or the URL is not that
 * completions shape.
 */
export function reasoningEffortForRequest(options: {
  model: string;
  thinking?: "low" | "medium" | "high";
  toolCount: number;
  apiUrl: string;
}): "low" | "medium" | "high" | "none" | undefined {
  if (!usesCompletionTokens(options.model)) return undefined;
  if (options.toolCount > 0 && /\/chat\/completions\/?$/i.test(options.apiUrl)) return "none";
  return options.thinking;
}

export function toLLMMessages(messages: ChatMessage[], mode: "chat" | "build", tools: OpenAITool[]): object[] {
  const sorted = [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name));
  const toolList = sorted.map((tool) => `- ${tool.function.name}`).join("\n");
  return [
    { role: "system", content: buildSystemPrompt(mode) },
    { role: "system", content: `Tools (alphabetical):\n${toolList}\n${CACHE_BOUNDARY}\n${new Date().toISOString().slice(0, 10)}` },
    ...messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const out: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
        if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
        if (m.name) out.name = m.name;
        if (m.tool_calls) out.tool_calls = m.tool_calls;
        return out;
      }),
  ];
}

/** A build session makes one request per tool round, so the hourly budget is generous. */
const CHAT_LIMITS: RouteLimits = {
  route: "chat",
  // Vercel refuses bodies over 4.5 MB before the function runs.
  maxBodyBytes: 4_000_000,
  perClient: { max: envLimit("CHAT_LIMIT_PER_HOUR", 200), windowSeconds: 3600 },
  global: { max: envLimit("CHAT_LIMIT_PER_DAY", 5000), windowSeconds: 86400 },
};

/** More than any Mockintosh session offers the model. */
const MAX_TOOLS = 128;

export function staticPromptPrefix(mode: "chat" | "build"): string {
  return buildSystemPrompt(mode);
}

export default async function handler(req: Request): Promise<Response> {
  const guard = await guardRequest(req, CHAT_LIMITS);
  if (!guard.ok) return guard.response;

  if (!LLM_API_KEY) {
    return new Response(
      JSON.stringify({
        message:
          "Hi! I'm ChatGippity. The LLM API key isn't configured yet, so I can't chat for real. Set LLM_API_KEY in your environment to enable me!",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(guard.body);
  } catch {
    body = null;
  }
  const parsed = parseChatRequest(body);
  if (!parsed) {
    return new Response(JSON.stringify({ error: "Missing prompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const options = parseChatOptions(body);
  const tools = parseClientTools(body) ?? HTTP_TOOLS;
  if (tools.length > MAX_TOOLS) {
    return new Response(JSON.stringify({ error: "Too many tools" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const mode = options.mode ?? "chat";
  const thinking = thinkingLevel(parsed, options.thinking) ?? (mode === "build" ? "medium" : undefined);

  try {
    const payload: Record<string, unknown> = {
      model: LLM_MODEL,
      messages: toLLMMessages(parsed, mode, tools),
    };
    if (usesCompletionTokens(LLM_MODEL)) {
      payload.max_completion_tokens = tools.length ? 32000 : 4096;
      const effort = reasoningEffortForRequest({
        model: LLM_MODEL,
        thinking,
        toolCount: tools.length,
        apiUrl: LLM_API_URL,
      });
      if (effort) payload.reasoning_effort = effort;
    } else {
      payload.max_tokens = tools.length ? 8192 : 2048;
      payload.temperature = 0.7;
    }
    if (tools.length) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }
    const resp = await fetch(LLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      // The provider's body can describe our account; keep it in the logs.
      console.error("LLM API error:", resp.status, await resp.text());
      throw new Error(`LLM API error (${resp.status})`);
    }
    const data = await resp.json();
    const result = completeFromLLMChoice(data.choices?.[0]);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const maxDuration = 300;
