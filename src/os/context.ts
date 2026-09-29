/**
 * OSContext — Solid context providing OS services to all OS components.
 * Created in solidMain.ts and provided to the tree by OSRoot.
 */

import { createContext, useContext } from "solid-js";
import type { SpriteRegistry } from "./sprites/registry";
import type { FileSystem } from "@mockintosh/fs";
import type { AnimRect } from "./zoomAnimation";
import type { AppInstaller } from "./installedApps";
import type {
  AgentRuntime,
  AppCrypto,
  AudioService,
  BrowserService,
  CameraService,
  DialogOptions,
  DownloadService,
  FetchFunction,
  ImageService,
  MicrophoneService,
  VideoService,
  WindowSpec,
} from "@mockintosh/sdk";
import type { HostDisplay, PlatformEnv, PlatformScheduler } from "../platform/types";
import type { CapabilitySet } from "./capabilities";
import type { SystemPrinters } from "./printers/manager";
import type { ScreenshotCommands } from "./screenshot";

export interface IconScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Drag outline rect — shared type for window drag and zoom animation. */
export type DragRect = AnimRect;

export type { DialogOptions };

export interface OSServices {
  instances?: import("./instances").AppInstances;
  projects?: import("./projects").ProjectService;
  shell?: import("./shell").ShellManager;
  kernel?: import("./kernel").Kernel;
  desktopSettings?: import("./kernel/settings").DesktopSettings;
  sprites: SpriteRegistry;
  fs: FileSystem;
  resolution: { width: number; height: number };
  /** Screen size and zoom, when this machine can change them after boot. */
  hostDisplay?: HostDisplay;
  menubarHeight: number;
  env: PlatformEnv;
  scheduler: PlatformScheduler;
  /** What this machine can do; apps' `requires` are checked against it. */
  capabilities: CapabilitySet;
  /** Network access, when the platform has it. */
  fetch?: FetchFunction;
  /** The configured printers (apps print to the default), when the platform can reach any. */
  printers?: SystemPrinters;
  /** Offer a file to the host user, when the platform can. */
  download?: DownloadService;
  images?: ImageService;
  video?: VideoService;
  camera?: CameraService;
  audio?: AudioService;
  microphone?: MicrophoneService;
  agentRuntime?: AgentRuntime;
  crypto: AppCrypto;
  browser?: BrowserService;
  /** Phone sign-in (`useApp().signIn`), when the platform has a relay. */
  signIn?: import("./signIn").SystemSignIn;
  /** Installs App Store apps. Remote bundles also need `Platform.loadModule`. */
  installer?: AppInstaller;
  /**
   * Open an app the way the user does: check its `requires`, bring a matching
   * open window to the front if there is one, otherwise run its `onOpen`
   * (by default: open its main window).
   */
  openApp: (appId: string, props?: Record<string, unknown>, fromRect?: IconScreenRect) => void;
  /**
   * Open a window for `appId` from a spec (defaults from its `defineApp`),
   * zooming out of `fromRect` when given. Returns the window id.
   */
  openWindow: <P extends Record<string, unknown>>(
    appId: string,
    spec?: WindowSpec<P>,
    fromRect?: IconScreenRect,
    instanceId?: string
  ) => string;
  openFolderWindow: (title: string, directoryId: string, fromRect?: IconScreenRect) => void;
  openFSNode: (nodeId: string, fromRect?: IconScreenRect) => void;
  closeWindow: (id: string) => void;
  showDialog: (options: DialogOptions) => Promise<string | null>;
  /** Run `work` under the watch cursor, once the watch is on screen (`AppContext.os.busy`). */
  busy: <T>(work: () => T | Promise<T>) => Promise<T>;
  /**
   * Play the classic zoom-open animation from `fromRect` (e.g. an icon's
   * screen rect) to `toRect` (the window rect), then call `onDone` to
   * actually add the window to state.  The render loop is blocked for the
   * duration so the XOR frames are not overwritten.
   */
  playWindowOpenAnimation: (fromRect: AnimRect, toRect: AnimRect, onDone: () => void) => void;
  /**
   * Show an XOR drag outline at the given visual rect while dragging or
   * resizing a window.  The outline is drawn every frame on top of the Solid
   * render.  `onCommit` is called on mouse-up to persist the change.
   */
  showWindowOutline: (rect: AnimRect, onCommit: () => void) => void;
  /** Remove the drag/resize outline and call the stored commit callback. */
  hideWindowOutline: () => void;
  scheduleRepaint: () => void;
  /** Full-screen and selection captures, saved as PNGs on the desktop. */
  screenshots: ScreenshotCommands;
  /**
   * Format the startup disk and come back on a first-boot volume (desktop
   * shortcuts restored). Reloads the machine when the platform can.
   */
  eraseDisk: () => Promise<void>;
}

export const OSContext = createContext<OSServices | null>(null);

export function useOS(): OSServices {
  const ctx = useContext(OSContext);
  if (!ctx) throw new Error("useOS() must be called inside the OS tree");
  return ctx;
}
