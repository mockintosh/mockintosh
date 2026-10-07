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
import { createPrintPage, disposePrintPage, drawOnPage } from "@mockintosh/print";
import { layoutPrintable } from "../../../os/printers/pictureLayout";
import { declarationOf } from "../../../os/appDeclaration";
import { openersAmong, type OpenerEntry } from "../../../os/openerTable";
import type { SolidApp as OSSolidApp } from "../../../os/apps";
import { newBitMap, rowBytesFor } from "@mockintosh/quickdraw/bits";
import {
  createUI,
  listFontFamilies,
  onFontsChanged,
  registerFont,
  replayFontRegistration,
  type CanvasNode,
  type CursorSpec,
  type JSX,
  type UIInstance,
  type UIServices,
} from "@mockintosh/ui";
import {
  AppServicesContext,
  WindowSlotsContext,
  type WindowBandView,
  type WindowSlots,
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
import { createWorkerMicrophone } from "./microphone";
import { createWorkerMedia } from "./media";
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
  scrollY: Accessor<number>;
  setState(state: WindowState): void;
  /**
   * `WindowHeader` / `WindowFooter` content, drawn here above and below the
   * body. The OS is told their heights (`window.setBands`) and shows those
   * rows of the picture in its own bands, so its scrollbar spans only the body.
   */
  header: Accessor<{ view: WindowBandView; height: number }>;
  footer: Accessor<{ view: WindowBandView; height: number }>;
  slots: WindowSlots;
  services: AppServices;
  node: CanvasNode | null;
  /** The picture last sent, to skip frames where this window didn't change. */
  sent: Uint8Array | null;
  /** Where this window's pictures go when memory can be shared with the OS. */
  shared: SharedArrayBuffer | null;
  cursor?: CursorSpec;
  /** Last `rawKeys` told to the OS: the focused control here takes raw keys. */
  rawKeys?: boolean;
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
  /** Output of a running `kernel.invoke`, by call id. */
  const kernelStreams = new Map<number, { stdout?: (bytes: Uint8Array) => void; stderr?: (bytes: Uint8Array) => void }>();
  const call = (method: string, args: unknown[], onId?: (id: number) => void): Promise<unknown> => {
    const id = nextCallId++;
    onId?.(id);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ t: "call", id, method, args });
    });
  };
  const notify = (method: string, ...args: unknown[]): void => post({ t: "call", id: 0, method, args });

  const mirror = createFsMirror(
    async (method, args) => {
      const result = await call(method, args);
      if (isNode(result)) mirror.upsert(result);
      return result;
    },
    notify,
  );
  let audio = createWorkerAudio(call, notify, { monitor: false });
  const microphone = createWorkerMicrophone(call, notify);
  const media = createWorkerMedia(call, notify);
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
  /** Which app opens which file type, as the OS last sent it. */
  let openers: OpenerEntry[] = [];
  let lastSeq = 0;
  let frameMs = 0;
  let frameScheduled = false;
  let nextWindow = 0;
  let nextKeepAlive = 0;
  /** The app's own About box, while it's open. */
  let aboutKey: string | null = null;
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
    reportRawKeys();
    for (const w of attached()) {
      const width = untrack(w.width);
      const height = Math.min(bandHeight, untrack(() => pictureHeight(w)));
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

  /** Header, body and footer: the rows of a window's picture. */
  function pictureHeight(w: Pick<ProcessWindow, "header" | "height" | "footer">): number {
    return w.header().height + w.height() + w.footer().height;
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
    openers = start.openers;
    const print: PrintService | undefined = start.print && {
      paperWidth: start.print.paperWidth,
      connected: printerConnected,
      connect: () => call("print.connect", []) as Promise<void>,
      printPicture: (image, options) => call("print.printPicture", [image, options]) as Promise<void>,
      layoutPicture: (image, options) => layoutPrintable(image, options ?? {}, start.print!.paperWidth),
      // Drawn here, as the printer would, then printed by the OS as a finished page.
      async printPage(height, draw, options) {
        const scale = Math.max(1, Math.floor(options?.scale ?? 1));
        const page = createPrintPage(Math.floor(start.print!.paperWidth / scale), height);
        try {
          drawOnPage(page, (port) => draw(port, { width: page.width, height: page.height }));
          const bits = { baseAddr: page.bits.baseAddr, rowBytes: page.bits.rowBytes, width: page.width, height: page.height };
          await call("print.printPage", [bits, height, options]);
        } finally {
          disposePrintPage(page);
        }
      },
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
        openersFor: (type) => openersAmong(openers, type),
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
      kernel: start.kernel && {
        describe: () => start.kernel!,
        invoke(name, args, options) {
          let id = 0;
          const done = call("kernel.invoke", [name, args], (callId) => {
            id = callId;
            kernelStreams.set(id, { stdout: options?.stdout, stderr: options?.stderr });
          });
          options?.signal?.addEventListener("abort", () => notify("kernel.abort", id), { once: true });
          return done.finally(() => kernelStreams.delete(id));
        },
      },
      download: start.download ? { save: (file) => call("download.save", [file]) as Promise<void> } : undefined,
      audio: start.audio ? audio.service : undefined,
      video:
        start.video || start.videoPlayback
          ? { open: start.videoPlayback ? media.video.open : () => Promise.reject(new Error("This Macintosh can't play video")), excerpt: start.video ? video.service.excerpt : undefined }
          : undefined,
      camera: start.camera ? media.camera : undefined,
      images: start.images
        ? { decode: (bytes, type, options) => call("images.decode", [bytes, type, options]) as ReturnType<NonNullable<AppContext["images"]>["decode"]> }
        : undefined,
      microphone: start.microphone ? microphone.service : undefined,
      fonts: {
        // Registered here for this app straight away, and with the OS for every other app.
        register: (name, data, size) => {
          registerFont(name, data, size);
          notify("fonts.register", name, data, size);
        },
        list: () => listFontFamilies(),
        onChange: onFontsChanged,
        install: start.fontInstall ? (suitcase) => call("fonts.install", [suitcase]) as Promise<string> : undefined,
      },
      fontRaster: start.fontRasterModes && {
        modes: () => start.fontRasterModes as ReturnType<NonNullable<AppContext["fontRaster"]>["modes"]>,
        rasterize: (bytes, options) => call("fonts.rasterize", [bytes, options]) as ReturnType<NonNullable<AppContext["fontRaster"]>["rasterize"]>,
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
    const [scrollY, setScrollY] = createSignal(state.scrollY, { ownedWrite: true });
    const [header, setHeader] = createSignal<{ view: WindowBandView; height: number }>({ view: null, height: 0 }, { ownedWrite: true });
    const [footer, setFooter] = createSignal<{ view: WindowBandView; height: number }>({ view: null, height: 0 }, { ownedWrite: true });
    let documentSize: { width: number; height: number } | null = null;
    const reportContentSize = () => {
      if (documentSize) notify("window.setContentSize", key, documentSize.width, documentSize.height);
    };
    // Kept here too: a signal write isn't readable until Solid flushes.
    const bandHeights = { header: 0, footer: 0 };
    const reportBands = () => notify("window.setBands", key, bandHeights.header, bandHeights.footer);
    const w: ProcessWindow = {
      key,
      slot: freeSlot(),
      ...opened,
      width,
      height,
      active,
      kind,
      scrollY,
      setState(next) {
        setWidth(next.width);
        setHeight(next.height);
        setActive(next.active);
        setKind(next.kind);
        setScrollY(next.scrollY);
      },
      header,
      footer,
      slots: {
        setHeader(view, bandHeight) {
          bandHeights.header = view ? bandHeight : 0;
          setHeader({ view, height: bandHeights.header });
          reportBands();
        },
        setFooter(view, bandHeight) {
          bandHeights.footer = view ? bandHeight : 0;
          setFooter({ view, height: bandHeights.footer });
          reportBands();
        },
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
      scrollY,
      scrollTo: (y) => notify("window.scrollTo", key, y),
      setContentSize: (cw, ch) => {
        documentSize = { width: cw, height: ch };
        reportContentSize();
      },
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

  /** Tell the OS which window's focused control takes raw keys, so it sends that window Tab and ⌃V. */
  function reportRawKeys(): void {
    if (!ui) return;
    const focused = ui.focusManager.focused;
    const raw = ui.focusedTakesRawKeys();
    for (const w of windows.values()) {
      let inside = false;
      for (let n = focused; n && !inside; n = n.parent) inside = n === w.node;
      const value = raw && inside;
      if ((w.rawKeys ?? false) === value) continue;
      w.rawKeys = value;
      post({ t: "rawKeys", key: w.key, value });
    }
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

  /** Load an app only to tell the OS what it declares. */
  async function describe(source: AppSource, appId: string): Promise<void> {
    try {
      const loaded = await load(source);
      if (!loaded || typeof loaded.Component !== "function" || loaded.id !== appId) {
        post({ t: "failed", error: `The module doesn't export the app "${appId}"` });
        return;
      }
      post({ t: "described", declaration: declarationOf(loaded as OSSolidApp) });
    } catch (error) {
      post({ t: "failed", error: `Couldn't load ${appId}: ${error instanceof Error ? error.message : String(error)}` });
    }
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
    audio = createWorkerAudio(call, notify, { monitor: startMessage.monitor });
    // The OS's fonts before any text is measured.
    for (const registration of startMessage.fonts) replayFontRegistration(registration);
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
        images: startMessage.images
          ? { decode: (source, options) => call("images.decodeSource", [source, options]) as ReturnType<NonNullable<UIServices["images"]>["decode"]> }
          : undefined,
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
              height={pictureHeight(w)}
              overflow="hidden"
              focusScope
              ref={(node: CanvasNode) => {
                w.node = node;
              }}
            >
              <AppServicesContext value={w.services}>
                <WindowSlotsContext value={w.slots}>
                  <box width={w.width()} height={pictureHeight(w)} flexDirection="column">
                    {w.header().view && <box width={w.width()} height={w.header().height}>{w.header().view!()}</box>}
                    <box width={w.width()} height={w.height()} overflow="hidden" position="relative">
                      {/* A scrollable window's document, moved to what the OS has scrolled to. */}
                      <box
                        position="absolute"
                        left={0}
                        top={-w.scrollY()}
                        width={w.width()}
                        height={w.height()}
                      >
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
                      </box>
                    </box>
                    {w.footer().view && <box width={w.width()} height={w.footer().height}>{w.footer().view!()}</box>}
                  </box>
                </WindowSlotsContext>
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
        case "paste": {
          const w = windows.get(msg.key);
          if (!w || !ui) return;
          lastSeq = Math.max(lastSeq, msg.seq);
          focusWindow(w);
          ui.dispatchPaste(msg.text);
          renderNow();
          return;
        }
        case "menu":
          menuActions.get(msg.action)?.(msg.value);
          flush();
          scheduleFrame();
          return;
        case "about": {
          const About = app?.about?.Component;
          if (!About) return;
          if (aboutKey && (windows.has(aboutKey) || opening.has(aboutKey))) return;
          aboutKey = context.openWindow({ title: msg.title, kind: "dialog", size: msg.size, Component: About });
          return;
        }
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
      case "openers":
        openers = msg.openers;
        return;
      case "font":
        replayFontRegistration(msg.registration);
        flush();
        scheduleFrame();
        return;
      case "audio":
        audio.update(msg.streamId, msg.state, msg.latencyFrames);
        return;
      case "microphone":
        microphone.update(msg.inputId, msg.state);
        return;
      case "monitor":
        audio.monitorSnapshot(msg.monitorId, msg.left, msg.right);
        return;
      case "video":
        video.event(msg.event);
        flush();
        scheduleFrame();
        return;
      case "mediaFrame":
        media.frame({ id: msg.id, frame: msg.frame, currentTime: msg.currentTime, duration: msg.duration });
        flush();
        scheduleFrame();
        return;
      case "kernelStream":
        kernelStreams.get(msg.id)?.[msg.stream]?.(msg.bytes);
        return;
      case "reply": {
        const waiter = pending.get(msg.id);
        if (!waiter) return;
        pending.delete(msg.id);
        if ("error" in msg) waiter.reject(Object.assign(new Error(msg.error), msg.code ? { code: msg.code } : {}));
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
    else if (msg.t === "describe") void describe(msg.source, msg.appId);
    else receive(msg);
  };
}
