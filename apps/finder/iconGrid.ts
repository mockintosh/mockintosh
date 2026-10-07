/**
 * Where Finder icons sit. A view (the desktop or a folder window) has a grid
 * of slots. An icon with a saved position stays exactly there; an icon
 * without one takes the first free slot, and the view saves that slot so the
 * icon never moves again. Only Clean Up moves saved icons, each to its
 * nearest free slot.
 */
import type { IconPosition } from "./attributes";

export const ICON_SIZE = 32;
/** Icon plus its label: what an icon covers from its origin, vertically. */
export const ICON_FOOTPRINT_H = ICON_SIZE + 18;

export const DESKTOP_ICON_CELL_W = 64;
export const DESKTOP_ICON_CELL_H = 64;
export const DESKTOP_PADDING_TOP = 8;
/** System 6 keeps the right column's icon centre 40px in from the edge, not 32. */
export const DESKTOP_PADDING_RIGHT = 8;

export const FOLDER_ICON_CELL_W = 80;
export const FOLDER_ICON_CELL_H = 56;
export const FOLDER_PADDING = 16;

export interface IconGrid {
  /** Slot origins in fill order: a new icon takes the first free one. */
  slots: readonly IconPosition[];
  /** What an icon covers from its origin; a new icon never overlaps another. */
  footprint: { width: number; height: number };
  /** The visible area, when the view can't scroll to an icon outside it. */
  bounds?: { width: number; height: number };
}

export interface DesktopGrid extends IconGrid {
  /** The Trash's place until it is moved: the bottom of the rightmost column. */
  trashSlot: IconPosition;
}

export interface GridIcon {
  id: string;
  /** Saved position; absent until the icon is first placed. */
  position?: IconPosition;
  /** Slot to take when first placed, if it is free. */
  home?: IconPosition;
}

export interface Arrangement {
  /** Where each icon draws. */
  positions: Map<string, IconPosition>;
  /** Icons that had no saved position and were just given a slot; the view saves these. */
  placed: Map<string, IconPosition>;
}

/**
 * The desktop below the menubar: columns from the right edge, each filled top
 * to bottom. The last row only needs room for an icon and its label. On a
 * 512px screen the leftmost cell starts just off screen, its icon 8px in,
 * as on a classic Mac.
 */
export function desktopGrid(width: number, height: number): DesktopGrid {
  const cols = Math.max(1, Math.floor(width / DESKTOP_ICON_CELL_W));
  const rows = Math.max(1, Math.floor((height - DESKTOP_PADDING_TOP - ICON_FOOTPRINT_H) / DESKTOP_ICON_CELL_H) + 1);
  const slot = (col: number, row: number): IconPosition => ({
    x: width - DESKTOP_PADDING_RIGHT - (col + 1) * DESKTOP_ICON_CELL_W,
    y: DESKTOP_PADDING_TOP + row * DESKTOP_ICON_CELL_H,
  });
  const slots: IconPosition[] = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) slots.push(slot(col, row));
  }
  return {
    slots,
    footprint: { width: DESKTOP_ICON_CELL_W, height: ICON_FOOTPRINT_H },
    bounds: { width, height },
    trashSlot: slot(0, rows - 1),
  };
}

/**
 * A folder window: rows from the top, each filled left to right, as many
 * columns as fit `contentWidth`. The window scrolls, so there are always
 * enough rows to place every icon and to reach the lowest one.
 */
export function folderGrid(contentWidth: number, icons: readonly GridIcon[]): IconGrid {
  const cols = Math.max(1, Math.floor((contentWidth - FOLDER_PADDING) / FOLDER_ICON_CELL_W));
  let lowest = 0;
  for (const icon of icons) if (icon.position) lowest = Math.max(lowest, icon.position.y);
  // A loose icon can cover four slots; leave room for that and one row past the lowest.
  const rows = Math.max(
    Math.ceil((icons.length * 4) / cols),
    Math.ceil((lowest - FOLDER_PADDING) / FOLDER_ICON_CELL_H) + 2,
  );
  const slots: IconPosition[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      slots.push({ x: FOLDER_PADDING + col * FOLDER_ICON_CELL_W, y: FOLDER_PADDING + row * FOLDER_ICON_CELL_H });
    }
  }
  return { slots, footprint: { width: FOLDER_ICON_CELL_W, height: ICON_FOOTPRINT_H } };
}

/**
 * Lay out a view. Saved icons stay put. Icons without a position take their
 * home slot if it's free, else the first free slot in fill order. A saved
 * icon outside `bounds` (the screen shrank) draws at the nearest free slot
 * but keeps its saved position, so it returns if the screen grows back.
 */
export function arrangeIcons(icons: readonly GridIcon[], grid: IconGrid): Arrangement {
  const positions = new Map<string, IconPosition>();
  const placed = new Map<string, IconPosition>();
  const taken: IconPosition[] = [];
  const take = (id: string, at: IconPosition) => {
    positions.set(id, at);
    taken.push(at);
  };
  const isFree = (slot: IconPosition) => !taken.some((p) => overlaps(p, slot, grid.footprint));

  const unplaced: GridIcon[] = [];
  const offscreen: GridIcon[] = [];
  for (const icon of icons) {
    if (!icon.position) unplaced.push(icon);
    else if (grid.bounds && !isVisible(icon.position, grid.footprint, grid.bounds)) offscreen.push(icon);
    else take(icon.id, icon.position);
  }

  // Icons with a home slot claim it before others fill in around them.
  const byHome = [...unplaced.filter((i) => i.home), ...unplaced.filter((i) => !i.home)];
  for (const icon of byHome) {
    const slot = icon.home && isFree(icon.home) ? icon.home : grid.slots.find(isFree) ?? leastCovered(grid, taken);
    take(icon.id, slot);
    placed.set(icon.id, slot);
  }

  for (const icon of offscreen) {
    const near = nearestFirst(icon.position!, grid.slots).find(isFree) ?? leastCovered(grid, taken);
    take(icon.id, near);
  }

  return { positions, placed };
}

/**
 * Clean Up: move every icon to its nearest free slot. The closest pairs of
 * icon and slot settle first, so an icon already near a slot keeps it. An
 * icon left over when the grid is full stays where it is.
 */
export function cleanUpIcons(
  icons: readonly { id: string; position: IconPosition }[],
  grid: IconGrid,
): Map<string, IconPosition> {
  const pairs: { icon: number; slot: number; distance: number }[] = [];
  icons.forEach((icon, i) => {
    grid.slots.forEach((slot, s) => pairs.push({ icon: i, slot: s, distance: distance2(icon.position, slot) }));
  });
  pairs.sort((a, b) => a.distance - b.distance || a.slot - b.slot || a.icon - b.icon);

  const result = new Map<string, IconPosition>();
  const usedSlots = new Set<number>();
  for (const { icon, slot } of pairs) {
    const id = icons[icon].id;
    if (result.has(id) || usedSlots.has(slot)) continue;
    result.set(id, grid.slots[slot]);
    usedSlots.add(slot);
  }
  for (const icon of icons) if (!result.has(icon.id)) result.set(icon.id, icon.position);
  return result;
}

function overlaps(a: IconPosition, b: IconPosition, size: { width: number; height: number }): boolean {
  return Math.abs(a.x - b.x) < size.width && Math.abs(a.y - b.y) < size.height;
}

/** True while the middle of the icon is on screen. */
function isVisible(p: IconPosition, size: { width: number; height: number }, bounds: { width: number; height: number }): boolean {
  const cx = p.x + size.width / 2;
  const cy = p.y + size.height / 2;
  return cx >= 0 && cx < bounds.width && cy >= 0 && cy < bounds.height;
}

function distance2(a: IconPosition, b: IconPosition): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function nearestFirst(from: IconPosition, slots: readonly IconPosition[]): IconPosition[] {
  return [...slots].sort((a, b) => distance2(from, a) - distance2(from, b));
}

/** A full grid: the slot under the fewest icons, earliest in fill order on a tie. */
function leastCovered(grid: IconGrid, taken: readonly IconPosition[]): IconPosition {
  let best = grid.slots[0];
  let bestCount = Infinity;
  for (const slot of grid.slots) {
    const count = taken.filter((p) => overlaps(p, slot, grid.footprint)).length;
    if (count < bestCount) {
      best = slot;
      bestCount = count;
    }
  }
  return best;
}
