/**
 * Finder.solid.tsx — Solid port of the Finder desktop and folder windows.
 *
 * Exports:
 *   FinderDesktop         — desktop icon area
 *   FinderFolderContent   — icon grid inside a folder window
 *   FinderDragGhost       — drag ghost (render as last child of OSRoot)
 *   buildFinderMenus      — Finder menubar for the desktop or a folder
 *   handleGlobalMouseUp   — icon drag release (drop into folder windows / desktop)
 *
 * Importing this module registers the Finder app (`FINDER_APP_ID`).
 */

import { For, Show, createSignal, createMemo, createEffect, onCleanup, type Accessor } from "solid-js";

function setToArray<T>(set: Set<T>): T[] {
  const out: T[] = [];
  set.forEach((value) => {
    out.push(value);
  });
  return out;
}
import type { JSX } from "@mockintosh/ui";
import { measureText, TextInput, type MouseEventHandlers } from "@mockintosh/ui";
import { useOS, type OSServices } from "../src/os/context";
import {
  openOSWindow,
  updateOSWindow,
  setAppMenus,
  getWindows,
  FINDER_APP_ID,
  type OSWindow,
} from "../src/os/state";
import { registerApp } from "../src/os/apps";
import { useWindow } from "../src/os/windowContext";
import { MAX_NAME_LENGTH, ROOT_ID, isFSError, type FileSystem, type FSNode } from "@mockintosh/fs";
import { WindowHeader, type MenubarDefinition } from "@mockintosh/sdk";
import {
  bumpZOrder,
  finderAttributes,
  iconForNode,
  placeIcons,
  setIconPositions,
  type IconPlacement,
  type IconPosition,
} from "./finder/attributes";
import {
  ICON_SIZE,
  DESKTOP_ICON_CELL_W,
  FOLDER_ICON_CELL_H,
  FOLDER_ICON_CELL_W,
  FOLDER_PADDING,
  arrangeIcons,
  cleanUpIcons,
  desktopGrid,
  folderGrid,
  type GridIcon,
  type IconGrid,
} from "./finder/iconGrid";
import { INFO_BAR_H, windowContentRect, windowTotalHeight } from "../src/os/windowGeometry";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const DRAG_THRESHOLD      = 4;
const LABEL_PAD           = 2;
const LABEL_H             = 14;
/** Height of an icon cell's box: icon, label, and a little slack below. */
const CELL_BOX_H          = ICON_SIZE + LABEL_H + 4;
const FONT                = "body" as const;
const RENAME_DELAY_MS     = 350;

interface LabelSpan {
  /** The label rectangle, in cell coordinates. */
  labelLeft: number;
  labelW: number;
  /** The cell widened to cover the label, in cell coordinates. */
  left: number;
  width: number;
}

/**
 * Where an icon's label sits: centred under the icon, spilling past the cell
 * on both sides when the name is wider than it. An empty name (mid-rename)
 * keeps room for the caret.
 */
function labelSpan(text: string, cellW: number): LabelSpan {
  const labelW = measureText(text || "n", FONT) + LABEL_PAD * 2;
  const labelLeft = Math.floor((cellW - labelW) / 2);
  return { labelLeft, labelW, left: Math.min(0, labelLeft), width: Math.max(cellW, labelW) };
}

/**
 * Map x within the icon cell to a caret index in `title`, using the same label
 * geometry and per-glyph hit logic as {@link TextInput}.
 */
function labelClickToCharIndex(title: string, lxInCell: number, cellW: number): number {
  const px = lxInCell - labelSpan(title, cellW).labelLeft - LABEL_PAD;
  if (px <= 0) return 0;
  let accumulated = 0;
  for (let i = 0; i < title.length; i++) {
    const cw = measureText(title[i], FONT);
    if (px < accumulated + cw / 2) return i;
    accumulated += cw;
  }
  return title.length;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FinderIcon {
  title: string;
  img: string;
  nodeId: string;
  isDirectory: boolean;
  isVolume?: boolean;
  position?: { x: number; y: number };
  zOrder: number;
}

interface PositionedIcon {
  icon: FinderIcon;
  pos: { x: number; y: number };
}

type SpriteRef = { width: number; height: number; data: Uint8Array; mask?: Uint8Array } | undefined;

type HitMask = { data: Uint8Array; width: number; height: number };

interface MarqueeState {
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
}

/**
 * Rubber-band selection on an empty background. The marquee exists only
 * while a drag is in progress — a plain press/release never shows one — and
 * a plain click (no drag) clears the selection.
 */
interface MarqueeController {
  marquee: Accessor<MarqueeState | null>;
  handlers: Pick<
    MouseEventHandlers,
    "onMouseDown" | "onDragStart" | "onDrag" | "onDragEnd" | "onClick"
  >;
}

function createMarquee(opts: {
  onSelect: (m: MarqueeState) => void;
  onPlainClick: () => void;
}): MarqueeController {
  const [marquee, setMarquee] = createSignal<MarqueeState | null>(null);
  let anchorX = 0;
  let anchorY = 0;
  let dragged = false;

  return {
    marquee,
    handlers: {
      onMouseDown: (lx, ly) => {
        anchorX = lx;
        anchorY = ly;
        dragged = false;
      },
      onDragStart: (lx, ly) => {
        dragged = true;
        setMarquee({ anchorX, anchorY, currentX: lx, currentY: ly });
      },
      onDrag: (lx, ly) => {
        setMarquee({ anchorX, anchorY, currentX: lx, currentY: ly });
      },
      onDragEnd: () => {
        const m = marquee();
        if (m) opts.onSelect(m);
        setMarquee(null);
      },
      onClick: () => {
        if (!dragged) opts.onPlainClick();
        dragged = false;
      },
    },
  };
}

/**
 * `<For>` keys by object identity, but Finder rebuilds `PositionedIcon`
 * records on every FS write (z-order bump, rename, move). Reconciling by
 * `nodeId` keeps the IconCell — and its CanvasNode — alive so an in-flight
 * pointer capture can still deliver click / dragEnd.
 */
function KeyedIcons(props: {
  each: PositionedIcon[];
  children: (item: Accessor<PositionedIcon>) => JSX.Element;
}): JSX.Element {
  const keys = createMemo(() => props.each.map((item) => item.icon.nodeId));
  const byId = createMemo(() => {
    const map = new Map<string, PositionedIcon>();
    for (const item of props.each) map.set(item.icon.nodeId, item);
    return map;
  });
  return (
    <For each={keys()}>
      {(id) => props.children(() => byId().get(id)!)}
    </For>
  );
}

/**
 * Back to front: by z-order, except the icon being renamed goes on top so a
 * neighbour's label can't cover its widening field.
 */
function paintOrder(renamingId: string | null): (a: PositionedIcon, b: PositionedIcon) => number {
  const onTop = (item: PositionedIcon) => (item.icon.nodeId === renamingId ? 1 : 0);
  return (a, b) => onTop(a) - onTop(b) || a.icon.zOrder - b.icon.zOrder;
}

function marqueeRect(m: MarqueeState): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(m.anchorX, m.currentX),
    y: Math.min(m.anchorY, m.currentY),
    w: Math.abs(m.currentX - m.anchorX),
    h: Math.abs(m.currentY - m.anchorY),
  };
}

function rectsIntersect(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ---------------------------------------------------------------------------
// Drag state (module-level — shared across all Finder component instances)
// ---------------------------------------------------------------------------

interface PendingDragCompanion {
  nodeId: string;
  img: string;
  title: string;
  cellW: number;
  /** Position relative to the primary icon's cell position. */
  offsetX: number;
  offsetY: number;
  sprite: SpriteRef;
}

interface PendingDragInfo {
  nodeId: string;
  sourceDirectoryId: string;   // FS directory the item lives in
  img: string;
  title: string;
  cellW: number;
  /** Mouse offset from the icon cell's top-left corner (screen space). */
  mouseOffsetX: number;
  mouseOffsetY: number;
  /** Position of the first onDrag call (for threshold detection). */
  firstDragX: number;
  firstDragY: number;
  thresholdMet: boolean;
  companions: PendingDragCompanion[];
}

interface ActiveDragCompanion {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  outlineData: Uint8Array;
  /** Where the outline starts, relative to the companion's cell. */
  outlineX: number;
  outlineW: number;
  outlineH: number;
}

interface ActiveDragState {
  nodeId: string;
  sourceDirectoryId: string;
  img: string;
  title: string;
  cellW: number;
  /** Screen position of the icon cell's top-left corner. */
  ghostX: number;
  ghostY: number;
  /** Pre-computed mask outline — drawn as the drag ghost. */
  outlineData: Uint8Array;
  /** Where the outline starts, relative to the cell (left of it for a wide label). */
  outlineX: number;
  outlineW: number;
  outlineH: number;
  companions: ActiveDragCompanion[];
}

let pendingDragInfo: PendingDragInfo | null = null;

export const [finderDrag, setFinderDrag] = createSignal<ActiveDragState | null>(null);

/** nodeId of the folder icon currently highlighted as a drop target. */
const [dropTargetId, setDropTargetId] = createSignal<string | null>(null);

// ---------------------------------------------------------------------------
// Ghost outline computation
// ---------------------------------------------------------------------------

/**
 * Given a sprite mask (or data if no mask), compute a new Uint8Array where
 * only the edge pixels (opaque pixel with at least one transparent neighbour)
 * are set to 1. Used for the drag ghost outline.
 */
function computeMaskOutline(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      // Treat out-of-bounds neighbours as transparent so silhouette pixels
      // that touch the image edge are correctly included in the outline.
      const hasTransparentNeighbour =
        (x === 0     || !mask[i - 1]) ||
        (x === w - 1 || !mask[i + 1]) ||
        (y === 0     || !mask[i - w]) ||
        (y === h - 1 || !mask[i + w]);
      if (hasTransparentNeighbour) out[i] = 1;
    }
  }
  return out;
}

/**
 * The icon's opaque pixels plus its label rectangle, over the cell widened to
 * the label ({@link LabelSpan}): `height` rows, `span.width` columns.
 */
function iconCellSilhouette(
  sprite: SpriteRef,
  cellW: number,
  span: LabelSpan,
  height: number,
): Uint8Array {
  const w = span.width;
  const out = new Uint8Array(w * height);
  const iconLeft = Math.floor((cellW - ICON_SIZE) / 2) - span.left;

  if (sprite) {
    const src = sprite.mask ?? sprite.data;
    const sw = Math.min(sprite.width, ICON_SIZE);
    const sh = Math.min(sprite.height, ICON_SIZE, height);
    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        if (src[sy * sprite.width + sx]) out[sy * w + iconLeft + sx] = 1;
      }
    }
  } else {
    for (let sy = 0; sy < Math.min(ICON_SIZE, height); sy++) {
      out.fill(1, sy * w + iconLeft, sy * w + iconLeft + ICON_SIZE);
    }
  }

  const labelLeft = span.labelLeft - span.left;
  for (let dy = ICON_SIZE; dy < Math.min(ICON_SIZE + LABEL_H, height); dy++) {
    out.fill(1, dy * w + labelLeft, dy * w + labelLeft + span.labelW);
  }
  return out;
}

/**
 * Build a single continuous outline that covers both the icon silhouette and
 * the label rectangle.  Where the two shapes share an edge (icon bottom ↔
 * label top), the outline is suppressed so the ghost looks like one piece.
 * `x` is where the outline starts relative to the cell, left of it for a
 * label wider than the cell.
 */
function buildOutlineForItem(
  sprite: SpriteRef, title: string, cellW: number,
): { data: Uint8Array; x: number; w: number; h: number } {
  const span = labelSpan(title, cellW);
  const h = ICON_SIZE + LABEL_H;
  const combined = iconCellSilhouette(sprite, cellW, span, h);
  return { data: computeMaskOutline(combined, span.width, h), x: span.left, w: span.width, h };
}

// ---------------------------------------------------------------------------
// FileSystem helpers
// ---------------------------------------------------------------------------

function getTrashId(fs: FileSystem): string | undefined {
  return fs.locate("trash")?.id;
}

function getDesktopFolderId(fs: FileSystem): string | undefined {
  return fs.locate("desktop")?.id;
}

/**
 * Run a file-system mutation from a Finder gesture. Expected failures (a name
 * clash on drop, a folder dragged into itself) are reported to the user;
 * anything else propagates.
 */
async function runFinderMutation(
  showDialog: OSServices["showDialog"],
  mutate: () => void | Promise<void>
): Promise<void> {
  try {
    await mutate();
  } catch (err) {
    if (isFSError(err)) await showDialog({ message: err.message, buttons: ["OK"] });
    else throw err;
  }
}

// ---------------------------------------------------------------------------
// Folder window construction — one definition for every way a folder opens
// ---------------------------------------------------------------------------

export interface FolderWindowSpec {
  title: string;
  directoryId: string;
  x: number;
  y: number;
  /** Outer frame width. */
  width: number;
  /** Content viewport height. */
  height: number;
  openedFromRect?: { x: number; y: number; width: number; height: number };
}

/** Build the OSWindow record for a Finder folder window. */
export function buildFolderWindow(fs: FileSystem, spec: FolderWindowSpec): OSWindow {
  return {
    id: `folder-${spec.directoryId}-${Date.now()}`,
    appId: FINDER_APP_ID,
    title: spec.title,
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    kind: "finder-folder",
    props: { directoryId: spec.directoryId },
    scrollY: 0,
    scrollX: 0,
    contentHeight: 300,
    contentWidth: spec.width,
    scrollable: true,
    resizable: true,
    headerHeight: INFO_BAR_H,
    openedFromRect: spec.openedFromRect,
  };
}

/** Outer frame rect of a window — the target of the zoom-open animation. */
export function windowOuterRect(win: OSWindow): { x: number; y: number; width: number; height: number } {
  return { x: win.x, y: win.y, width: win.width, height: windowTotalHeight(win) };
}

function toFinderIcon(fs: FileSystem, node: FSNode, isVolume = false): FinderIcon {
  const attrs = finderAttributes(fs, node.id);
  return {
    title: node.name,
    img: iconForNode(fs, node),
    nodeId: node.id,
    isDirectory: node.kind === "directory",
    isVolume,
    position: attrs.position,
    zOrder: attrs.zOrder ?? 0,
  };
}

/**
 * A folder window's icons. The Trash and the Desktop Folder's contents sit on
 * the desktop at desktop positions, so like a classic disk window this one
 * doesn't list them.
 */
function buildFolderIcons(fs: FileSystem, directoryId: string): FinderIcon[] {
  return fs.children(directoryId)
    .filter((n) => n.kind !== "directory" || (n.role !== "trash" && n.role !== "desktop"))
    .map((n) => toFinderIcon(fs, n));
}

function buildDesktopIcons(fs: FileSystem): FinderIcon[] {
  const icons: FinderIcon[] = [];
  const volumes = fs.volumes();

  for (const vol of volumes) icons.push(toFinderIcon(fs, vol, true));

  for (const vol of volumes) {
    const desktop = fs.locate("desktop", vol.id);
    if (!desktop) continue;
    for (const node of fs.children(desktop.id)) icons.push(toFinderIcon(fs, node));
  }

  // Trash (if not already included)
  const trashId = getTrashId(fs);
  if (trashId && !icons.some((ic) => ic.nodeId === trashId)) {
    for (const vol of volumes) {
      const trash = fs.locate("trash", vol.id);
      if (trash) {
        icons.push(toFinderIcon(fs, trash));
        break;
      }
    }
  }

  return icons;
}

/**
 * Draw positions for a view's icons, saving a slot for each icon that had
 * none so it stays put when others come and go. Clean Up moves them all to
 * their nearest grid slots.
 */
function createIconLayout<G extends IconGrid>(
  fs: FileSystem,
  icons: Accessor<FinderIcon[]>,
  grid: (icons: GridIcon[]) => G,
  home: (icon: FinderIcon, grid: G) => IconPosition | undefined = () => undefined,
): { positions: Accessor<Map<string, IconPosition>>; cleanUp: () => void } {
  const layout = createMemo(() => {
    const list = icons();
    const bare = list.map((icon): GridIcon => ({ id: icon.nodeId, position: icon.position }));
    const g = grid(bare);
    const gridIcons = list.map((icon, i): GridIcon => (icon.position ? bare[i] : { ...bare[i], home: home(icon, g) }));
    return { grid: g, ...arrangeIcons(gridIcons, g) };
  });

  createEffect(
    () => layout().placed,
    (placed) => {
      // The FS flushes on every write, which an effect callback can't do; save just after.
      if (placed.size > 0) queueMicrotask(() => setIconPositions(fs, placed));
    },
  );

  return {
    positions: () => layout().positions,
    cleanUp: () => {
      const { grid: g, positions } = layout();
      const current = [...positions].map(([id, position]) => ({ id, position }));
      setIconPositions(fs, cleanUpIcons(current, g));
    },
  };
}

function computeFolderContentHeight(positions: Iterable<IconPosition>): number {
  let maxY = 0;
  for (const pos of positions) maxY = Math.max(maxY, pos.y + FOLDER_ICON_CELL_H);
  return maxY + FOLDER_PADDING;
}

// ---------------------------------------------------------------------------
// Drag helpers
// ---------------------------------------------------------------------------

function activateDrag(
  info: PendingDragInfo,
  sprite: SpriteRef,
  ghostX: number,
  ghostY: number
): void {
  const { data, x, w, h } = buildOutlineForItem(sprite, info.title, info.cellW);

  const companions: ActiveDragCompanion[] = info.companions.map(c => {
    const outline = buildOutlineForItem(c.sprite, c.title, c.cellW);
    return {
      nodeId: c.nodeId,
      offsetX: c.offsetX,
      offsetY: c.offsetY,
      outlineData: outline.data,
      outlineX: outline.x,
      outlineW: outline.w,
      outlineH: outline.h,
    };
  });

  setFinderDrag({
    nodeId:             info.nodeId,
    sourceDirectoryId:  info.sourceDirectoryId,
    img:                info.img,
    title:              info.title,
    cellW:              info.cellW,
    ghostX,
    ghostY,
    outlineData:        data,
    outlineX:           x,
    outlineW:           w,
    outlineH:           h,
    companions,
  });
}

function updateDragPosition(gx: number, gy: number): void {
  const info = pendingDragInfo;
  if (!info) return;
  setFinderDrag((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      ghostX: gx - info.mouseOffsetX,
      ghostY: gy - info.mouseOffsetY,
    };
  });
}

/** Called from an icon's onDragEnd: resolves the drop target for an icon drag. */
export function handleGlobalMouseUp(
  x: number,
  y: number,
  menubarH: number,
  fs: FileSystem,
  showDialog: OSServices["showDialog"]
): void {
  const drag = finderDrag();
  const targetIconId = dropTargetId();
  pendingDragInfo = null;
  setDropTargetId(null);

  if (!drag) return;
  setFinderDrag(null);

  /** The dragged icon plus its companions, laid out around (x, y). */
  const placementsAt = (px: number, py: number): IconPlacement[] => [
    { nodeId: drag.nodeId, position: { x: Math.max(0, px), y: Math.max(0, py) } },
    ...drag.companions.map((c) => ({
      nodeId: c.nodeId,
      position: { x: Math.max(0, px + c.offsetX), y: Math.max(0, py + c.offsetY) },
    })),
  ];

  // Released over a folder icon: move inside and let the icons auto-arrange.
  if (targetIconId && targetIconId !== drag.sourceDirectoryId) {
    const placements: IconPlacement[] = [
      { nodeId: drag.nodeId, position: undefined },
      ...drag.companions.map((c) => ({ nodeId: c.nodeId, position: undefined })),
    ];
    void runFinderMutation(showDialog, () => placeIcons(fs, targetIconId, placements));
    return;
  }

  // Check if the release was inside an open folder window's content area.
  for (const win of [...getWindows()].reverse()) {
    if (win.kind !== "finder-folder") continue;
    const dirId = win.props?.directoryId as string;
    if (dirId === drag.nodeId) continue; // can't drop into itself

    const content = windowContentRect(win);
    const inside =
      x >= content.x && x < content.x + content.width &&
      y >= content.y && y < content.y + content.height;
    if (inside) {
      const dropX = drag.ghostX - content.x + win.scrollX;
      const dropY = drag.ghostY - content.y + win.scrollY;
      void runFinderMutation(showDialog, () => placeIcons(fs, dirId, placementsAt(dropX, dropY)));
      return;
    }
  }

  // Default: drop onto the desktop. Volumes stay at the root; everything else
  // lands in the Desktop Folder.
  const isVolume = drag.sourceDirectoryId === ROOT_ID;
  const targetDir = isVolume ? ROOT_ID : getDesktopFolderId(fs) ?? drag.sourceDirectoryId;
  void runFinderMutation(showDialog, () =>
    placeIcons(fs, targetDir, placementsAt(drag.ghostX, drag.ghostY - menubarH))
  );
}

// ---------------------------------------------------------------------------
// FinderDesktop
// ---------------------------------------------------------------------------

export function FinderDesktop(): JSX.Element {
  const os = useOS();
  const [selectedSet, setSelectedSet] = createSignal<Set<string>>(new Set(), { ownedWrite: true });
  const [renamingNodeId, setRenamingNodeId] = createSignal<string | null>(null, { ownedWrite: true });
  const [renameCaretIndex, setRenameCaretIndex] = createSignal(0, { ownedWrite: true });

  // The desktop owns the Finder's app-level menus (shown when no window, or a
  // window without its own menus, is active). Folder windows override per window.
  // Signals used here must already be declared: compute runs synchronously.
  createEffect(
    () => buildFinderMenus(os.fs, undefined, {os, selected: setToArray(selectedSet())}, () => layout.cleanUp()),
    (menus) => setAppMenus(FINDER_APP_ID, menus),
  );
  const { marquee, handlers: marqueeHandlers } = createMarquee({
    onSelect: (m) => updateMarqueeSelection(m),
    onPlainClick: () => {
      setRenamingNodeId(null);
      setSelectedSet(new Set<string>());
    },
  });

  createEffect(
    () => ({ sel: selectedSet(), rn: renamingNodeId() }),
    ({ sel, rn }) => {
      if (rn && (sel.size !== 1 || !sel.has(rn))) {
        setRenamingNodeId(null);
      }
    },
  );

  const icons = createMemo(() => {
    return buildDesktopIcons(os.fs);
  });

  const layout = createIconLayout(
    os.fs,
    icons,
    () => desktopGrid(os.resolution.width, os.resolution.height - os.menubarHeight),
    (icon, grid) => (icon.nodeId === getTrashId(os.fs) ? grid.trashSlot : undefined),
  );

  const orderedIcons = createMemo((): PositionedIcon[] => {
    const positions = layout.positions();
    return icons()
      .map((icon) => ({ icon, pos: positions.get(icon.nodeId)! }))
      .sort(paintOrder(renamingNodeId()));
  });

  const desktopIconOffsetX = Math.floor((DESKTOP_ICON_CELL_W - ICON_SIZE) / 2);

  function updateMarqueeSelection(m: MarqueeState) {
    const mr = marqueeRect(m);
    const sel = new Set<string>();
    for (const item of orderedIcons()) {
      if (rectsIntersect(mr.x, mr.y, mr.w, mr.h,
          item.pos.x + desktopIconOffsetX, item.pos.y, ICON_SIZE, ICON_SIZE)) {
        sel.add(item.icon.nodeId);
      }
    }
    setSelectedSet(sel);
  }

  function getCompanions(primaryNodeId: string): PendingDragCompanion[] {
    const sel = selectedSet();
    if (sel.size <= 1) return [];
    const primaryItem = orderedIcons().find(i => i.icon.nodeId === primaryNodeId);
    if (!primaryItem) return [];
    return orderedIcons()
      .filter(i => sel.has(i.icon.nodeId) && i.icon.nodeId !== primaryNodeId)
      .map(i => ({
        nodeId: i.icon.nodeId,
        img: i.icon.img,
        title: i.icon.title,
        cellW: DESKTOP_ICON_CELL_W,
        offsetX: i.pos.x - primaryItem.pos.x,
        offsetY: i.pos.y - primaryItem.pos.y,
        sprite: os.sprites.get(i.icon.img),
      }));
  }

  function openFolderWindow(icon: FinderIcon, iconScreenX: number, iconScreenY: number) {
    const x = 60;
    const y = os.menubarHeight + 50;
    const iconRect = {
      x: iconScreenX,
      y: iconScreenY,
      width: DESKTOP_ICON_CELL_W,
      height: ICON_SIZE + 18,
    };
    const win = buildFolderWindow(os.fs, {
      title: icon.title,
      directoryId: icon.nodeId,
      x,
      y,
      width: Math.min(400, os.resolution.width - x - 20),
      height: Math.min(200, os.resolution.height - y - 40),
      openedFromRect: iconRect,
    });

    os.playWindowOpenAnimation(iconRect, windowOuterRect(win), () => {
      openOSWindow(win);
    });
  }

  return (
    <>
      {/* Desktop drop zone — lowest priority (first child) */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={os.resolution.width}
        height={os.resolution.height - os.menubarHeight}
        {...marqueeHandlers}
      />

      {/* Desktop icons — sorted by zOrder so recently moved icons render on top */}
      <KeyedIcons each={orderedIcons()}>
        {(item) => (
          <IconCell
            item={item}
            cellW={DESKTOP_ICON_CELL_W}
            sprite={() => os.sprites.get(item().icon.img)}
            isSelected={() => selectedSet().has(item().icon.nodeId)}
            isDropTarget={() => dropTargetId() === item().icon.nodeId}
            sourceDirectoryId={() =>
              item().icon.isVolume ? ROOT_ID : (getDesktopFolderId(os.fs) ?? ROOT_ID)
            }
            onClick={() => setSelectedSet(new Set([item().icon.nodeId]))}
            onDoubleClick={() => {
              const { icon, pos } = item();
              setSelectedSet(new Set([icon.nodeId]));
              if (icon.isDirectory && !os.fs.child(icon.nodeId, "mockintosh.json")) {
                openFolderWindow(icon, pos.x, pos.y + os.menubarHeight);
              } else {
                os.openFSNode(icon.nodeId, {
                  x: pos.x,
                  y: pos.y + os.menubarHeight,
                  width: DESKTOP_ICON_CELL_W,
                  height: ICON_SIZE + 18,
                });
              }
            }}
            getCompanions={() => getCompanions(item().icon.nodeId)}
            isRenaming={() => renamingNodeId() === item().icon.nodeId}
            renameCaretIndex={() =>
              renamingNodeId() === item().icon.nodeId ? renameCaretIndex() : undefined
            }
            onStartRename={(caretIndex) => {
              const nodeId = item().icon.nodeId;
              if (selectedSet().size === 1 && selectedSet().has(nodeId)) {
                setRenameCaretIndex(caretIndex);
                setRenamingNodeId(nodeId);
              }
            }}
            onCommitRename={(newName) => {
              setRenamingNodeId(null);
              void runFinderMutation(os.showDialog, () => os.fs.rename(item().icon.nodeId, newName));
            }}
            onCancelRename={() => setRenamingNodeId(null)}
          />
        )}
      </KeyedIcons>

      {/* Marquee selection rectangle */}
      <Show when={marquee()}>
        {(m) => {
          const mr = () => marqueeRect(m());
          return (
            <box
              position="absolute"
              left={mr().x}
              top={mr().y}
              width={Math.max(1, mr().w)}
              height={Math.max(1, mr().h)}
              borderColor={1}
              borderWidth={1}
            />
          );
        }}
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// FinderFolderContent
// ---------------------------------------------------------------------------

export function FinderFolderContent(props: { directoryId: string }): JSX.Element {
  const os = useOS();
  const windowApi = useWindow();
  const win = windowApi.win;
  const [selectedSet, setSelectedSet] = createSignal<Set<string>>(new Set(), { ownedWrite: true });
  const [renamingNodeId, setRenamingNodeId] = createSignal<string | null>(null, { ownedWrite: true });
  const [renameCaretIndex, setRenameCaretIndex] = createSignal(0, { ownedWrite: true });
  const { marquee, handlers: marqueeHandlers } = createMarquee({
    onSelect: (m) => updateMarqueeSelection(m),
    onPlainClick: () => {
      setRenamingNodeId(null);
      setSelectedSet(new Set<string>());
    },
  });

  createEffect(
    () => ({ sel: selectedSet(), rn: renamingNodeId() }),
    ({ sel, rn }) => {
      if (rn && (sel.size !== 1 || !sel.has(rn))) {
        setRenamingNodeId(null);
      }
    },
  );

  const directoryId = () => props.directoryId;

  const icons = createMemo(() => {
    const id = directoryId();
    return id ? buildFolderIcons(os.fs, id) : [];
  });

  const contentW = () => windowContentRect(win).width;

  const layout = createIconLayout(os.fs, icons, (list) => folderGrid(contentW(), list));

  const orderedIcons = createMemo((): PositionedIcon[] => {
    const positions = layout.positions();
    return icons()
      .map((icon) => ({ icon, pos: positions.get(icon.nodeId)! }))
      .sort(paintOrder(renamingNodeId()));
  });

  createEffect(
    () => {
      const h = computeFolderContentHeight(layout.positions().values());
      return { h, current: win.contentHeight };
    },
    ({ h, current }) => {
      if (h !== current) updateOSWindow(win.id, { contentHeight: h });
    },
  );

  const folderIconOffsetX = Math.floor((FOLDER_ICON_CELL_W - ICON_SIZE) / 2);

  function updateMarqueeSelection(m: MarqueeState) {
    const mr = marqueeRect(m);
    const sel = new Set<string>();
    for (const item of orderedIcons()) {
      if (rectsIntersect(mr.x, mr.y, mr.w, mr.h,
          item.pos.x + folderIconOffsetX, item.pos.y, ICON_SIZE, ICON_SIZE)) {
        sel.add(item.icon.nodeId);
      }
    }
    setSelectedSet(sel);
  }

  function getCompanions(primaryNodeId: string): PendingDragCompanion[] {
    const sel = selectedSet();
    if (sel.size <= 1) return [];
    const primaryItem = orderedIcons().find(i => i.icon.nodeId === primaryNodeId);
    if (!primaryItem) return [];
    return orderedIcons()
      .filter(i => sel.has(i.icon.nodeId) && i.icon.nodeId !== primaryNodeId)
      .map(i => ({
        nodeId: i.icon.nodeId,
        img: i.icon.img,
        title: i.icon.title,
        cellW: FOLDER_ICON_CELL_W,
        offsetX: i.pos.x - primaryItem.pos.x,
        offsetY: i.pos.y - primaryItem.pos.y,
        sprite: os.sprites.get(i.icon.img),
      }));
  }

  function openNested(icon: FinderIcon, iconScreenX: number, iconScreenY: number) {
    const iconRect = { x: iconScreenX, y: iconScreenY, width: FOLDER_ICON_CELL_W, height: ICON_SIZE + 18 };
    const child = buildFolderWindow(os.fs, {
      title: icon.title,
      directoryId: icon.nodeId,
      x: win.x + 20,
      y: win.y + 20,
      width: win.width,
      height: win.height,
      openedFromRect: iconRect,
    });

    os.playWindowOpenAnimation(iconRect, windowOuterRect(child), () => {
      openOSWindow(child);
    });
  }

  const itemCount = () => `${icons().length} item${icons().length !== 1 ? "s" : ""}`;
  const dirId = () => directoryId();

  // This window's menus reflect its folder (Clean Up) and the trash state.
  createEffect(
    () => buildFinderMenus(os.fs, dirId(), {os, selected: setToArray(selectedSet())}, layout.cleanUp),
    (menus) => windowApi.setMenus(menus),
  );

  function handleScroll(dy: number): void {
    const maxY = Math.max(0, win.contentHeight - win.height);
    updateOSWindow(win.id, { scrollY: Math.max(0, Math.min(maxY, win.scrollY + dy)) });
  }

  return (
    <>
      <WindowHeader height={INFO_BAR_H}>
        <box width="100%" height="100%" paddingLeft={4} justifyContent="center">
          <text font="menu" nowrap verticalAlign="middle">{itemCount()}</text>
        </box>
      </WindowHeader>
      {/* Content drop zone (below icons in z-order = lower priority) */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={contentW()}
        height={win.height}
        {...marqueeHandlers}
        onScroll={handleScroll}
      />

      {/* Icon grid — sorted by zOrder so recently moved icons render on top */}
      <KeyedIcons each={orderedIcons()}>
        {(item) => (
          <IconCell
            item={item}
            cellW={FOLDER_ICON_CELL_W}
            sprite={() => os.sprites.get(item().icon.img)}
            isSelected={() => selectedSet().has(item().icon.nodeId)}
            isDropTarget={() => dropTargetId() === item().icon.nodeId}
            sourceDirectoryId={() => dirId() ?? ROOT_ID}
            onClick={() => setSelectedSet(new Set([item().icon.nodeId]))}
            onDoubleClick={() => {
              const { icon, pos } = item();
              setSelectedSet(new Set([icon.nodeId]));
              const content = windowContentRect(win);
              const screenX = content.x + pos.x;
              const screenY = content.y + pos.y - win.scrollY;
              if (icon.isDirectory && !os.fs.child(icon.nodeId, "mockintosh.json")) {
                openNested(icon, screenX, screenY);
              } else {
                os.openFSNode(icon.nodeId, {
                  x: screenX,
                  y: screenY,
                  width: FOLDER_ICON_CELL_W,
                  height: ICON_SIZE + 18,
                });
              }
            }}
            onScroll={handleScroll}
            getCompanions={() => getCompanions(item().icon.nodeId)}
            isRenaming={() => renamingNodeId() === item().icon.nodeId}
            renameCaretIndex={() =>
              renamingNodeId() === item().icon.nodeId ? renameCaretIndex() : undefined
            }
            onStartRename={(caretIndex) => {
              const nodeId = item().icon.nodeId;
              if (selectedSet().size === 1 && selectedSet().has(nodeId)) {
                setRenameCaretIndex(caretIndex);
                setRenamingNodeId(nodeId);
              }
            }}
            onCommitRename={(newName) => {
              setRenamingNodeId(null);
              void runFinderMutation(os.showDialog, () => os.fs.rename(item().icon.nodeId, newName));
            }}
            onCancelRename={() => setRenamingNodeId(null)}
          />
        )}
      </KeyedIcons>

      {/* Marquee selection rectangle */}
      <Show when={marquee()}>
        {(m) => {
          const mr = () => marqueeRect(m());
          return (
            <box
              position="absolute"
              left={mr().x}
              top={mr().y}
              width={Math.max(1, mr().w)}
              height={Math.max(1, mr().h)}
              borderColor={1}
              borderWidth={1}
            />
          );
        }}
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// IconCell
// ---------------------------------------------------------------------------

interface IconCellProps {
  item: Accessor<PositionedIcon>;
  cellW: number;
  sprite: Accessor<SpriteRef>;
  isSelected: () => boolean;
  isDropTarget: () => boolean;
  /** FS directory ID this icon lives in. */
  sourceDirectoryId: Accessor<string>;
  onClick: () => void;
  onDoubleClick: () => void;
  /** Forwarded from the parent scrollable container so the wheel scrolls even
   *  when hovering directly over an icon (which would otherwise block it). */
  onScroll?: (dy: number) => void;
  /** Returns companion items for multi-icon drag when this icon is part of a multi-selection. */
  getCompanions?: () => PendingDragCompanion[];
  isRenaming: () => boolean;
  /** Caret index derived from the label click that opened rename (only read while renaming). */
  renameCaretIndex: Accessor<number | undefined>;
  onStartRename: (caretIndex: number) => void;
  onCommitRename: (newName: string) => void;
  onCancelRename: () => void;
}

function IconCell(props: IconCellProps): JSX.Element {
  const os = useOS();
  const icon = () => props.item().icon;

  // Owned here, not by the rename field, so the cell widens as the name grows.
  const [renameValue, setRenameValue] = createSignal(icon().title, { ownedWrite: true });
  function startRename(caretIndex: number): void {
    setRenameValue(icon().title);
    props.onStartRename(caretIndex);
  }

  /** The label, and this cell's box widened to cover it. Children sit at `x - span().left`. */
  const span = createMemo(() =>
    labelSpan(props.isRenaming() ? renameValue() : icon().title, props.cellW),
  );
  const iconLeft = () => Math.floor((props.cellW - ICON_SIZE) / 2) - span().left;
  const labelLeft = () => span().labelLeft - span().left;

  const hitMask = createMemo((): HitMask => {
    const s = span();
    return { data: iconCellSilhouette(props.sprite(), props.cellW, s, CELL_BOX_H), width: s.width, height: CELL_BOX_H };
  });

  const isHighlighted = () => props.isSelected() || props.isDropTarget();

  let wasSelectedBeforeMouseDown = false;
  let mouseDownLY = 0;
  let lastLabelMouseDownX = 0;
  let renameTimer: ReturnType<typeof setTimeout> | null = null;

  function clearRenameTimer(): void {
    if (renameTimer) { clearTimeout(renameTimer); renameTimer = null; }
  }
  onCleanup(clearRenameTimer);

  function isPartOfActiveDrag(nodeId: string): boolean {
    const drag = finderDrag();
    if (!drag) return false;
    if (drag.nodeId === nodeId) return true;
    return drag.companions.some(c => c.nodeId === nodeId);
  }

  function handleDrag(gx: number, gy: number): void {
    clearRenameTimer();
    const info = pendingDragInfo;
    if (!info || info.nodeId !== icon().nodeId) return;

    if (!info.thresholdMet) {
      if (info.firstDragX === -Infinity) {
        info.firstDragX = gx;
        info.firstDragY = gy;
        return;
      }
      const dx = Math.abs(gx - info.firstDragX);
      const dy = Math.abs(gy - info.firstDragY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      info.thresholdMet = true;
      activateDrag(
        info,
        props.sprite(),
        gx - info.mouseOffsetX,
        gy - info.mouseOffsetY,
      );
    } else {
      updateDragPosition(gx, gy);
    }
  }

  return (
    <box semantic={{ name: icon().title, role: "icon" }}
      tabIndex={0}
      onKeyDown={(key) => { if (key === "Enter" && !props.isRenaming()) startRename(0); }}
      position="absolute"
      left={props.item().pos.x + span().left}
      top={props.item().pos.y}
      width={span().width}
      height={CELL_BOX_H}
      hitMask={props.isRenaming() ? undefined : hitMask()}
      onMouseDown={(lx, ly) => {
        if (props.isRenaming()) return;
        const ic = icon();
        wasSelectedBeforeMouseDown = props.isSelected();
        mouseDownLY = ly;
        if (ly >= ICON_SIZE) lastLabelMouseDownX = lx + span().left;
        if (!wasSelectedBeforeMouseDown) {
          props.onClick();
          bumpZOrder(os.fs, ic.nodeId);
        }
        pendingDragInfo = {
          nodeId:             ic.nodeId,
          sourceDirectoryId:  props.sourceDirectoryId(),
          img:                ic.img,
          title:              ic.title,
          cellW:              props.cellW,
          mouseOffsetX:       lx + span().left,
          mouseOffsetY:       ly,
          firstDragX:         -Infinity,
          firstDragY:         -Infinity,
          thresholdMet:       false,
          companions:         props.getCompanions?.() ?? [],
        };
      }}
      onMouseUp={() => {
        pendingDragInfo = null;
      }}
      onClick={() => {
        if (props.isRenaming()) return;
        if (!finderDrag()) {
          const isLabelClick = mouseDownLY >= ICON_SIZE;
          if (wasSelectedBeforeMouseDown && isLabelClick) {
            clearRenameTimer();
            renameTimer = setTimeout(() => {
              renameTimer = null;
              if (!finderDrag() && props.isSelected()) {
                const idx = labelClickToCharIndex(
                  icon().title,
                  lastLabelMouseDownX,
                  props.cellW,
                );
                startRename(idx);
              }
            }, RENAME_DELAY_MS);
          }
          if (!wasSelectedBeforeMouseDown) {
            props.onClick();
            bumpZOrder(os.fs, icon().nodeId);
          }
        }
      }}
      onDoubleClick={() => {
        clearRenameTimer();
        if (!finderDrag()) props.onDoubleClick();
      }}
      onDrag={(_lx, _ly, gx, gy) => handleDrag(gx, gy)}
      onDragEnd={(_lx, _ly, gx, gy) => {
        handleGlobalMouseUp(gx, gy, os.menubarHeight, os.fs, os.showDialog);
      }}
      onScroll={props.onScroll}
      onMouseEnter={() => {
        const ic = icon();
        if (finderDrag() && ic.isDirectory && !isPartOfActiveDrag(ic.nodeId)) {
          setDropTargetId(ic.nodeId);
        }
      }}
      onMouseLeave={() => {
        if (dropTargetId() === icon().nodeId) setDropTargetId(null);
      }}
    >
      {/* Icon image */}
      <Show
        when={props.sprite()}
        fallback={
          <box
            position="absolute"
            left={iconLeft()}
            top={0}
            width={ICON_SIZE}
            height={ICON_SIZE}
            background={isHighlighted() ? 1 : 0}
            borderColor={1}
            borderWidth={1}
          />
        }
      >
        {(s) => (
          <image
            position="absolute"
            left={iconLeft()}
            top={0}
            width={ICON_SIZE}
            height={ICON_SIZE}
            src={{ width: s().width, height: s().height, data: s().data, mask: s().mask }}
            mode={isHighlighted() ? "inverted" : "normal"}
          />
        )}
      </Show>

      {/* Label — static text or inline rename input */}
      <Show
        when={props.isRenaming()}
        fallback={
          <text
            position="absolute"
            left={labelLeft()}
            top={ICON_SIZE}
            padding={LABEL_PAD}
            font={FONT}
            color={isHighlighted() ? 0 : 1}
            background={isHighlighted() ? 1 : 0}
            nowrap
          >
            {icon().title}
          </text>
        }
      >
        {(_) => {
          let committed = false;

          function commit(): void {
            if (committed) return;
            committed = true;
            const trimmed = renameValue().trim();
            if (trimmed && trimmed !== icon().title) {
              props.onCommitRename(trimmed);
            } else {
              props.onCancelRename();
            }
          }

          // Remounts (z-order, For reconcile) must not cancel rename or the
          // field disappears before keystrokes arrive. Only commit a real edit.
          onCleanup(() => {
            if (committed) return;
            const trimmed = renameValue().trim();
            if (trimmed && trimmed !== icon().title) {
              committed = true;
              props.onCommitRename(trimmed);
            }
          });

          return (
            <box position="absolute" left={labelLeft()} top={ICON_SIZE} width={span().labelW}>
              <TextInput
                name="rename"
                value={renameValue()}
                onChange={setRenameValue}
                onSubmit={(v) => {
                  setRenameValue(v);
                  if (committed) return;
                  committed = true;
                  const trimmed = v.trim();
                  if (trimmed && trimmed !== icon().title) props.onCommitRename(trimmed);
                  else props.onCancelRename();
                }}
                onCancel={() => { committed = true; props.onCancelRename(); }}
                onBlur={() => commit()}
                font={FONT}
                width={span().labelW}
                height={LABEL_H}
                padding={LABEL_PAD}
                verticalAlign="top"
                borderless
                maxLength={MAX_NAME_LENGTH}
                autoFocus
                initialCaretIndex={props.renameCaretIndex()}
              />
            </box>
          );
        }}
      </Show>
    </box>
  );
}

// ---------------------------------------------------------------------------
// FinderDragGhost — rendered at OSRoot level, drawn above everything
// ---------------------------------------------------------------------------

export function FinderDragGhost(): JSX.Element {
  return (
    <Show when={finderDrag()}>
      {(drag) => {
        const outlineSrc = () => {
          const d = drag();
          return d.outlineData.length > 0
            ? { width: d.outlineW, height: d.outlineH, data: d.outlineData, mask: d.outlineData }
            : undefined;
        };

        return (
          <>
            <Show when={outlineSrc()}>
              {(src) => (
                <image
                  position="absolute"
                  left={drag().ghostX + drag().outlineX}
                  top={drag().ghostY}
                  width={src().width}
                  height={src().height}
                  src={src()}
                />
              )}
            </Show>
            <For each={drag().companions}>
              {(c) => {
                const cSrc = () =>
                  c.outlineData.length > 0
                    ? { width: c.outlineW, height: c.outlineH, data: c.outlineData, mask: c.outlineData }
                    : undefined;
                return (
                  <Show when={cSrc()}>
                    {(src) => (
                      <image
                        position="absolute"
                        left={drag().ghostX + c.offsetX + c.outlineX}
                        top={drag().ghostY + c.offsetY}
                        width={src().width}
                        height={src().height}
                        src={src()}
                      />
                    )}
                  </Show>
                );
              }}
            </For>
          </>
        );
      }}
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Finder menus
// ---------------------------------------------------------------------------

/**
 * Finder menubar for the desktop (`activeDirId` undefined) or a folder window.
 * Pure: callers install the result via `setAppMenus` / `useWindow().setMenus`
 * and rebuild it when the file system changes.
 */
export function buildFinderMenus(
  fs: FileSystem,
  activeDirId?: string,
  selection?: {os: ReturnType<typeof useOS>; selected: readonly string[]},
  cleanUp?: () => void,
): MenubarDefinition[] {
  const selected = selection?.selected.length === 1 ? fs.node(selection.selected[0]) : undefined;
  const projectApp = selected && fs.attributes(selected.id).projectApp;
  const projectId = selected?.kind === "directory" && fs.child(selected.id, "mockintosh.json") ? selected.id
    : typeof projectApp === "string" ? selection?.os.projects?.projectIdForApp(projectApp) : undefined;
  const trashId = getTrashId(fs);
  const trashEmpty = !trashId || fs.childCount(trashId) === 0;
  // New folders go in the active folder window, or on the desktop.
  const newFolderParent = activeDirId ?? getDesktopFolderId(fs);

  return [
    {
      label: "File",
      items: [
        {
          label: "New Folder",
          shortcut: "N",
          disabled: !newFolderParent,
          onClick: () => {
            const parent = activeDirId ?? getDesktopFolderId(fs);
            if (parent) fs.mkdir(parent, fs.availableName(parent, "untitled folder"));
          },
        },
        { type: "separator" },
        { label: "Open",  shortcut: "O", disabled: true },
        { label: "Open Source", disabled: !projectId, onClick: () => {
          if (projectId && selection) selection.os.openApp("source_editor", {path: selection.os.projects!.pathFor(projectId)});
        } },
        { label: "Show Package Contents", disabled: !projectId, onClick: () => {
          if (projectId && selection) selection.os.openFolderWindow(fs.node(projectId)!.name, projectId);
        } },
        { label: "Close", disabled: true },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo",       shortcut: "Z", disabled: true },
        { type: "separator" },
        { label: "Cut",        shortcut: "X", disabled: true },
        { label: "Copy",       shortcut: "C", disabled: true },
        { label: "Paste",      shortcut: "V", disabled: true },
        { label: "Clear",      disabled: true },
        { label: "Select All", shortcut: "A", disabled: true },
      ],
    },
    {
      label: "View",
      items: [
        { label: "By Icon", disabled: true },
        { label: "By Name", disabled: true },
        { label: "By Date", disabled: true },
        { label: "By Size", disabled: true },
        { label: "By Kind", disabled: true },
      ],
    },
    {
      label: "Special",
      items: [
        {
          label: activeDirId ? "Clean Up Window" : "Clean Up Desktop",
          disabled: !cleanUp,
          onClick: () => cleanUp?.(),
        },
        {
          label: "Empty Trash",
          disabled: trashEmpty,
          onClick: async () => {
            if (!trashId) return;
            for (const child of fs.children(trashId)) await fs.remove(child.id);
          },
        },
        { type: "separator" },
        { label: "Eject Disk",  disabled: true },
        {
          label: "Erase Disk…",
          disabled: !selection?.os,
          onClick: () => {
            const os = selection?.os;
            if (!os) return;
            void (async () => {
              const volume = fs.locate("volume");
              const choice = await os.showDialog({
                message: `Erase "${volume?.name ?? "this disk"}"? Everything on this disk will be lost.`,
                buttons: ["Cancel", "Erase"],
                variant: "caution",
              });
              if (choice !== "Erase") return;
              await os.eraseDisk();
            })();
          },
        },
        { type: "separator" },
        { label: "Restart",   disabled: true },
        { label: "Shut Down", disabled: true },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// App registration — the Finder is an app like any other: folder windows are
// its windows, and it is the active app when nothing else is.
// ---------------------------------------------------------------------------

registerApp<{ directoryId: string }>({
  id: FINDER_APP_ID,
  title: "Finder",
  icon: "icon/folder",
  smallIcon: "icon/finder-16x16",
  defaultSize: { width: 400, height: 200 },
  windowKind: "finder-folder",
  scrollable: true,
  resizable: true,
  singleInstance: false,
  Component: FinderFolderContent,
});
