/**
 * Host `<text selectable>` — one document selection, like the DOM.
 * Layout and paint stay on the intrinsic; this registers the node and
 * maps pointer/keyboard onto a single anchor/focus pair that may span
 * many selectable nodes.
 */

import { getFocusManager } from "./focusContext";
import { useUIServices } from "./services";
import { fontFromProps } from "./fonts/style";
import { indexAtPoint, layoutNodeText } from "./fonts/textLayout";
import { collectNodeText, setNodeProperty, textWraps, type CanvasNode, type TextAlign } from "./nodes";
import { scrollPaintOffset, scrollPaintOffsetX } from "./scroll";
import { createTextClicks, paragraphRangeAt, type TextClickSelection } from "./textClicks";

export interface TextSelection {
  lo: number;
  hi: number;
}

interface Caret {
  node: CanvasNode;
  offset: number;
}

const registered = new Set<CanvasNode>();
const sessions = new WeakMap<CanvasNode, () => void>();

let anchor: Caret | undefined;
let focus: Caret | undefined;

function localPoint(node: CanvasNode, gx: number, gy: number): { lx: number; ly: number } {
  let ox = 0;
  let oy = 0;
  for (let n = node.parent; n; n = n.parent) {
    if (n.style.overflow === "scroll") oy -= scrollPaintOffset(n);
    ox -= scrollPaintOffsetX(n);
  }
  return { lx: gx - (node.layout.x + ox), ly: gy - (node.layout.y + oy) };
}

function blockOf(node: CanvasNode) {
  const wrap = textWraps(node.props);
  const padL = node.style.paddingLeft ?? node.style.padding ?? 0;
  const padR = node.style.paddingRight ?? node.style.padding ?? 0;
  const innerW = Math.max(0, node.layout.width - padL - padR);
  return layoutNodeText(node, fontFromProps(node.props), collectNodeText(node), wrap ? innerW : undefined);
}

function indexAtLocal(node: CanvasNode, lx: number, ly: number): number {
  const text = collectNodeText(node);
  const padL = node.style.paddingLeft ?? node.style.padding ?? 0;
  const padR = node.style.paddingRight ?? node.style.padding ?? 0;
  const padT = node.style.paddingTop ?? node.style.padding ?? 0;
  const align = (node.props["align"] as TextAlign | undefined) ?? "left";
  const innerW = Math.max(0, node.layout.width - padL - padR);
  return Math.max(0, Math.min(
    text.length,
    indexAtPoint(blockOf(node), fontFromProps(node.props), lx - padL, ly - padT, align, innerW),
  ));
}

function rootOf(node: CanvasNode): CanvasNode {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

/** Selectable nodes in paint/document order. */
function documentOrder(from: CanvasNode): CanvasNode[] {
  const out: CanvasNode[] = [];
  const walk = (node: CanvasNode) => {
    if (registered.has(node)) out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(rootOf(from));
  return out;
}

function compare(a: Caret, b: Caret): number {
  if (a.node === b.node) return a.offset - b.offset;
  const order = documentOrder(a.node);
  return order.indexOf(a.node) - order.indexOf(b.node);
}

function ordered(): { start: Caret; end: Caret } | undefined {
  if (!anchor || !focus) return undefined;
  return compare(anchor, focus) <= 0 ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

function setCaret(nextAnchor: Caret, nextFocus: Caret): void {
  anchor = nextAnchor;
  focus = nextFocus;
}

function clearSelection(): void {
  anchor = undefined;
  focus = undefined;
}

function containsPoint(node: CanvasNode, gx: number, gy: number): boolean {
  const { lx, ly } = localPoint(node, gx, gy);
  return lx >= 0 && ly >= 0 && lx < node.layout.width && ly < node.layout.height;
}

/** Map a screen point onto a caret in the selectable document. */
function caretAt(from: CanvasNode, gx: number, gy: number): Caret {
  const order = documentOrder(from);
  if (!order.length) {
    const { lx, ly } = localPoint(from, gx, gy);
    return { node: from, offset: indexAtLocal(from, lx, ly) };
  }

  for (const node of order) {
    if (containsPoint(node, gx, gy)) {
      const { lx, ly } = localPoint(node, gx, gy);
      return { node, offset: indexAtLocal(node, lx, ly) };
    }
  }

  const first = order[0]!;
  const { ly: firstLy } = localPoint(first, gx, gy);
  if (firstLy < 0) return { node: first, offset: 0 };

  const last = order[order.length - 1]!;
  return { node: last, offset: collectNodeText(last).length };
}

function isOn(value: unknown): boolean {
  return value === true || value === "";
}

function siblingsOf(node: CanvasNode): CanvasNode[] {
  return documentOrder(node).filter((n) => n.parent === node.parent);
}

/** Inclusive-exclusive range of the document selection that falls on `node`. */
export function textSelectionOf(node: CanvasNode): TextSelection | undefined {
  const span = ordered();
  if (!span) return undefined;
  const order = documentOrder(node);
  const i = order.indexOf(node);
  const iStart = order.indexOf(span.start.node);
  const iEnd = order.indexOf(span.end.node);
  if (i < 0 || iStart < 0 || i < iStart || i > iEnd) return undefined;
  const lo = i === iStart ? span.start.offset : 0;
  const hi = i === iEnd ? span.end.offset : collectNodeText(node).length;
  if (lo >= hi) return undefined;
  return { lo, hi };
}

/** Plain text of the current document selection, nodes joined with newlines. */
export function selectedPlainText(): string {
  const span = ordered();
  if (!span) return "";
  if (span.start.node === span.end.node) {
    return collectNodeText(span.start.node).slice(span.start.offset, span.end.offset);
  }
  const order = documentOrder(span.start.node);
  const parts: string[] = [];
  for (const node of order) {
    const slice = textSelectionOf(node);
    if (slice) parts.push(collectNodeText(node).slice(slice.lo, slice.hi));
  }
  return parts.join("\n");
}

/**
 * Called from the renderer when the `selectable` prop appears, changes, or
 * the node is removed. Pointer/keyboard already schedule the next frame.
 */
export function applySelectable(node: CanvasNode, value: unknown): void {
  const want = isOn(value);
  const detach = sessions.get(node);
  if (want && detach) return;
  if (!want) {
    detach?.();
    sessions.delete(node);
    return;
  }

  const focusManager = getFocusManager();
  const { clipboard, scheduler } = useUIServices();

  // Double-click selects a word, triple-click the paragraph.
  const clicks = createTextClicks({ third: paragraphRangeAt, now: scheduler && (() => scheduler.now()) });
  const select = ({ anchor: from, caret: to }: TextClickSelection) =>
    setCaret({ node, offset: from }, { node, offset: to });

  const onMouseDown = (lx: number, ly: number) => {
    focusManager.focus(node);
    select(clicks.down(lx, ly, collectNodeText(node), indexAtLocal(node, lx, ly)));
  };

  const onDrag = (_lx: number, _ly: number, gx: number, gy: number) => {
    if (!anchor) return;
    const text = collectNodeText(node);
    const target = caretAt(node, gx, gy);
    if (target.node === node) {
      select(clicks.drag(text, target.offset));
      return;
    }
    // Into another node: keep the whole word or paragraph pressed here, by
    // extending it to this node's far edge, then select on by character.
    const after = compare({ node, offset: 0 }, target) < 0;
    const edge = clicks.drag(text, after ? text.length : 0);
    setCaret({ node, offset: edge.anchor }, target);
  };

  const onDoubleClick = (lx: number, ly: number) => {
    const sel = clicks.doubleClick(lx, ly, collectNodeText(node), indexAtLocal(node, lx, ly));
    if (!sel) return;
    focusManager.focus(node);
    select(sel);
  };

  const onKeyDown = (key: string, mod: { meta?: boolean; ctrl?: boolean }) => {
    const command = !!(mod.meta || mod.ctrl);
    if (command && key.toLowerCase() === "a") {
      const group = siblingsOf(node);
      const first = group[0] ?? node;
      const last = group[group.length - 1] ?? node;
      setCaret({ node: first, offset: 0 }, { node: last, offset: collectNodeText(last).length });
      return;
    }
    if (command && key.toLowerCase() === "c") {
      const text = selectedPlainText();
      if (text) void clipboard?.writeText(text).catch(() => {});
    }
  };

  registered.add(node);
  setNodeProperty(node, "tabIndex", 0);
  setNodeProperty(node, "onMouseDown", onMouseDown);
  setNodeProperty(node, "onDrag", onDrag);
  setNodeProperty(node, "onDoubleClick", onDoubleClick);
  setNodeProperty(node, "onKeyDown", onKeyDown);
  if (!node._eventHandlers.cursor) setNodeProperty(node, "cursor", "text");

  sessions.set(node, () => {
    registered.delete(node);
    if (anchor?.node === node || focus?.node === node) clearSelection();
    setNodeProperty(node, "tabIndex", undefined);
    setNodeProperty(node, "onMouseDown", undefined);
    setNodeProperty(node, "onDrag", undefined);
    setNodeProperty(node, "onDoubleClick", undefined);
    setNodeProperty(node, "onKeyDown", undefined);
    if (node._eventHandlers.cursor === "text") setNodeProperty(node, "cursor", undefined);
  });
}
