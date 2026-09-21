/**
 * Host file import — a file the user dragged from the real computer onto the
 * Mockintosh screen becomes an ordinary FS node. Dropping it on Dither,
 * Trace or Foundry opens that app; anything else lands in the folder under
 * the pointer.
 */
import { inferMimeType, isFontType, isImageType, MIME, uniqueChildName, type FileSystem, type FSFile } from "@mockintosh/fs";
import type { HostFileDrop } from "../platform/types";
import type { OSWindow } from "./state";
import { windowContentRect, windowTotalHeight } from "./windowGeometry";

export const DITHER_APP_ID = "dither";
export const TRACE_APP_ID = "trace";
export const FOUNDRY_APP_ID = "foundry";
export const IMPORTED_IMAGE_ICON = "icon/camera";
export const IMPORTED_FONT_ICON = "foundry/icon";

export interface ImportTarget {
  parentId: string;
  position: { x: number; y: number };
  /** When the drop landed on this app's window, open the new file there. */
  openIn?: string;
}

export function isImportableImage(file: HostFileDrop): boolean {
  if (isImageType(file.type)) return true;
  return isImageType(inferMimeType(file.name));
}

export function isImportableFont(file: HostFileDrop): boolean {
  if (isFontType(file.type)) return true;
  return isFontType(inferMimeType(file.name));
}

export function isImportableHostFile(file: HostFileDrop): boolean {
  return isImportableImage(file) || isImportableFont(file);
}

/**
 * Frontmost window under `(x, y)` that should receive the drop: Dither opens
 * the file; a Finder folder keeps it; everything else falls through to the
 * desktop.
 */
export function resolveImportTarget(
  fs: FileSystem,
  windows: readonly OSWindow[],
  x: number,
  y: number,
  menubarHeight: number,
): ImportTarget | null {
  const desktop = fs.locate("desktop");
  if (!desktop) return null;

  for (const win of [...windows].reverse()) {
    const height = windowTotalHeight(win);
    const inside =
      x >= win.x && x < win.x + win.width && y >= win.y && y < win.y + height;
    if (!inside) continue;

    if (win.appId === DITHER_APP_ID || win.appId === TRACE_APP_ID || win.appId === FOUNDRY_APP_ID) {
      return {
        parentId: desktop.id,
        position: desktopPosition(x, y, menubarHeight),
        openIn: win.appId,
      };
    }
    if (win.kind === "finder-folder") {
      const dirId = win.props.directoryId;
      if (typeof dirId !== "string") break;
      const content = windowContentRect(win);
      return {
        parentId: dirId,
        position: {
          x: Math.max(0, x - content.x + win.scrollX),
          y: Math.max(0, y - content.y + win.scrollY),
        },
      };
    }
    break;
  }

  return { parentId: desktop.id, position: desktopPosition(x, y, menubarHeight) };
}

function desktopPosition(x: number, y: number, menubarHeight: number): { x: number; y: number } {
  return { x: Math.max(0, x - 32), y: Math.max(0, y - menubarHeight - 16) };
}

export async function importHostFile(
  fs: FileSystem,
  parentId: string,
  file: HostFileDrop,
  position: { x: number; y: number },
): Promise<FSFile> {
  const inferred = inferMimeType(file.name);
  const type = isImageType(file.type)
    ? file.type
    : isFontType(file.type)
      ? file.type === "font/otf"
        ? "font/otf"
        : MIME.truetype
      : inferred;
  const name = uniqueChildName(fs, parentId, file.name.trim() || "untitled");
  return fs.writeFile(parentId, name, file.bytes, {
    type,
    attributes: {
      icon: isImportableFont({ ...file, type }) ? IMPORTED_FONT_ICON : IMPORTED_IMAGE_ICON,
      position: { x: position.x, y: position.y },
    },
  });
}
