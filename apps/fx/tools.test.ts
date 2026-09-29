import { describe, expect, it } from "vitest";
import { TOOL_DESCRIPTIONS } from "@mockintosh/agent";
import type { KernelClient, OperationContract } from "@mockintosh/sdk";
import { kernelAgentTools } from "./tools";

const schema = { type: "object", properties: {} } as const;
const contract = (name: string): OperationContract => ({
  name,
  description: `${name} trap`,
  inputSchema: schema,
  resultSchema: schema,
});

function fakeKernel(results: Record<string, unknown>): KernelClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    describe: () => ["read", "screenshot", "windows", "shell_close"].map(contract),
    async invoke(name) {
      calls.push(name);
      if (!(name in results)) throw new Error(`no ${name}`);
      return results[name];
    },
  };
}

describe("kernel traps as agent tools", () => {
  it("offers the agent traps this session may call, with the agent's descriptions", () => {
    const tools = kernelAgentTools(fakeKernel({}));
    expect(tools.map((tool) => tool.name).sort()).toEqual(["read", "screenshot", "windows"]);
    const read = tools.find((tool) => tool.name === "read")!;
    expect(read.description).toBe(TOOL_DESCRIPTIONS.read);
    expect(read.inputSchema).toEqual(schema);
  });

  it("returns trap results as text", async () => {
    const kernel = fakeKernel({ windows: [{ id: "w1", title: "fx" }] });
    const windows = kernelAgentTools(kernel).find((tool) => tool.name === "windows")!;
    const result = await windows.execute({}, { signal: new AbortController().signal });
    expect(result).toBe('[{"id":"w1","title":"fx"}]');
  });

  it("hands the model a screenshot as a PNG it can see", async () => {
    const frame = { width: 8, height: 2, rowBytes: 2, bytes: [0xff, 0, 0x0f, 0] };
    const screenshot = kernelAgentTools(fakeKernel({ screenshot: frame })).find((tool) => tool.name === "screenshot")!;
    const result = await screenshot.execute({}, { signal: new AbortController().signal });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(JSON.parse(result.text)).toEqual({ width: 8, height: 2 });
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.mimeType).toBe("image/png");
    expect(atob(result.images[0]!.data).slice(1, 4)).toBe("PNG");
  });

  it("turns a failing trap into an error the model can read", async () => {
    const read = kernelAgentTools(fakeKernel({})).find((tool) => tool.name === "read")!;
    const result = await read.execute({ path: "/disk/missing.txt" }, { signal: new AbortController().signal });
    expect(JSON.parse(result as string)).toMatchObject({ error: "failed", message: "no read" });
  });
});
