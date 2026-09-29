/**
 * Canvas document — a retained list of shapes and text boxes.
 * The file is JSON (`MIME.canvas`); pixels are only produced at paint time.
 * Documents and elements are never mutated: an edit builds a new element
 * and a new list, so views keyed on identity see every change.
 */

export const DOCUMENT_VERSION = 1 as const;

/** New documents, and saved files that don't record a size yet. */
export const DEFAULT_PAGE = { width: 288, height: 288 } as const;

export type CanvasFont = "body" | "menu" | "mono" | "pixel";
export type CanvasAlign = "left" | "center" | "right";
export type FillStyle = "none" | "white" | "black" | "gray25" | "gray50" | "gray75";
export type ShapeKind = "rect" | "roundrect" | "oval" | "line";
export type ElementType = ShapeKind | "text";

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShapeElement extends Frame {
  id: string;
  type: ShapeKind;
  fill: FillStyle;
  stroke: boolean;
  /** Line diagonal: false = NW→SE, true = NE→SW. */
  reverse?: boolean;
}

export interface TextElement extends Frame {
  id: string;
  type: "text";
  text: string;
  font: CanvasFont;
  align: CanvasAlign;
}

export type CanvasElement = ShapeElement | TextElement;

export interface CanvasDocument {
  version: typeof DOCUMENT_VERSION;
  width: number;
  height: number;
  elements: CanvasElement[];
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type LineHandle = "start" | "end";
export type Handle = ResizeHandle | LineHandle;

export const MIN_SHAPE = 8;
export const MIN_TEXT_W = 24;
export const LINE_HIT_SLACK = 3;
export const HANDLE_SIZE = 5;

const FONTS = new Set<CanvasFont>(["body", "menu", "mono", "pixel"]);
const ALIGNS = new Set<CanvasAlign>(["left", "center", "right"]);
const FILLS = new Set<FillStyle>(["none", "white", "black", "gray25", "gray50", "gray75"]);
const SHAPES = new Set<ShapeKind>(["rect", "roundrect", "oval", "line"]);
const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function emptyDocument(): CanvasDocument {
  return { version: DOCUMENT_VERSION, width: DEFAULT_PAGE.width, height: DEFAULT_PAGE.height, elements: [] };
}

/** `elements` with the element `id` swapped for `update(element)`. */
export function replaceElement(
  elements: readonly CanvasElement[],
  id: string,
  update: (el: CanvasElement) => CanvasElement,
): CanvasElement[] {
  return elements.map((el) => (el.id === id ? update(el) : el));
}

export function allocateId(elements: readonly CanvasElement[]): string {
  const used = new Set(elements.map((el) => el.id));
  let n = used.size + 1;
  while (used.has(`e${n}`)) n += 1;
  return `e${n}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
}

function parseFrame(raw: Record<string, unknown>): Frame {
  return {
    x: num(raw.x),
    y: num(raw.y),
    width: Math.max(1, num(raw.width, 1)),
    height: Math.max(1, num(raw.height, 1)),
  };
}

function parseShape(raw: Record<string, unknown>, type: ShapeKind, id: string): ShapeElement {
  const fill = FILLS.has(raw.fill as FillStyle) ? (raw.fill as FillStyle) : "none";
  const stroke = raw.stroke === false ? fill !== "none" : true;
  const el: ShapeElement = { id, type, ...parseFrame(raw), fill, stroke };
  if (type === "line") el.reverse = raw.reverse === true;
  return el;
}

function parseText(raw: Record<string, unknown>, id: string): TextElement {
  return {
    id,
    type: "text",
    ...parseFrame(raw),
    text: typeof raw.text === "string" ? raw.text : "",
    font: FONTS.has(raw.font as CanvasFont) ? (raw.font as CanvasFont) : "body",
    align: ALIGNS.has(raw.align as CanvasAlign) ? (raw.align as CanvasAlign) : "left",
  };
}

/** Parse a saved document. Unknown element types are skipped; junk throws. */
export function parseDocument(raw: unknown): CanvasDocument {
  if (!isRecord(raw)) throw new Error("Canvas document must be an object.");
  if (raw.version !== DOCUMENT_VERSION) throw new Error("Unsupported Canvas document version.");
  if (!Array.isArray(raw.elements)) throw new Error("Canvas document is missing elements.");
  const elements: CanvasElement[] = [];
  const seen = new Set<string>();
  for (const item of raw.elements) {
    if (!isRecord(item)) continue;
    const type = item.type;
    const id = typeof item.id === "string" && item.id && !seen.has(item.id) ? item.id : allocateId(elements);
    seen.add(id);
    if (type === "text") elements.push(parseText(item, id));
    else if (typeof type === "string" && SHAPES.has(type as ShapeKind)) {
      elements.push(parseShape(item, type as ShapeKind, id));
    }
  }
  return {
    version: DOCUMENT_VERSION,
    width: Math.max(1, num(raw.width, DEFAULT_PAGE.width)),
    height: Math.max(1, num(raw.height, DEFAULT_PAGE.height)),
    elements,
  };
}

export function normalizeFrame(x0: number, y0: number, x1: number, y1: number): Frame {
  const x = Math.round(Math.min(x0, x1));
  const y = Math.round(Math.min(y0, y1));
  return {
    x,
    y,
    width: Math.max(1, Math.round(Math.abs(x1 - x0))),
    height: Math.max(1, Math.round(Math.abs(y1 - y0))),
  };
}

export function pointInFrame(el: Frame, x: number, y: number): boolean {
  return x >= el.x && y >= el.y && x < el.x + el.width && y < el.y + el.height;
}

function insideEllipse(px: number, py: number, el: Frame): boolean {
  if (el.width <= 0 || el.height <= 0) return false;
  const cx = el.x + (el.width - 1) / 2;
  const cy = el.y + (el.height - 1) / 2;
  const rx = el.width / 2;
  const ry = el.height / 2;
  if (rx <= 0 || ry <= 0) return px === el.x && py === el.y;
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

export function lineEndpoints(el: ShapeElement): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = el.x;
  const y0 = el.y;
  const x1 = el.x + el.width - 1;
  const y1 = el.y + el.height - 1;
  if (el.reverse) return { x0: x1, y0, x1: x0, y1 };
  return { x0, y0, x1, y1 };
}

/** A line's frame and diagonal, stored as `x`/`y`/`width`/`height` plus `reverse`. */
export interface LineFrame extends Frame {
  reverse: boolean;
}

export function lineFrame(x0: number, y0: number, x1: number, y1: number): LineFrame {
  return { ...normalizeFrame(x0, y0, x1, y1), reverse: x0 > x1 !== y0 > y1 };
}

function distanceToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

export function containsPoint(el: CanvasElement, x: number, y: number): boolean {
  if (el.type === "line") {
    const { x0, y0, x1, y1 } = lineEndpoints(el);
    return distanceToSegment(x, y, x0, y0, x1, y1) <= LINE_HIT_SLACK;
  }
  if (el.type === "oval") return insideEllipse(x, y, el);
  return pointInFrame(el, x, y);
}

/** Front-most element under the point, or null. */
export function hitTest(elements: readonly CanvasElement[], x: number, y: number): CanvasElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (containsPoint(el, x, y)) return el;
  }
  return null;
}

export function handlePosition(el: Frame, handle: ResizeHandle): { x: number; y: number } {
  const midX = el.x + Math.floor(el.width / 2);
  const midY = el.y + Math.floor(el.height / 2);
  const r = el.x + el.width;
  const b = el.y + el.height;
  switch (handle) {
    case "nw": return { x: el.x, y: el.y };
    case "n": return { x: midX, y: el.y };
    case "ne": return { x: r, y: el.y };
    case "e": return { x: r, y: midY };
    case "se": return { x: r, y: b };
    case "s": return { x: midX, y: b };
    case "sw": return { x: el.x, y: b };
    case "w": return { x: el.x, y: midY };
  }
}

export function applyResize(frame: Frame, handle: ResizeHandle, px: number, py: number, minW: number, minH: number): Frame {
  let { x, y, width, height } = frame;
  const right = x + width;
  const bottom = y + height;
  switch (handle) {
    case "nw":
      x = px;
      y = py;
      width = right - px;
      height = bottom - py;
      break;
    case "n":
      y = py;
      height = bottom - py;
      break;
    case "ne":
      y = py;
      width = px - x;
      height = bottom - py;
      break;
    case "e":
      width = px - x;
      break;
    case "se":
      width = px - x;
      height = py - y;
      break;
    case "s":
      height = py - y;
      break;
    case "sw":
      x = px;
      width = right - px;
      height = py - y;
      break;
    case "w":
      x = px;
      width = right - px;
      break;
  }
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(minW, Math.round(width)),
    height: Math.max(minH, Math.round(height)),
  };
}

export function minSize(el: CanvasElement): { width: number; height: number } {
  if (el.type === "text") return { width: MIN_TEXT_W, height: MIN_SHAPE };
  if (el.type === "line") return { width: 1, height: 1 };
  return { width: MIN_SHAPE, height: MIN_SHAPE };
}

/** `el` as it looks with `handle` dragged by (`dx`, `dy`) from where it started. */
export function resizeElement(el: CanvasElement, handle: Handle, dx: number, dy: number): CanvasElement {
  if (handle === "start" || handle === "end") {
    if (el.type !== "line") return el;
    const ends = lineEndpoints(el);
    const frame = handle === "start"
      ? lineFrame(ends.x0 + dx, ends.y0 + dy, ends.x1, ends.y1)
      : lineFrame(ends.x0, ends.y0, ends.x1 + dx, ends.y1 + dy);
    return { ...el, ...frame };
  }
  const origin = handlePosition(el, handle);
  const mins = minSize(el);
  return { ...el, ...applyResize(el, handle, origin.x + dx, origin.y + dy, mins.width, mins.height) };
}

export function bringToFront(elements: readonly CanvasElement[], id: string): CanvasElement[] {
  const next = elements.slice();
  const i = next.findIndex((el) => el.id === id);
  if (i < 0 || i === next.length - 1) return next;
  const [el] = next.splice(i, 1);
  next.push(el!);
  return next;
}

export function sendToBack(elements: readonly CanvasElement[], id: string): CanvasElement[] {
  const next = elements.slice();
  const i = next.findIndex((el) => el.id === id);
  if (i <= 0) return next;
  const [el] = next.splice(i, 1);
  next.unshift(el!);
  return next;
}

export function duplicateElement(el: CanvasElement, id: string): CanvasElement {
  return { ...el, id, x: el.x + 8, y: el.y + 8 };
}

export function cornerRadius(el: Frame): number {
  return Math.max(0, Math.min(8, Math.floor(Math.min(el.width, el.height) / 2)));
}

export const ALL_RESIZE_HANDLES = RESIZE_HANDLES;
