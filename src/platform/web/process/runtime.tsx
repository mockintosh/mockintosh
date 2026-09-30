/**
 * An app process: the worker half of an app instance (docs/worker-apps-plan.md).
 *
 * `runProcess` loads the app, runs its `onOpen` with an `AppContext` whose
 * calls go to the OS, and draws every window the app opens. The windows share
 * this worker's one UI instance: each is laid out in its own band of a tall
 * offscreen bitmap, in its own focus scope, and each OS window is sent only its
 * band. Reads the app expects to be synchronous (window size, the catalog,
 * fonts, sprites) are answered here from state the OS keeps current.
 */
import { Errored, For, Loading, createComponent, createRoot, createSignal, flush, untrack, type Accessor, type Setter } from "solid-js";
import { InitGraf, type BitMap } from "@mockintosh/quickdraw";
import { newBitMap, rowBytesFor } from "@mockintosh/quickdraw/bits";
import {
  createUI,
  listFontFamilies,
  onFontsChanged,
  registerFont,
  type CanvasNode,
  type CursorSpec,
  type JSX,
  type UIInstance,
} from "@mockintosh/ui";
import {
  AppServicesContext,
  type AppContext,
  type AppServices,
  type AppWindow,
  type Capability,
  type MenubarDefinition,
  type PrintService,
  type SolidApp,
  type WindowKind,
  type WindowSpec,
} from "@mockintosh/sdk";
import type { FSNode } from "@mockintosh/fs";
import { wireMenus, type MenuActions } from "../../../os/process/menus";
import { publishSharedFrame, sharedFrameBytes } from "../../../os/process/sharedFrame";
import type { AppSource, HostToProcess, ProcessStart, ProcessToHost, WindowState, WireWindowSpec } from "../../../os/process/protocol";
import { createWorkerAudio } from "./audio";
import { createFsMirror } from "./fsMirror";
import { createWorkerVideo } from "./video";

/** The worker's global scope, as far as a process uses it. */
export interface ProcessScope {
  postMessage(message: ProcessToHost, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<HostToProcess>) => void) | null;
  requestAnimationFrame?: (callback: () => void) => number;
}

export type LoadApp = (source: AppSource) => Promise<SolidApp | undefined>;

interface ProcessWindow {
  key: string;
  slot: number;
  Component: (props: Record<string, unknown>) => JSX.Element;
  props: Record<string, unknown>;
  onGoAway?: () => void;
  width: Accessor<number>;
  height: Accessor<number>;
  active: Accessor<boolean>;
  kind: Accessor<WindowKind>;
  setState(state: WindowState): void;
  services: AppServices;
  node: CanvasNode | null;
  /** The picture last sent, to skip frames where this window didn't change. */
  sent: Uint8Array | null;
  /** Where this window's pictures go when memory can be shared with the OS. */
  shared: SharedArrayBuffer | null;
  cursor?: CursorSpec;
  /** Action ids of this window's current menus, dropped when it sets new ones. */
  menuIds: number[];
}

function isNode(value: unknown): value is FSNode {
  return !!value && typeof value === "object" && "id" in value && "kind" in value && "parentId" in value;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function runProcess(scope: ProcessScope, load: LoadApp): void {
  const post = (message: ProcessToHost, transfer?: Transferable[]) => scope.postMessage(message, transfer);

  let nextCallId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const call = (method: string, args: unknown[]): Promise<unknown> => {
    const id = nextCallId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ t: "call", id, method, args });
    });
  };
  const notify = (method: string, ...args: unknown[]): void => post({ t: "call", id: 0, method, args });

  const mirror = createFsMirror(async (method, args) => {
    const result = await call(method, args);
    if (isNode(result)) mirror.upsert(result);
    return result;
  });
  const audio = createWorkerAudio(call, notify);
  const video = createWorkerVideo(call, notify);
  const menuActions: MenuActions = new Map();
  let nextMenuId = 0;

  let app: SolidApp | null = null;
  let ui: UIInstance | null = null;
  let screen: BitMap | null = null;
  let bandHeight = 0;
  let screenWidth = 0;
  const [slotCount, setSlotCount] = createSignal(1, { ownedWrite: true });
  const [attached, setAttached] = createSignal<ProcessWindow[]>([], { ownedWrite: true });
  const windows = new Map<string, ProcessWindow>();
  /** Windows the app opened whose OS window hasn't attached yet. */
  const opening = new Map<string, Pick<ProcessWindow, "Component" | "props" | "onGoAway">>();
  const cleanups: (() => void)[] = [];
  let [printerConnected, setPrinterConnected]: [Accessor<boolean>, Setter<boolean>] = createSignal(false, { ownedWrite: true });
  let lastSeq = 0;
  let frameMs = 0;
  let frameScheduled = false;
  let nextWindow = 0;
  let nextKeepAlive = 0;
  let sendStats = false;
  /** Shared memory needs a cross-origin-isolated page; elsewhere (Safari) pictures go by message. */
  const canShare = typeof SharedArrayBuffer !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

  function scheduleFrame(): void {
    if (frameScheduled) return;
    frameScheduled = true;
    // A task, not a vsync: input that arrived together is handled first, then
    // each changed window goes to the OS, which presents it on its next frame.
    setTimeout(renderFrame, 0);
  }

  /**
   * Draw input's effect straight away rather than on the next task: the OS
   * presents on its own next frame, and every millisecond here decides
   * whether the picture makes that frame or waits for the one after.
   */
  function renderNow(): void {
    if (frameScheduled) renderFrame();
  }

  function renderFrame(): void {
    frameScheduled = false;
    if (!ui || !screen) return;
    const start = performance.now();
    ui.frame();
    frameMs = performance.now() - start;
    performance.measure("app-process:frame", { start });
    const audioMs = audio.renderMs.splice(0);
    if (sendStats) post({ t: "frameStats", frameMs, audioMs: audioMs.splice(0) });
    for (const w of attached()) {
      const width = untrack(w.width);
      const height = untrack(w.height);
      const rowBytes = rowBytesFor(width);
      const picture = new Uint8Array(rowBytes * height);
      const top = w.slot * bandHeight;
      for (let y = 0; y < height; y++) {
        const from = (top + y) * screen.rowBytes;
        picture.set(screen.baseAddr.subarray(from, from + rowBytes), y * rowBytes);
      }
      if (w.sent && sameBytes(w.sent, picture)) continue;
      w.sent = picture.slice();
      if (w.shared) {
        publishSharedFrame(w.shared, picture, width, height, rowBytes, lastSeq);
        continue;
      }
      post(
        { t: "frame", key: w.key, buffer: picture.buffer, rowBytes, width, height, seq: lastSeq, frameMs, audioMs: audioMs.splice(0) },
        [picture.buffer],
      );
    }
  }

  function setWindowMenus(w: Pick<ProcessWindow, "key" | "menuIds">, menus: MenubarDefinition[]): void {
    for (const id of w.menuIds) menuActions.delete(id);
    w.menuIds = [];
    const wire = wireMenus(menus, menuActions, () => {
      const id = ++nextMenuId;
      w.menuIds.push(id);
      return id;
    });
    post({ t: "menus", key: w.key, menus: wire });
  }

  function freeSlot(): number {
    const used = new Set(attached().map((w) => w.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= untrack(slotCount)) {
      setSlotCount(slot + 1);
      screen = newBitMap(screenWidth, bandHeight * (slot + 1));
      ui!.resize(screen);
    }
    return slot;
  }

  function createContext(start: ProcessStart): AppContext {
    const capabilities = new Set(start.capabilities as Capability[]);
    [printerConnected, setPrinterConnected] = createSignal(start.print?.connected ?? false, { ownedWrite: true });
    const print: PrintService | undefined = start.print && {
      paperWidth: start.print.paperWidth,
      connected: printerConnected,
      connect: () => call("print.connect", []) as Promise<void>,
      printPicture: (image, options) => call("print.printPicture", [image, options]) as Promise<void>,
      layoutPicture: () => {
        throw new Error("layoutPicture is not available to app processes yet");
      },
      printPage: () => Promise.reject(new Error("printPage is not available to app processes yet")),
    };
    const storage = Object.fromEntries(
      ["read", "write", "readBytes", "writeBytes", "remove", "list"].map((m) => [m, (...args: unknown[]) => call(`storage.${m}`, args)]),
    ) as unknown as AppContext["storage"];

    return {
      quit: () => notify("quit"),
      keepAlive: () => {
        const id = ++nextKeepAlive;
        notify("keepAlive", id);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          notify("release", id);
        };
      },
      onCleanup: (cleanup) => void cleanups.push(cleanup),
      getSprite: (name) => app?.sprites?.[name] ?? start.sprites[name],
      storage,
      fs: mirror.fs,
      os: {
        openApp: (id, props) => notify("os.openApp", id, props),
        openWindow: (id, props) => notify("os.openApp", id, props),
        openersFor: () => {
          throw new Error("os.openersFor is not available to app processes yet");
        },
        closeWindow: (id) => (windows.has(id) || opening.has(id) ? notify("window.close", id) : notify("os.closeWindow", id)),
        showDialog: (options) => call("os.showDialog", [options]) as Promise<string | null>,
        // This thread is the app's own; blocking it blocks nobody else.
        busy: async (work) => work(),
      },
      openWindow<P extends Record<string, unknown>>(spec: WindowSpec<P> = {}): string {
        const key = `window-${++nextWindow}`;
        const { Component, onGoAway, ...rest } = spec;
        opening.set(key, {
          Component: (Component ?? app!.Component) as ProcessWindow["Component"],
          props: (spec.props ?? {}) as Record<string, unknown>,
          onGoAway,
        });
        const wire: WireWindowSpec = { ...rest, hasGoAway: !!onGoAway };
        notify("window.open", key, wire);
        return key;
      },
      fetch: capabilities.has("network") ? globalThis.fetch.bind(globalThis) : undefined,
      env: start.env,
      crypto: {
        randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
        sha256: async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
      },
      capabilities,
      print,
      download: start.download ? { save: (file) => call("download.save", [file]) as Promise<void> } : undefined,
      audio: start.audio ? audio.service : undefined,
      video: start.video ? video.service : undefined,
      fonts: {
        register: (name, data, size) => void registerFont(name, data, size),
        list: () => listFontFamilies(),
        onChange: onFontsChanged,
      },
      scheduler: {
        now: () => performance.now(),
        requestFrame(callback) {
          const raf = scope.requestAnimationFrame;
          if (raf) {
            let live = true;
            raf(() => live && callback(performance.now()));
            return () => {
              live = false;
            };
          }
          const id = setTimeout(() => callback(performance.now()), 16);
          return () => clearTimeout(id);
        },
      },
    };
  }

  function attach(key: string, state: WindowState, context: AppContext): void {
    const opened = opening.get(key);
    if (!opened || !ui) return;
    opening.delete(key);
    const [width, setWidth] = createSignal(state.width, { ownedWrite: true });
    const [height, setHeight] = createSignal(state.height, { ownedWrite: true });
    const [active, setActive] = createSignal(state.active, { ownedWrite: true });
    const [kind, setKind] = createSignal(state.kind, { ownedWrite: true });
    const w: ProcessWindow = {
      key,
      slot: freeSlot(),
      ...opened,
      width,
      height,
      active,
      kind,
      setState(next) {
        setWidth(next.width);
        setHeight(next.height);
        setActive(next.active);
        setKind(next.kind);
      },
      services: null as unknown as AppServices,
      node: null,
      sent: null,
      shared: canShare ? new SharedArrayBuffer(sharedFrameBytes(screenWidth, bandHeight)) : null,
      menuIds: [],
    };
    if (w.shared) post({ t: "frameBuffer", key, buffer: w.shared });
    const appWindow: AppWindow = {
      id: key,
      width,
      height,
      isActive: active,
      kind,
      scrollY: () => 0,
      scrollTo: () => {},
      setContentSize: (cw, ch) => notify("window.setContentSize", key, cw, ch),
      setTitle: (title) => notify("window.setTitle", key, title),
      setFullScreen: (on) => notify("window.setFullScreen", key, on),
      close: () => notify("window.close", key),
    };
    w.services = { ...context, window: appWindow, setMenus: (menus) => setWindowMenus(w, menus) };
    windows.set(key, w);
    // The app's own menus until the window sets its own; they must call back into this process.
    setWindowMenus(w, app?.menus ?? []);
    setAttached((list) => [...list, w]);
    flush();
    scheduleFrame();
  }

  function detach(key: string): void {
    const w = windows.get(key);
    opening.delete(key);
    if (!w) return;
    windows.delete(key);
    for (const id of w.menuIds) menuActions.delete(id);
    setAttached((list) => list.filter((x) => x !== w));
    flush();
  }

  function focusWindow(w: ProcessWindow): void {
    if (w.node && ui && ui.focusManager.getActiveScope() !== w.node) ui.focusManager.setActiveScope(w.node);
  }

  function trackCursor(w: ProcessWindow, x: number, y: number): void {
    if (!ui) return;
    const cursor = ui.cursorAt(x, y);
    if (cursor === w.cursor) return;
    w.cursor = cursor;
    post({ t: "cursor", key: w.key, cursor });
  }

  async function start(startMessage: ProcessStart): Promise<void> {
    const loaded = await load(startMessage.source).catch((error: unknown) => {
      post({ t: "failed", error: `Couldn't load ${startMessage.appId}: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    });
    if (loaded === null) return;
    if (!loaded) {
      post({ t: "failed", error: `No app module for ${startMessage.appId}` });
      return;
    }
    app = loaded;
    sendStats = startMessage.stats;
    screenWidth = startMessage.screen.width;
    bandHeight = startMessage.screen.height;
    screen = newBitMap(screenWidth, bandHeight);
    InitGraf(screen);
    ui = createUI({
      screen,
      scheduleRender: scheduleFrame,
      services: {
        clipboard: {
          readText: () => call("clipboard.readText", []) as Promise<string>,
          writeText: (text) => call("clipboard.writeText", [text]) as Promise<void>,
        },
        onError: (error) => {
          console.error(error);
          notify("error", error instanceof Error ? error.stack ?? error.message : String(error));
        },
      },
    });

    ui.render(() => (
      <box width={screenWidth} height={bandHeight * slotCount()} position="relative">
        <For each={attached()}>
          {(w) => (
            <box
              position="absolute"
              left={0}
              top={w.slot * bandHeight}
              width={w.width()}
              height={w.height()}
              overflow="hidden"
              focusScope
              ref={(node: CanvasNode) => {
                w.node = node;
              }}
            >
              <AppServicesContext value={w.services}>
                <Errored
                  fallback={(error) => {
                    notify("instance.fail", String(error()));
                    return <text wrap>{`Application failed: ${String(error())}`}</text>;
                  }}
                >
                  <Loading fallback={<box width="100%" height="100%" background={0} />}>
                    {createComponent(w.Component, w.props)}
                  </Loading>
                </Errored>
              </AppServicesContext>
            </box>
          )}
        </For>
      </box>
    ));

    const context = createContext(startMessage);
    const onOpen = app.onOpen ?? ((ctx: AppContext, props: Record<string, unknown>) => void ctx.openWindow({ props }));
    try {
      createRoot(() => onOpen(context, startMessage.props));
    } catch (error) {
      post({ t: "failed", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    post({ t: "started" });

    scope.onmessage = (event) => {
      const msg = event.data;
      switch (msg.t) {
        case "window.attach":
          attach(msg.key, msg.state, context);
          return;
        case "window.detach":
          detach(msg.key);
          return;
        case "window.state": {
          const w = windows.get(msg.key);
          if (!w) return;
          w.setState(msg.state);
          if (msg.state.active) focusWindow(w);
          flush();
          scheduleFrame();
          return;
        }
        case "window.goAway":
          (windows.get(msg.key) ?? opening.get(msg.key))?.onGoAway?.();
          return;
        case "pointer": {
          const w = windows.get(msg.key);
          if (!w || !ui) return;
          lastSeq = Math.max(lastSeq, msg.seq);
          const y = msg.y + w.slot * bandHeight;
          ui.dispatchPointer(msg.kind, msg.x, y, { deltaY: msg.deltaY, modifiers: msg.modifiers });
          if (msg.kind !== "scroll") trackCursor(w, msg.x, y);
          renderNow();
          return;
        }
        case "key": {
          const w = windows.get(msg.key);
          if (!w || !ui) return;
          lastSeq = Math.max(lastSeq, msg.seq);
          focusWindow(w);
          ui.dispatchKeyboard(msg.kind, msg.value, msg.modifiers);
          renderNow();
          return;
        }
        case "menu":
          menuActions.get(msg.action)?.(msg.value);
          flush();
          scheduleFrame();
          return;
        default:
          receive(msg);
      }
    };
  }

  /** Messages that mean the same before and after start. */
  function receive(msg: HostToProcess): void {
    switch (msg.t) {
      case "fs":
        mirror.update(msg.snapshot);
        flush();
        scheduleFrame();
        return;
      case "printer":
        setPrinterConnected(msg.connected);
        flush();
        return;
      case "audio":
        audio.update(msg.streamId, msg.state, msg.latencyFrames);
        return;
      case "video":
        video.event(msg.event);
        flush();
        scheduleFrame();
        return;
      case "reply": {
        const waiter = pending.get(msg.id);
        if (!waiter) return;
        pending.delete(msg.id);
        if ("error" in msg) waiter.reject(new Error(msg.error));
        else waiter.resolve(msg.value);
        return;
      }
      case "stop":
        for (const cleanup of cleanups.splice(0)) {
          try {
            cleanup();
          } catch (error) {
            console.error(error);
          }
        }
        for (const key of [...windows.keys()]) detach(key);
        post({ t: "stopped" });
        return;
    }
  }

  scope.onmessage = (event) => {
    const msg = event.data;
    if (msg.t === "start") void start(msg.start);
    else receive(msg);
  };
}
