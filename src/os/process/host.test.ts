import { describe, expect, it, vi } from "vitest";
import { MUSIC_KIT_IDLE, type AppContext, type MusicKitError, type MusicKitService, type MusicKitState, type WindowSpec } from "@mockintosh/sdk";
import type { OSServices } from "../context";
import { registerApp, unregisterApp } from "../apps";
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

function setup(extra: Partial<AppContext> = {}) {
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
    ...extra,
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

/** A MusicKit the test drives: `change` and `fail` play the page's events. */
function fakeMusicKit() {
  const changes = new Set<(state: MusicKitState) => void>();
  const errors = new Set<(error: MusicKitError) => void>();
  const musicKit = {
    state: MUSIC_KIT_IDLE,
    onChange: (listener: (state: MusicKitState) => void) => (changes.add(listener), () => void changes.delete(listener)),
    onError: (listener: (error: MusicKitError) => void) => (errors.add(listener), () => void errors.delete(listener)),
    setQueue: vi.fn(async () => {}),
    setVolume: vi.fn(),
    openSignUp: vi.fn(async () => {}),
  } as unknown as MusicKitService;
  return {
    musicKit,
    change: (state: MusicKitState) => changes.forEach((listener) => listener(state)),
    fail: (error: MusicKitError) => errors.forEach((listener) => listener(error)),
  };
}

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

  it("starts the worker with MusicKit's state, and sends each change once the app listens, until it stops", () => {
    const { musicKit, change, fail } = fakeMusicKit();
    const { proc, posted, receive } = setup({ musicKit });
    expect(posted[0]!.message.t === "start" && posted[0]!.message.start.musicKit).toEqual(MUSIC_KIT_IDLE);
    const playing = { ...MUSIC_KIT_IDLE, ready: true, playing: true, time: 12 };
    change(playing);
    expect(posted.map((p) => p.message.t)).not.toContain("musicKit");

    receive({ t: "call", id: 0, method: "musicKit.listen", args: [] });
    change(playing);
    const refused = { message: "Apple Music membership required", membershipRequired: true };
    fail(refused);
    expect(posted.map((p) => p.message)).toContainEqual({ t: "musicKit", state: playing });
    expect(posted.map((p) => p.message)).toContainEqual({ t: "musicKitError", error: refused });

    proc.stop();
    const sent = posted.length;
    change({ ...playing, time: 13 });
    expect(posted.slice(sent).map((p) => p.message.t)).not.toContain("musicKit");
  });

  it("drives MusicKit for the app by name", async () => {
    const { musicKit } = fakeMusicKit();
    const { posted, receive } = setup({ musicKit });
    receive({ t: "call", id: 11, method: "musicKit.setQueue", args: [{ playlist: "pl.1", startPlaying: true }] });
    receive({ t: "call", id: 0, method: "musicKit.setVolume", args: [0.4] });
    receive({ t: "call", id: 12, method: "musicKit.openSignUp", args: [] });
    await settle();
    expect(musicKit.openSignUp).toHaveBeenCalledTimes(1);
    expect(musicKit.setQueue).toHaveBeenCalledWith({ playlist: "pl.1", startPlaying: true });
    expect(musicKit.setVolume).toHaveBeenCalledWith(0.4);
    expect(posted.map((p) => p.message)).toContainEqual({ t: "reply", id: 11, ok: true, value: undefined });
  });

  it("sends the worker which app opens which file type, again when an app is installed", () => {
    const { proc, posted } = setup();
    const start = posted[0]!.message;
    expect(start.t === "start" && start.start.openers.some((o) => o.appId === "pictures")).toBe(false);

    registerApp({ id: "pictures", title: "Pictures", icon: "x", defaultSize: { width: 8, height: 8 }, fileTypes: ["image/png"], Component: () => null });
    try {
      const update = posted.at(-1)!.message;
      expect(update.t === "openers" && update.openers.find((o) => o.appId === "pictures")).toEqual({
        appId: "pictures",
        title: "Pictures",
        claims: [{ type: "image/png", rank: "default" }],
      });
      const sent = posted.length;
      registerApp({ id: "pictures", title: "Pictures", icon: "x", defaultSize: { width: 8, height: 8 }, fileTypes: ["image/png"], Component: () => null });
      expect(posted).toHaveLength(sent);
    } finally {
      unregisterApp("pictures");
    }
    expect(posted.at(-1)!.message.t === "openers").toBe(true);

    proc.stop();
    const stopped = posted.length;
    registerApp({ id: "pictures", title: "Pictures", icon: "x", defaultSize: { width: 8, height: 8 }, fileTypes: ["image/png"], Component: () => null });
    unregisterApp("pictures");
    expect(posted).toHaveLength(stopped);
  });

  it("asks the worker to stop, then terminates it when it has", () => {
    const { proc, port, posted, receive } = setup();
    proc.stop();
    expect(posted.at(-1)!.message).toEqual({ t: "stop" });
    receive({ t: "stopped" });
    expect(port.terminate).toHaveBeenCalled();
  });
});
