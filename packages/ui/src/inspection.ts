import { resolveBorderWidth, type CanvasNode, type LayoutRect } from "./nodes";
import { scrollPaintOffset, scrollPaintOffsetX } from "./scroll";
import type { FocusManager } from "./focus";
export interface SemanticMetadata {
  name?: string;
  role?: string;
  value?: string;
  enabled?: boolean;
  password?: boolean;
  windowId?: string;
}
export interface InspectionNode {
  readonly id: number;
  readonly name?: string;
  readonly role: string;
  readonly text: string;
  readonly value?: string;
  readonly enabled: boolean;
  readonly focused: boolean;
  readonly windowId?: string;
  readonly bounds: Readonly<LayoutRect>;
  readonly actions: readonly string[];
}
const intersection = (a: LayoutRect, b: LayoutRect): LayoutRect => {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y)
  };
};
/** Where a node's children draw relative to it: its scroll offsets, undone. */
function childOffset(node: CanvasNode, offset: { x: number; y: number }): { x: number; y: number } {
  return {
    x: offset.x - scrollPaintOffsetX(node),
    y: offset.y - (node.style.overflow === "scroll" ? scrollPaintOffset(node) : 0),
  };
}

/** A detached, immutable snapshot. No handlers or mutable node objects escape. */
export function inspectTree(root: CanvasNode, focus: FocusManager): readonly InspectionNode[] {
  const out: InspectionNode[] = [];
  function visit(node: CanvasNode, clip: LayoutRect, offset: { x: number; y: number }, enabled: boolean, windowId?: string, masked = false) {
    const metadata = (node.props.semantic ?? {}) as SemanticMetadata;
    windowId = metadata.windowId ?? windowId;
    enabled = enabled && node.props.inert !== true && metadata.enabled !== false;
    masked = masked || metadata.password === true;
    const rect = {
      ...node.layout,
      x: node.layout.x + offset.x,
      y: node.layout.y + offset.y
    };
    const bounds = Object.freeze(intersection(clip, rect));
    const h = node._eventHandlers;
    const actions: string[] = [];
    if (h.onClick || h.onMouseDown || h.onMouseUp) actions.push("click");
    if (h.onDoubleClick) actions.push("double-click");
    if (h.onDrag) actions.push("drag");
    if (h.onKeyPress) actions.push("type");
    if (h.onKeyDown) actions.push("key");
    const text = (n: CanvasNode): string => (n.props.semantic as SemanticMetadata)?.password ? "••••" : n.textContent + n.children.map(text).join("");
    if (node.type !== "_text_content") out.push(Object.freeze({
      id: node.id,
      name: metadata.name,
      role: metadata.role ?? node.type,
      text: masked ? "••••" : text(node),
      value: metadata.value === undefined ? undefined : masked ? "••••" : metadata.value,
      enabled,
      focused: focus.focused === node,
      windowId,
      bounds,
      actions: Object.freeze(actions)
    }));
    let childClip = clip;
    if (node.style.overflow === "hidden" || node.style.overflow === "scroll") {
      const border = resolveBorderWidth(node);
      childClip = intersection(clip, {
        x: rect.x + border,
        y: rect.y + border,
        width: Math.max(0, rect.width - 2 * border),
        height: Math.max(0, rect.height - 2 * border)
      });
    }
    for (const child of node.children) visit(child, childClip, childOffset(node, offset), enabled, windowId, masked);
  }
  visit(root, root.layout, { x: 0, y: 0 }, true);
  return Object.freeze(out);
}
