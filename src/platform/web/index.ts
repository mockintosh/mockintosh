/**
 * The browser platform: a `<canvas>` for the screen, DOM events for input,
 * `requestAnimationFrame` for the clock, OPFS for the disk, and WebUSB /
 * Web Bluetooth for printers. This is the only OS-level module that may use DOM APIs.
 */
import { createWebAppProcesses } from "./process";
import type { BitMap } from "@mockintosh/quickdraw";
import { InMemoryBackend } from "@mockintosh/fs";
import { OPFSBackend, isOPFSAvailable } from "./OPFSBackend";
import { createWebPrinterLinks } from "./printerLinks";
import type { Modifiers, UIClipboard } from "@mockintosh/ui";
import type {
  HostCapability,
  HostFileDrop,
  Platform,
  PlatformDisplay,
  PlatformDropEvent,
  PlatformInput,
  PlatformKeyEvent,
  PlatformPointerEvent,
  PlatformScheduler,
  PointerButton,
} from "../types";
import { browserBuilder } from "./builder";
import { webFetch } from "./fetch";
import { CanvasPresenter, createScreenCanvas, wheelDeltaX, wheelDeltaY, wheelIsPinchZoom } from "@mockintosh/ui/web";
import { bitMapHeight, bitMapWidth } from "@mockintosh/quickdraw/bits";
import { createHostDisplay, initialScreenSize } from "./hostDisplay";
import { createWebDownloadService } from "./download";
import { createWebImageService } from "./media/images";
import { createWebGpuService } from "./media/gpu";
import { createWebVideoService } from "./media/video";
import { createWebCameraService } from "./media/camera";
import { createWebAudioService } from "./media/audio";
import { createWebMicrophoneService } from "./media/microphone";
import { createWebAgentRuntime } from "./agentRuntime";
import { createWebCrypto } from "./crypto";
import { createWebSourceProvider } from "./source";
import { createWebBrowserService } from "./browser";
import { createWebSignInRelay } from "./signInRelay";
import { createWebFontRasterService } from "./fontRaster";
export interface WebPlatformOptions {
  /** Element the screen canvas is appended to. */
  root: HTMLElement;
  width: number;
  height: number;
}

/** The classic 512×342 screen — what the web build boots with. */
export const DEFAULT_SCREEN = { width: 512, height: 342 } as const;

export function createWebPlatform(options: WebPlatformOptions): Platform {
  const { root, width, height } = options;

  const resizeListeners = new Set<(width: number, height: number) => void>();
  const screenEl = createScreenCanvas(root, initialScreenSize({ width, height }), {
    onLogicalSize: (nextWidth, nextHeight) => {
      resizeListeners.forEach((listener) => listener(nextWidth, nextHeight));
    },
  });
  const { canvas, ctx } = screenEl;
  const hostDisplay = createHostDisplay(screenEl, { width, height }, resizeListeners);

  let presenter: CanvasPresenter | null = null;
  let presenterW = 0;
  let presenterH = 0;
  let lastScreen: BitMap | null = null;
  const display: PlatformDisplay = {
    get width() {
      return screenEl.width;
    },
    get height() {
      return screenEl.height;
    },
    present(screen) {
      lastScreen = screen;
      const w = bitMapWidth(screen);
      const h = bitMapHeight(screen);
      if (!presenter || presenterW !== w || presenterH !== h) {
        presenter = new CanvasPresenter(screen, ctx);
        presenterW = w;
        presenterH = h;
      }
      presenter.present(screen);
    },
    whenVisible(callback) {
      // The canvas is painted after the frame callbacks of the rendering
      // update that follows a present; the frame callback after that one
      // runs once the paint is done, wherever the present happened.
      requestAnimationFrame(() => requestAnimationFrame(() => callback()));
    },
  };
  screenEl.subscribeInvalidate(() => {
    if (!lastScreen) return;
    presenter ??= new CanvasPresenter(lastScreen, ctx);
    presenter.present(lastScreen);
  });

  // --- Input: DOM events → screen-space pointer/key events ---
  const input = createDOMInput(canvas, screenEl.toScreen);

  // --- Clock ---
  const scheduler: PlatformScheduler = {
    requestFrame(cb) {
      const id = requestAnimationFrame(cb);
      return () => cancelAnimationFrame(id);
    },
    now: () => performance.now(),
  };

  // --- Disk ---
  if (!isOPFSAvailable()) {
    console.warn("OPFS unavailable — the file system will not persist across reloads.");
  }
  const storage = isOPFSAvailable() ? new OPFSBackend() : new InMemoryBackend();

  // --- Peripherals ---
  const clipboard: UIClipboard | undefined = navigator.clipboard
    ? {
        readText: () => navigator.clipboard.readText(),
        writeText: (text) => navigator.clipboard.writeText(text),
      }
    : undefined;

  const hostCapabilities: HostCapability[] = [];
  const fetch = globalThis.fetch.bind(globalThis);

  return {
    display,
    input,
    scheduler,
    storage,
    env: {
      origin: location.origin,
      config: {
        SPOTIFY_CLIENT_ID: (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? "",
      },
    },
    hostCapabilities,
    crypto: createWebCrypto(),
    browser: createWebBrowserService(),
    signInRelay: createWebSignInRelay(webFetch, location.origin),
    clipboard,
    printerLinks: createWebPrinterLinks(),
    download: createWebDownloadService(),
    fetch: webFetch,
    images: createWebImageService(),
    video: createWebVideoService(),
    camera: createWebCameraService(),
    gpu: createWebGpuService(),
    audio: createWebAudioService(),
    microphone: createWebMicrophoneService(),
    agentRuntime: createWebAgentRuntime(),
    processes: createWebAppProcesses(),
    fonts: createWebFontRasterService(),
    builder: browserBuilder,
    hostDisplay,
    source: createWebSourceProvider(),
    async loadArtifact(code) {
      const url = URL.createObjectURL(new Blob([code], {type: "text/javascript"}));
      try { return await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
    },
    loadModule: (url) => import(/* @vite-ignore */ url),
    reload() {
      location.reload();
    },
  };
}

function createDOMInput(
  canvas: HTMLCanvasElement,
  toScreen: (e: Pick<MouseEvent, "clientX" | "clientY">) => { x: number; y: number },
): PlatformInput {
  const pointerHandlers = new Set<(e: PlatformPointerEvent) => void>();
  const keyHandlers = new Set<(e: PlatformKeyEvent) => void>();
  const dropHandlers = new Set<(e: PlatformDropEvent) => void>();

  const emitPointer = (e: PlatformPointerEvent) => pointerHandlers.forEach((h) => h(e));
  const emitKey = (e: PlatformKeyEvent) => keyHandlers.forEach((h) => h(e));
  const emitDrop = (e: PlatformDropEvent) => dropHandlers.forEach((h) => h(e));
  const button = (e: MouseEvent): PointerButton => (e.button === 1 || e.button === 2 ? e.button : 0);
  const modifiers = (e: MouseEvent | KeyboardEvent): Modifiers => ({
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    meta: e.metaKey,
  });

  // A press on the screen owns the mouse until it is released, like a real
  // Mac's, whose pointer cannot leave the screen: moves and the release over
  // the page around the canvas are reported pinned to the screen's edge, so
  // a drag that ends out there still ends.
  let pressed = false;
  const pinned = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return toScreen({
      clientX: Math.max(rect.left, Math.min(e.clientX, rect.right - 1)),
      clientY: Math.max(rect.top, Math.min(e.clientY, rect.bottom - 1)),
    });
  };

  canvas.addEventListener("mousedown", (e) => {
    pressed = true;
    canvas.focus({ preventScroll: true });
    emitPointer({ type: "down", ...toScreen(e), button: button(e), modifiers: modifiers(e) });
  });
  canvas.addEventListener("mouseup", (e) => {
    emitPointer({ type: "up", ...toScreen(e), button: button(e), modifiers: modifiers(e) });
  });

  canvas.addEventListener("mousemove", (e) => {
    emitPointer({ type: "move", ...toScreen(e), modifiers: modifiers(e) });
  });

  // The page around the canvas is not the screen. While the pointer is in
  // that margin above the OS, report it (y < 0) so a pass over the top edge
  // can bring the menubar down. A jump from that margin into the canvas
  // still counts as crossing the edge.
  let aboveScreen = false;
  window.addEventListener("mousemove", (e) => {
    if (pressed) {
      if (e.target !== canvas) emitPointer({ type: "move", ...pinned(e), modifiers: modifiers(e) });
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const overX = e.clientX >= rect.left && e.clientX < rect.right;
    const above = overX && e.clientY < rect.top;
    if (above) {
      aboveScreen = true;
      emitPointer({ type: "move", ...toScreen(e) });
      return;
    }
    if (aboveScreen && overX) {
      aboveScreen = false;
      const pos = toScreen(e);
      emitPointer({ type: "move", x: pos.x, y: -1 });
    } else {
      aboveScreen = false;
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (!pressed) return;
    pressed = false;
    if (e.target !== canvas) {
      emitPointer({ type: "up", ...pinned(e), button: button(e), modifiers: modifiers(e) });
    }
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (wheelIsPinchZoom(e)) return;
      emitPointer({ type: "scroll", ...toScreen(e), deltaX: wheelDeltaX(e, canvas.clientWidth), deltaY: wheelDeltaY(e, canvas.clientHeight) });
    },
    { passive: false }
  );

  const keyEvent = (type: "down" | "up", e: KeyboardEvent): PlatformKeyEvent => ({
    type,
    key: e.key,
    modifiers: modifiers(e),
  });
  window.addEventListener("keydown", (e) => {
    // Tab moves focus inside the Macintosh, not the browser's focus off it,
    // when the keys are the Macintosh's (not a field of the page around it).
    if (e.key === "Tab" && (e.target === canvas || e.target === document.body)) e.preventDefault();
    emitKey(keyEvent("down", e));
  });
  window.addEventListener("keyup", (e) => emitKey(keyEvent("up", e)));

  const allowDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const preventNav = (e: DragEvent) => {
    e.preventDefault();
  };
  window.addEventListener("dragover", preventNav);
  window.addEventListener("drop", preventNav);
  canvas.addEventListener("dragover", allowDrop);
  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const list = e.dataTransfer?.files;
    if (!list?.length) return;
    const pos = toScreen(e);
    void Promise.all(
      Array.from(list).map(async (file): Promise<HostFileDrop> => ({
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    ).then((files) => emitDrop({ ...pos, files }));
  });

  return {
    onPointer(handler) {
      pointerHandlers.add(handler);
      return () => pointerHandlers.delete(handler);
    },
    onKey(handler) {
      keyHandlers.add(handler);
      return () => keyHandlers.delete(handler);
    },
    onDrop(handler) {
      dropHandlers.add(handler);
      return () => dropHandlers.delete(handler);
    },
  };
}
