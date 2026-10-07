/**
 * @mockintosh/sdk v2 — Solid-only public API for third-party Mockintosh apps.
 *
 * Apps export a Solid component via `defineApp`. Drawing happens through
 * `@mockintosh/ui` (`box` / `text` / `image` / `raster` / `bitmap`). OS services come
 * from `useApp()`.
 */

import { createContext, useContext, type Accessor } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import type { FileSystem } from "@mockintosh/fs";
import type { GrafPort } from "@mockintosh/quickdraw";
import type { Sprite } from "@mockintosh/ui";
import type { MenubarDefinition } from "./menus";
import type { AppScheduler, CameraService, ImageService, VideoService } from "./media";
import type { AudioService } from "./audio";
import type { MicrophoneService } from "./microphone";
import type { AgentRuntime } from "./agentRuntime";
import type { FontRasterService, FontRegistryService } from "./fontRaster";
import type { KernelClient, KernelPermission } from "./kernel";
import type { AppCrypto } from "./crypto";
import type { BrowserService } from "./browser";
import type { SignInDeclaration, SignInService } from "./signIn";

export type { MenubarDefinition, MenubarItemDef, MenubarActionItem, MenubarRadioGroupDef, MenubarSubmenuDef, MenubarSeparator } from "./menus";

// File-system vocabulary, re-exported so apps never import @mockintosh/fs
// directly (the OS owns the one FileSystem instance; apps reach it via
// `useApp().fs`).
export {
  MIME,
  ROOT_ID,
  FSError,
  isFSError,
  inferMimeType,
  isTextType,
  isImageType,
  isFontType,
  IMAGE_TYPES,
  uniqueChildName,
  FONT_TYPES,
  type NodeId,
  type NodeRole,
  type FSNode,
  type FSFile,
  type FSDirectory,
  type FileContent,
  type WriteFileOptions,
  type NodeAttributes,
  type FSErrorCode,
} from "@mockintosh/fs";

// The screen is 1-bit: every pixel is one of two inks. Sprites are the
// 1-bit image asset format; `defineSprite` / `fromGrid` build them.
export {
  BLACK,
  WHITE,
  defineSprite,
  encodeSprite,
  fromGrid,
  toBits,
  createDitherer,
  coverFrame,
  rasterizeFrame,
  isImageFrame,
  isDitheredAsset,
  Dithered,
  DitherTransition,
  paintDitherDissolve,
  encodePng1bit,
  ASCII_TILE,
  ASCII_MATCH_MODES,
  ASCII_PUNCH_MIN,
  ASCII_PUNCH_MAX,
  ASCII_PUNCH_DEFAULT,
  ASCII_DIRECTIONAL_DEFAULT,
  ASCII_NORMALIZE_DEFAULT,
  ASCII_DIFFUSE_DEFAULT,
  BASELINE_ASCII,
  resolveAsciiOptions,
  isBaselineAscii,
  asciiOptionsRevision,
  asciiToBits,
  createAsciiDitherer,
  listAsciiGlyphs,
  renderAsciiGlyphAtlas,
} from "@mockintosh/ui";
export type {
  Sprite,
  TextRun,
  ImageFrame,
  DitherMode,
  DitherOptions,
  CoverFrameOptions,
  DitheredAsset,
  DitheredProps,
  DitheredSrc,
  DitherTransitionProps,
  AsciiMatchMode,
  AsciiDitherOptions,
  ResolvedAsciiOptions,
} from "@mockintosh/ui";
export type {
  ImageService,
  VideoSource,
  VideoService,
  VideoRange,
  VideoExcerptRequest,
  VideoPicture,
  VideoSound,
  VideoExcerptClip,
  VideoExcerpt,
  CameraSource,
  CameraService,
  AppScheduler,
} from "./media";
export type {
  AudioService,
  AudioMonitor,
  AudioPortOptions,
  AudioPortStream,
  AudioStream,
  AudioStreamOptions,
  AudioStreamState,
  AudioRenderBlock,
  AudioLatency,
  DecodedWav,
} from "./audio";
export { midiToFrequency, noteName, encodeWav, decodeWav } from "./audio";
export type { MicrophoneService, MicrophoneInput, MicrophoneOptions, MicrophonePortInput, MicrophonePortOptions, AudioCaptureBlock } from "./microphone";
export type {
  AgentRuntime,
  AgentSession,
  AgentSessionOptions,
  AgentTurn,
  AgentTurnResult,
  AgentStopReason,
  AgentEvent,
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  AgentImage,
} from "./agentRuntime";
export { readWavChunk, readWavMarkers, setWavChunk, setWavMarkers } from "./wav";
export type { FontRasterMode, FontRasterOptions, FontRasterService, FontRegistryService } from "./fontRaster";
export {
  encodeDeckerFont,
  decodeDeckerFont,
  deckerFontFromDraft,
  draftFromDeckerFont,
  defaultRasterCharset,
  deckerOrdinalForCharCode,
  getGlyphPixel,
  getGlyphWidth,
  getGlyphIndexForChar,
  glyphAdvance,
  glyphOriginX,
  registerFont,
  listFonts,
  listFontFamilies,
  bakeOutlineStrike,
  clampBakeSize,
  MIN_BAKE_SIZE,
  MAX_BAKE_SIZE,
  OutlineFace,
  peekSfntFamily,
  familyKey,
  encodeSuitcase,
  decodeSuitcase,
  outlineStyleOf,
  SUITCASE_BOLD,
  SUITCASE_ITALIC,
} from "@mockintosh/ui";
export type {
  FontStrikeDraft,
  FontStrikeGlyph,
  DeckerFont,
  FontFamilyInfo,
  FontSuitcase,
  SuitcaseStrike,
  SuitcaseOutline,
  FamilyScalerSettings,
} from "@mockintosh/ui";
export type { KernelClient, KernelInvokeOptions, KernelPermission, OperationContract } from "./kernel";
export { appDeclaration, type AppDeclaration, type EncodedSprite } from "./declaration";
import type { AppDeclaration } from "./declaration";
export type { AppCrypto } from "./crypto";
export type { BrowserService } from "./browser";
export type { SignInService, SignInDeclaration } from "./signIn";
export { encodeQR } from "./qr";
export type { Resource, Job, Diagnostic, ChatMessage, CompleteResult, OpenAITool, ContentPart, ChatContent } from "@mockintosh/protocol";
export { parse, resource, jobSchema } from "@mockintosh/protocol";
export {
  readSpriteFile,
  readImageFile,
  spriteToImageFrame,
  writeSpriteFile,
  type SpriteFileContent,
  type WriteSpriteFileOptions,
  type ReadImageFileOptions,
} from "./spriteFile";
export {
  PAINT_WIDTH,
  PAINT_HEIGHT,
  PAINT_ROW_BYTES,
  PAINT_PATTERN_COUNT,
  blankPaintDocument,
  decodePaint,
  encodePaint,
  packBits,
  unpackBits,
  paintToSprite,
  paintToImageFrame,
  readPaintFile,
  writePaintFile,
  type PaintDocument,
  type WritePaintFileOptions,
} from "./paintFile";

/** Classic Alert() icon: System ICON 0 / 1 / 2 (stop / note / caution). */
export type DialogVariant = "stop" | "note" | "caution";

export interface DialogOptions {
  message: string;
  buttons?: string[];
  showInput?: boolean;
  inputDefault?: string;
  /** Which alert icon to show. Defaults to `stop`. */
  variant?: DialogVariant;
}

/**
 * Per-app key/value storage. Keys are file names inside the app's own folder
 * (`System Folder/Preferences/<appId>/`), so the user can see and delete an
 * app's data from the Finder.
 */
export interface AppStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  /** A key's raw bytes, for data that isn't text (sounds, pictures). */
  readBytes(key: string): Promise<Uint8Array | null>;
  /** Store bytes under `key`; the file's type comes from the key's extension (`take.wav` is `audio/wav`). */
  writeBytes(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * The shared file system as seen by apps: reactive catalog reads (call them
 * inside memos/effects), content access, and mutations. Well-known folders
 * are found by role (`fs.locate("desktop")`), never by name.
 */
export type AppFileSystem = Pick<
  FileSystem,
  | "node"
  | "file"
  | "directory"
  | "exists"
  | "children"
  | "childCount"
  | "child"
  | "resolve"
  | "pathOf"
  | "locate"
  | "volumes"
  | "volumeOf"
  | "readBytes"
  | "readText"
  | "readJSON"
  | "mkdir"
  | "writeFile"
  | "writeJSON"
  | "rename"
  | "move"
  | "remove"
  | "batch"
>;

/** A 1-bit image to print: 1 byte per pixel, `1` = black (a `Sprite` qualifies). */
export interface PrintableImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Which way the picture sits on the paper. */
export type PrintOrientation = "portrait" | "landscape";

export interface PrintPictureOptions {
  /**
   * How the picture meets the paper. `"auto"` (the default) picks the largest
   * whole-number scale and the orientation that fills the width. `"fit"`
   * fills the width exactly. A number is that whole-number enlargement,
   * shrunk to the paper when it doesn't fit.
   */
  scale?: "auto" | "fit" | number;
  /** `"auto"` (the default) lets `scale` choose. */
  orientation?: "auto" | PrintOrientation;
}

export interface PrintPageOptions {
  /**
   * Whole-number enlargement from drawing pixels to printer dots (default 1).
   * One-dot lines and screen fonts print faint on thermal paper; 2 makes a
   * page look like a picture printed from Preview.
   */
  scale?: number;
}

/** What {@link PrintService.layoutPicture} decided, without sending it to the printer. */
export interface PrintPictureLayout {
  /** The page as it will print, paper-width wide. */
  page: PrintableImage;
  /** Scale actually used. Smaller than requested when that wouldn't fit. */
  scale: number;
  orientation: PrintOrientation;
  paperWidth: number;
}

/**
 * System printer (a thermal receipt printer). Present on `useApp()` only when
 * the platform can reach one; apps that print should hide the feature when
 * `print` is undefined.
 */
/** A file the host user can take away (browser download, SD card, …). */
export interface HostDownload {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/**
 * Offer a file to the host user. Present on `useApp()` only when the
 * platform can; hide Export UI when `download` is undefined.
 */
export interface DownloadService {
  /** Trigger a host save. On the web this starts a download; call it from a click. */
  save(file: HostDownload): Promise<void>;
}

export interface PrintService {
  /** Paper width in dots — 576 for 80 mm paper at 203 dpi. */
  readonly paperWidth: number;
  /** Whether a printer is connected. Reactive; read it inside JSX or effects. */
  connected(): boolean;
  /**
   * Connect to a printer. On the web this opens the browser's USB device
   * picker, so it must run from a user gesture such as a button click.
   * Resolves with `connected()` still false if the user cancels the picker.
   */
  connect(): Promise<void>;
  /**
   * Print a picture, scaled to the paper.
   * Connects first if needed; resolves without printing if the user cancels.
   */
  printPicture(image: PrintableImage, options?: PrintPictureOptions): Promise<void>;
  /**
   * Lay a picture out for the default printer's paper without printing.
   * The `page` is exactly what `printPicture` would send.
   */
  layoutPicture(image: PrintableImage, options?: PrintPictureOptions): PrintPictureLayout;
  /**
   * Draw a page with QuickDraw and print it. `port` is the current port while
   * `draw` runs; `size` is the page in drawing pixels — `paperWidth / scale`
   * wide and `height` tall. Like `printPicture`, resolves without printing if
   * the user cancels.
   */
  printPage(height: number, draw: (port: GrafPort, size: { width: number; height: number }) => void, options?: PrintPageOptions): Promise<void>;
}

/**
 * The window definitions an app may ask for — the Macintosh `procID`s of
 * `NewWindow`, in spirit:
 *
 * - `document`   — title bar with close and zoom boxes; grow box and scroll
 *                  bars when the window is `resizable` / `scrollable`
 *                  (`documentProc` / `zoomDocProc`)
 * - `dialog`     — title bar with a close box, no zoom, fixed size
 *                  (`movableDBoxProc`)
 * - `utility`    — tool palette. Floats above document and full-screen
 *                  windows. An empty `title` is the untitled form: an 11px
 *                  drag bar, no title text, filled with 25% gray rather than
 *                  racing stripes. It stays lit while its app is frontmost,
 *                  together with the key document, and a click in it does not
 *                  take the key window. Hidden when another app is frontmost.
 * - `plain`      — a bare 1px frame, no title bar, cannot be moved
 *                  (`plainDBox`)
 * - `alert`      — square double frame (1px / 2px white / 2px), system-modal:
 *                  every other window ignores input until it closes (`dBoxProc`)
 * - `fullscreen` — no chrome at all; covers the whole screen, menubar
 *                  included. Touching the top edge slides the menubar down
 *                  over the picture; ⌘ shortcuts work without revealing it.
 * - `desk`       — the app's own desktop: no chrome, the whole screen under
 *                  the menubar, always behind the app's other windows. Its
 *                  content coordinates are screen coordinates. A click in it
 *                  does not take the key window, and it is hidden while
 *                  another app is frontmost. MacPaint's gray desk with its
 *                  palettes is one.
 */
export type WindowKind = "document" | "dialog" | "utility" | "plain" | "alert" | "fullscreen" | "desk";

/**
 * What an app asks for when it opens a window. Everything is optional: the
 * defaults come from the app's `defineApp` (`defaultSize`, `windowKind`,
 * `scrollable`, `resizable`, `minSize`, `title`, `Component`), so
 * `openWindow()` with no argument opens the app's main window.
 */
export interface WindowSpec<P extends Record<string, unknown> = Record<string, unknown>> {
  kind?: WindowKind;
  title?: string;
  /** Content size in pixels. Ignored for `fullscreen`, which is the screen. */
  size?: { width: number; height: number };
  /** Screen position of the window's top-left corner; staggered by the OS when omitted. */
  position?: { x: number; y: number };
  scrollable?: boolean;
  resizable?: boolean;
  /** `false` pins the window where it opened: its title bar does not drag. */
  movable?: boolean;
  /**
   * The close box asks instead of closing: `TrackGoAway` → your Close command.
   * Close the window yourself (`window.close()`) once the user agrees.
   */
  onGoAway?: () => void;
  /**
   * `false` keeps an `alert`-framed window from blocking the rest of the
   * screen — `ModalDialog` with a filter proc rather than `Alert`: the app
   * decides what clicks elsewhere do while it is up.
   */
  modal?: boolean;
  minSize?: { width: number; height: number };
  /** The content to mount; the app's `Component` when omitted. */
  Component?: (props: P) => JSX.Element;
  /** Props for the component. */
  props?: P;
}

/**
 * Everything an app can do that does not depend on being inside a window:
 * what `onOpen` receives, and what `useApp()` extends with the window it is
 * mounted in.
 */
export interface AppContext {
  /** Cleanup on app instance stop/restart. Solid component cleanup remains automatic. */
  onCleanup?(cleanup: () => void): void;
  /** Explicitly retain an instance for background work; release when it finishes. */
  keepAlive?(): () => void;
  /**
   * End this launch: close every window it owns and run its cleanup, which
   * returns the user to the Finder. File → Quit should call this. The OS does
   * not add that menu item.
   */
  quit(): void;
  getSprite(name: string): Sprite | undefined;
  storage: AppStorage;
  fs: AppFileSystem;
  os: {
    /** Open another app, as the Finder would when its icon is double-clicked. */
    openApp(appId: string, props?: Record<string, unknown>): void;
    /** @deprecated Renamed `openApp`; this opens an *app*, which decides about its windows. */
    openWindow(appId: string, props?: Record<string, unknown>): void;
    /**
     * Every app that can open files of `type`, the Finder's default first.
     * Open one with `openApp(opener.appId, fileDocumentProps)`.
     */
    openersFor(type: string): FileOpener[];
    closeWindow(windowId: string): void;
    /**
     * Resolves with the label of the button pressed or, with `showInput`,
     * the text typed — `null` when that dialog's "Cancel" is pressed.
     */
    showDialog(options: DialogOptions): Promise<string | null>;
    /**
     * Do something that keeps the Macintosh busy, under the watch cursor:
     * the watch reaches the screen first, then `work` runs — it may block
     * everything until it returns — and the cursor comes back when it (or
     * the promise it returns) settles. Nothing else draws meanwhile, so keep
     * it to a second or two.
     */
    busy<T>(work: () => T | Promise<T>): Promise<T>;
  };
  /**
   * Open one of this app's windows. Returns the new window's id, which
   * `os.closeWindow` accepts.
   */
  openWindow<P extends Record<string, unknown>>(spec?: WindowSpec<P>): string;
  fetch?: FetchFunction;
  env: {
    origin: string;
    config: Readonly<Record<string, string>>;
  };
  crypto: AppCrypto;
  browser?: BrowserService;
  /** Sign in to an OAuth provider from the user's phone, when this Macintosh can. */
  signIn?: SignInService;
  /**
   * What this Macintosh can do. Apps that work with or without a feature
   * check here instead of declaring it in `requires`.
   */
  capabilities: ReadonlySet<Capability>;
  /** The system printer, when this platform has one. */
  print?: PrintService;
  /** Offer a file to the host user, when this platform can. */
  download?: DownloadService;
  /** Decode PNG/JPEG/GIF, when this platform can. */
  images?: ImageService;
  /** Play compressed video, when this platform can. */
  video?: VideoService;
  /** Live camera frames, when this platform can. */
  camera?: CameraService;
  /** Sound output streams, when this platform has a speaker. */
  audio?: AudioService;
  /** Sound input, when this platform has a microphone. */
  microphone?: MicrophoneService;
  /** Language-model agents, when this platform can run them. */
  agentRuntime?: AgentRuntime;
  /** Bake a TrueType / OpenType file into a 1-bit strike (Foundry). */
  fontRaster?: FontRasterService;
  /** The Font Manager: installed families, session strikes, and System Folder › Fonts. */
  fonts: FontRegistryService;
  /** Frame clock and monotonic time. */
  scheduler: AppScheduler;
  /** Kernel traps, when the app declared `permissions`. */
  kernel?: KernelClient;
}

/** Request options an app may pass to `fetch` — the portable subset of `RequestInit`. */
export interface FetchRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

/** The response surface apps may rely on — the portable subset of `Response`. */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Network access as the platform provides it. The browser's `fetch`
 * satisfies this; a microcontroller supplies its own HTTP client.
 */
export type FetchFunction = (url: string, options?: FetchRequest) => Promise<FetchResponse>;

/**
 * Something an app needs from the machine that not every Mockintosh has.
 * Service capabilities (`network`, `clipboard`, `printer`) follow from the
 * platform's services; the rest are host features the platform declares.
 *
 * - `network`   — `useApp().fetch` is available
 * - `clipboard` — copy and paste work
 * - `printer`   — `useApp().print` is available
 * - `download`  — `useApp().download` is available
 * - `camera`    — `useApp().camera` is available
 * - `video`     — `useApp().video` is available
 * - `images`    — `useApp().images` is available
 * - `audio`     — `useApp().audio` is available (a speaker)
 * - `microphone` — `useApp().microphone` is available
 * - `browser`   — `useApp().browser` is available (`openExternal`, `authorize`, `loadScript`)
 * - `sign-in`   — `useApp().signIn` is available (sign in from a phone; see `SignInService`)
 * - `agent-runtime` — `useApp().agentRuntime` is available (language-model agents; see `AgentRuntime`)
 * - `fonts`     — `useApp().fontRaster` is available
 */
export type Capability =
  | "network" | "clipboard" | "printer" | "download" | "camera" | "video" | "images" | "audio" | "microphone" | "browser" | "sign-in"
  | "agent-runtime" | "fonts";

/**
 * What "About <app>…" — the first Apple-menu item while the app is frontmost —
 * shows. Everything is optional: with nothing declared the OS draws a standard
 * About box from the app's `title` and `icon`; `version` and `description` add
 * lines to that box; `Component` replaces it entirely and is mounted in a
 * fixed-size `dialog` window of `size` (the OS default when omitted).
 */
export interface AppAbout {
  /** Custom About-box content; receives no props. */
  Component?: (props: Record<string, unknown>) => JSX.Element;
  /** Content size of the About window when `Component` needs a particular one. */
  size?: { width: number; height: number };
  /** Shown as "Version <version>" in the standard box. */
  version?: string;
  /** A sentence or two about the app, wrapped in the standard box. */
  description?: string;
}

export interface SolidApp<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string;
  icon: string;
  /**
   * 16×16 menu-bar icon (`ics#`). Omit it and the OS reduces `icon` to 16×16
   * for the application menu. Supply it when you have a small icon drawn for
   * that size.
   */
  smallIcon?: string;
  /** The app's About box, opened from the Apple menu. See `AppAbout`. */
  about?: AppAbout;
  /**
   * Capabilities the app cannot work without. The OS refuses to launch the
   * app on a platform that lacks any of them and tells the user why, instead
   * of the app failing at runtime. Omit when the app runs anywhere.
   */
  requires?: Capability[];
  /**
   * Kernel traps this app may call. The OS creates a granted session for the
   * instance and exposes it as `useApp().kernel`. `kernel:*` is every trap.
   */
  permissions?: KernelPermission[];
  /**
   * Where the app signs in with `useApp().signIn`. The OS refuses authorize
   * URLs on any other host. Declare `"sign-in"` in `requires` alongside it
   * when the app cannot work signed out.
   */
  signIn?: SignInDeclaration;
  /**
   * Where the app's code runs. `"worker"`: in a process of its own (a Web
   * Worker on the web), when the platform has processes and can give the app
   * everything it declares; otherwise on the OS's thread. `"main"`: always on
   * the OS's thread. Unset: the platform decides (the web runs apps in
   * processes). Declare `"main"` only for something a process can't serve.
   */
  runtime?: "worker" | "main";
  /** Content size of the main window. */
  defaultSize: { width: number; height: number };
  /** Kind of the main window (default `document`). */
  windowKind?: WindowKind;
  scrollable?: boolean;
  resizable?: boolean;
  minSize?: { width: number; height: number };
  singleInstance?: boolean;
  /**
   * The app's menubar, shown whenever one of its windows is active. Declared
   * once for the whole app; for menus that depend on component state use
   * `useApp().setMenus` from inside the component instead.
   */
  menus?: MenubarDefinition[];
  /**
   * MIME types this app opens. When the user opens such a file from the
   * Finder, the OS launches the app with `FileDocumentProps` merged into its
   * props. A plain string claims the type as the app's `"default"`; see
   * `FileTypeClaim` for apps that can open a type but shouldn't own it.
   */
  fileTypes?: (string | FileTypeClaim)[];
  /**
   * Sprites the app draws by name (`<image src>`, `getSprite`) — including
   * its own `icon`. Registered with the OS alongside the app; keys should be
   * prefixed with the app id to avoid clashing with built-ins.
   */
  sprites?: Record<string, Sprite>;
  /** Content of the app's main window. */
  Component: (props: P) => JSX.Element;
  /**
   * What happens when the user opens the app — its `main`. The OS calls it
   * when the app's icon is double-clicked (`props` is `{}`) or a document it
   * handles is opened (`props` is `FileDocumentProps`), after checking
   * `requires` and after bringing an already-open matching window to the
   * front instead. The default opens the main window: `app.openWindow({ props })`.
   *
   * An app that should decide for itself — start in full screen, put up a
   * dialog first, or open no window at all — supplies this and opens whatever
   * it wants through `app.openWindow`. It runs outside any component, so it
   * is a place for opening windows, not for creating effects.
   *
   * The launch ends if no window is open when `onOpen` returns. To open one
   * after an `await`, hold `app.keepAlive()` until it is open.
   */
  onOpen?(app: AppContext, props: P): void;
}

/**
 * How strongly an app wants a file type (after macOS's handler rank). A
 * double-click opens the first registered `"default"` app for the type, and
 * only falls back to an `"alternate"` when no app claims it as default.
 * Alternates are still offered by "Open With".
 */
export type FileTypeRank = "default" | "alternate";

export interface FileTypeClaim {
  type: string;
  rank: FileTypeRank;
}

/** Claim `types` as an alternate opener: offered by "Open With", never the double-click default. */
export function alternateFileTypes(types: readonly string[]): FileTypeClaim[] {
  return types.map((type) => ({ type, rank: "alternate" }));
}

/** An app that can open a given file type, as listed by `os.openersFor`. */
export interface FileOpener {
  appId: string;
  title: string;
  rank: FileTypeRank;
}

/** Props the OS passes when an app is launched to open a file. */
export interface FileDocumentProps {
  /** File-system node id — read it with `useApp().fs.readText(fileId)`. */
  fileId: string;
  /** The file's name, suitable as a window title. */
  title: string;
}

export function defineApp<P extends Record<string, unknown>>(app: SolidApp<P>): SolidApp<P> {
  return app;
}

/**
 * The window a component is mounted in. Sizes are reactive accessors — read
 * them inside JSX or effects; a component that fills the window is
 * `<box width={window.width()} height={window.height()}>`.
 */
export interface AppWindow {
  readonly id: string;
  /** Content width in pixels (excluding chrome). */
  width: Accessor<number>;
  /** Content height in pixels. */
  height: Accessor<number>;
  /** Whether this is the frontmost window. */
  isActive: Accessor<boolean>;
  /** Current vertical scroll offset of the content, when `scrollable`. */
  scrollY: Accessor<number>;
  /** Scroll the content to `y`. The window keeps it within the content height it was given. */
  scrollTo(y: number): void;
  /** The window's current kind; `fullscreen` while `setFullScreen(true)` is in effect. */
  kind: Accessor<WindowKind>;
  /** Height of the scrollable document; drives the window scrollbar thumb. */
  setContentSize(width: number, height: number): void;
  setTitle(title: string): void;
  /**
   * Make this window cover the whole screen, menubar included, keeping its
   * content mounted; `false` gives it back the kind and bounds it had before.
   * A window that was *opened* as `fullscreen` has nothing to go back to and
   * stays as it is — close it instead.
   */
  setFullScreen(on: boolean): void;
  close(): void;
}

export interface AppServices extends AppContext {
  /** The window this component is mounted in. */
  window: AppWindow;
  /**
   * Set the menubar for the window this component is mounted in. It replaces
   * the app-level `menus` while this window is active, so each window's menus
   * can close over that window's own state. Call it from an effect to keep
   * `disabled` flags and radio values in sync.
   */
  setMenus(menus: MenubarDefinition[]): void;
}

/**
 * Host-only: the OS provides one `AppServices` per window through this
 * context; `useApp()` reads it, so every window sees its own services.
 */
export const AppServicesContext = createContext<AppServices | null>(null);

export { WindowHeader, WindowFooter, WindowSlotsContext } from "./windowBands";
export type { WindowBandView, WindowSlots } from "./windowBands";

export function useApp(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) {
    throw new Error("useApp() must be called inside a Mockintosh app window");
  }
  return services;
}

export {
  measureText,
  spacedFontName,
  fontLineHeight,
  drawString,
  drawPixels,
  heldModifiers,
  type Modifiers,
  type CursorFace,
  type CursorSpec,
  useTheme,
  useRadius,
  useViewport,
  themeRadius,
  RADIUS_SCALES,
  DEFAULT_THEME,
  type Ink,
  type RasterSurface,
  type RasterPaintRect,
  type RasterPaintFn,
  type UITheme,
  type RadiusScale,
  type RadiusStep,
  type ViewportSize,
} from "@mockintosh/ui";

export {
  createSignal,
  createEffect,
  createMemo,
  createContext,
  useContext,
  onCleanup,
  onSettled,
  flush,
  Loading,
  Errored,
  isPending,
  Show,
  For,
  Accordion,
  Attachment,
  Avatar,
  Badge,
  Breadcrumb,
  Bubble,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Disclosure,
  Empty,
  Field,
  InputGroup,
  Item,
  Kbd,
  Label,
  Marker,
  Menu,
  Message,
  MessageScroller,
  Note,
  Overlay,
  Pagination,
  Popover,
  Progress,
  Questionnaire,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Spinner,
  Switch,
  Table,
  Tabs,
  TextInput,
  EditableText,
  Toggle,
  ToggleGroup,
  Tooltip,
} from "@mockintosh/ui";

export { showPrintDialog, PrintScaleSelect, PrintPreview, printDotsToMillimetres, printScaleLabel } from "./printDialog";
export type { PrintDialogRequest, PrintDialogChoice, PrintScale, PrintScaleSelectProps, PrintPreviewProps } from "./printDialog";
export { Markdown, parseMarkdown } from "./markdown";
export type { MarkdownProps, LayoutNode, LayoutColumn, InlineSegment, TableRow, FormControl, WebForm } from "./markdown";
export { DocumentView } from "./document";
export { encodeQuery, formatUrl, parseUrl, queryParam, queryParams } from "./url";
export type { QueryParam, WebUrl } from "./url";
export type { DocumentViewProps, FormField } from "./document";

export interface AppManifest {
  id: string;
  title: string;
  description: string;
  icon: string;
  author: string;
  version: string;
  sdk: string;
  permissions: string[];
  entry: string;
  /** Same as `SolidApp.requires`; lets the OS skip loading a bundle it cannot run. */
  requires?: Capability[];
  /**
   * The app's declaration: its icon, window defaults and the files it opens,
   * so the OS can draw, list and launch it without running it first.
   * `mockintoshManifest()` (`@mockintosh/sdk/vite`) fills it in.
   */
  declaration?: AppDeclaration;
}
