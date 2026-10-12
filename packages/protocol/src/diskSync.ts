/**
 * Syncing a Computer Club member's home disk (docs/club-storage-plan.md):
 * what a Macintosh and the Club (`sites/club/api/disk/*`) send each other.
 * The Club keeps one row per file and folder on the disk, each with the
 * revision the Mac gave it and a change number (`seq`) to ask "what changed
 * since". The disk's own volume isn't a row: it is the parent of the top
 * folders, by the id both sides derive from the member (`homeVolumeId`).
 */

/** File contents up to this size travel inside the change. */
export const DISK_INLINE_MAX = 16 * 1024;
/** The largest file that syncs: a function's request body tops out at 4.5 MB. */
export const DISK_FILE_MAX = 4 * 1024 * 1024;
/** What a member's disk may hold. */
export const DISK_QUOTA = 100 * 1024 * 1024;
/** Rows per page of changes. */
export const DISK_PAGE = 500;

/** The id of `member`'s home disk volume, the same on every Macintosh. */
export function homeVolumeId(member: string): string {
  return `${member}.home`;
}

/** The id of `member`'s home disk folder with `role`, the same on every Macintosh. */
export function homeFolderId(member: string, role: string): string {
  return `${member}.${role}`;
}

/** A file or folder on the disk, as it travels. */
export interface SyncNode {
  id: string;
  parentId: string;
  name: string;
  kind: "file" | "directory";
  /** Files: MIME type. */
  type?: string;
  size: number;
  revision: number;
  createdAt: number;
  modifiedAt: number;
  role?: string;
  /** The Finder's icon position and the like. */
  attributes?: Record<string, unknown>;
  /** A tombstone: the node was removed. */
  deleted?: boolean;
  /** Small file contents, base64. */
  content?: string;
  /** Larger file contents, by SHA-256 (hex): `GET /api/disk/blob?sha=`. */
  sha256?: string;
}

/** `GET /api/disk/changes?since=`: rows changed after `since`, oldest first. */
export interface DiskChanges {
  /** Pass as `since` next time. */
  cursor: number;
  nodes: SyncNode[];
  /** More rows wait: ask again from `cursor`. */
  more: boolean;
  /** Bytes the disk holds, and may. */
  used: number;
  quota: number;
}

/** One change a Macintosh sends: the node as it is now, and the revision it was based on (0 = new). */
export interface DiskChange extends SyncNode {
  baseRevision: number;
}

/** `POST /api/disk/push`. */
export interface DiskPush {
  /** The Mac's catalog format: the Club refuses one older than it has seen for this disk. */
  format: number;
  changes: DiskChange[];
}

export type DiskRefusal =
  /** Someone else changed it first: `current` is the Club's version (`null`: gone). */
  | "changed"
  /** The disk would go over its quota. */
  | "over_quota"
  /** The file is over `DISK_FILE_MAX`. */
  | "too_large"
  /** Its folder isn't on the Club's disk. */
  | "missing_parent"
  /** A large file's contents haven't been uploaded. */
  | "missing_blob";

export interface DiskPushResult {
  applied: Array<{ id: string }>;
  refused: Array<{ id: string; reason: DiskRefusal; current?: SyncNode | null }>;
  used: number;
  quota: number;
}

/** Why a whole push was refused: this Macintosh's Mockintosh is older than the disk. */
export const NEWER_DISK_FORMAT = "newer_disk_format";
