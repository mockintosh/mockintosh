import { describe as suite, expect, it, vi } from "vitest";
import type { AppProcesses } from "../../platform/types";
import { describeApp } from "./describe";
import type { HostToProcess, ProcessPort, ProcessToHost } from "./protocol";

function processes(answer: (request: Extract<HostToProcess, { t: "describe" }>) => ProcessToHost) {
  const terminate = vi.fn();
  const spawn = vi.fn((): ProcessPort => {
    const port: ProcessPort = {
      onmessage: null,
      onerror: null,
      terminate,
      postMessage(message) {
        const reply = answer(message as Extract<HostToProcess, { t: "describe" }>);
        queueMicrotask(() => port.onmessage?.({ data: reply }));
      },
    };
    return port;
  });
  const host: AppProcesses = { defaultRuntime: "worker", canRun: () => true, spawn };
  return { host, spawn, terminate };
}

suite("describing an app in a process", () => {
  it("returns the declaration the process read, and ends the process", async () => {
    const { host, terminate } = processes((request) => ({
      t: "described",
      declaration: { id: request.appId, title: "Remote", icon: "x", defaultSize: { width: 1, height: 1 } },
    }));
    const declaration = await describeApp(host, "remote", { kind: "url", url: "https://apps.example/remote.js" });
    expect(declaration.title).toBe("Remote");
    expect(terminate).toHaveBeenCalled();
  });

  it("fails with the process's error, and ends the process", async () => {
    const { host, terminate } = processes(() => ({ t: "failed", error: "No default export" }));
    await expect(describeApp(host, "broken", { kind: "code", code: "", identity: "b" })).rejects.toThrow("No default export");
    expect(terminate).toHaveBeenCalled();
  });
});
