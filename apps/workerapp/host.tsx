/**
 * The main-thread half of a worker-hosted app. `defineWorkerApp` returns an
 * ordinary `SolidApp` whose window starts a Worker, shows the frames it posts
 * through `<raster>`, sends it input, and answers its calls with this
 * window's real `useApp()` services. One worker per window.
 *
 * The Worker menu shows how long frames take and how long input takes to
 * reach the screen, so the app can be compared with its main-thread twin.
 */
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { CopyBits, srcCopy, type BitMap } from "@mockintosh/quickdraw";
import { makeRect } from "@mockintosh/quickdraw/bits";
import { heldModifiers, useUIServices, type CursorSpec, type JSX, type Modifiers } from "@mockintosh/ui";
import {
  defineApp,
  useApp,
  type AppFileSystem,
  type AppServices,
  type AudioPortOptions,
  type AudioPortStream,
  type MenubarDefinition,
  type MenubarItemDef,
  type SolidApp,
  type VideoExcerpt,
  type VideoExcerptRequest,
} from "@mockintosh/sdk";
import type { Sprite } from "@mockintosh/ui";
import type { FSNode } from "@mockintosh/fs";
import type { FsSnapshot, HostToWorker, KeyKind, PointerKind, WireMenu, WireMenuItem, WorkerToHost } from "./protocol";

export interface WorkerAppSpec extends Omit<SolidApp, "Component" | "onOpen" | "menus"> {
  /** Start the worker that runs the app; it calls `runWorkerApp`. */
  createWorker(): Worker;
  /** Where the first window opens. */
  position?: { x: number; y: number };
  /** Appended to the title the app sets, so the twins can be told apart. */
  titleSuffix?: string;
  /**
   * Sprites the app looks up by name that aren't in its own `sprites` — OS
   * icons, other apps' icons. Resolved here and sent once; the worker has no
   * sprite registry of its own.
   */
  spriteNames?: readonly string[];
}

function fsSnapshot(fs: AppFileSystem): FsSnapshot {
  const volumes = fs.volumes();
  const rootId = volumes[0]?.parentId;
  if (!rootId) return { rootId: "", nodes: [] };
  const nodes: FSNode[] = [];
  const root = fs.node(rootId);
  if (root) nodes.push({ ...root });
  const walk = (node: FSNode): void => {
    nodes.push({ ...node });
    if (node.kind === "directory") for (const child of fs.children(node.id)) walk(child);
  };
  for (const volume of volumes) walk(volume);
  return { rootId, nodes };
}

/** A call result that moves objects (a `MessagePort`) to the worker instead of copying them. */
class Transfer {
  constructor(readonly value: unknown, readonly transfer: Transferable[]) {}
}

/** Store proxies don't survive structured clone; plain copies do. */
function cloneable(value: unknown): unknown {
  if (value instanceof Uint8Array || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneable);
  return { ...value };
}

class Samples {
  private values: number[] = [];
  add(value: number): void {
    this.values.push(value);
    if (this.values.length > 1000) this.values.shift();
  }
  get count(): number {
    return this.values.length;
  }
  summary(): string {
    if (this.values.length === 0) return "—";
    const sorted = [...this.values].sort((a, b) => a - b);
    const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    return `avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`;
  }
  reset(): void {
    this.values = [];
  }
}

function WorkerWindow(props: { spec: WorkerAppSpec; launch: Record<string, unknown> }): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { clipboard } = useUIServices();
  const worker = props.spec.createWorker();
  onCleanup(() => worker.terminate());

  let frame: BitMap | null = null;
  let frameSeq = 0;
  let bytes = 0;
  const [revision, setRevision] = createSignal(0, { ownedWrite: true });
  const [cursor, setCursor] = createSignal<CursorSpec | undefined>(undefined, { ownedWrite: true });
  const [menus, setWireMenus] = createSignal<WireMenu[]>([], { ownedWrite: true });

  const stats = { worker: new Samples(), blit: new Samples(), latency: new Samples(), audio: new Samples(), frames: 0 };

  const videoLoads = new Map<number, AbortController>();
  onCleanup(() => videoLoads.forEach((load) => load.abort()));

  /** Decode here, and copy the excerpt to the worker as it fills: the partial excerpt, then each new picture. */
  async function excerpt(id: number, url: string, request: Omit<VideoExcerptRequest, "onPartial" | "onProgress" | "signal">): Promise<null> {
    const decode = app.video?.excerpt;
    if (!decode) throw new Error("This Macintosh can't decode video");
    const load = new AbortController();
    videoLoads.set(id, load);
    let filling: VideoExcerpt | null = null;
    let sent: number[] = [];
    const flushPictures = (fraction: number) => {
      if (!filling) return;
      const pictures: { clip: number; picture: VideoExcerpt["clips"][number]["pictures"][number] }[] = [];
      filling.clips.forEach((clip, i) => {
        while (sent[i]! < clip.pictures.length) pictures.push({ clip: i, picture: clip.pictures[sent[i]!++]! });
      });
      send({ t: "video", event: { id, kind: "progress", fraction, pictures } });
    };
    try {
      await decode.call(app.video, url, {
        ...request,
        signal: load.signal,
        onPartial: (partial) => {
          filling = partial;
          sent = partial.clips.map((clip) => clip.pictures.length);
          const copy: VideoExcerpt = {
            width: partial.width,
            height: partial.height,
            fps: partial.fps,
            clips: partial.clips.map((clip) => ({ ...clip, pictures: [...clip.pictures] })),
          };
          send({ t: "video", event: { id, kind: "partial", excerpt: copy } });
        },
        onProgress: flushPictures,
      });
      flushPictures(1);
      return null;
    } finally {
      videoLoads.delete(id);
    }
  }

  const audioStreams = new Map<number, AudioPortStream>();
  let audioIds = 0;
  const audioState = (id: number, stream: AudioPortStream) =>
    send({ t: "audio", streamId: id, state: stream.state(), latencyFrames: stream.outputLatencyFrames() });
  // Output latency settles after the device starts; keep the worker's playback position honest.
  const latencyTimer = setInterval(() => audioStreams.forEach((stream, id) => audioState(id, stream)), 1000);
  onCleanup(() => {
    clearInterval(latencyTimer);
    audioStreams.forEach((stream) => stream.close());
    audioStreams.clear();
  });
  let seq = 0;
  const sentAt = new Map<number, number>();
  let lastX = 0;
  let lastY = 0;

  const send = (message: HostToWorker): void => worker.postMessage(message);

  function pointer(kind: PointerKind, x: number, y: number, deltaY?: number): void {
    lastX = x;
    lastY = y;
    seq++;
    sentAt.set(seq, performance.now());
    send({ t: "pointer", kind, x, y, deltaY, modifiers: heldModifiers(), seq });
  }

  function key(kind: KeyKind, value: string, modifiers: Modifiers): void {
    seq++;
    sentAt.set(seq, performance.now());
    send({ t: "key", kind, key: value, modifiers, seq });
  }

  const services = app as AppServices;
  async function dispatch(method: string, args: unknown[]): Promise<unknown> {
    const [scope, name] = method.split(".") as [string, string | undefined];
    switch (scope) {
      case "fs":
        return (app.fs as unknown as Record<string, (...a: unknown[]) => unknown>)[name!]!(...args);
      case "storage":
        return (app.storage as unknown as Record<string, (...a: unknown[]) => unknown>)[name!]!(...args);
      case "clipboard":
        if (!clipboard) throw new Error("This Macintosh has no clipboard");
        return name === "readText" ? clipboard.readText() : clipboard.writeText(args[0] as string);
      case "print":
        if (!app.print) throw new Error("This Macintosh has no printer");
        return name === "connect"
          ? app.print.connect()
          : app.print.printPicture(args[0] as Parameters<typeof app.print.printPicture>[0], args[1] as never);
      case "os":
        if (name === "showDialog") return app.os.showDialog(args[0] as Parameters<typeof app.os.showDialog>[0]);
        if (name === "openApp") return app.os.openApp(args[0] as string, args[1] as Record<string, unknown>);
        if (name === "closeWindow") return app.os.closeWindow(args[0] as string);
        break;
      case "window":
        if (name === "setTitle") return win.setTitle(`${args[0]}${props.spec.titleSuffix ?? ""}`);
        if (name === "setContentSize") return win.setContentSize(args[0] as number, args[1] as number);
        if (name === "setFullScreen") return win.setFullScreen(args[0] as boolean);
        if (name === "close") return win.close();
        break;
      case "audio": {
        if (name === "close") {
          audioStreams.get(args[0] as number)?.close();
          audioStreams.delete(args[0] as number);
          return;
        }
        const openPort = app.audio?.openPort;
        if (!openPort) throw new Error("This Macintosh's speaker can't be reached from a worker");
        const stream = await openPort.call(app.audio, args[0] as AudioPortOptions);
        const streamId = ++audioIds;
        audioStreams.set(streamId, stream);
        stream.onStateChange(() => audioState(streamId, stream));
        const port = stream.port as MessagePort;
        return new Transfer(
          {
            streamId,
            sampleRate: stream.sampleRate,
            channels: stream.channels,
            target: stream.target,
            latencyFrames: stream.outputLatencyFrames(),
            state: stream.state(),
            port,
          },
          [port],
        );
      }
      case "video":
        if (name === "abort") {
          videoLoads.get(args[0] as number)?.abort();
          return;
        }
        return excerpt(args[0] as number, args[1] as string, args[2] as VideoExcerptRequest);
      case "download":
        if (!app.download) throw new Error("This Macintosh can't save files to the host");
        return app.download.save(args[0] as Parameters<typeof app.download.save>[0]);
      case "quit":
        return services.quit();
      case "error":
        console.error(`[${props.spec.title}]`, args[0]);
        return;
    }
    throw new Error(`Unknown call ${method}`);
  }

  function handleCall(id: number, method: string, args: unknown[]): void {
    dispatch(method, args).then(
      (value) => {
        if (!id) return;
        if (value instanceof Transfer) worker.postMessage({ t: "reply", id, ok: true, value: value.value }, value.transfer);
        else send({ t: "reply", id, ok: true, value: cloneable(value) });
      },
      (error: unknown) => id && send({ t: "reply", id, ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  }

  worker.onmessage = (event: MessageEvent<WorkerToHost>) => {
    const msg = event.data;
    switch (msg.t) {
      case "frame":
        frame = {
          baseAddr: new Uint8Array(msg.buffer),
          rowBytes: msg.rowBytes,
          bounds: makeRect(0, 0, msg.height, msg.width),
        };
        frameSeq = msg.seq;
        bytes = msg.buffer.byteLength;
        stats.frames++;
        stats.worker.add(msg.frameMs);
        for (const ms of msg.audioMs) stats.audio.add(ms);
        setRevision((r) => r + 1);
        return;
      case "cursor":
        setCursor(msg.cursor);
        return;
      case "menus":
        setWireMenus(msg.menus);
        return;
      case "call":
        handleCall(msg.id, msg.method, msg.args);
        return;
    }
  };
  worker.onerror = (event) => {
    void app.os.showDialog({ message: `${props.spec.title} stopped: ${event.message}` });
  };

  let sentW = untrack(() => win.width());
  let sentH = untrack(() => win.height());
  send({
    t: "init",
    init: {
      appId: props.spec.id,
      windowId: win.id,
      props: JSON.parse(JSON.stringify(props.launch ?? {})) as Record<string, unknown>,
      width: sentW,
      height: sentH,
      active: untrack(() => win.isActive()),
      env: { origin: app.env.origin, config: JSON.parse(JSON.stringify(app.env.config)) as Record<string, string> },
      capabilities: [...app.capabilities],
      audio: typeof app.audio?.openPort === "function",
      download: app.download !== undefined,
      video: typeof app.video?.excerpt === "function",
      sprites: Object.fromEntries(
        (props.spec.spriteNames ?? []).flatMap((name) => {
          const sprite = app.getSprite(name);
          return sprite ? [[name, sprite] as [string, Sprite]] : [];
        }),
      ),
      kind: untrack(() => win.kind()),
      print: app.print && { paperWidth: app.print.paperWidth, connected: untrack(() => app.print!.connected()) },
    },
  });

  createEffect(
    () => ({ width: win.width(), height: win.height() }),
    ({ width, height }) => {
      if (width === sentW && height === sentH) return;
      sentW = width;
      sentH = height;
      send({ t: "resize", width, height });
    },
  );
  createEffect(
    () => win.kind(),
    (kind) => send({ t: "kind", kind }),
  );
  createEffect(
    () => win.isActive(),
    (value) => send({ t: "active", value }),
  );
  createEffect(
    () => fsSnapshot(app.fs),
    (snapshot) => send({ t: "fs", snapshot }),
  );
  createEffect(
    () => app.print?.connected() ?? false,
    (connected) => send({ t: "printer", connected }),
  );

  function unwire(items: WireMenuItem[]): MenubarItemDef[] {
    return items.map((item): MenubarItemDef => {
      switch (item.type) {
        case "separator":
          return { type: "separator" };
        case "submenu":
          return { type: "submenu", label: item.label, disabled: item.disabled, items: unwire(item.items) };
        case "radiogroup":
          return {
            type: "radiogroup",
            value: item.value,
            items: item.items,
            onValueChange: (value) => send({ t: "menu", action: item.action, value }),
          };
        default: {
          const action = item.action;
          return {
            label: item.label,
            shortcut: item.shortcut,
            disabled: item.disabled,
            checked: item.checked,
            onClick: action === undefined ? undefined : () => send({ t: "menu", action }),
          };
        }
      }
    });
  }

  function showPerformance(): void {
    const lines = [
      `${stats.frames} frames, ${(bytes / 1024).toFixed(1)} KB each`,
      `Worker draw: ${stats.worker.summary()}`,
      `Main blit: ${stats.blit.summary()}`,
      `Input to screen: ${stats.latency.summary()}`,
      ...(stats.audio.count > 0 ? [`Audio chunk: ${stats.audio.summary()}`] : []),
    ];
    console.table({
      workerFrame: stats.worker.summary(),
      mainBlit: stats.blit.summary(),
      inputToScreen: stats.latency.summary(),
      audioRender: stats.audio.summary(),
    });
    void app.os.showDialog({ message: lines.join("\n"), variant: "note" });
  }

  const workerMenu: MenubarDefinition = {
    label: "Worker",
    items: [
      { label: "Performance…", onClick: showPerformance },
      {
        label: "Reset Counters",
        onClick: () => {
          stats.worker.reset();
          stats.blit.reset();
          stats.latency.reset();
          stats.audio.reset();
          stats.frames = 0;
        },
      },
    ],
  };

  createEffect(
    () => menus(),
    (wire) => app.setMenus([...wire.map((m) => ({ label: m.label, items: unwire(m.items) })), workerMenu]),
  );

  return (
    <raster
      width={win.width()}
      height={win.height()}
      revision={revision()}
      cursor={cursor()}
      tabIndex={0}
      autoFocus
      semantic={{ name: "worker-app", role: "canvas" }}
      onPaint={(surface) => {
        const start = performance.now();
        const { x, y, width, height } = surface.rect;
        // Clearing goes pixel by pixel; only a frame that doesn't cover the raster (mid-resize) needs it.
        if (!frame || frame.bounds.right < width || frame.bounds.bottom < height) surface.fill(0);
        if (frame) {
          const w = frame.bounds.right;
          const h = frame.bounds.bottom;
          CopyBits(frame, surface.port.portBits, frame.bounds, makeRect(y, x, y + h, x + w), srcCopy, null);
        }
        const end = performance.now();
        stats.blit.add(end - start);
        performance.measure("worker-app:blit", { start, end });
        for (const [s, at] of sentAt) {
          if (s > frameSeq) continue;
          stats.latency.add(end - at);
          sentAt.delete(s);
        }
      }}
      onMouseDown={(x, y) => pointer("mousedown", x, y)}
      onDoubleClick={(x, y) => pointer("dblclick", x, y)}
      onMouseMove={(x, y) => pointer("mousemove", x, y)}
      onDrag={(x, y) => pointer("mousemove", x, y)}
      onMouseUp={(x, y) => pointer("mouseup", x, y)}
      onScroll={(deltaY) => pointer("scroll", lastX, lastY, deltaY)}
      onKeyDown={(k, mods) => key("keydown", k, mods)}
      onKeyUp={(k, mods) => key("keyup", k, mods)}
      onKeyPress={(ch) => key("keypress", ch, heldModifiers())}
    />
  );
}

export function defineWorkerApp(spec: WorkerAppSpec): SolidApp {
  return defineApp({
    ...spec,
    Component: (launch: Record<string, unknown>) => <WorkerWindow spec={spec} launch={launch} />,
    onOpen(app, props) {
      app.openWindow({ props, position: spec.position });
    },
  });
}
