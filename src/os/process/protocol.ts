/**
 * Messages between the OS and an app process: one app instance running in its
 * own Web Worker (docs/worker-apps-plan.md).
 *
 * The worker owns its own Solid, `@mockintosh/ui` and QuickDraw. It lays each
 * of its windows out in a band of one offscreen 1-bit bitmap and posts each
 * window its own picture. The OS window shows the latest picture and sends
 * input back. Everything the app asks of the OS is a `call`, answered by the
 * instance's real `AppContext`.
 */
import type { CursorSpec, FontRegistration, Modifiers, Sprite } from "@mockintosh/ui";
import type { FSNode } from "@mockintosh/fs";
import type { OperationContract, VideoExcerpt, VideoPicture, WindowKind, WindowSpec } from "@mockintosh/sdk";

export type PointerKind = "mousemove" | "mousedown" | "mouseup" | "dblclick" | "scroll";
export type KeyKind = "keydown" | "keyup" | "keypress";

/** What the OS posts and receives on: a `Worker`, or anything with its shape. */
export interface ProcessPort {
  postMessage(message: unknown, transfer?: unknown[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

/** Catalog nodes the worker mirrors for synchronous `fs` reads. */
export interface FsSnapshot {
  rootId: string;
  nodes: FSNode[];
}

/** A menu item with its callbacks replaced by ids the worker resolves. */
export type WireMenuItem =
  | { type: "action"; label: string; shortcut?: string; disabled?: boolean; checked?: boolean; action?: number }
  | { type: "radiogroup"; value: string; action: number; items: { label: string; value: string; disabled?: boolean }[] }
  | { type: "submenu"; label: string; disabled?: boolean; items: WireMenuItem[] }
  | { type: "separator" };

export interface WireMenu {
  label: string;
  items: WireMenuItem[];
}

/** A `WindowSpec` without its functions: the component stays in the worker, `onGoAway` becomes an event. */
export type WireWindowSpec = Omit<WindowSpec, "Component" | "onGoAway"> & { hasGoAway: boolean };

/** Where the app's code comes from. */
export type AppSource = { kind: "bundled"; id: string };

export interface ProcessStart {
  appId: string;
  source: AppSource;
  /** Launch props: `{}` from an icon, `FileDocumentProps` for a document. */
  props: Record<string, unknown>;
  /** Largest window the screen allows; each window's band is this tall. */
  screen: { width: number; height: number };
  env: { origin: string; config: Record<string, string> };
  capabilities: string[];
  print?: { paperWidth: number; connected: boolean };
  /** The speaker can take a port (`AudioService.openPort`). */
  audio: boolean;
  download: boolean;
  /** The host can decode video excerpts (`VideoService.excerpt`). */
  video: boolean;
  /** The microphone can deliver to a port (`MicrophoneService.openPort`). */
  microphone: boolean;
  /** The speaker's mix can be read back (`AudioService.monitor`). */
  monitor: boolean;
  /** The host can decode PNG/JPEG/GIF (`AppContext.images`, and `<image>` sources). */
  images: boolean;
  /** The traps the instance's kernel session grants (`AppContext.kernel.describe()`); absent = no kernel. */
  kernel?: OperationContract[];
  /** Sprites the app may ask for by name that aren't its own (OS icons, other apps'). */
  sprites: Record<string, Sprite>;
  /** Send `frameStats` for the Worker menu. */
  stats: boolean;
  /** Fonts installed since boot (System Folder › Fonts, Foundry), to replay before the app starts. */
  fonts: FontRegistration[];
  /** `fontRaster.modes()` when the host can rasterize fonts; absent = no `fontRaster`. */
  fontRasterModes?: string[];
  /** The Font Manager can save suitcases into System Folder › Fonts. */
  fontInstall: boolean;
}

/** Progress of a `video.excerpt` call: the excerpt once it exists, then its pictures as they decode. */
export type VideoEvent =
  | { id: number; kind: "partial"; excerpt: VideoExcerpt }
  | { id: number; kind: "progress"; fraction: number; pictures: { clip: number; picture: VideoPicture }[] };

/** The state of an OS window the worker draws. */
export interface WindowState {
  width: number;
  height: number;
  active: boolean;
  kind: WindowKind;
  /** How far the OS has scrolled a scrollable window's document. */
  scrollY: number;
}

export type HostToProcess =
  | { t: "start"; start: ProcessStart }
  /** The OS window for `key` is on screen: mount its content. */
  | { t: "window.attach"; key: string; state: WindowState }
  /** The OS window for `key` closed: dispose its content. */
  | { t: "window.detach"; key: string }
  | { t: "window.state"; key: string; state: WindowState }
  | { t: "window.goAway"; key: string }
  /** The instance is ending: run the app's cleanups, then answer `stopped`. */
  | { t: "stop" }
  | { t: "pointer"; key: string; kind: PointerKind; x: number; y: number; deltaY?: number; modifiers: Modifiers; seq: number }
  | { t: "key"; key: string; kind: KeyKind; value: string; modifiers: Modifiers; seq: number }
  | { t: "menu"; action: number; value?: string }
  | { t: "fs"; snapshot: FsSnapshot }
  | { t: "printer"; connected: boolean }
  /** A font was installed or removed on the OS's side. */
  | { t: "font"; registration: FontRegistration }
  | { t: "audio"; streamId: number; state: "suspended" | "running" | "closed"; latencyFrames: number }
  | { t: "microphone"; inputId: number; state: "suspended" | "running" | "closed" }
  /** The speaker's latest mix, read as the OS's frame started. */
  | { t: "monitor"; monitorId: number; left: Float32Array; right: Float32Array }
  | { t: "video"; event: VideoEvent }
  /** Output of the `kernel.invoke` call `id`, while it runs. */
  | { t: "kernelStream"; id: number; stream: "stdout" | "stderr"; bytes: Uint8Array }
  | { t: "reply"; id: number; ok: true; value: unknown }
  | { t: "reply"; id: number; ok: false; error: string };

export type ProcessToHost =
  /** `onOpen` returned; the launch ends now unless a window is open or the app holds `keepAlive`. */
  | { t: "started" }
  /** The app failed to load or threw in `onOpen`. */
  | { t: "failed"; error: string }
  /** Cleanups ran after `stop`; the worker can go. */
  | { t: "stopped" }
  | {
      t: "frame";
      key: string;
      /** Packed 1-bit rows, `rowBytes` apart — a QuickDraw `BitMap.baseAddr`. Transferred. */
      buffer: ArrayBuffer;
      rowBytes: number;
      width: number;
      height: number;
      /** Highest input `seq` whose effects are in this frame. */
      seq: number;
      /** Time the worker spent in `ui.frame()` for the frame this picture came from. */
      frameMs: number;
      /** `render` times of the audio chunks made since the last frame. */
      audioMs: number[];
    }
  /**
   * Window `key` publishes its pictures in shared memory (`sharedFrame.ts`)
   * from now on, instead of in `frame` messages.
   */
  | { t: "frameBuffer"; key: string; buffer: SharedArrayBuffer }
  /** Timings for the Worker menu, when the start asked for them. */
  | { t: "frameStats"; frameMs: number; audioMs: number[] }
  | { t: "cursor"; key: string; cursor: CursorSpec }
  /** `menus` for window `key`; `null` gives the window back the app's menus. */
  | { t: "menus"; key: string; menus: WireMenu[] }
  /** `id` 0 expects no reply. */
  | { t: "call"; id: number; method: string; args: unknown[] };
