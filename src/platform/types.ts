/**
 * Platform — everything the OS needs from the machine it runs on.
 *
 * The OS core (`src/os`, `lib`, and the `@mockintosh/*` packages) is written
 * against this interface only and compiles without DOM types. A platform is
 * one object built by the host entry point — `createWebPlatform()` in the
 * browser, a panel + touch controller on a microcontroller, a PNG writer in
 * tests — and handed to `bootOS()`.
 *
 * Required members are what a Macintosh has: a screen, a mouse and keyboard,
 * a clock, and a disk. Optional members are peripherals; the OS hides the
 * corresponding features when they are absent.
 */
import type { BitMap } from "@mockintosh/quickdraw";
import type { FSBackend } from "@mockintosh/fs";
import type { PrinterLinks, PrinterProfile, PrinterTransport } from "@mockintosh/print";
import type { UIClipboard, Modifiers } from "@mockintosh/ui";
import type {
  AgentRuntime,
  AppCrypto,
  AudioService,
  BrowserService,
  CameraService,
  Capability,
  FetchFunction,
  DownloadService,
  ImageService,
  MicrophoneService,
  VideoService,
} from "@mockintosh/sdk";

export interface PlatformDisplay {
  readonly width: number;
  readonly height: number;
  /**
   * Framebuffer the display hardware owns, if any (DMA buffers, shared
   * memory). When omitted, QuickDraw allocates the screen bitmap.
   */
  readonly framebuffer?: BitMap;
  /** Show the current contents of `screen` (QuickDraw's `screenBits`). */
  present(screen: BitMap): void;
  /**
   * Call `callback` once everything presented so far can be seen: the
   * browser has painted it, the panel has refreshed. Absent when a frame is
   * visible as soon as `present` returns.
   */
  whenVisible?(callback: () => void): void;
}

export type PointerButton = 0 | 1 | 2;

export interface PlatformPointerEvent {
  type: "down" | "up" | "move" | "scroll";
  /** Screen coordinates, already scaled to the display's pixel grid. */
  x: number;
  y: number;
  button?: PointerButton;
  deltaX?: number;
  deltaY?: number;
  /** Modifier keys held with this event. Hosts without a keyboard omit it. */
  modifiers?: Modifiers;
}

export interface PlatformKeyEvent {
  type: "down" | "up";
  /** Key value as in `KeyboardEvent.key` ("a", "Enter", "ArrowLeft", …). */
  key: string;
  modifiers: Modifiers;
}

/** A file the host user dropped onto the screen (browser `<input>` / drag). */
export interface HostFileDrop {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface PlatformDropEvent {
  /** Screen coordinates, already scaled to the display's pixel grid. */
  x: number;
  y: number;
  files: HostFileDrop[];
}

/** Returned by every subscription; call to unsubscribe. */
export type Unsubscribe = () => void;

export interface PlatformInput {
  onPointer(handler: (event: PlatformPointerEvent) => void): Unsubscribe;
  onKey(handler: (event: PlatformKeyEvent) => void): Unsubscribe;
  /** Host files dropped onto the screen. Absent on hosts with no such notion. */
  onDrop?(handler: (event: PlatformDropEvent) => void): Unsubscribe;
}

/**
 * What varies between hosts about time. Plain timers (`setTimeout`,
 * `setInterval`) are assumed host globals — see `core-env.d.ts`.
 */
export interface PlatformScheduler {
  /** Run `callback` before the next display refresh; returns a cancel function. */
  requestFrame(callback: (timeMs: number) => void): () => void;
  /** Monotonic milliseconds. */
  now(): number;
}

/** One poll of a phone sign-in. */
export type SignInPollResult =
  | { status: "pending" }
  | { status: "complete"; params: Record<string, string> }
  | { status: "expired" };

/** A phone sign-in in progress: what the QR code shows, and how to collect the answer. */
export interface SignInPairing {
  /** The URL the QR code encodes, opened on the phone. */
  link: string;
  /** How long the pairing stays open, in milliseconds. */
  expiresInMs: number;
  /** How often to call `poll`, in milliseconds. */
  pollIntervalMs: number;
  poll(): Promise<SignInPollResult>;
}

export interface SignInStartRequest {
  /** The provider's authorize URL. The relay sets `redirect_uri` to `redirectUri`, and `state`. */
  url: string;
  /** Shown on the phone before it goes on to the provider. */
  appTitle: string;
}

/**
 * Carries an OAuth authorization response from the user's phone to this
 * machine — a server both can reach (`api/oauth` on the web host).
 */
export interface SignInRelay {
  /** The redirect URI apps register with their provider. */
  readonly redirectUri: string;
  start(request: SignInStartRequest): Promise<SignInPairing>;
}

/** Capabilities a platform declares outright; the rest follow from which services it provides. */
export type HostCapability = "browser";

export interface PlatformEnv {
  /** Origin the OS is served from ("" when there is no such notion). */
  origin: string;
  /** Host configuration (Vite `VITE_*` values on the web). */
  config: Readonly<Record<string, string>>;
}

export interface Platform {
  display: PlatformDisplay;
  input: PlatformInput;
  scheduler: PlatformScheduler;
  /** Backing store for the file system. */
  storage: FSBackend;
  env: PlatformEnv;
  /** Host features present beyond the services below (`browser`). */
  hostCapabilities: readonly HostCapability[];
  clipboard?: UIClipboard;
  /**
   * Printers the user adds in the Chooser (USB, Bluetooth). The OS keeps a
   * list of configured printers and opens one transport per printer.
   */
  printerLinks?: PrinterLinks;
  /** A printer wired to the board itself, always present; `printerProfile` says what it is. */
  printer?: PrinterTransport;
  /** Paper width and dialect of the fixed `printer`. Absent = ESC/POS 80 mm. */
  printerProfile?: PrinterProfile;
  download?: DownloadService;
  fetch?: FetchFunction;
  images?: ImageService;
  video?: VideoService;
  camera?: CameraService;
  /** A speaker: PCM output streams the apps render into. */
  audio?: AudioService;
  /** A microphone: PCM input the apps are handed as it arrives. */
  microphone?: MicrophoneService;
  /** Runs language-model agents for apps. Absent when the host can't load the engine. */
  agentRuntime?: AgentRuntime;
  crypto: AppCrypto;
  browser?: BrowserService;
  /** Phone sign-in for apps (`useApp().signIn`). Absent when no relay server is reachable. */
  signInRelay?: SignInRelay;
  /**
   * Load a JavaScript module by URL, for installing third-party apps. Absent
   * when the host cannot load modules at runtime, where the App Store then
   * cannot install anything.
   */
  loadModule?: ModuleLoader;
  /** Load persisted bundled ESM through this host's shared runtime. */
  loadArtifact?: (code: string, identity: string) => Promise<unknown>;
  builder?: import("../shared/buildContract").BuildProvider;
  /** Read-only OS source volume (`/system/source`). Absent = no source volume. */
  source?: SourceProvider;
  /**
   * Reboot this machine. The web host reloads the page. Absent on headless
   * tests — `eraseDisk` then re-bootstraps in place.
   */
  reload?(): void;
  /**
   * The machine's screen size and how many host pixels show one screen pixel.
   * Absent when the display is fixed for the life of the boot (headless tests).
   */
  hostDisplay?: HostDisplay;
}

/** One logical framebuffer the Host panel can select. */
export interface HostResolution {
  id: string;
  label: string;
  /** Absent when the framebuffer follows the host window. */
  width?: number;
  height?: number;
}

/** `"auto"` is the largest whole zoom that fits, or native pixels in viewport mode. */
export type HostScale = number | "auto";

export interface HostDisplayState {
  resolution: string;
  width: number;
  height: number;
  scale: HostScale;
  /** Highest whole zoom the window can show for a fixed resolution. At least 1. */
  maxScale: number;
}

export interface HostDisplay {
  readonly resolutions: readonly HostResolution[];
  state(): HostDisplayState;
  setResolution(id: string): void;
  setScale(scale: HostScale): void;
  /** Logical framebuffer size changed. Scale-only changes do not call this. */
  onResize(listener: (width: number, height: number) => void): () => void;
  /** Resolution, scale, or the room available for zoom changed. */
  subscribe(listener: () => void): () => void;
}

export interface SourceFile {
  path: string;
  size: number;
  sdkClean?: boolean;
}

export interface SourceManifest {
  commit: string;
  files: SourceFile[];
}

export interface SourceProvider {
  manifest(): Promise<SourceManifest>;
  read(path: string): Promise<string>;
}

/** `import(url)` as a service — see {@link Platform.loadModule}. */
export type ModuleLoader = (url: string) => Promise<unknown>;
