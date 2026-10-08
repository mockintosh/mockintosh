/**
 * Phase 0 eval: run the real LLM through runAgent on the headless OS.
 * Skips when there is no AI Gateway credential (AI_GATEWAY_API_KEY or
 * VERCEL_OIDC_TOKEN) or API_ACCESS_TOKEN is unset.
 *
 *   npm run agent:eval
 *   npm run agent:eval -- --task notes
 *
 * Writes scripts/agent-eval-out/<task>/{messages.json,summary.json,histogram.txt}
 */
import { join } from "node:path";
import handler from "../api/chat";
import { withHeadless } from "./companion/headless";
import { runAgent } from "@mockintosh/agent";
import { allAgentTools } from "../src/os/agent/tools";
import type { ChatMessage, CompleteResult, OpenAITool } from "@mockintosh/protocol";
import {
  EVAL_OUT_DIR,
  formatScoreRow,
  inspectNames,
  lastBuildSucceeded,
  lastDiagnostics,
  lastToolResult,
  newAppIds,
  parseTaskFilter,
  toolHistogram,
  writeTaskReport,
  type EvalScore,
  type EvalTaskId,
} from "./agent-eval/report";

const TASKS = [
  {
    id: "counter" as const,
    prompt: "Build a counter app with increment.",
    names: ["counter-increment", "counter-value"],
    drag: false,
  },
  {
    id: "drawing" as const,
    prompt: "Build a drawing app with pencil, eraser, and clear.",
    names: ["tool-pencil", "tool-eraser", "tool-clear"],
    drag: true,
  },
  {
    id: "notes" as const,
    prompt: "Build a notes app that saves a note to the Desktop. Name the save control note-save.",
    names: ["note-save"],
    drag: false,
  },
];

async function complete(messages: ChatMessage[], tools: OpenAITool[]): Promise<CompleteResult> {
  const response = await handler(new Request("http://eval/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.API_ACCESS_TOKEN ?? ""}`,
    },
    body: JSON.stringify({ messages, tools, mode: "build" }),
  }));
  return response.json() as Promise<CompleteResult>;
}

async function tryInvoke(
  invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    return await invoke(name, args);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    console.log("agent:eval skipped (no AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN)");
    return;
  }
  if (!process.env.API_ACCESS_TOKEN) {
    console.log("agent:eval skipped (no API_ACCESS_TOKEN; /api/chat refuses unauthenticated calls)");
    return;
  }
  let filter: EvalTaskId[] | undefined;
  try {
    filter = parseTaskFilter(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }
  const tasks = filter ? TASKS.filter((task) => filter.includes(task.id)) : TASKS;
  const rows: string[] = [];
  for (const task of tasks) {
    const score = await withHeadless(async (os) => {
      const caller = os.kernel.createSession();
      const invoke = (name: string, args: Record<string, unknown> = {}) => os.kernel.invoke(caller, name, args);
      const appsBefore = await invoke("apps") as { id: string }[];
      const before = task.drag ? await invoke("screenshot") as { bytes: number[] } : undefined;
      const result = await runAgent({
        complete,
        invoke,
        tools: allAgentTools(os.kernel),
        messages: [{ role: "user", content: task.prompt }],
      });
      const nodes = await invoke("inspect") as { name?: string }[];
      const named = task.names.every((name) => nodes.some((node) => node.name === name));
      const installedApps = newAppIds(appsBefore, await invoke("apps") as { id: string }[]);
      let painted: boolean | null = null;
      if (task.drag) {
        painted = false;
        try {
          await invoke("drag", { name: "canvas", x: 40, y: 40 });
          const after = await invoke("screenshot") as { bytes: number[] };
          painted = JSON.stringify(after.bytes) !== JSON.stringify(before?.bytes);
        } catch { /* no canvas yet */ }
      }
      const score: EvalScore = {
        compiled: lastBuildSucceeded(result.messages),
        installed: installedApps.length > 0,
        named,
        painted,
      };
      const dir = join(EVAL_OUT_DIR, task.id);
      const historyChars = JSON.stringify(result.messages).length;
      await writeTaskReport(dir, {
        task: task.id,
        prompt: task.prompt,
        reply: result.reply,
        budgetExceeded: result.budgetExceeded,
        cancelled: result.cancelled,
        steps: result.steps,
        historyChars,
        score,
        tools: toolHistogram(result.messages),
        last: {
          diagnostics: lastDiagnostics(result.messages),
          build_submit: lastToolResult(result.messages, "build_submit"),
        },
        installedApps,
        inspectNames: inspectNames(nodes),
        disk: await tryInvoke(invoke, "list", { path: "/disk", recursive: true }),
        desktop: await tryInvoke(invoke, "list", { path: "/disk/Desktop Folder" }),
      }, result.messages);
      return formatScoreRow(task.id, score, result.steps, historyChars, dir);
    });
    rows.push(score);
  }
  console.log(rows.join("\n"));
}

void main();
