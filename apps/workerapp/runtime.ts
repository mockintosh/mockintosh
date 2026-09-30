/**
 * The worker half of a worker-hosted app. `runWorkerApp(app)` mounts the
 * app's main `Component` into this worker's own `createUI`, draws it into a
 * window-sized 1-bit bitmap, and posts frames to the host window. The app sees
 * an ordinary `useApp()`: reads it can answer here (sizes, fonts, sprites, the
 * catalog mirror) are local, everything else is a call to the host.
 */
import { createComponent, createSignal, flush } from "solid-js";
import { InitGraf, type BitMap } from "@mockintosh/quickdraw";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import {
  createUI,
  listFontFamilies,
  onFontsChanged,
  registerFont,
  type CursorSpec,
  type UIInstance,
} from "@mockintosh/ui";
import {
  AppServicesContext,
  type AppServices,
  type AppWindow,
  type Capability,
  type MenubarDefinition,
  type MenubarItemDef,
  type PrintService,
  type SolidApp,
} from "@mockintosh/sdk";
import type { FSNode } from "@mockintosh/fs";
import { createFsMirror } from "./fsMirror";
import { createWorkerAudio } from "./audio";
import { createWorkerVideo } from "./video";
import type { HostToWorker, WireMenu, WireMenuItem, WorkerInit, WorkerToHost } from "./protocol";

interface WorkerScope {
  postMessage(message: WorkerToHost, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<HostToWorker>) => void) | null;
  requestAnimationFrame?: (cb: () => void) => number;
}

const scope = self as unknown as WorkerScope;

function post(message: WorkerToHost, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

let nextCallId = 1;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function call(method: string, args: unknown[]): Promise<unknown> {
  const id = nextCallId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ t: "call", id, method, args });
  });
}

function notify(method: string, ...args: unknown[]): void {
  post({ t: "call", id: 0, method, args });
}

function isNode(value: unknown): value is FSNode {
  return !!value && typeof value === "object" && "id" in value && "kind" in value && "parentId" in value;
}

export function runWorkerApp(app: SolidApp): void {
  let ui: UIInstance | null = null;
  let screen: BitMap | null = null;
  let frameScheduled = false;
  let lastSeq = 0;
  let lastCursor: CursorSpec | undefined;
  const mirror = createFsMirror(async (method, args) => {
    const result = await call(method, args);
    if (isNode(result)) mirror.upsert(result);
    return result;
  });

  const audio = createWorkerAudio(call, notify);
  const video = createWorkerVideo(call, notify);

  // Menu callbacks stay here; the host sees ids.
  let menuActions = new Map<number, (value?: string) => void>();

  function wireItems(items: MenubarItemDef[], next: () => number): WireMenuItem[] {
    return items.map((item): WireMenuItem => {
      switch (item.type) {
        case "separator":
          return { type: "separator" };
        case "submenu":
          return { type: "submenu", label: item.label, disabled: item.disabled, items: wireItems(item.items, next) };
        case "radiogroup": {
          const action = next();
          menuActions.set(action, (value) => item.onValueChange(value ?? item.value));
          return { type: "radiogroup", value: item.value, action, items: item.items.map((i) => ({ ...i })) };
        }
        default: {
          let action: number | undefined;
          if (item.onClick) {
            action = next();
            const onClick = item.onClick;
            menuActions.set(action, () => onClick());
          }
          return {
            type: "action",
            label: item.label,
            shortcut: item.shortcut,
            disabled: item.disabled,
            checked: item.checked,
            action,
          };
        }
      }
    });
  }

  function setMenus(menus: MenubarDefinition[]): void {
    menuActions = new Map();
    let id = 0;
    const wire: WireMenu[] = menus.map((m) => ({ label: m.label, items: wireItems(m.items, () => ++id) }));
    post({ t: "menus", menus: wire });
  }

  function scheduleFrame(): void {
    if (frameScheduled) return;
    frameScheduled = true;
    // A task, not a vsync: input that arrived together is handled first, then
    // one frame goes to the host, which presents it on its own next frame.
    setTimeout(renderFrame, 0);
  }

  function renderFrame(): void {
    frameScheduled = false;
    if (!ui || !screen) return;
    const start = performance.now();
    ui.frame();
    const frameMs = performance.now() - start;
    performance.measure("worker-app:frame", { start });
    const copy = screen.baseAddr.slice();
    post(
      {
        t: "frame",
        buffer: copy.buffer,
        rowBytes: screen.rowBytes,
        width: screen.bounds.right - screen.bounds.left,
        height: screen.bounds.bottom - screen.bounds.top,
        seq: lastSeq,
        frameMs,
        audioMs: audio.renderMs.splice(0),
      },
      [copy.buffer],
    );
  }

  function trackCursor(x: number, y: number): void {
    if (!ui) return;
    const cursor = ui.cursorAt(x, y);
    if (cursor === lastCursor) return;
    lastCursor = cursor;
    post({ t: "cursor", cursor });
  }

  function start(init: WorkerInit): void {
    screen = newBitMap(init.width, init.height);
    InitGraf(screen);
    const [width, setWidth] = createSignal(init.width, { ownedWrite: true });
    const [height, setHeight] = createSignal(init.height, { ownedWrite: true });
    const [active, setActive] = createSignal(init.active, { ownedWrite: true });
    const [kind, setKind] = createSignal(init.kind, { ownedWrite: true });
    const [printerConnected, setPrinterConnected] = createSignal(init.print?.connected ?? false, { ownedWrite: true });

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

    const win: AppWindow = {
      id: init.windowId,
      width,
      height,
      isActive: active,
      scrollY: () => 0,
      scrollTo: () => {},
      kind,
      setContentSize: (w, h) => notify("window.setContentSize", w, h),
      setTitle: (title) => notify("window.setTitle", title),
      setFullScreen: (on) => notify("window.setFullScreen", on),
      close: () => notify("window.close"),
    };

    const print: PrintService | undefined = init.print && ({
      paperWidth: init.print.paperWidth,
      connected: printerConnected,
      connect: () => call("print.connect", []) as Promise<void>,
      printPicture: (image, options) => call("print.printPicture", [image, options]) as Promise<void>,
      layoutPicture: () => {
        throw new Error("layoutPicture is not available to worker apps yet");
      },
      printPage: () => Promise.reject(new Error("printPage is not available to worker apps yet")),
    } satisfies PrintService);

    const storage = Object.fromEntries(
      ["read", "write", "readBytes", "writeBytes", "remove", "list"].map((m) => [m, (...args: unknown[]) => call(`storage.${m}`, args)]),
    ) as unknown as AppServices["storage"];

    const services: AppServices = {
      window: win,
      setMenus,
      quit: () => notify("quit"),
      getSprite: (name) => app.sprites?.[name] ?? init.sprites[name],
      storage,
      fs: mirror.fs,
      os: {
        openApp: (id, props) => notify("os.openApp", id, props),
        openWindow: (id, props) => notify("os.openApp", id, props),
        openersFor: () => [],
        closeWindow: (id) => notify("os.closeWindow", id),
        showDialog: (options) => call("os.showDialog", [options]) as Promise<string | null>,
        // This thread is the app's own; blocking it blocks nobody else.
        busy: async (work) => work(),
      },
      openWindow: () => {
        throw new Error("Worker apps have one window for now");
      },
      env: init.env,
      crypto: {
        randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
        sha256: async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
      },
      capabilities: new Set(init.capabilities as Capability[]),
      print,
      audio: init.audio ? audio.service : undefined,
      video: init.video ? video.service : undefined,
      download: init.download ? { save: (file) => call("download.save", [file]) as Promise<void> } : undefined,
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
            return () => { live = false; };
          }
          const id = setTimeout(() => callback(performance.now()), 16);
          return () => clearTimeout(id);
        },
      },
    };

    ui.render(() =>
      AppServicesContext({
        value: services,
        get children() {
          return createComponent(app.Component, init.props);
        },
      }),
    );
    scheduleFrame();

    scope.onmessage = (event) => {
      const msg = event.data;
      switch (msg.t) {
        case "resize":
          if (!ui) return;
          screen = newBitMap(msg.width, msg.height);
          ui.resize(screen);
          setWidth(msg.width);
          setHeight(msg.height);
          flush();
          scheduleFrame();
          return;
        case "active":
          setActive(msg.value);
          flush();
          scheduleFrame();
          return;
        case "pointer":
          lastSeq = Math.max(lastSeq, msg.seq);
          ui!.dispatchPointer(msg.kind, msg.x, msg.y, { deltaY: msg.deltaY, modifiers: msg.modifiers });
          if (msg.kind !== "scroll") trackCursor(msg.x, msg.y);
          return;
        case "key":
          lastSeq = Math.max(lastSeq, msg.seq);
          ui!.dispatchKeyboard(msg.kind, msg.key, msg.modifiers);
          return;
        case "menu":
          menuActions.get(msg.action)?.(msg.value);
          flush();
          scheduleFrame();
          return;
        case "fs":
          mirror.update(msg.snapshot);
          flush();
          scheduleFrame();
          return;
        case "kind":
          setKind(msg.kind);
          flush();
          scheduleFrame();
          return;
        case "video":
          video.event(msg.event);
          flush();
          scheduleFrame();
          return;
        case "audio":
          audio.update(msg.streamId, msg.state, msg.latencyFrames);
          return;
        case "printer":
          setPrinterConnected(msg.connected);
          flush();
          return;
        case "reply": {
          const waiter = pending.get(msg.id);
          if (!waiter) return;
          pending.delete(msg.id);
          if ("error" in msg) waiter.reject(new Error(msg.error));
          else waiter.resolve(msg.value);
          return;
        }
        case "init":
          return;
      }
    };
  }

  scope.onmessage = (event) => {
    if (event.data.t === "fs") {
      mirror.update(event.data.snapshot);
      return;
    }
    if (event.data.t === "init") start(event.data.init);
  };
}
