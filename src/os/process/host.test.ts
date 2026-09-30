import { describe, expect, it, vi } from "vitest";
import type { AppContext, WindowSpec } from "@mockintosh/sdk";
import type { OSServices } from "../context";
import { AppProcess } from "./host";
import type { HostToProcess, ProcessPort, ProcessToHost } from "./protocol";

function fakePort() {
  const posted: { message: HostToProcess; transfer?: unknown[] }[] = [];
  const port: ProcessPort = {
    postMessage: (message, transfer) => void posted.push({ message: message as HostToProcess, transfer }),
    onmessage: null,
    onerror: null,
    terminate: vi.fn(),
  };
  const receive = (data: ProcessToHost) => port.onmessage!({ data });
  return { port, posted, receive };
}

function setup() {
  const { port, posted, receive } = fakePort();
  const opened: WindowSpec[] = [];
  const release = vi.fn();
  const storage = { read: vi.fn(async (key: string) => `stored ${key}`) };
  const kernel = {
    describe: () => [{ name: "echo", description: "", inputSchema: {}, resultSchema: {} }],
    invoke: vi.fn(async (_name: string, _args: unknown, options?: { stdout?: (b: Uint8Array) => void }) => {
      options?.stdout?.(new Uint8Array([104, 105]));
      return { ok: true };
    }),
  };
  const context = {
    kernel,
    capabilities: new Set(),
    keepAlive: vi.fn(() => release),
    openWindow: vi.fn((spec: WindowSpec) => {
      opened.push(spec);
      return `os-window-${opened.length}`;
    }),
    storage,
    fonts: { register: vi.fn(), list: () => [], onChange: () => () => {} },
    quit: vi.fn(),
    os: { showDialog: vi.fn(async () => "OK") },
  } as unknown as AppContext;
  const os = {
    resolution: { width: 512, height: 342 },
    env: { origin: "http://test", config: {} },
    sprites: { all: () => ({}) },
    fs: { volumes: () => [], node: () => undefined, children: () => [] },
    scheduler: { now: () => 0 },
    beforeFrame: () => () => {},
    instances: { note: vi.fn(), fail: vi.fn(), stop: vi.fn() },
    showDialog: vi.fn(async () => "OK"),
    closeWindow: vi.fn(),
  } as unknown as OSServices;
  const component = () => null as never;
  const proc = new AppProcess({
    port,
    appId: "test",
    instanceId: "instance-1",
    source: { kind: "bundled", id: "test" },
    props: { fileId: "f1" },
    context,
    os,
    windowComponent: () => component,
  });
  return { proc, port, posted, receive, context, os, opened, release, storage, component };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AppProcess", () => {
  it("starts the worker with the launch and holds the launch until onOpen has run", () => {
    const { posted, receive, context, release } = setup();
    const start = posted[0]!.message;
    expect(start.t).toBe("start");
    expect(start.t === "start" && start.start.props).toEqual({ fileId: "f1" });
    expect(context.keepAlive).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    receive({ t: "started" });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("opens an OS window for a window the app opens, with the process's content", () => {
    const { proc, receive, opened, component } = setup();
    receive({ t: "call", id: 0, method: "window.open", args: ["window-1", { title: "Doc", props: { a: 1 }, hasGoAway: true }] });
    expect(opened).toHaveLength(1);
    expect(opened[0]!.title).toBe("Doc");
    expect(opened[0]!.Component).toBe(component);
    expect(typeof opened[0]!.onGoAway).toBe("function");
    expect(proc.windows.get("window-1")?.osId).toBe("os-window-1");
  });

  it("answers a call with the instance's context", async () => {
    const { posted, receive, storage } = setup();
    receive({ t: "call", id: 7, method: "storage.read", args: ["prefs"] });
    await settle();
    expect(storage.read).toHaveBeenCalledWith("prefs");
    expect(posted.at(-1)!.message).toEqual({ t: "reply", id: 7, ok: true, value: "stored prefs" });
  });

  it("replies with the error when a call fails", async () => {
    const { posted, receive } = setup();
    receive({ t: "call", id: 8, method: "nonsense", args: [] });
    await settle();
    expect(posted.at(-1)!.message).toEqual({ t: "reply", id: 8, ok: false, error: "Unknown call nonsense" });
  });

  it("runs a kernel trap for the app, streaming its output back", async () => {
    const { posted, receive } = setup();
    expect(posted[0]!.message.t === "start" && posted[0]!.message.start.kernel?.[0]?.name).toBe("echo");
    receive({ t: "call", id: 9, method: "kernel.invoke", args: ["echo", { text: "hi" }] });
    await settle();
    const messages = posted.map((p) => p.message);
    expect(messages).toContainEqual({ t: "kernelStream", id: 9, stream: "stdout", bytes: new Uint8Array([104, 105]) });
    expect(messages.at(-1)).toEqual({ t: "reply", id: 9, ok: true, value: { ok: true } });
  });

  it("asks the worker to stop, then terminates it when it has", () => {
    const { proc, port, posted, receive } = setup();
    proc.stop();
    expect(posted.at(-1)!.message).toEqual({ t: "stop" });
    receive({ t: "stopped" });
    expect(port.terminate).toHaveBeenCalled();
  });
});
