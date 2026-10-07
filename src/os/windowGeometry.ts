/**
 * Window chrome geometry — the single source of truth for frame, title bar,
 * info bar and scrollbar metrics.
 *
 * Model: `win.x / win.y / win.width` and `windowTotalHeight()` describe the
 * OUTER frame. The body box draws the frame as its border and every other
 * chrome element is laid out in the frame's interior; `@mockintosh/ui` insets
 * children by the border and clips them to it, so nothing inside a window can
 * ever paint over its frame.
 *
 * Which chrome a window has at all — title bar, frame, shadow — is the window
 * definition's say (`windowKinds.ts`); the helpers here take the window so
 * callers never look at the kind themselves.
 *
 * Classic Mac scrollbars and the grow box are 16px bands that *include* the
 * frame line they sit against, so their 16px sprites are placed on the last
 * interior column/row and get clipped by the frame.
 */

import type { OSWindow } from "./state";
import { windowDefinition } from "./windowKinds";

export const FRAME       = 1;    // window frame line, for kinds that have one
export const TITLE_BAR_H = 20;   // outer: top frame + stripes + separator line
export const INFO_BAR_H  = 20;   // includes its bottom separator line
export const SB_W        = 16;   // scrollbar band, including the frame line it shares
export const SHADOW      = 1;
export const CLOSE_SIZE  = 11;
export const ZOOM_SIZE   = 11;
export const GROW_SIZE   = 16;

/** Scrollbar / grow-box footprint inside the frame. */
export const SB_INNER = SB_W - FRAME;

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Total chrome thickness on each edge: outer hairline + optional white gap
 * + optional inner band. Content and `windowTotalHeight` use this; the body
 * box itself only draws `definition.frame` as its border.
 */
export function windowFrame(win: Pick<OSWindow, "kind">): number {
  const d = windowDefinition(win.kind);
  return d.frame + (d.frameGap ?? 0) + (d.innerFrame ?? 0);
}

/** Outer hairline only — the body box's `borderWidth`. */
export function windowOuterFrame(win: Pick<OSWindow, "kind">): number {
  return windowDefinition(win.kind).frame;
}

export function hasTitleBar(win: Pick<OSWindow, "kind">): boolean {
  return windowDefinition(win.kind).titleBar;
}

export function hasInfoBar(win: Pick<OSWindow, "kind" | "infoBar">): boolean {
  return hasTitleBar(win) && !!win.infoBar && win.infoBar.length > 0;
}

/** App-filled band below the title bar; `infoBar` is the 20px text fallback. */
export function headerBandHeight(
  win: Pick<OSWindow, "kind" | "headerHeight" | "infoBar">
): number {
  if (!hasTitleBar(win)) return 0;
  if (win.headerHeight !== undefined) return win.headerHeight;
  return hasInfoBar(win) ? INFO_BAR_H : 0;
}

export function footerBandHeight(win: Pick<OSWindow, "footerHeight">): number {
  return win.footerHeight ?? 0;
}

/**
 * Outer height of this window's drag/title bar, including the top frame line.
 * An untitled utility window is the HIG's 11px drag region; a title uses the
 * document height. Callers that omit `title` get the titled height.
 */
export function titleBarOuterHeight(win: Pick<OSWindow, "kind"> & { title?: string }): number {
  const d = windowDefinition(win.kind);
  if (!d.titleBar) return 0;
  if (d.toolPalette && win.title === "") return d.untitledBarHeight ?? d.titleBarHeight;
  return d.titleBarHeight;
}

/** Outer height of the title bar + header band; frame only without a title bar. */
export function windowHeaderHeight(
  win: Pick<OSWindow, "kind" | "headerHeight" | "infoBar"> & { title?: string }
): number {
  if (!hasTitleBar(win)) return windowFrame(win);
  return titleBarOuterHeight(win) + headerBandHeight(win);
}

/** Outer frame height. */
export function windowTotalHeight(
  win: Pick<OSWindow, "kind" | "headerHeight" | "infoBar" | "footerHeight" | "height" | "scrollable"> & {
    title?: string;
  }
): number {
  return (
    windowHeaderHeight(win) +
    win.height +
    footerBandHeight(win) +
    (win.scrollable ? SB_W : windowFrame(win))
  );
}

/** Zooming changes the size, so like the grow box it needs a resizable window of a kind that has one. */
export function hasZoomBox(win: Pick<OSWindow, "kind" | "resizable">): boolean {
  return win.resizable && windowDefinition(win.kind).zoomBox;
}

/** Whether the window shows a grow box: it must be resizable and of a kind that has one. */
export function hasGrowBox(win: OSWindow): boolean {
  return win.resizable && windowDefinition(win.kind).growBox;
}

/**
 * Whether the window keeps an empty scroll-bar band down its right edge for
 * the grow box: resizable, no scroll bars, and not asking for the grow box
 * over its content.
 */
export function hasGrowBand(win: OSWindow): boolean {
  return !win.scrollable && hasGrowBox(win) && win.growBox !== "overlay";
}

/** Width available to the window's content component. */
export function windowContentWidth(win: OSWindow): number {
  const reserved = win.scrollable || hasGrowBand(win) ? SB_INNER : 0;
  return win.width - 2 * windowFrame(win) - reserved;
}

/**
 * Screen-space rectangle of the content viewport (inside the frame, below the
 * header, left of the scrollbar). Content coordinate (0,0) maps to (x, y) at
 * scroll offset 0.
 */
export function windowContentRect(win: OSWindow): ScreenRect {
  return {
    x: win.x + windowFrame(win),
    y: win.y + windowHeaderHeight(win),
    width: windowContentWidth(win),
    height: win.height,
  };
}
