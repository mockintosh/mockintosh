import { resolveBorderWidth, type CanvasNode } from "./nodes";

function paddingEdge(node: CanvasNode, edge: "top" | "right" | "bottom" | "left"): number {
  const base = node.style.padding ?? 0;
  if (edge === "top") return node.style.paddingTop ?? base;
  if (edge === "right") return node.style.paddingRight ?? base;
  if (edge === "bottom") return node.style.paddingBottom ?? base;
  return node.style.paddingLeft ?? base;
}

/**
 * Paint/hit Y for `overflow: scroll`. QuickDraw packs rows at `rowBytes`;
 * a fractional dest Y becomes a horizontal byte offset and glyphs walk
 * off the clip. Finger-drag stays on whole pixels; flick must too.
 */
export function scrollPaintOffset(node: CanvasNode): number {
  return Math.round(node._scrollOffset);
}

/** A pane whose owner sets `scrollOffset` and moves it from `onScroll`. */
export function isScrollOwned(node: CanvasNode): boolean {
  return node.props["scrollOffset"] !== undefined && node._eventHandlers.onScroll !== undefined;
}

/** How far `overflow: scroll` can move, from laid-out children. */
export function scrollOverflow(node: CanvasNode): number {
  const bw = resolveBorderWidth(node);
  let maxBottom = node.layout.y + bw + paddingEdge(node, "top");
  for (const child of node.children) {
    if ((child.style.position ?? "relative") === "absolute") continue;
    maxBottom = Math.max(maxBottom, child.layout.y + child.layout.height);
  }
  const contentH = maxBottom - node.layout.y + bw + paddingEdge(node, "bottom");
  return Math.max(0, contentH - node.layout.height);
}

/**
 * After each layout pass: a `scrollAnchor="bottom"` pane that was at the end
 * stays at the end, and an offset left past shrunken content comes back
 * inside it. Owned panes are the owner's to clamp.
 */
export function settleScrollOffsets(node: CanvasNode): void {
  if (node.style.overflow === "scroll" && !isScrollOwned(node)) {
    const max = scrollOverflow(node);
    const atEnd = node._scrollOffset >= node._scrollMax - 1;
    if (node.props["scrollAnchor"] === "bottom" && atEnd) node._scrollOffset = Math.round(max);
    else if (node._scrollOffset > max) node._scrollOffset = Math.floor(max);
    node._scrollMax = max;
  }
  for (const child of node.children) settleScrollOffsets(child);
}

export interface ScrollTrack {
  x: number;
  y: number;
  width: number;
  height: number;
  thumbY: number;
  thumbHeight: number;
}

/** Gap from the padding-box edge so the track is not flush with the pane. */
const TRACK_INSET = 1;
const THUMB_W = 3;

/**
 * Checker-filled thumb inset from the inner right/top/bottom. The travel
 * range is the inset column; only the active segment is painted.
 * Null when the pane cannot scroll.
 */
export function scrollTrack(
  node: CanvasNode,
  x: number,
  y: number,
  width: number,
  height: number,
): ScrollTrack | null {
  const max = scrollOverflow(node);
  if (max <= 0) return null;
  const bw = resolveBorderWidth(node);
  const trackH = height - 2 * bw - 2 * TRACK_INSET;
  if (trackH <= 0 || width <= 2 * bw + TRACK_INSET + THUMB_W) return null;
  const contentH = trackH + max;
  const thumbHeight = Math.max(2, Math.round((trackH * trackH) / contentH));
  const travel = trackH - thumbHeight;
  const trackY = y + bw + TRACK_INSET;
  const thumbY = trackY + Math.round((node._scrollOffset / max) * travel);
  return {
    x: x + width - bw - TRACK_INSET - THUMB_W,
    y: trackY,
    width: THUMB_W,
    height: trackH,
    thumbY,
    thumbHeight,
  };
}
