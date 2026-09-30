/**
 * Core file-system types.
 *
 * The catalog is a flat map of nodes keyed by id; hierarchy is expressed
 * through `parentId`. File bodies live in a `FSBackend` blob store keyed by
 * the same id, so the catalog is small enough to hold in memory and persist
 * as a single JSON document.
 */

export type NodeId = string;

/** The invisible root that holds volumes. Never shown, never removed. */
export const ROOT_ID: NodeId = "__root__";

/**
 * Well-known locations. A role is a stable identity for a directory the OS
 * needs to find without knowing its name — renaming "Trash" must not break
 * the Finder. At most one node per role per volume (anywhere in the volume,
 * not only at its top level); `root` is unique.
 *
 *   volume         a disk shown on the desktop; direct child of the root
 *   desktop        the volume's Desktop Folder
 *   trash          the volume's Trash
 *   applications   installed apps (`MIME.app` manifests)
 *   system         the System Folder
 *   preferences    per-app storage folders (`System Folder/Preferences/<appId>`)
 *   pictures       the volume's Pictures folder (user pictures, not settings)
 *   fonts          `System Folder/Fonts`: suitcases, TrueType files and strikes loaded at boot
 */
export type NodeRole =
  | "root"
  | "volume"
  | "desktop"
  | "trash"
  | "applications"
  | "system"
  | "preferences"
  | "pictures"
  | "extensions"
  | "printer-drivers"
  | "fonts";

export interface FSNodeBase {
  id: NodeId;
  name: string;
  parentId: NodeId | null;
  /** Epoch milliseconds. */
  createdAt: number;
  modifiedAt: number;
  /** Monotonic resource revision, persisted with the catalog. */
  revision: number;
  role?: NodeRole;
}

export interface FSFile extends FSNodeBase {
  kind: "file";
  /** MIME type. This is the single source of truth for "what is this file". */
  type: string;
  /** Body size in bytes. */
  size: number;
}

export interface FSDirectory extends FSNodeBase {
  kind: "directory";
}

export type FSNode = FSFile | FSDirectory;

/**
 * Per-node attributes owned by *consumers* of the file system, not by it —
 * the Finder's icon positions, custom icons and stacking order, for example
 * (the Mac kept these in the "Desktop database"). The FS persists and
 * garbage-collects them with the node but never interprets them.
 */
export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };
export type NodeAttributes = Readonly<Record<string, AttributeValue>>;

/** Text or bytes — text is UTF-8 encoded on write. */
export type FileContent = string | Uint8Array;

export interface WriteFileOptions {
  /** Compare-and-swap; zero requires a new file. */
  expectedRevision?: number;
  /** MIME type; defaults to the existing file's type, else inferred from the name. */
  type?: string;
  /** Attributes to merge into the node's attribute bag on write. */
  attributes?: NodeAttributes;
}

/** MIME types the OS itself defines. */
export const MIME = {
  text: "text/plain",
  markdown: "text/markdown",
  html: "text/html",
  json: "application/json",
  binary: "application/octet-stream",
  /** JSON `{ width, height, data }` — a 2bpp base64 sprite, see `defineSprite`. */
  sprite: "image/x-mockintosh-sprite",
  /** JSON Canvas document — retained shapes and text, not a bitmap. */
  canvas: "application/x-mockintosh-canvas",
  /** JSON `{ appId }` — a Finder icon that launches an app. */
  appShortcut: "application/x-mockintosh-app-shortcut",
  /** JSON app manifest for an installed third-party app. */
  app: "application/x-mockintosh-app",
  deck: "application/x-decker",
  /** MacPaint document ('PNTG'): 512-byte header, then 720 PackBits rows of 576 pixels. */
  paint: "image/x-macpaint",
  /** Host TrueType / OpenType bytes dropped onto the desktop. */
  truetype: "font/ttf",
  /** Decker `%%FNT1` strike text. */
  deckerFont: "application/x-mockintosh-font",
  /** Font suitcase (FOND): a family's bitmap strikes and outlines, as JSON. */
  suitcase: "application/x-mockintosh-suitcase",
} as const;

export type KnownMime = (typeof MIME)[keyof typeof MIME];
