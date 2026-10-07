import { FSError } from "./errors";
import type { FileSystem } from "./fileSystem";
import type { NodeId } from "./types";

/** Longest file or folder name, in characters. */
export const MAX_NAME_LENGTH = 28;

/** Characters, not UTF-16 units, so an emoji counts once and is never split. */
function chars(text: string): string[] {
  return Array.from(text);
}

/** Whether `name` is short enough to be a file or folder name. */
export function nameFits(name: string): boolean {
  return chars(name).length <= MAX_NAME_LENGTH;
}

/**
 * Throw unless `name` fits. Only a name given to a node for the first time is
 * checked: names saved before the limit stay usable, so writing to or
 * re-making an existing node by its long name is fine.
 */
export function assertNewNameFits(name: string): void {
  if (!nameFits(name)) {
    throw new FSError("invalid-name", `"${name}" is too long. Names can have at most ${MAX_NAME_LENGTH} characters.`);
  }
}

/** `name` split at its extension's dot: `photo.png` → `photo` + `.png`. */
function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}

/**
 * `stem + tail` shortened to {@link MAX_NAME_LENGTH} by cutting the end of
 * `stem`, so a suffix like ` 2.png` survives. A tail too long to leave any
 * stem is cut too.
 */
function fitStem(stem: string, tail: string): string {
  const room = MAX_NAME_LENGTH - chars(tail).length;
  if (room < 1) return chars(stem + tail).slice(0, MAX_NAME_LENGTH).join("").trimEnd();
  const kept = chars(stem).slice(0, room).join("").trimEnd();
  return (kept || chars(stem)[0] || "") + tail;
}

/**
 * `name` shortened to {@link MAX_NAME_LENGTH}, keeping its extension: for a
 * name that comes from outside (a host file, a font family, a timestamp).
 */
export function fitName(name: string): string {
  if (nameFits(name)) return name;
  const { stem, ext } = splitExtension(name);
  return fitStem(stem, ext);
}

/**
 * `stem + suffix` shortened to {@link MAX_NAME_LENGTH} by cutting the end of
 * `stem`, so the suffix survives: `IMG_20231007_140305_123` + ` 1-bit`.
 */
export function fitNameWithSuffix(stem: string, suffix: string): string {
  return nameFits(stem + suffix) ? stem + suffix : fitStem(stem, suffix);
}

/**
 * A name that fits and is free in `parentId`: `photo.png`, then `photo 2.png`,
 * … A long name is shortened first, and its stem again to make room for the
 * number.
 */
export function availableChildName(fs: Pick<FileSystem, "child">, parentId: NodeId, name: string): string {
  const fitted = fitName(name);
  if (!fs.child(parentId, fitted)) return fitted;
  const { stem, ext } = splitExtension(fitted);
  for (let n = 2; ; n++) {
    const candidate = fitStem(stem, ` ${n}${ext}`);
    if (!fs.child(parentId, candidate)) return candidate;
  }
}

/**
 * A name that is free in `parentId`: `photo.png`, then `photo 2.png`, … Writing
 * to an existing name replaces that file, so a "save a new copy" action picks
 * its name through this.
 */
export function uniqueChildName(fs: Pick<FileSystem, "child">, parentId: NodeId, name: string): string {
  return availableChildName(fs, parentId, name.trim() || "untitled");
}
