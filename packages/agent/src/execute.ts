import { jobSchema, parse, ValidationError } from "@mockintosh/protocol";
import type { AgentToolCall, ContentPart } from "@mockintosh/protocol";
import { AGENT_TRAP_SET, HTTP_TOOL_NAMES, READ_ONLY_TOOLS } from "./tools";
import { delay, errorCode, throwIfAborted } from "./signal";
import { encodePackedPngDataUrl, type PackedFrame } from "./png";

export const TOOL_RESULT_MAX = 4000;
export const RESULT_BUDGETS: Record<string, number> = {
  inspect: 8000,
  windows: 4000,
  apps: 4000,
  list: 8000,
  logs: 4000,
};
const EXEMPT = new Set(["read", "read_lines", "search", "build_submit", "build_status", "project_check"]);
const SPILL_DIR = "/disk/System Folder/Preferences/assistant/tool-results";

export type AgentInvoke = (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;

export interface AgentHttp {
  generateImage?(prompt: string): Promise<string>;
}

export interface AgentExecState {
  lastRead: Map<string, number>;
  lastDiagnostics?: string;
  repeatDiagnostic?: boolean;
  installed?: boolean;
  verified?: boolean;
}

export interface ToolExecution {
  content: string;
  vision?: ContentPart[];
}

export function truncateToolResult(value: unknown, budget = TOOL_RESULT_MAX): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n\n[... truncated, ${text.length - budget} more chars]`;
}

export function formatToolError(error: unknown): string {
  if (error instanceof ValidationError) {
    return JSON.stringify({ error: error.code, message: error.message });
  }
  const code = errorCode(error);
  if (code && error instanceof Error) {
    return JSON.stringify({ error: code, message: error.message });
  }
  return JSON.stringify({ error: "failed", message: error instanceof Error ? error.message : String(error) });
}

export async function pollBuild(
  invoke: AgentInvoke,
  id: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let job = parse(jobSchema, await invoke("build_status", { id }, signal));
  while (job.state === "building") {
    try {
      await delay(100, signal);
    } catch (error) {
      if (errorCode(error) === "cancellation") {
        try { await invoke("build_cancel", { id }); } catch { /* already gone */ }
      }
      throw error;
    }
    job = parse(jobSchema, await invoke("build_status", { id }, signal));
  }
  return job;
}

export async function executeToolCall(
  call: AgentToolCall,
  invoke: AgentInvoke,
  signal?: AbortSignal,
  http: AgentHttp = {},
  state: AgentExecState = { lastRead: new Map() },
): Promise<ToolExecution> {
  throwIfAborted(signal);
  if (call.name === "generate_image") {
    const prompt = typeof call.arguments.prompt === "string" ? call.arguments.prompt : "";
    if (!prompt) return { content: JSON.stringify({ error: "Missing prompt" }) };
    if (!http.generateImage) return { content: JSON.stringify({ error: "Image generation is unavailable" }) };
    return { content: await settleResult(invoke, call.id, call.name, await http.generateImage(prompt)) };
  }
  if (!AGENT_TRAP_SET.has(call.name)) {
    return { content: JSON.stringify({ error: "unsupported-operation", message: `Unknown tool: ${call.name}` }) };
  }
  try {
    if (call.name === "edit" || call.name === "write") {
      const blocked = await requireFreshRead(invoke, call, state, signal);
      if (blocked) return { content: blocked };
    }
    let value: unknown;
    if (call.name === "build_submit") {
      const submitted = parse(jobSchema, await invoke("build_submit", call.arguments, signal));
      value = submitted.state !== "building" ? submitted : await pollBuild(invoke, submitted.id, signal);
    } else if (call.name === "screenshot") {
      const frame = await invoke("screenshot", call.arguments, signal) as PackedFrame;
      state.verified = true;
      return {
        content: JSON.stringify({ width: frame.width, height: frame.height }),
        vision: [{ type: "image_url", image_url: { url: encodePackedPngDataUrl(frame) } }],
      };
    } else {
      value = await invoke(call.name, call.arguments, signal);
    }
    await rememberRead(invoke, call, value, state, signal);
    if (call.name === "app_install") state.installed = true;
    if (call.name === "drag" || call.name === "dblclick" || call.name === "pointer") state.verified = true;
    if ((call.name === "write" || call.name === "edit") && typeof call.arguments.path === "string") {
      value = await appendProjectCheck(invoke, call.arguments.path, value, state, signal);
    }
    return { content: await settleResult(invoke, call.id, call.name, value) };
  } catch (error) {
    if (errorCode(error) === "cancellation") throw error;
    return { content: formatToolError(error) };
  }
}

export function isHttpTool(name: string): boolean {
  return HTTP_TOOL_NAMES.has(name);
}

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name) && !isHttpTool(name);
}

async function requireFreshRead(
  invoke: AgentInvoke,
  call: AgentToolCall,
  state: AgentExecState,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const path = typeof call.arguments.path === "string" ? call.arguments.path : "";
  if (!path) return JSON.stringify({ error: "Missing path" });
  if (call.name === "write") {
    try {
      const stat = await invoke("stat", { path }, signal) as { revision: number };
      if (state.lastRead.get(path) !== stat.revision) {
        return JSON.stringify({ error: "conflict", message: "file changed since you read it; read it again" });
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (state.lastRead.get(path) === undefined) {
    return JSON.stringify({ error: "conflict", message: "file changed since you read it; read it again" });
  }
  return undefined;
}

async function rememberRead(
  invoke: AgentInvoke,
  call: AgentToolCall,
  value: unknown,
  state: AgentExecState,
  signal?: AbortSignal,
): Promise<void> {
  const path = typeof call.arguments.path === "string" ? call.arguments.path : "";
  if (!path) return;
  if (call.name === "read_lines" && value && typeof value === "object" && "revision" in value) {
    state.lastRead.set(path, Number((value as { revision: number }).revision));
  }
  if ((call.name === "write" || call.name === "edit" || call.name === "stat") && value && typeof value === "object" && "revision" in value) {
    state.lastRead.set(path, Number((value as { revision: number }).revision));
  }
  if (call.name === "read") {
    try {
      const stat = await invoke("stat", { path }, signal) as { revision: number };
      state.lastRead.set(path, stat.revision);
    } catch { /* source volume or missing */ }
  }
}

async function appendProjectCheck(
  invoke: AgentInvoke,
  path: string,
  value: unknown,
  state: AgentExecState,
  signal?: AbortSignal,
): Promise<unknown> {
  const project = await projectRoot(invoke, path, signal);
  if (!project) return value;
  try {
    const check = await invoke("project_check", { path: project }, signal) as { diagnostics?: unknown };
    if (check.diagnostics) {
      const key = JSON.stringify(check.diagnostics);
      state.repeatDiagnostic = !!state.lastDiagnostics && state.lastDiagnostics === key && key !== "[]";
      state.lastDiagnostics = key;
      return { write: value, diagnostics: check.diagnostics };
    }
  } catch {
    /* typecheck is optional on hosts without a builder */
  }
  return value;
}

async function projectRoot(invoke: AgentInvoke, path: string, signal?: AbortSignal): Promise<string | undefined> {
  const parts = path.split("/");
  while (parts.length > 2) {
    const candidate = parts.join("/");
    try {
      await invoke("stat", { path: `${candidate}/mockintosh.json` }, signal);
      return candidate;
    } catch {
      parts.pop();
    }
  }
  return undefined;
}

async function settleResult(invoke: AgentInvoke, callId: string, name: string, value: unknown): Promise<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (EXEMPT.has(name) || text.length <= (RESULT_BUDGETS[name] ?? TOOL_RESULT_MAX)) return text;
  await ensureSpillDir(invoke);
  // File names hold 28 characters; a call id's random part is at its end.
  const path = `${SPILL_DIR}/${callId.replace(/[^\w.-]/g, "_").slice(-24)}.txt`;
  await invoke("write", { path, body: text });
  return `${text.slice(0, 800)}\n\n[... ${text.length} chars; full result at ${path}]`;
}

async function ensureSpillDir(invoke: AgentInvoke): Promise<void> {
  for (const path of [
    "/disk/System Folder/Preferences/assistant",
    SPILL_DIR,
  ]) {
    try { await invoke("mkdir", { path }); } catch { /* exists */ }
  }
}
