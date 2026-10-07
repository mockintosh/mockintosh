/**
 * The Finder's view of per-node attributes — the modern "Desktop database":
 * where an icon sits, which custom icon it shows, and its stacking order.
 *
 * The file system persists these bags but never interprets them; this module
 * is the only place that knows their keys, so the FS core stays free of pixel
 * geometry.
 */
import { MIME, isFSError, type FileSystem, type FSNode, type NodeAttributes } from "@mockintosh/fs";

export interface IconPosition {
  x: number;
  y: number;
}

export interface FinderNodeAttributes {
  /** Sprite name overriding the default icon for the node's kind/type. */
  icon?: string;
  /** Free-form position inside the parent's icon view; absent = auto-arranged. */
  position?: IconPosition;
  /** Higher draws on top; bumped whenever the user touches the icon. */
  zOrder?: number;
}

const ICON_BY_MIME: Readonly<Record<string, string>> = {
  [MIME.sprite]: "icon/camera",
  "image/png": "icon/camera",
  "image/jpeg": "icon/camera",
  "image/gif": "icon/camera",
  "image/webp": "icon/camera",
  [MIME.canvas]: "canvas/icon",
  [MIME.paint]: "macpaint/document",
  [MIME.app]: "icon/appstore-smr-32x32",
  [MIME.appShortcut]: "icon/computer",
};

function isIconPosition(v: unknown): v is IconPosition {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as IconPosition).x === "number" &&
    typeof (v as IconPosition).y === "number"
  );
}

/** Typed, validated read of a node's Finder attributes (reactive). */
export function finderAttributes(fs: FileSystem, nodeId: string): FinderNodeAttributes {
  const raw: NodeAttributes = fs.attributes(nodeId);
  const out: FinderNodeAttributes = {};
  if (typeof raw.icon === "string") out.icon = raw.icon;
  if (isIconPosition(raw.position)) out.position = { x: raw.position.x, y: raw.position.y };
  if (typeof raw.zOrder === "number") out.zOrder = raw.zOrder;
  return out;
}

/** Sprite name to draw for a node: custom icon, else by role, kind and type. */
export function iconForNode(fs: FileSystem, node: FSNode): string {
  const custom = finderAttributes(fs, node.id).icon;
  if (custom) return custom;
  if (node.kind === "directory") {
    if (node.role === "trash") return "icon/trash";
    if (node.role === "volume") return "icon/hd";
    return "icon/folder";
  }
  return ICON_BY_MIME[node.type] ?? "icon/file";
}

export function setIconPosition(fs: FileSystem, nodeId: string, position: IconPosition | undefined): void {
  fs.setAttributes(nodeId, { position: position ? { x: position.x, y: position.y } : null });
}

/** Put the node above every sibling in its parent's icon view. */
export function bumpZOrder(fs: FileSystem, nodeId: string): void {
  const node = fs.node(nodeId);
  if (!node || node.parentId === null) return;
  let maxZ = 0;
  for (const sibling of fs.children(node.parentId)) {
    const z = finderAttributes(fs, sibling.id).zOrder ?? 0;
    if (z > maxZ) maxZ = z;
  }
  fs.setAttributes(nodeId, { zOrder: maxZ + 1 });
}

/**
 * Save several icons' positions as one write. A node that went away or is
 * mid-write is skipped; its view places it again on the next pass.
 */
export function setIconPositions(fs: FileSystem, positions: ReadonlyMap<string, IconPosition>): void {
  fs.batch(() => {
    for (const [nodeId, position] of positions) {
      try {
        setIconPosition(fs, nodeId, position);
      } catch (err) {
        if (!isFSError(err)) throw err;
      }
    }
  });
}

export interface IconPlacement {
  nodeId: string;
  /** Free-form position, or `undefined` to auto-arrange. */
  position: IconPosition | undefined;
}

/**
 * Drop a set of icons into `directoryId` at the given positions: move those
 * that come from elsewhere, place them, and bring them to the front. One
 * reactive update and one persistence write for the whole drop.
 */
export function placeIcons(fs: FileSystem, directoryId: string, placements: IconPlacement[]): void {
  fs.batch(() => {
    for (const p of placements) {
      const node = fs.node(p.nodeId);
      if (!node) continue;
      if (node.parentId !== directoryId) fs.move(p.nodeId, directoryId);
      setIconPosition(fs, p.nodeId, p.position);
      bumpZOrder(fs, p.nodeId);
    }
  });
}
