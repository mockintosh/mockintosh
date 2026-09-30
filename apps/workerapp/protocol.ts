/**
 * Messages between a window on the main thread and an app running in a Web
 * Worker. Prototype: see docs/browsix-research.md §2.
 *
 * The worker owns its own Solid, `@mockintosh/ui` and QuickDraw, draws the
 * window's content into a packed 1-bit bitmap, and posts it as a frame. The
 * host window shows the latest frame and sends input back. Everything the
 * app asks of the OS (files, dialogs, clipboard, printing) is a `call`.
 */
import type { CursorSpec, Modifiers, Sprite } from "@mockintosh/ui";
import type { VideoExcerpt, VideoPicture, WindowKind } from "@mockintosh/sdk";
import type { FSNode } from "@mockintosh/fs";

export type PointerKind = "mousemove" | "mousedown" | "mouseup" | "dblclick" | "scroll";
export type KeyKind = "keydown" | "keyup" | "keypress";

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

export interface WorkerInit {
  appId: string;
  windowId: string;
  props: Record<string, unknown>;
  width: number;
  height: number;
  active: boolean;
  env: { origin: string; config: Record<string, string> };
  capabilities: string[];
  print?: { paperWidth: number; connected: boolean };
  /** The host's speaker can take a port (`AudioService.openPort`). */
  audio: boolean;
  download: boolean;
  /** The host can decode video excerpts (`VideoService.excerpt`). */
  video: boolean;
  /** Sprites the app asks for by name that aren't its own (OS icons, other apps'). */
  sprites: Record<string, Sprite>;
  kind: WindowKind;
}

/** Progress of a `video.excerpt` call: the excerpt once it exists, then its pictures as they decode. */
export type VideoEvent =
  | { id: number; kind: "partial"; excerpt: VideoExcerpt }
  | { id: number; kind: "progress"; fraction: number; pictures: { clip: number; picture: VideoPicture }[] };

export type HostToWorker =
  | { t: "init"; init: WorkerInit }
  | { t: "resize"; width: number; height: number }
  | { t: "active"; value: boolean }
  | { t: "kind"; kind: WindowKind }
  | { t: "video"; event: VideoEvent }
  | { t: "pointer"; kind: PointerKind; x: number; y: number; deltaY?: number; modifiers: Modifiers; seq: number }
  | { t: "key"; kind: KeyKind; key: string; modifiers: Modifiers; seq: number }
  | { t: "menu"; action: number; value?: string }
  | { t: "fs"; snapshot: FsSnapshot }
  | { t: "printer"; connected: boolean }
  | { t: "audio"; streamId: number; state: "suspended" | "running" | "closed"; latencyFrames: number }
  | { t: "reply"; id: number; ok: true; value: unknown }
  | { t: "reply"; id: number; ok: false; error: string };

export type WorkerToHost =
  | {
      t: "frame";
      /** Packed 1-bit rows, `rowBytes` apart — a QuickDraw `BitMap.baseAddr`. Transferred. */
      buffer: ArrayBuffer;
      rowBytes: number;
      width: number;
      height: number;
      /** Highest input `seq` whose effects are in this frame. */
      seq: number;
      /** Time the worker spent in `ui.frame()` (flush, layout, draw). */
      frameMs: number;
      /** `render` times of the audio chunks made since the last frame. */
      audioMs: number[];
    }
  | { t: "cursor"; cursor: CursorSpec }
  | { t: "menus"; menus: WireMenu[] }
  /** `id` 0 expects no reply. */
  | { t: "call"; id: number; method: string; args: unknown[] };
