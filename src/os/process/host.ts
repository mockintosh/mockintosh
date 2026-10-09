/**
 * The OS half of an app process (docs/worker-apps-plan.md). An `AppProcess`
 * starts the worker for one app instance, opens an OS window for each window
 * the app opens there, and answers the app's calls with the instance's real
 * `AppContext`. The instance owns the process: when it ends, the worker runs
 * its cleanups and is terminated.
 */
import { createEffect, createRoot, untrack } from "solid-js";
import type { BitMap } from "@mockintosh/quickdraw";
import { fontRegistrations, onFontRegistration, type CursorSpec, type UIClipboard, type UIImageService } from "@mockintosh/ui";
import type {
  MusicKitQueueOptions,
  MusicKitRepeatMode,
  MusicKitService,
  MusicKitShuffleMode,
  AppContext,
  AppServices,
  AudioPortOptions,
  AudioPortStream,
  AudioMonitor,
  MicrophonePortInput,
  MicrophonePortOptions,
  MenubarDefinition,
  VideoExcerpt,
  VideoExcerptRequest,
  VideoSource,
  CameraSource,
  WindowSpec,
} from "@mockintosh/sdk";
import type { FSNode } from "@mockintosh/fs";
import type { OSServices } from "../context";
import type { WindowComponent } from "../state";
import { CopyBits, srcCopy } from "@mockintosh/quickdraw";
import { getAllApps, onAppsChanged } from "../apps";
import { openerTable } from "../openerTable";
import { unwireMenus } from "./menus";
import { readSharedFrame, sharedFrameCount } from "./sharedFrame";
import type { AppSource, FsSnapshot, HostToProcess, ProcessPort, ProcessToHost, WindowState, WireMenu, WireWindowSpec } from "./protocol";

export interface AppProcessOptions {
  port: ProcessPort;
  appId: string;
  instanceId: string;
  source: AppSource;
  props: Record<string, unknown>;
  /** The instance's real context: every call the app makes is answered through it. */
  context: AppContext;
  os: OSServices;
  clipboard?: UIClipboard;
  /** Decodes `<image>` sources: bytes, or a URL it fetches. */
  images?: UIImageService;
  /** Appended to every title the app sets (the Webworker twins' " (Worker)"). */
  titleSuffix?: string;
  /** Collect the worker's timings for the Worker menu. */
  stats?: boolean;
  /** Makes the host-side component for one of the process's windows. */
  windowComponent(process: AppProcess, key: string): WindowComponent;
}

/** Timing samples for the Worker menu. */
export class Samples {
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

/** What the host keeps for each of the process's windows. */
export interface ProcessWindowHost {
  key: string;
  /** The OS window's id, once `openWindow` has returned. */
  osId?: string;
  /** The window's services, while its content is mounted. */
  services?: AppServices;
  /** Window calls made before the content mounted; replayed on attach. */
  queued: ((services: AppServices) => void)[];
  frame: BitMap | null;
  frameSeq: number;
  frameBytes: number;
  cursor?: CursorSpec;
  /** The worker's focused control in this window takes raw keys. */
  rawKeys?: boolean;
  menus: MenubarDefinition[];
  /** Rows at the top and bottom of the picture that are the window's header and footer bands. */
  bands: { header: number; footer: number };
  /** Shared memory the worker publishes this window's pictures in, and the last count seen. */
  shared?: { buffer: SharedArrayBuffer; count: number };
  /** Tells the window's content a new frame, cursor or menus arrived. */
  changed?(what: "frame" | "cursor" | "menus" | "bands" | "rawKeys"): void;
}

/** A call result that moves objects (a `MessagePort`) to the worker instead of copying them. */
class Transfer {
  constructor(readonly value: unknown, readonly transfer: unknown[]) {}
}

/** Store proxies don't survive structured clone; plain copies do. */
function cloneable(value: unknown): unknown {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map(cloneable);
  return { ...value };
}

function fsSnapshot(fs: OSServices["fs"]): FsSnapshot {
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

/** How long a stopping worker gets to run its cleanups before it's terminated. */
const STOP_GRACE_MS = 250;

export class AppProcess {
  readonly windows = new Map<string, ProcessWindowHost>();
  readonly stats = {
    worker: new Samples(),
    blit: new Samples(),
    latency: new Samples(),
    audio: new Samples(),
    frames: 0,
    /** From spawning the worker to the OS taking its first picture. */
    firstPictureMs: null as number | null,
  };
  private readonly spawnedAt: number;
  /** Input sent and not yet seen in a frame: seq → time sent. */
  readonly sentAt = new Map<number, number>();
  private seq = 0;
  private readonly port: ProcessPort;
  private readonly context: AppContext;
  private readonly os: OSServices;
  private readonly keepAlives = new Map<number, () => void>();
  private readonly audioStreams = new Map<number, AudioPortStream>();
  private audioIds = 0;
  private readonly microphones = new Map<number, MicrophonePortInput>();
  private readonly monitors = new Map<number, AudioMonitor>();
  private readonly videoLoads = new Map<number, { abort(): void }>();
  private readonly kernelCalls = new Map<number, AbortController>();
  /** Live video and camera sources the app opened, and those it wants a picture of. */
  private readonly media = new Map<number, VideoSource | CameraSource>();
  private readonly mediaWanted = new Set<number>();
  /** Stops the MusicKit pushes, once the app has asked for them. */
  private stopMusicKit: (() => void) | null = null;
  private disposeRoot: () => void = () => {};
  private releaseLaunch: (() => void) | null;
  private latencyTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private removeBeforeFrame: () => void = () => {};
  private removeFontListener: () => void = () => {};
  private removeAppsListener: () => void = () => {};
  private openers = openerTable(getAllApps());

  constructor(private readonly options: AppProcessOptions) {
    this.spawnedAt = options.os.scheduler.now();
    this.port = options.port;
    this.context = options.context;
    this.os = options.os;
    // The launch stays alive until `onOpen` has run in the worker.
    this.releaseLaunch = this.context.keepAlive?.() ?? null;
    this.port.onmessage = (event) => this.receive(event.data as ProcessToHost);
    this.port.onerror = (event) => {
      this.os.instances?.note(options.instanceId, new Error(event.message ?? "The app's worker failed"), "process");
      this.fail(event.message ?? "The app's worker failed");
    };
    const printers = this.os.printers;
    this.send({
      t: "start",
      start: {
        appId: options.appId,
        source: options.source,
        props: JSON.parse(JSON.stringify(options.props ?? {})) as Record<string, unknown>,
        screen: { width: this.os.resolution.width, height: this.os.resolution.height },
        env: { origin: this.os.env.origin, config: JSON.parse(JSON.stringify(this.os.env.config ?? {})) as Record<string, string> },
        capabilities: [...this.context.capabilities],
        print: printers && { paperWidth: printers.paperWidth, connected: untrack(() => printers.connected()) },
        audio: typeof this.context.audio?.openPort === "function",
        download: this.context.download !== undefined,
        signIn: this.context.signIn && { redirectUri: this.context.signIn.redirectUri },
        musicKit: this.context.musicKit?.state,
        video: typeof this.context.video?.excerpt === "function",
        videoPlayback: this.context.video !== undefined,
        camera: this.context.camera !== undefined,
        microphone: typeof this.context.microphone?.openPort === "function",
        monitor: typeof this.context.audio?.monitor === "function",
        images: this.context.images !== undefined,
        gpu: this.context.gpu !== undefined,
        kernel: this.context.kernel ? JSON.parse(JSON.stringify(this.context.kernel.describe())) : undefined,
        openers: this.openers,
        sprites: this.os.sprites.all(),
        stats: !!options.stats,
        fonts: [...fontRegistrations()],
        fontRasterModes: this.context.fontRaster ? [...this.context.fontRaster.modes()] : undefined,
        fontInstall: typeof this.context.fonts.install === "function",
      },
    });
    this.removeFontListener = onFontRegistration((registration) => this.send({ t: "font", registration }));
    this.removeAppsListener = onAppsChanged(() => {
      // Loading an app's code re-registers it with the same claims; send only a change.
      const sent = JSON.stringify(this.openers);
      this.openers = openerTable(getAllApps());
      if (JSON.stringify(this.openers) !== sent) this.send({ t: "openers", openers: this.openers });
    });
    this.removeBeforeFrame = this.os.beforeFrame(() => this.takeSharedFrames());
    createRoot((dispose) => {
      this.disposeRoot = dispose;
      createEffect(
        () => fsSnapshot(this.os.fs),
        (snapshot) => this.send({ t: "fs", snapshot }),
      );
      createEffect(
        () => printers?.connected() ?? false,
        (connected) => this.send({ t: "printer", connected }),
      );
    });
  }

  send(message: HostToProcess, transfer?: unknown[]): void {
    if (this.stopped) return;
    this.port.postMessage(message, transfer);
  }

  /** Send input for window `key`, timed for the Worker menu's latency figure. */
  input(message: Extract<HostToProcess, { t: "pointer" } | { t: "key" } | { t: "paste" }> extends infer M ? M extends { seq: number } ? Omit<M, "seq"> : never : never): void {
    const seq = ++this.seq;
    this.sentAt.set(seq, this.os.scheduler.now());
    this.send({ ...message, seq } as HostToProcess);
  }

  /** The window's content mounted: start drawing it. */
  attach(key: string, services: AppServices, state: WindowState): void {
    const w = this.windows.get(key);
    if (!w) return;
    w.services = services;
    for (const replay of w.queued.splice(0)) replay(services);
    this.send({ t: "window.attach", key, state });
  }

  detach(key: string): void {
    const w = this.windows.get(key);
    if (!w) return;
    this.windows.delete(key);
    this.send({ t: "window.detach", key });
  }

  get appId(): string {
    return this.options.appId;
  }

  /** Open the app's own About box: its code is here, not on the OS's thread. */
  openAbout(title: string, size: { width: number; height: number }): void {
    this.send({ t: "about", title, size });
  }

  /** End the worker now, without waiting for its cleanups: Force Quit, or a stuck app. */
  kill(): void {
    this.stop();
    this.port.terminate();
  }

  /** Stop the worker: its cleanups run, then it's terminated. The instance calls this as it ends. */
  stop(): void {
    if (this.stopped) return;
    this.send({ t: "stop" });
    this.stopped = true;
    this.disposeRoot();
    this.removeBeforeFrame();
    this.removeFontListener();
    this.removeAppsListener();
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    for (const load of this.videoLoads.values()) load.abort();
    for (const call of this.kernelCalls.values()) call.abort();
    for (const source of this.media.values()) source.close();
    this.media.clear();
    for (const stream of this.audioStreams.values()) stream.close();
    this.audioStreams.clear();
    for (const input of this.microphones.values()) input.close();
    this.microphones.clear();
    for (const monitor of this.monitors.values()) monitor.close();
    this.monitors.clear();
    this.stopMusicKit?.();
    this.stopMusicKit = null;
    this.releaseLaunch?.();
    this.releaseLaunch = null;
    for (const release of this.keepAlives.values()) release();
    this.keepAlives.clear();
    setTimeout(() => this.port.terminate(), STOP_GRACE_MS);
  }

  private fail(message: string): void {
    this.os.instances?.fail(this.options.instanceId, new Error(message));
    void this.os.showDialog({ message: `"${this.options.appId}" stopped: ${message}` });
    this.os.instances?.stop(this.options.instanceId);
  }

  private notePicture(): void {
    if (this.stats.firstPictureMs !== null) return;
    this.stats.firstPictureMs = this.os.scheduler.now() - this.spawnedAt;
    if (this.options.stats) console.info(`[process] ${this.options.appId}: first picture ${this.stats.firstPictureMs.toFixed(0)} ms after spawn`);
  }

  /** At the start of the OS's frame: take any picture the worker published since the last one. */
  private takeSharedFrames(): void {
    // A picture for each live source the app asked about since the last one.
    for (const id of this.mediaWanted) {
      const source = this.media.get(id);
      const frame = source?.frame();
      if (!source || !frame) continue;
      this.mediaWanted.delete(id);
      const rgba = frame.rgba.slice();
      const timing = "currentTime" in source ? { currentTime: source.currentTime, duration: source.duration } : { currentTime: 0, duration: 0 };
      this.send({ t: "mediaFrame", id, frame: { width: frame.width, height: frame.height, rgba }, ...timing }, [rgba.buffer]);
    }
    // The speaker's mix for any monitor the app has open, as fresh as a main-thread app would read it.
    for (const [monitorId, monitor] of this.monitors) {
      const left = new Float32Array(monitor.capacity);
      const right = new Float32Array(monitor.capacity);
      monitor.read(left, right);
      this.send({ t: "monitor", monitorId, left, right }, [left.buffer, right.buffer]);
    }
    for (const w of this.windows.values()) {
      if (!w.shared) continue;
      const count = sharedFrameCount(w.shared.buffer);
      if (count === w.shared.count) continue;
      w.shared.count = count;
      const { bits, seq, bytes } = readSharedFrame(w.shared.buffer);
      w.frame = bits;
      w.frameSeq = seq;
      w.frameBytes = bytes;
      this.notePicture();
      w.changed?.("frame");
      this.os.scheduleRepaint();
    }
  }

  private withWindow(key: string, run: (services: AppServices) => void): void {
    const w = this.windows.get(key);
    if (!w) return;
    if (w.services) run(w.services);
    else w.queued.push(run);
  }

  private receive(msg: ProcessToHost): void {
    switch (msg.t) {
      case "started":
        this.releaseLaunch?.();
        this.releaseLaunch = null;
        return;
      case "failed":
        this.fail(msg.error);
        return;
      case "stopped":
        this.port.terminate();
        return;
      case "frame": {
        const w = this.windows.get(msg.key);
        if (!w) return;
        w.frame = { baseAddr: new Uint8Array(msg.buffer), rowBytes: msg.rowBytes, bounds: { top: 0, left: 0, bottom: msg.height, right: msg.width } };
        w.frameSeq = msg.seq;
        w.frameBytes = msg.buffer.byteLength;
        this.notePicture();
        w.changed?.("frame");
        return;
      }
      case "frameBuffer": {
        const w = this.windows.get(msg.key);
        if (w) w.shared = { buffer: msg.buffer, count: 0 };
        return;
      }
      case "frameStats":
        this.stats.frames++;
        this.stats.worker.add(msg.frameMs);
        for (const ms of msg.audioMs) this.stats.audio.add(ms);
        return;
      case "cursor": {
        const w = this.windows.get(msg.key);
        if (!w) return;
        w.cursor = msg.cursor;
        w.changed?.("cursor");
        return;
      }
      case "rawKeys": {
        const w = this.windows.get(msg.key);
        if (!w) return;
        w.rawKeys = msg.value;
        w.changed?.("rawKeys");
        return;
      }
      case "menus": {
        const w = this.windows.get(msg.key);
        if (!w) return;
        w.menus = unwireMenus(msg.menus as WireMenu[], (action, value) => this.send({ t: "menu", action, value }));
        w.changed?.("menus");
        return;
      }
      case "call":
        this.call(msg.id, msg.method, msg.args);
        return;
    }
  }

  private call(id: number, method: string, args: unknown[]): void {
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(method === "kernel.invoke" ? this.kernelInvoke(id, args) : this.dispatch(method, args));
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(
      (value) => {
        if (!id) return;
        if (value instanceof Transfer) this.send({ t: "reply", id, ok: true, value: value.value }, value.transfer);
        else this.send({ t: "reply", id, ok: true, value: cloneable(value) });
      },
      (error: unknown) => {
        if (!id) {
          console.error(`${this.options.appId}: ${method} failed`, error);
          return;
        }
        const code = (error as { code?: unknown } | null)?.code;
        this.send({ t: "reply", id, ok: false, error: error instanceof Error ? error.message : String(error), ...(typeof code === "string" ? { code } : {}) });
      },
    );
  }

  private dispatch(method: string, args: unknown[]): unknown {
    const dot = method.indexOf(".");
    const scope = dot < 0 ? method : method.slice(0, dot);
    const name = dot < 0 ? "" : method.slice(dot + 1);
    const ctx = this.context;
    switch (scope) {
      case "window":
        return this.windowCall(name, args);
      case "fs":
        return (ctx.fs as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
      case "storage":
        return (ctx.storage as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
      case "clipboard": {
        const clipboard = this.options.clipboard;
        if (!clipboard) throw new Error("This Macintosh has no clipboard");
        return name === "readText" ? clipboard.readText() : clipboard.writeText(args[0] as string);
      }
      case "print":
        if (!ctx.print) throw new Error("This Macintosh has no printer");
        if (name === "connect") return ctx.print.connect();
        if (name === "printPage") {
          // The worker drew the page; this copies its bits onto the page the printer lays out.
          const [page, height, options] = args as [{ baseAddr: Uint8Array; rowBytes: number; width: number; height: number }, number, never];
          const bits = { baseAddr: page.baseAddr, rowBytes: page.rowBytes, bounds: { top: 0, left: 0, bottom: page.height, right: page.width } };
          return ctx.print.printPage(
            height,
            (port) => CopyBits(bits, port.portBits, bits.bounds, bits.bounds, srcCopy, null),
            options,
          );
        }
        return ctx.print.printPicture(args[0] as never, args[1] as never);
      case "images": {
        const frame = name === "decodeSource"
          ? this.options.images?.decode(args[0] as never, args[1] as never)
          : ctx.images?.decode(args[0] as Uint8Array, args[1] as string | undefined, args[2] as never);
        if (!frame) throw new Error("This Macintosh can't decode images");
        // The pixels move to the worker rather than being copied.
        return frame.then((f) => new Transfer({ width: f.width, height: f.height, rgba: f.rgba }, [f.rgba.buffer]));
      }
      case "fonts":
        if (name === "register") return ctx.fonts.register(args[0] as string, args[1] as string, args[2] as number | undefined);
        if (name === "install") {
          if (!ctx.fonts.install) throw new Error("This Macintosh can't install fonts");
          return ctx.fonts.install(args[0] as never);
        }
        if (name === "rasterize") {
          if (!ctx.fontRaster) throw new Error("This Macintosh can't rasterize fonts");
          return ctx.fontRaster.rasterize(args[0] as Uint8Array, args[1] as never);
        }
        break;
      case "download":
        if (!ctx.download) throw new Error("This Macintosh can't save files to the host");
        return ctx.download.save(args[0] as never);
      case "signIn":
        if (!ctx.signIn) throw new Error("This Macintosh can't sign in from a phone");
        return ctx.signIn.authorize(args[0] as string);
      case "musicKit":
        return this.musicKitCall(name, args);
      case "os":
        if (name === "showDialog") return ctx.os.showDialog(args[0] as never);
        if (name === "openApp") return ctx.os.openApp(args[0] as string, args[1] as Record<string, unknown>);
        if (name === "closeWindow") return ctx.os.closeWindow(args[0] as string);
        break;
      case "audio":
        return this.audioCall(name, args);
      case "video":
        if (name === "open") {
          if (!ctx.video) throw new Error("This Macintosh can't play video");
          return ctx.video.open(args[0] as string, args[1] as never).then((source) => this.adoptMedia(source, source.duration));
        }
        return this.videoCall(name, args);
      case "microphone":
        return this.microphoneCall(name, args);
      case "keepAlive": {
        const release = ctx.keepAlive?.();
        if (release) this.keepAlives.set(args[0] as number, release);
        return;
      }
      case "release":
        this.keepAlives.get(args[0] as number)?.();
        this.keepAlives.delete(args[0] as number);
        return;
      case "quit":
        return ctx.quit();
      case "media":
        return this.mediaCall(name, args);
      case "camera": {
        if (!ctx.camera) throw new Error("This Macintosh has no camera");
        return ctx.camera.open(args[0] as never).then((source) => this.adoptMedia(source, 0));
      }
      case "kernel":
        if (name === "abort") this.kernelCalls.get(args[0] as number)?.abort();
        return;
      case "instance":
        if (name === "fail") this.os.instances?.fail(this.options.instanceId, new Error(String(args[0])));
        return;
      case "error":
        console.error(`[${this.options.appId}]`, args[0]);
        this.os.instances?.note(this.options.instanceId, new Error(String(args[0])));
        return;
    }
    throw new Error(`Unknown call ${method}`);
  }

  private mediaIds = 0;

  /** Keep a source the app opened; the reply carries its current picture, as `open` gives a main-thread app one. */
  private adoptMedia(source: VideoSource | CameraSource, duration: number): Transfer {
    const id = ++this.mediaIds;
    this.media.set(id, source);
    const frame = source.frame();
    const first = frame && { width: frame.width, height: frame.height, rgba: frame.rgba.slice() };
    return new Transfer({ id, width: source.width, height: source.height, duration, first }, first ? [first.rgba.buffer] : []);
  }

  /** Apple Music: MusicKit stays here in the page; the app drives it by name and is sent each new state. */
  private musicKitCall(name: string, args: unknown[]): unknown {
    const musicKit = this.context.musicKit;
    if (!musicKit) throw new Error("This Macintosh can't play Apple Music");
    switch (name) {
      case "listen":
        if (!this.stopMusicKit) {
          // The state is plain data: it crosses to the worker as it is.
          const offChange = musicKit.onChange((state) => this.send({ t: "musicKit", state }));
          const offError = musicKit.onError((error) => this.send({ t: "musicKitError", error }));
          this.stopMusicKit = () => {
            offChange();
            offError();
          };
        }
        return undefined;
      case "configure":
        return musicKit.configure(args[0] as Parameters<MusicKitService["configure"]>[0]);
      case "authorize":
        return musicKit.authorize();
      case "unauthorize":
        return musicKit.unauthorize();
      case "openSignUp":
        return musicKit.openSignUp();
      case "setQueue":
        return musicKit.setQueue(args[0] as MusicKitQueueOptions);
      case "play":
        return musicKit.play();
      case "pause":
        return musicKit.pause();
      case "skipToNextItem":
        return musicKit.skipToNextItem();
      case "skipToPreviousItem":
        return musicKit.skipToPreviousItem();
      case "seekToTime":
        return musicKit.seekToTime(args[0] as number);
      case "setVolume":
        return musicKit.setVolume(args[0] as number);
      case "setShuffleMode":
        return musicKit.setShuffleMode(args[0] as MusicKitShuffleMode);
      case "setRepeatMode":
        return musicKit.setRepeatMode(args[0] as MusicKitRepeatMode);
    }
    throw new Error(`Unknown call musicKit.${name}`);
  }

  private mediaCall(name: string, args: unknown[]): unknown {
    const id = args[0] as number;
    const source = this.media.get(id);
    if (!source) return;
    switch (name) {
      case "want":
        this.mediaWanted.add(id);
        return;
      case "play":
        return "play" in source ? source.play() : undefined;
      case "pause":
        if ("pause" in source) source.pause();
        return;
      case "seek":
        if ("seek" in source) source.seek(args[1] as number);
        return;
      case "close":
        source.close();
        this.media.delete(id);
        this.mediaWanted.delete(id);
        return;
    }
    throw new Error(`Unknown call media.${name}`);
  }

  /** A trap the app invokes, with its output streamed back while it runs. */
  private async kernelInvoke(id: number, args: unknown[]): Promise<unknown> {
    const kernel = this.context.kernel;
    if (!kernel) throw new Error("This app has no kernel session");
    const [name, input] = args as [string, Record<string, unknown> | undefined];
    const cancel = new AbortController();
    this.kernelCalls.set(id, cancel);
    try {
      return await kernel.invoke(name, input, {
        signal: cancel.signal,
        stdout: (bytes) => this.send({ t: "kernelStream", id, stream: "stdout", bytes }),
        stderr: (bytes) => this.send({ t: "kernelStream", id, stream: "stderr", bytes }),
      });
    } finally {
      this.kernelCalls.delete(id);
    }
  }

  private windowCall(name: string, args: unknown[]): unknown {
    const key = args[0] as string;
    if (name === "open") {
      const wire = args[1] as WireWindowSpec;
      const { hasGoAway, ...spec } = wire;
      const w: ProcessWindowHost = { key, queued: [], frame: null, frameSeq: 0, frameBytes: 0, menus: [], bands: { header: 0, footer: 0 } };
      this.windows.set(key, w);
      const full: WindowSpec = {
        ...spec,
        Component: this.options.windowComponent(this, key),
        onGoAway: hasGoAway ? () => this.send({ t: "window.goAway", key }) : undefined,
      };
      w.osId = this.context.openWindow(full);
      return;
    }
    if (name === "close") {
      const osId = this.windows.get(key)?.osId;
      if (osId) this.os.closeWindow(osId);
      return;
    }
    if (name === "setTitle") return this.withWindow(key, (s) => s.window.setTitle(`${args[1] as string}${this.options.titleSuffix ?? ""}`));
    if (name === "scrollTo") return this.withWindow(key, (s) => s.window.scrollTo(args[1] as number));
    if (name === "setContentSize") return this.withWindow(key, (s) => s.window.setContentSize(args[1] as number, args[2] as number));
    if (name === "setBands") {
      const w = this.windows.get(key);
      if (!w) return;
      w.bands = { header: args[1] as number, footer: args[2] as number };
      w.changed?.("bands");
      return;
    }
    if (name === "setFullScreen") return this.withWindow(key, (s) => s.window.setFullScreen(args[1] as boolean));
    throw new Error(`Unknown call window.${name}`);
  }

  private async microphoneCall(name: string, args: unknown[]): Promise<unknown> {
    if (name === "close") {
      this.microphones.get(args[0] as number)?.close();
      this.microphones.delete(args[0] as number);
      return;
    }
    const microphone = this.context.microphone;
    if (!microphone?.openPort) throw new Error("This Macintosh's microphone can't be reached from an app process");
    const input = await microphone.openPort(args[0] as MicrophonePortOptions);
    const inputId = ++this.audioIds;
    this.microphones.set(inputId, input);
    input.onStateChange((state) => this.send({ t: "microphone", inputId, state }));
    const port = input.port;
    return new Transfer({ inputId, sampleRate: input.sampleRate, channels: input.channels, state: input.state(), port }, [port]);
  }

  private async audioCall(name: string, args: unknown[]): Promise<unknown> {
    if (name === "monitor") {
      const open = this.context.audio?.monitor;
      if (!open) throw new Error("This Macintosh's speaker can't be listened to");
      const monitor = await open.call(this.context.audio);
      const monitorId = ++this.audioIds;
      this.monitors.set(monitorId, monitor);
      return { monitorId, sampleRate: monitor.sampleRate, capacity: monitor.capacity };
    }
    if (name === "monitorClose") {
      this.monitors.get(args[0] as number)?.close();
      this.monitors.delete(args[0] as number);
      return;
    }
    if (name === "close") {
      this.audioStreams.get(args[0] as number)?.close();
      this.audioStreams.delete(args[0] as number);
      return;
    }
    const audio = this.context.audio;
    if (!audio?.openPort) throw new Error("This Macintosh's speaker can't be reached from an app process");
    const stream = await audio.openPort(args[0] as AudioPortOptions);
    const streamId = ++this.audioIds;
    this.audioStreams.set(streamId, stream);
    const report = () =>
      this.send({ t: "audio", streamId, state: stream.state(), latencyFrames: stream.outputLatencyFrames() });
    stream.onStateChange(report);
    // Output latency settles after the device starts; keep the worker's playback position honest.
    this.latencyTimer ??= setInterval(() => {
      for (const [id, s] of this.audioStreams) this.send({ t: "audio", streamId: id, state: s.state(), latencyFrames: s.outputLatencyFrames() });
    }, 1000);
    return new Transfer(
      {
        streamId,
        sampleRate: stream.sampleRate,
        channels: stream.channels,
        target: stream.target,
        latencyFrames: stream.outputLatencyFrames(),
        state: stream.state(),
        port: stream.port,
      },
      [stream.port],
    );
  }

  /** Decode here, and copy the excerpt to the worker as it fills: the partial excerpt, then each new picture. */
  private async videoCall(name: string, args: unknown[]): Promise<unknown> {
    const id = args[0] as number;
    if (name === "abort") {
      this.videoLoads.get(id)?.abort();
      return;
    }
    const video = this.context.video;
    if (!video?.excerpt) throw new Error("This Macintosh can't decode video");
    const request = args[2] as Omit<VideoExcerptRequest, "onPartial" | "onProgress" | "signal">;
    const load = new AbortController();
    this.videoLoads.set(id, load);
    let filling: VideoExcerpt | null = null;
    let sent: number[] = [];
    const flushPictures = (fraction: number) => {
      if (!filling) return;
      const pictures: { clip: number; picture: VideoExcerpt["clips"][number]["pictures"][number] }[] = [];
      filling.clips.forEach((clip, i) => {
        while (sent[i]! < clip.pictures.length) pictures.push({ clip: i, picture: clip.pictures[sent[i]!++]! });
      });
      this.send({ t: "video", event: { id, kind: "progress", fraction, pictures } });
    };
    try {
      await video.excerpt(args[1] as string, {
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
          this.send({ t: "video", event: { id, kind: "partial", excerpt: copy } });
        },
        onProgress: flushPictures,
      });
      flushPictures(1);
      return null;
    } finally {
      this.videoLoads.delete(id);
    }
  }
}
