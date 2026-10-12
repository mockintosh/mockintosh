/**
 * A disk the system ships rather than one the user's storage holds — the
 * Tour disk, a CD-ROM. `FileSystem.mount` shows it as a locked volume: its
 * nodes live in the catalog like any other, so every view and app process
 * sees them, but they are never persisted and nothing on it can change.
 * Bodies come from the image when read, so a large file costs nothing until
 * it is opened.
 */
import type { FileContent, NodeAttributes } from "./types";

export interface VolumeImageFolder {
  kind: "directory";
  name: string;
  entries: readonly VolumeImageEntry[];
  /** Initial Finder attributes (an icon position, a custom icon). */
  attributes?: NodeAttributes;
}

export interface VolumeImageFile {
  kind: "file";
  name: string;
  type: string;
  /** The body, inline… */
  content?: FileContent;
  /** …or fetched the first time it is read. */
  read?: () => Promise<Uint8Array>;
  /** The body's size when it isn't inline. */
  size?: number;
  /** Where it can be streamed from; see `FSFile.url`. */
  url?: string;
  attributes?: NodeAttributes;
}

export type VolumeImageEntry = VolumeImageFolder | VolumeImageFile;

export interface VolumeImage {
  /** Stable key; the volume's node ids derive from it, so they survive a reboot. */
  key: string;
  name: string;
  /** The user can eject it. */
  ejectable?: boolean;
  entries: readonly VolumeImageEntry[];
  attributes?: NodeAttributes;
}
