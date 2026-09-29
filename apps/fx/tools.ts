import {
  AGENT_TRAPS,
  TOOL_DESCRIPTIONS,
  executeToolCall,
  type AgentExecState,
  type AgentInvoke,
  type ToolExecution,
} from "@mockintosh/agent";
import type { AgentImage, AgentTool, AgentToolResult, KernelClient } from "@mockintosh/sdk";

/**
 * The kernel traps an agent may call, as runtime tools. Calls go through
 * `executeToolCall`, the path ChatGippity uses: reads before edits, builds
 * awaited to the end, screenshots as pictures the model can see, and long
 * results spilled to a file. Make one set per conversation; the set carries
 * that conversation's read revisions.
 */
export function kernelAgentTools(kernel: KernelClient): AgentTool[] {
  const contracts = new Map(kernel.describe().map((contract) => [contract.name, contract]));
  const state: AgentExecState = { lastRead: new Map() };
  const invoke: AgentInvoke = (name, args, signal) => kernel.invoke(name, args, { signal });
  let calls = 0;
  return AGENT_TRAPS.filter((name) => contracts.has(name)).map((name) => {
    const contract = contracts.get(name)!;
    return {
      name,
      description: TOOL_DESCRIPTIONS[name] ?? contract.description,
      inputSchema: contract.inputSchema as Record<string, unknown>,
      async execute(input, { signal }) {
        calls += 1;
        const execution = await executeToolCall({ id: `fx-${calls}`, name, arguments: input }, invoke, signal, {}, state);
        return toolResult(execution);
      },
    };
  });
}

function toolResult(execution: ToolExecution): AgentToolResult {
  const images: AgentImage[] = [];
  for (const part of execution.vision ?? []) {
    if (part.type !== "image_url") continue;
    const image = imageFromDataUrl(part.image_url.url);
    if (image) images.push(image);
  }
  return images.length ? { text: execution.content, images } : execution.content;
}

function imageFromDataUrl(url: string): AgentImage | null {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(url);
  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}
