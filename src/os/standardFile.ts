/**
 * The Standard File Package's model: what the Open dialog lists where, the
 * folder path its pop-up shows, and type-select. The dialog itself is
 * `components/OpenDialog.solid.tsx`.
 *
 * Places are arranged as in System 7: the Desktop holds the volumes and
 * whatever is on the desktop; each volume's Desktop Folder and Trash are
 * invisible inside it, so an item on the desktop is reached from Desktop,
 * never from the disk.
 */
import { MIME, type FileSystem, type FSNode } from "@mockintosh/fs";

/** Where the dialog is looking: the Desktop, or a volume or folder. */
export type SFPlace = { kind: "desktop" } | { kind: "folder"; id: string };

export const DESKTOP: SFPlace = { kind: "desktop" };

export interface SFEntry {
  id: string;
  name: string;
  kind: "volume" | "folder" | "file";
  /** The file's MIME type; absent for volumes and folders. */
  type?: string;
}

/** True for directories the Finder keeps out of view inside a volume. */
function hiddenInVolume(node: FSNode): boolean {
  return node.kind === "directory" && (node.role === "desktop" || node.role === "trash");
}

function entry(node: FSNode): SFEntry {
  if (node.kind === "directory") return { id: node.id, name: node.name, kind: node.role === "volume" ? "volume" : "folder" };
  return { id: node.id, name: node.name, kind: "file", type: node.type };
}

/** Name order, as `IUCompString` sorts: case and accents don't separate names. */
function byName(a: SFEntry, b: SFEntry): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name);
}

/**
 * What the list shows at `place`: every folder, and the files whose type is
 * in `types` (every file when `types` is omitted), in name order. App
 * shortcuts and installed apps are the Finder's business and never listed
 * unless asked for.
 */
export function listPlace(fs: FileSystem, place: SFPlace, types?: readonly string[]): SFEntry[] {
  const listed = (nodes: FSNode[]) => nodes.filter((n) => n.kind === "directory" || shows(n.type, types)).map(entry).sort(byName);
  if (place.kind === "folder") return listed(fs.children(place.id).filter((n) => !hiddenInVolume(n)));
  // The Desktop lists its disks first, the startup disk leading, as System 7's does.
  const onDesktop = fs.volumes().flatMap((v) => {
    const desktop = fs.locate("desktop", v.id);
    return desktop ? fs.children(desktop.id) : [];
  });
  return [...fs.volumes().map(entry), ...listed(onDesktop)];
}

function shows(type: string, types?: readonly string[]): boolean {
  if (types) return types.includes(type);
  return type !== MIME.appShortcut && type !== MIME.app;
}

/** The place one level up, or null at the Desktop. */
export function parentPlace(fs: FileSystem, place: SFPlace): SFPlace | null {
  if (place.kind === "desktop") return null;
  const node = fs.node(place.id);
  if (!node || node.kind !== "directory" || node.role === "volume" || node.parentId === null) return DESKTOP;
  const parent = fs.node(node.parentId);
  if (!parent || (parent.kind === "directory" && parent.role === "desktop")) return DESKTOP;
  return { kind: "folder", id: parent.id };
}

/** `place` and every place above it, up to the Desktop: what the folder pop-up lists. */
export function placePath(fs: FileSystem, place: SFPlace): SFPlace[] {
  const path: SFPlace[] = [place];
  for (let up = parentPlace(fs, place); up; up = parentPlace(fs, up)) path.push(up);
  return path;
}

export function placeName(fs: FileSystem, place: SFPlace): string {
  return place.kind === "desktop" ? "Desktop" : (fs.node(place.id)?.name ?? "");
}

/** Whether `place` still exists to be shown. */
export function placeExists(fs: FileSystem, place: SFPlace): boolean {
  return place.kind === "desktop" || fs.node(place.id)?.kind === "directory";
}

/** The place a folder, volume or file's folder is: where the dialog opens to show it. */
export function placeOf(fs: FileSystem, id: string): SFPlace {
  const node = fs.node(id);
  if (!node) return DESKTOP;
  if (node.kind === "directory") {
    if (node.role === "desktop") return DESKTOP;
    return node.role === "root" ? DESKTOP : { kind: "folder", id: node.id };
  }
  return node.parentId ? placeOf(fs, node.parentId) : DESKTOP;
}

/** How long a pause ends a type-select prefix, as the List Manager's `lastKeyTime` check. */
export const TYPE_SELECT_TIMEOUT_MS = 1000;

/**
 * Type-select: the first entry whose name is at or after `prefix` in name
 * order, so typing "mo" selects "Motion" or, failing that, what follows it.
 * The list is in name order, so this is the nearest match.
 */
export function typeSelect(entries: readonly SFEntry[], prefix: string): number {
  if (entries.length === 0 || prefix === "") return -1;
  const at = entries.findIndex((e) => e.name.slice(0, prefix.length).localeCompare(prefix, undefined, { sensitivity: "base" }) >= 0);
  return at < 0 ? entries.length - 1 : at;
}
