/**
 * Copying icons, for drops the Finder can't make a move: onto another disk,
 * or off a locked one (the Tour disk). As on the Mac, dragging between disks
 * copies and dragging within one moves.
 */
import type { FileSystem, FSNode } from "@mockintosh/fs";
import { bumpZOrder, setIconPosition, type IconPlacement } from "./attributes";

/** Finder attributes that describe where an icon sat, which a copy gets afresh. */
const PLACEMENT_KEYS = new Set(["position", "zOrder"]);

/** Whether dropping `nodeId` into `targetDirId` copies it rather than moving it. */
export function dropCopies(fs: FileSystem, nodeId: string, targetDirId: string): boolean {
  return fs.isLocked(nodeId) || fs.volumeOf(nodeId)?.id !== fs.volumeOf(targetDirId)?.id;
}

/** Copy `nodeId` (a folder with everything in it) into `targetDirId`, under a free name. */
export async function copyNode(fs: FileSystem, nodeId: string, targetDirId: string): Promise<FSNode> {
  const node = fs.node(nodeId);
  if (!node) throw new Error(`No such item: ${nodeId}`);
  const name = fs.availableName(targetDirId, node.name);
  const attributes = Object.fromEntries(Object.entries(fs.attributes(nodeId)).filter(([key]) => !PLACEMENT_KEYS.has(key)));
  if (node.kind === "file") {
    const bytes = (await fs.readBytes(node.id)) ?? new Uint8Array();
    return fs.writeFile(targetDirId, name, bytes, { type: node.type, attributes, ...(node.url ? { url: node.url } : {}) });
  }
  const folder = fs.mkdir(targetDirId, name);
  if (Object.keys(attributes).length) fs.setAttributes(folder.id, attributes);
  for (const child of fs.children(node.id)) {
    const copy = await copyNode(fs, child.id, folder.id);
    const position = fs.attributes(child.id).position;
    if (position !== undefined) fs.setAttributes(copy.id, { position });
  }
  return folder;
}

/** Copy dropped icons into `targetDirId`, each placed where it was dropped and brought to the front. */
export async function copyIcons(fs: FileSystem, targetDirId: string, placements: readonly IconPlacement[]): Promise<void> {
  for (const placement of placements) {
    const copy = await copyNode(fs, placement.nodeId, targetDirId);
    setIconPosition(fs, copy.id, placement.position);
    bumpZOrder(fs, copy.id);
  }
}
