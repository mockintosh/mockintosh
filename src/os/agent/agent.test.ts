import { describe, expect, it } from "vitest";
import { withHeadless } from "../../../scripts/companion/headless";
import { counterSource } from "../projects";
import { allAgentTools, openaiToolsFromKernel } from "./tools";
import { runAgent, type CompleteFn } from "./loop";
import { messageText, type ChatMessage, type CompleteResult } from "../../shared/chatProtocol";

const path = "/disk/Applications/AgentCounter.app";
const broken = `${counterSource("agent_counter", "Agent Counter")}\nconst bad: number = "wrong";`;
const fixed = counterSource("agent_counter", "Agent Counter");

function call(id: string, name: string, args: Record<string, unknown> = {}): CompleteResult {
  return { tool_calls: [{ id, name, arguments: args }] };
}

function lastTool(messages: ChatMessage[]): unknown {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool" && messages[i].content) {
      try { return JSON.parse(messageText(messages[i].content)); } catch { return messages[i].content; }
    }
  }
  return null;
}

function scripted(plan: Array<CompleteResult | ((messages: ChatMessage[]) => CompleteResult)>): CompleteFn {
  let i = 0;
  return async (messages) => {
    const step = plan[i++];
    if (!step) return { message: "Done." };
    return typeof step === "function" ? step(messages) : step;
  };
}

describe("ChatGippity agent loop", () => {
  it("creates, fails a build, repairs, installs, and clicks Counter", async () => {
    await withHeadless(async (os) => {
      const caller = os.kernel.createSession();
      const invoke = (name: string, args: Record<string, unknown> = {}) => os.kernel.invoke(caller, name, args);
      const tools = allAgentTools(os.kernel);
      expect(openaiToolsFromKernel(os.kernel).map((t) => t.function.name)).toEqual(
        expect.arrayContaining(["project_create", "write", "build_submit", "app_install", "inspect", "click"])
      );

      const complete = scripted([
        call("1", "project_create", { path, id: "agent_counter", title: "Agent Counter" }),
        call("1b", "read_lines", { path: `${path}/src/index.tsx` }),
        call("2", "write", { path: `${path}/src/index.tsx`, body: broken }),
        call("3", "build_submit", { path }),
        (messages) => {
          const job = lastTool(messages) as { state?: string };
          expect(job.state).toBe("failed");
          return call("4", "write", { path: `${path}/src/index.tsx`, body: fixed });
        },
        call("5", "build_submit", { path }),
        (messages) => {
          const job = lastTool(messages) as { id?: string; state?: string };
          expect(job.state).toBe("succeeded");
          return call("6", "app_install", { path, build: job.id });
        },
        call("7", "inspect", {}),
        call("8", "click", { name: "counter-increment" }),
        { message: "The counter adds one." },
      ]);

      const result = await runAgent({
        complete,
        invoke,
        tools,
        messages: [{ role: "user", content: "Make a counter" }],
        budget: { steps: 16, ms: 60_000 },
      });
      expect(result.budgetExceeded).toBe(false);
      expect(result.cancelled).toBe(false);
      expect(result.reply).toContain("counter");
      const nodes = (await invoke("inspect")) as { name?: string; text: string }[];
      expect(nodes.find((n) => n.name === "counter-value")?.text).toBe("1");
    });
  }, 30000);

  it("stops when the step budget is exceeded", async () => {
    await withHeadless(async (os) => {
      const caller = os.kernel.createSession();
      const names: string[] = [];
      const invoke = (name: string, args: Record<string, unknown> = {}) => {
        names.push(name);
        return os.kernel.invoke(caller, name, args);
      };
      let n = 0;
      const complete: CompleteFn = async () =>
        call(String(++n), "apps", {});
      const result = await runAgent({
        complete,
        invoke,
        tools: allAgentTools(os.kernel),
        messages: [{ role: "user", content: "Go" }],
        budget: { steps: 2, ms: 10_000 },
      });
      expect(result.budgetExceeded).toBe(true);
      expect(names.filter((name) => name === "apps")).toHaveLength(2);
      expect(result.reply).toMatch(/budget/i);
    });
  });

  it("cancels an in-flight build and does not install", async () => {
    await withHeadless(async (os) => {
      const caller = os.kernel.createSession();
      const controller = new AbortController();
      const invoke = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await os.kernel.invoke(caller, name, args);
        if (name === "build_submit") controller.abort();
        return result;
      };
      await os.kernel.invoke(caller, "project_create", { path: "/disk/Applications/Cancel.app", id: "cancel_me", title: "Cancel Me" });
      const complete = scripted([
        call("1", "build_submit", { path: "/disk/Applications/Cancel.app" }),
        call("2", "app_install", { path: "/disk/Applications/Cancel.app", build: "should-not-run" }),
      ]);
      const result = await runAgent({
        complete,
        invoke,
        tools: allAgentTools(os.kernel),
        messages: [{ role: "user", content: "Build it" }],
        signal: controller.signal,
      });
      expect(result.cancelled).toBe(true);
      expect(result.reply).toBe("Stopped.");
      expect(os.services.projects!.selectedBuild("cancel_me")).toBeUndefined();
      const toolCalls = result.messages.filter((m) => m.role === "assistant" && m.tool_calls?.length);
      expect(toolCalls.some((m) => m.tool_calls!.some((c) => c.function.name === "app_install"))).toBe(false);
    });
  }, 30000);

  it("typechecks via project_check and journals instance errors for logs", async () => {
    await withHeadless(async (os) => {
      const caller = os.kernel.createSession();
      const project = "/disk/Applications/Check.app";
      await os.kernel.invoke(caller, "project_create", { path: project, id: "check_me", title: "Check Me", template: "blank" });
      const check = await os.kernel.invoke(caller, "project_check", { path: project }) as { diagnostics: unknown[] };
      expect(check.diagnostics).toEqual([]);
      const instance = os.services.instances!.create("check_me");
      os.services.instances!.note(instance, new Error("handler blew up"), "handler");
      const logs = await os.kernel.invoke(caller, "logs", {}) as { message: string; source: string }[];
      expect(logs.some((row) => row.message === "handler blew up" && row.source === "handler")).toBe(true);
    });
  }, 30000);
});
