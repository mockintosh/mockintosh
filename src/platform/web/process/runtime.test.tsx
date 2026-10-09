import { describe, expect, it } from "vitest";
import { MUSIC_KIT_IDLE, WindowHeader, defineApp, showPrintDialog, type AppContext, type MusicKitState } from "@mockintosh/sdk";
import { getBit, makeRect } from "@mockintosh/quickdraw/bits";
import { PaintRect } from "@mockintosh/quickdraw";
import type { HostToProcess, ProcessStart, ProcessToHost } from "../../../os/process/protocol";
import { runProcess, type ProcessScope } from "./runtime";

/** A worker scope that keeps what the process posts and lets the test post to it. */
function fakeScope() {
  const posted: ProcessToHost[] = [];
  const scope: ProcessScope = {
    postMessage: (message) => void posted.push(message),
    onmessage: null,
  };
  const send = (data: HostToProcess) => scope.onmessage!({ data } as MessageEvent<HostToProcess>);
  return { scope, posted, send };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const START: Omit<ProcessStart, "appId" | "source"> = {
  props: {},
  screen: { width: 512, height: 342 },
  env: { origin: "http://test", config: {} },
  capabilities: [],
  audio: false,
  download: false,
  video: false,
  openers: [],
  sprites: {},
  stats: false,
  fonts: [],
  fontInstall: false,
  microphone: false,
  monitor: false,
  images: false,
  gpu: false,
  videoPlayback: false,
  camera: false,
};

describe("an app process", () => {
  it("draws each of its windows into its own picture and routes input to the right one", async () => {
    const pressed: string[] = [];
    const app = defineApp<{ name?: string; ink?: 0 | 1 }>({
      id: "two-windows",
      title: "Two Windows",
      icon: "x",
      defaultSize: { width: 24, height: 10 },
      Component: (props) => (
        <box width={24} height={10} background={props.ink ?? 0} onMouseDown={() => pressed.push(props.name ?? "?")} />
      ),
      onOpen(ctx) {
        ctx.openWindow({ props: { name: "black", ink: 1 } });
        ctx.openWindow({ props: { name: "white", ink: 0 } });
      },
    });

    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => app);
    send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id } } });
    await settle();

    const opens = posted.filter((m) => m.t === "call" && m.method === "window.open") as Extract<ProcessToHost, { t: "call" }>[];
    expect(opens).toHaveLength(2);
    expect(posted.some((m) => m.t === "started")).toBe(true);
    const [black, white] = opens.map((m) => m.args[0] as string);

    const state = { width: 24, bandWidth: 24, height: 10, active: false, kind: "document" as const, scrollY: 0 };
    send({ t: "window.attach", key: black!, state: { ...state, active: true } });
    send({ t: "window.attach", key: white!, state });
    await settle();

    const frames = posted.filter((m) => m.t === "frame") as Extract<ProcessToHost, { t: "frame" }>[];
    const latest = (key: string) => frames.filter((f) => f.key === key).at(-1)!;
    const pixel = (key: string, x: number, y: number) => {
      const f = latest(key);
      return getBit({ baseAddr: new Uint8Array(f.buffer), rowBytes: f.rowBytes, bounds: { top: 0, left: 0, bottom: f.height, right: f.width } }, x, y);
    };
    expect(latest(black!).width).toBe(24);
    expect(pixel(black!, 5, 5)).toBe(1);
    expect(pixel(white!, 5, 5)).toBe(0);

    const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
    send({ t: "pointer", key: white!, kind: "mousedown", x: 3, y: 3, modifiers, seq: 1 });
    send({ t: "pointer", key: white!, kind: "mouseup", x: 3, y: 3, modifiers, seq: 2 });
    send({ t: "pointer", key: black!, kind: "mousedown", x: 3, y: 3, modifiers, seq: 3 });
    expect(pressed).toEqual(["white", "black"]);

    send({ t: "stop" });
    expect(posted.at(-1)).toEqual({ t: "stopped" });
  });

  it("tells the OS its header's height and draws it above a body of the OS's height, as wide as the band", async () => {
    let headerWidth = 0;
    const app = defineApp({
      id: "with-header",
      title: "H",
      icon: "x",
      defaultSize: { width: 16, height: 20 },
      Component: () => (
        <>
          <WindowHeader height={6}>
            <box width="100%" height={6} background={1} onLayout={({ width }) => (headerWidth = width)} />
          </WindowHeader>
          <box width={16} height={20} background={0} />
        </>
      ),
    });
    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => app);
    send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id } } });
    await settle();
    const open = posted.find((m) => m.t === "call" && m.method === "window.open") as Extract<ProcessToHost, { t: "call" }>;
    const key = open.args[0] as string;
    // The band runs over a 15px scroll bar column beside the body.
    send({ t: "window.attach", key, state: { width: 16, bandWidth: 31, height: 20, active: true, kind: "document", scrollY: 0 } });
    await settle();

    const bands = posted.filter((m) => m.t === "call" && m.method === "window.setBands") as Extract<ProcessToHost, { t: "call" }>[];
    expect(bands.at(-1)!.args).toEqual([key, 6, 0]);
    const frame = (posted.filter((m) => m.t === "frame") as Extract<ProcessToHost, { t: "frame" }>[]).at(-1)!;
    expect(frame.height).toBe(26);
    expect(frame.width).toBe(31);
    expect(headerWidth).toBe(31);
    const bits = { baseAddr: new Uint8Array(frame.buffer), rowBytes: frame.rowBytes, bounds: { top: 0, left: 0, bottom: frame.height, right: frame.width } };
    expect(getBit(bits, 4, 2)).toBe(1);
    expect(getBit(bits, 28, 2)).toBe(1);
    expect(getBit(bits, 4, 10)).toBe(0);
  });

  it("answers openersFor from the OS's table, defaults first, and follows the OS's changes", async () => {
    let os: AppContext["os"] | null = null;
    const app = defineApp({
      id: "viewer",
      title: "Viewer",
      icon: "x",
      defaultSize: { width: 8, height: 8 },
      Component: () => null,
      onOpen(ctx) {
        os = ctx.os;
      },
    });
    const { scope, send } = fakeScope();
    runProcess(scope, async () => app);
    const openers = [
      { appId: "paint", title: "Paint", claims: [{ type: "image/png", rank: "alternate" as const }] },
      { appId: "viewer", title: "Viewer", claims: [{ type: "image/png", rank: "default" as const }] },
    ];
    send({ t: "start", start: { ...START, openers, appId: app.id, source: { kind: "bundled", id: app.id } } });
    await settle();

    expect(os!.openersFor("image/png")).toEqual([
      { appId: "viewer", title: "Viewer", rank: "default" },
      { appId: "paint", title: "Paint", rank: "alternate" },
    ]);
    expect(os!.openersFor("text/plain")).toEqual([]);

    send({ t: "openers", openers: openers.slice(1) });
    expect(os!.openersFor("image/png").map((o) => o.appId)).toEqual(["viewer"]);
  });

  it("gives a kernel client its session: describe here, invoke on the OS with output streamed", async () => {
    let invoked: Promise<unknown> | null = null;
    const out: number[] = [];
    const app = defineApp({
      id: "kernel-client",
      title: "K",
      icon: "x",
      defaultSize: { width: 8, height: 8 },
      Component: () => null,
      onOpen(ctx) {
        expect(ctx.kernel!.describe().map((c) => c.name)).toEqual(["echo"]);
        invoked = ctx.kernel!.invoke("echo", { text: "hi" }, { stdout: (bytes) => out.push(...bytes) });
      },
    });
    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => app);
    const kernel = [{ name: "echo", description: "", inputSchema: {}, resultSchema: {} }];
    send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id }, kernel } });
    await settle();
    const request = posted.find((m) => m.t === "call" && m.method === "kernel.invoke") as Extract<ProcessToHost, { t: "call" }>;
    expect(request.args).toEqual(["echo", { text: "hi" }]);
    send({ t: "kernelStream", id: request.id, stream: "stdout", bytes: new Uint8Array([104, 105]) });
    send({ t: "reply", id: request.id, ok: true, value: "done" });
    await expect(invoked).resolves.toBe("done");
    expect(out).toEqual([104, 105]);
  });

  it("gives the app MusicKit's state, listens on first ask, and sends its calls to the OS", async () => {
    let musicKit: AppContext["musicKit"];
    const seen: MusicKitState[] = [];
    const app = defineApp({
      id: "music-client",
      title: "M",
      icon: "x",
      defaultSize: { width: 8, height: 8 },
      Component: () => null,
      onOpen(ctx) {
        musicKit = ctx.musicKit;
      },
    });
    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => app);
    send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id }, musicKit: MUSIC_KIT_IDLE } });
    await settle();
    expect(musicKit!.state).toEqual(MUSIC_KIT_IDLE);
    expect(posted.some((m) => m.t === "call" && m.method === "musicKit.listen")).toBe(false);

    musicKit!.onChange((state) => seen.push(state));
    expect(posted.filter((m) => m.t === "call" && m.method === "musicKit.listen")).toHaveLength(1);
    const playing = { ...MUSIC_KIT_IDLE, ready: true, playing: true, time: 3 };
    send({ t: "musicKit", state: playing });
    expect(seen).toEqual([playing]);
    expect(musicKit!.state).toEqual(playing);

    const queued = musicKit!.setQueue({ songs: ["1", "2"], startPlaying: true });
    const request = posted.find((m) => m.t === "call" && m.method === "musicKit.setQueue") as Extract<ProcessToHost, { t: "call" }>;
    expect(request.args).toEqual([{ songs: ["1", "2"], startPlaying: true }]);
    send({ t: "reply", id: request.id, ok: true, value: undefined });
    await expect(queued).resolves.toBeUndefined();
  });

  it("gives an app no MusicKit when the OS holds none", async () => {
    let musicKit: AppContext["musicKit"] | "unset" = "unset";
    const app = defineApp({
      id: "no-music",
      title: "N",
      icon: "x",
      defaultSize: { width: 8, height: 8 },
      Component: () => null,
      onOpen(ctx) {
        musicKit = ctx.musicKit;
      },
    });
    const { scope, send } = fakeScope();
    runProcess(scope, async () => app);
    send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id } } });
    await settle();
    expect(musicKit).toBeUndefined();
  });

  it("draws a page for printPage here and hands the OS the finished bits", async () => {
    const app = defineApp({
      id: "page-printer",
      title: "P",
      icon: "x",
      defaultSize: { width: 8, height: 8 },
      Component: () => null,
      onOpen(ctx) {
        void ctx.print!.printPage(12, (_port, size) => {
          expect(size).toEqual({ width: 64, height: 12 });
          PaintRect(makeRect(0, 0, 4, 8));
        });
      },
    });
    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => app);
    send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id }, print: { paperWidth: 64, connected: true } } });
    await settle();
    const request = posted.find((m) => m.t === "call" && m.method === "print.printPage") as Extract<ProcessToHost, { t: "call" }>;
    const [page, height] = request.args as [{ baseAddr: Uint8Array; rowBytes: number; width: number; height: number }, number];
    expect(height).toBe(12);
    expect(page.width).toBe(64);
    const bits = { baseAddr: page.baseAddr, rowBytes: page.rowBytes, bounds: { top: 0, left: 0, bottom: page.height, right: page.width } };
    expect(getBit(bits, 2, 2)).toBe(1);
    expect(getBit(bits, 20, 8)).toBe(0);
  });

  describe("a window whose props hold functions", () => {
    /** A worker scope that clones what it posts, as the real boundary does: a function can't cross it. */
    function cloningScope() {
      const { scope, posted, send } = fakeScope();
      const post = scope.postMessage;
      scope.postMessage = (message, transfer) => post(structuredClone(message), transfer);
      return { scope, posted, send };
    }

    const windowOpen = (posted: ProcessToHost[]) =>
      posted.find((m) => m.t === "call" && m.method === "window.open") as Extract<ProcessToHost, { t: "call" }> | undefined;

    it("opens, telling the OS only the plain props it matches windows by", async () => {
      let received: Record<string, unknown> = {};
      const app = defineApp({
        id: "dialog-props",
        title: "D",
        icon: "x",
        defaultSize: { width: 8, height: 8 },
        Component: () => null,
        onOpen(ctx) {
          ctx.openWindow({
            title: "Settings",
            props: { fileId: "f1", count: 2, onDone: () => {}, nested: { onDone: () => {} }, picture: new Uint8Array(4) },
            Component: (props) => {
              received = props;
              return null;
            },
          });
        },
      });
      const { scope, posted, send } = cloningScope();
      runProcess(scope, async () => app);
      send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id } } });
      await settle();

      const request = windowOpen(posted);
      expect(posted.some((m) => m.t === "failed")).toBe(false);
      expect(request?.args[1]).toEqual({ title: "Settings", props: { fileId: "f1", count: 2 }, hasGoAway: false });
      // The component keeps all of its props, functions included, in the worker.
      send({ t: "window.attach", key: request!.args[0] as string, state: { width: 8, bandWidth: 8, height: 8, active: true, kind: "document", scrollY: 0 } });
      await settle();
      expect(typeof received.onDone).toBe("function");
    });

    it("opens the Print dialog, whose props hold the function that settles it", async () => {
      const app = defineApp({
        id: "printer-dialog",
        title: "P",
        icon: "x",
        defaultSize: { width: 8, height: 8 },
        Component: () => null,
        onOpen(ctx) {
          void showPrintDialog(ctx, { image: { width: 4, height: 4, data: new Uint8Array(16) }, documentName: "Map" });
        },
      });
      const { scope, posted, send } = cloningScope();
      runProcess(scope, async () => app);
      send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id }, print: { paperWidth: 64, connected: false } } });
      await settle();

      expect(posted.some((m) => m.t === "failed")).toBe(false);
      expect((windowOpen(posted)?.args[1] as { kind?: string } | undefined)?.kind).toBe("alert");
    });
  });

  it("reports an app it can't load", async () => {
    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => undefined);
    send({ t: "start", start: { ...START, appId: "missing", source: { kind: "bundled", id: "missing" } } });
    await settle();
    expect(posted).toEqual([{ t: "failed", error: "No app module for missing" }]);
  });
});
