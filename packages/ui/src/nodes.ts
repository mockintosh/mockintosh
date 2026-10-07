// -------------------------------------------------------------------------
// Layout style (Yoga-compatible subset)
// -------------------------------------------------------------------------

import type { GrafPort } from "@mockintosh/quickdraw";
import type { Sprite } from "./sprite";
import type { CursorSpec } from "./cursor";

export interface LayoutStyle {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  flexDirection?: "row" | "column";
  justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
  /** Cross-axis alignment of children. Defaults to "stretch" (flexbox). */
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  alignSelf?: "auto" | "flex-start" | "center" | "flex-end" | "stretch";
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  gap?: number;
  position?: "relative" | "absolute";
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  /**
   * Clip children to this node's padding box (inside the border). "scroll"
   * additionally applies `scrollOffset`.
   */
  overflow?: "visible" | "hidden" | "scroll";
  /**
   * Border thickness. Participates in layout like CSS: the border insets the
   * padding box, so children are laid out inside it and can never sit on it.
   * Only takes effect when `borderColor` is set (default 1 in that case).
   */
  borderWidth?: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// -------------------------------------------------------------------------
// Pattern names (1-bit dither patterns)
// -------------------------------------------------------------------------

export type PatternName =
  | "checker"
  | "gray75"
  | "gray50"
  | "gray25"
  | "hstripe"
  | "vstripe"
  | "dstripe"
  | "crosshatch"
  | "darkCheckers";

// -------------------------------------------------------------------------
// Event handler types
// -------------------------------------------------------------------------

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Event delivered to `onMouseDownCapture` handlers. Coordinates are local to
 * the node whose handler is running (not the hit target).
 */
export interface PointerCaptureEvent {
  readonly localX: number;
  readonly localY: number;
  readonly globalX: number;
  readonly globalY: number;
  /** True once any capture handler has called `preventDefault()`. */
  readonly defaultPrevented: boolean;
  /**
   * Swallow the press: no further capture handlers run, the hit target never
   * receives `onMouseDown`, and the matching mouseup / click / drag are not
   * delivered either.
   */
  preventDefault(): void;
}

export interface MouseEventHandlers {
  onClick?: (localX: number, localY: number) => void;
  onDoubleClick?: (localX: number, localY: number) => void;
  onMouseDown?: (localX: number, localY: number) => void;
  /**
   * Capture-phase mousedown: runs on every ancestor of the hit target
   * (root-most first, target last) *before* the target's `onMouseDown`.
   * Lets a container enforce policy over its subtree — e.g. a window that
   * must activate before its content reacts to a click.
   */
  onMouseDownCapture?: (event: PointerCaptureEvent) => void;
  onMouseUp?: (localX: number, localY: number) => void;
  /** The pointer moved over this node with no press captured. A press delivers `onDrag` instead. */
  onMouseMove?: (localX: number, localY: number) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** The first move of a press. Reports where the press went down, so `onDrag` deltas from it lose no travel. */
  onDragStart?: (localX: number, localY: number, globalX: number, globalY: number) => void;
  onDrag?: (localX: number, localY: number, globalX: number, globalY: number) => void;
  onDragEnd?: (localX: number, localY: number, globalX: number, globalY: number) => void;
  onScroll?: (deltaY: number) => void;
  /**
   * Semantic cursor name (`pointer`, `text`, `watch`, …) or the app's own
   * 16×16 `CursorFace`. Hosts map a name to CSS or a 1-bit face — see `cursor.ts`.
   */
  cursor?: CursorSpec;
}

export interface KeyboardEventHandlers {
  onKeyDown?: (key: string, modifiers: Modifiers) => void;
  onKeyUp?: (key: string, modifiers: Modifiers) => void;
  onKeyPress?: (char: string) => void;
}

export interface FocusEventHandlers {
  onFocus?: () => void;
  onBlur?: () => void;
  tabIndex?: number;
  autoFocus?: boolean;
}

export type EventHandlers = MouseEventHandlers & KeyboardEventHandlers & FocusEventHandlers;

/** True if the node can be a pointer hit target (has any mouse handler or is focusable). */
export function hasMouseHandlers(h: EventHandlers): boolean {
  return !!(
    h.onClick ||
    h.onDoubleClick ||
    h.onMouseDown ||
    h.onMouseDownCapture ||
    h.onMouseUp ||
    h.onMouseMove ||
    h.onMouseEnter ||
    h.onMouseLeave ||
    h.onDragStart ||
    h.onDrag ||
    h.onDragEnd ||
    h.onScroll ||
    h.tabIndex !== undefined
  );
}

// -------------------------------------------------------------------------
// Hit mask — per-pixel mask for non-rectangular clickable regions
// -------------------------------------------------------------------------

export interface HitMask {
  /** 1 byte per pixel: 0 = not clickable, 1 = clickable */
  data: Uint8Array;
  width: number;
  height: number;
}

// -------------------------------------------------------------------------
// Hit rect (output of draw pass, consumed by host for event dispatch)
// -------------------------------------------------------------------------

export interface HitRect {
  rect: LayoutRect;
  handlers: EventHandlers;
  nodeId: number;
  zIndex: number;
  /** When set, only pixels with mask[y * width + x] !== 0 receive events. */
  hitMask?: HitMask;
}

// -------------------------------------------------------------------------
// Intrinsic element prop types
// -------------------------------------------------------------------------

/** A 1-bit pixel value: `0` = white, `1` = black. The screen has no other colours. */
export type Ink = 0 | 1;

/** An 8-byte QuickDraw `Pattern` (8×8, 1-bit). */
export type PatternBits = Uint8Array;

/** Compass aliases (`se`) and CSS `to …` keywords (`to bottom right`). */
export type GradientKeyword =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw"
  | "to top"
  | "to right"
  | "to bottom"
  | "to left"
  | "to top right"
  | "to bottom right"
  | "to bottom left"
  | "to top left";

/**
 * Linear heading: a keyword, or CSS degrees (`0` = up, clockwise).
 * `se` / `to bottom right` / `135` are the same vector.
 */
export type GradientDirection = GradientKeyword | number;

export type GradientKind = "linear" | "radial" | "conic";

/** Origin for radial / conic. Unit coords `0…1`, or a CSS/compass side. */
export type GradientAt =
  | { x: number; y: number }
  | "center"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top left"
  | "top right"
  | "bottom left"
  | "bottom right";

/**
 * Size-dependent 1-bit ramp. `from` / `to` are blackness in `0…1`
 * (0 = paper, 1 = ink). Painted at the box's laid-out size, not tiled 8×8.
 * CSS has linear, radial, and conic (plus repeating forms of each).
 */
export interface DitherGradientFill {
  dither: "gradient";
  from: number;
  to: number;
  /** Linear heading. Default `s` / `to bottom`. Unused by radial. */
  direction?: GradientDirection;
  /** Default `linear`. */
  kind?: GradientKind;
  /** Radial / conic origin. Default `center`. */
  at?: GradientAt;
  /** Radial: `ellipse` fits the box (CSS default); `circle` is isotropic. */
  shape?: "circle" | "ellipse";
  /** Conic start, CSS degrees (`0` = up). Falls back to numeric `direction`. */
  start?: number;
  /** Period in the 0…1 parameter. `0.25` repeats four times. */
  repeat?: number;
  /** Defaults to Bayer — stable chrome, no error-diffusion fringe. */
  mode?: "atkinson" | "bayer";
}

export type DitherGradientInit = Omit<DitherGradientFill, "dither">;

export function ditherGradient(
  from: number,
  to: number,
  direction?: GradientDirection,
  mode?: DitherGradientFill["mode"],
): DitherGradientFill;
export function ditherGradient(fill: DitherGradientInit): DitherGradientFill;
export function ditherGradient(
  fromOrFill: number | DitherGradientInit,
  to?: number,
  direction?: GradientDirection,
  mode?: DitherGradientFill["mode"],
): DitherGradientFill {
  if (typeof fromOrFill === "object") {
    return { dither: "gradient", direction: "s", ...fromOrFill };
  }
  return {
    dither: "gradient",
    from: fromOrFill,
    to: to ?? 1,
    direction: direction ?? "s",
    mode,
  };
}

export function isDitherGradientFill(value: unknown): value is DitherGradientFill {
  if (!value || typeof value !== "object" || !("dither" in value)) return false;
  return (value as DitherGradientFill).dither === "gradient";
}

/** Solid ink, a named dither, a raw 8-byte pattern, or a sized gradient. */
export type Fill = Ink | PatternName | PatternBits | DitherGradientFill;

export interface SemanticProps { semantic?: import("./inspection").SemanticMetadata; }

/** Word-wrap unless `nowrap` or `wrap={false}`. Default is on. */
export function textWraps(props: { wrap?: unknown; nowrap?: unknown }): boolean {
  if (props.nowrap === true) return false;
  if (props.wrap === false) return false;
  return true;
}

export interface BoxProps extends LayoutStyle, EventHandlers, SemanticProps {
  /** Solid ink, named dither, or raw 8-byte QuickDraw pattern */
  background?: Fill;
  borderColor?: Ink;
  /** default: "solid" */
  borderStyle?: "solid" | "dotted" | "dashed";
  borderRadius?: number;
  /**
   * 1px drop shadow to the right and below (window chrome).
   * The face paints 1px up-left so it sits on the shadow. The shadow
   * uses the same `borderRadius` as the face.
   */
  shadow?: boolean;
  /** Transfer mode for fills and borders. `bic` punches paper through ink. */
  penMode?: "copy" | "xor" | "bic";
  /** Skip this subtree in hit-testing (e.g. windows behind a modal). */
  inert?: boolean;
  /** Treat this node as a Tab-cycle / last-focus scope. */
  focusScope?: boolean;
  /**
   * Vertical scroll offset in pixels (requires overflow="scroll"). Together
   * with `onScroll` the owner drives the offset: the wheel and touch pans
   * only call `onScroll` and never move the pane themselves.
   */
  scrollOffset?: number;
  /**
   * When this value changes, `_scrollOffset` returns to 0.
   * Use a route path so a reused overflow pane does not stay scrolled
   * into empty space after navigation.
   */
  scrollKey?: string | number;
  /**
   * Which end of an `overflow="scroll"` pane holds still as content changes.
   * `"bottom"` keeps a pane that is scrolled to the end at the end while its
   * children grow (chat threads, logs); scrolling up lets go until the reader
   * scrolls back down. Default `"top"`.
   */
  scrollAnchor?: "top" | "bottom";
  /** Per-pixel hit mask — limits clickable area to non-zero mask pixels. */
  hitMask?: HitMask;
  /**
   * Called after layout whenever this box's measured size changes (and once
   * for its first layout). Runs in a microtask, so it may write signals.
   */
  onLayout?: LayoutChangeFn;
  children?: unknown;
}

/** A node's laid-out box, as reported to `<box onLayout>`. `x`/`y` are on the screen. */
export interface LayoutSize {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutChangeFn = (size: LayoutSize) => void;

export type TextAlign = "left" | "center" | "right";
export type TextVerticalAlign = "top" | "middle" | "bottom";

export interface TextProps extends LayoutStyle, EventHandlers, SemanticProps {
  font?: string;
  /**
   * Native bitmap point size for a family (`font="geneva" size={12}`).
   * Omitted uses the family's default (Geneva 9, Chicago 12, …).
   * A size Apple did not ship snaps to the nearest native strike.
   */
  size?: number;
  /**
   * Font Manager bold: smear each glyph 1px to the right and grow the
   * advance. Works on every registered face — there is no `monoBold` name.
   */
  bold?: boolean;
  /**
   * Font Manager italic: shear at draw time and grow the advance 1px.
   * Combines with `bold`.
   */
  italic?: boolean;
  /**
   * 1px ring in this text's color; the stem is inverted. Combines with
   * `bold` / `italic` / `shadow`. Grows the cell 2px in each axis.
   */
  outline?: boolean;
  /**
   * Outline plus a 1px south-east drop of the ring. Combines with
   * `bold` / `italic` / `outline`. Grows the cell 3px in each axis.
   */
  shadow?: boolean;
  /** QuickDraw underline, 1px below the baseline. Does not change the advance. */
  underline?: boolean;
  /**
   * Pixels between glyphs, in place of the face's own (Chicago 12 has 2,
   * as the real Mac draws it). App content sets 1 for the tighter look.
   */
  spacing?: number;
  color?: Ink;
  /** Solid background behind the text */
  background?: Ink;
  /**
   * Horizontal alignment of each line within this node's content box
   * (CSS `text-align`). Distinct from `alignSelf`, which positions the node
   * itself inside its parent.
   */
  align?: TextAlign;
  /**
   * Vertical alignment of the line block within this node's content box.
   * Single-line `middle` is the Control Manager rule: FontInfo line box
   * centered, then the baseline (`ascent` from the top of that box).
   */
  verticalAlign?: TextVerticalAlign;
  /**
   * Word-wrap to the content width. Default is on; pass `nowrap` (or
   * `wrap={false}`) for a single line. Explicit `\n` always breaks.
   */
  wrap?: boolean;
  /** Opt out of the default wrap. */
  nowrap?: boolean;
  /** Drag-select this text and copy with ⌘C / Ctrl+C. */
  selectable?: boolean;
  /**
   * Draw text with a checkerboard overlay to simulate disabled/dimmed appearance.
   * Matches Classic Mac System's "grayed text" technique.
   */
  stipple?: boolean;
  /**
   * Styled runs that wrap as one paragraph, in place of `children`. Runs
   * inherit the node's font, size and style and add their own. Runs of
   * spaces collapse to one and never start a wrapped line. A run with
   * `onClick` becomes a link: the pointer cursor shows over it and a click
   * on it calls the handler. Runs are not `selectable`.
   */
  runs?: readonly TextRun[];
  children?: string;
}

/** One styled stretch of a `<text runs>` paragraph. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  onClick?: () => void;
}

export interface ImageProps extends LayoutStyle, EventHandlers, SemanticProps {
  src: Sprite;
  mode?: "normal" | "inverted" | "outline";
}

export interface RasterPaintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a `<raster>` gets handed each frame. Pixel access goes through this
 * surface so apps never depend on how the framebuffer is laid out in memory
 * (it is packed 1 bpp — see `packedBits.ts` in QuickDraw).
 *
 * `setPixel` / `blitPixels` / `fill` take raster-local coordinates and clip
 * to the raster. For anything more, `port` is the current QuickDraw port
 * (already clipped to `rect`); offset QuickDraw coordinates by `rect.x` /
 * `rect.y`.
 */
export interface RasterSurface {
  readonly port: GrafPort;
  /** The raster's box in port coordinates. */
  readonly rect: RasterPaintRect;
  /** Set one pixel; out-of-range writes are ignored. */
  setPixel(x: number, y: number, ink: Ink): void;
  /**
   * Copy a 1-byte-per-pixel buffer (`0` = white, non-zero = black, rows
   * `width` apart) into the raster with its top-left at local `(x, y)`.
   */
  blitPixels(pixels: Uint8Array, width: number, height: number, x?: number, y?: number): void;
  /** Paint the whole raster one ink. */
  fill(ink: Ink): void;
}

/** Immediate-mode paint callback for `<raster onPaint>`. */
export type RasterPaintFn = (surface: RasterSurface) => void;

export interface RasterProps extends LayoutStyle, EventHandlers, SemanticProps {
  onPaint?: RasterPaintFn;
  /**
   * Bump to repaint. `onPaint` runs at paint time, outside any reactive scope,
   * so a raster whose pixels come from elsewhere (a camera, a decoder) sets
   * `revision` from a signal to have the frame redrawn when the source changes.
   */
  revision?: number;
}

/**
 * A retained 1-bit picture. `pixels` is unpacked (`0` = white, nonzero =
 * black, `width` bytes per row) — not a QuickDraw `BitMap`. Replacing the
 * array (a new `Uint8Array`, typically from a signal) is what schedules a
 * repaint; there is no `onPaint` and no `revision`.
 *
 * Use `<raster>` when the pixels come from a camera, decoder, or other
 * source Solid cannot see.
 */
export interface BitmapProps extends LayoutStyle, EventHandlers, SemanticProps {
  pixels: Uint8Array;
}

// -------------------------------------------------------------------------
// CanvasNode — the internal tree node
// -------------------------------------------------------------------------

let nextNodeId = 1;

export type NodeType = "box" | "text" | "image" | "raster" | "bitmap" | "_root" | "_text_content";

export interface CanvasNode {
  id: number;
  type: NodeType;
  props: Record<string, unknown>;
  style: LayoutStyle;
  layout: LayoutRect;
  children: CanvasNode[];
  parent: CanvasNode | null;
  /** Text content for `_text_content` nodes (Solid text nodes). */
  textContent: string;
  /**
   * Solid components that were on the owner stack when this node was
   * created, nearest first (`Button`, then `HomePage`). Catalog DevTools
   * and `debugInspect` read this; the draw path ignores it.
   */
  debugOwner?: readonly string[];
  _dirty: boolean;
  _eventHandlers: EventHandlers;
  _scrollOffset: number;
  /** `scrollOverflow` as of the last layout pass. */
  _scrollMax: number;
}

/** Concatenate `_text_content` leaves. Used by measure, draw, and `<text selectable>`. */
export function collectNodeText(node: CanvasNode): string {
  if (node.type === "_text_content") return node.textContent;
  return node.children.map(collectNodeText).join("");
}

export function createNode(type: NodeType): CanvasNode {
  return {
    id: nextNodeId++,
    type,
    props: {},
    style: {},
    layout: { x: 0, y: 0, width: 0, height: 0 },
    children: [],
    parent: null,
    textContent: "",
    debugOwner: undefined,
    _dirty: true,
    _eventHandlers: {},
    _scrollOffset: 0,
    _scrollMax: 0,
  };
}

export function markDirty(node: CanvasNode): void {
  let n: CanvasNode | null = node;
  while (n) {
    n._dirty = true;
    n = n.parent;
  }
}

/**
 * Insert `node` into `parent` before `anchor` (or at the end).
 *
 * DOM `insertBefore` semantics: a node that is already attached — to this
 * parent or another — is detached first, so the call *moves* it. Solid's
 * control flow (`<For>` reordering) relies on this; without it, reordering
 * leaves duplicate references in `children`.
 */
export function insertChild(
  parent: CanvasNode,
  node: CanvasNode,
  anchor: CanvasNode | null
): void {
  if (anchor === node) return;
  if (node.parent) removeChild(node.parent, node);

  node.parent = parent;
  if (anchor === null) {
    parent.children.push(node);
  } else {
    const idx = parent.children.indexOf(anchor);
    if (idx === -1) {
      parent.children.push(node);
    } else {
      parent.children.splice(idx, 0, node);
    }
  }
  markDirty(parent);
}

export function removeChild(parent: CanvasNode, node: CanvasNode): void {
  const idx = parent.children.indexOf(node);
  if (idx !== -1) {
    parent.children.splice(idx, 1);
    node.parent = null;
    markDirty(parent);
  }
}

// -------------------------------------------------------------------------
// Prop classification helpers
// -------------------------------------------------------------------------

export const LAYOUT_PROP_NAMES = new Set<string>([
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "flexDirection", "justifyContent", "alignItems", "alignSelf",
  "flexGrow", "flexShrink", "flexBasis",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "gap", "position", "top", "left", "right", "bottom", "overflow",
  "borderWidth",
]);

/**
 * Effective border thickness of a node: the drawn border (`borderColor` set)
 * with `borderWidth` defaulting to 1. Shared by layout, draw and hit-testing so
 * the three can never disagree about where the padding box starts.
 */
export function resolveBorderWidth(node: CanvasNode): number {
  if (node.type !== "box") return 0;
  if (node.props["borderColor"] === undefined) return 0;
  return Math.max(0, node.style.borderWidth ?? 1);
}

/** Face paints 1px up-left so it sits on the L-shadow. Text `shadow` is a type style. */
export function shadowRaise(node: CanvasNode): number {
  if (node.type !== "box") return 0;
  return node.props.shadow === true ? 1 : 0;
}

export const EVENT_PROP_NAMES = new Set<string>([
  "onClick", "onDoubleClick", "onMouseDown", "onMouseDownCapture", "onMouseUp",
  "onMouseMove", "onMouseEnter", "onMouseLeave", "onDragStart", "onDrag", "onDragEnd",
  "onScroll",
  "onKeyDown", "onKeyUp", "onKeyPress",
  "onFocus", "onBlur", "tabIndex", "autoFocus", "cursor",
]);

export function setNodeProperty(node: CanvasNode, name: string, value: unknown): void {
  if (name === "scrollOffset") {
    node.props["scrollOffset"] = value;
    node._scrollOffset = Math.round((value as number) || 0);
    return;
  }
  if (name === "scrollKey") {
    const prev = node.props["scrollKey"];
    node.props["scrollKey"] = value;
    if (value !== prev) {
      node._scrollOffset = 0;
      markDirty(node);
    }
    return;
  }
  if (LAYOUT_PROP_NAMES.has(name)) {
    (node.style as Record<string, unknown>)[name] = value;
    markDirty(node);
  } else if (EVENT_PROP_NAMES.has(name)) {
    (node._eventHandlers as Record<string, unknown>)[name] = value;
  } else {
    node.props[name] = value;
    markDirty(node);
  }
}
