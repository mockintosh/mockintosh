import { isDitherGradientFill, resolveBorderWidth, type CanvasNode, type LayoutRect, type NodeType } from "./nodes";
import { scrollPaintOffset, scrollPaintOffsetX } from "./scroll";
import type { SemanticMetadata } from "./inspection";

const OMIT_PROPS = new Set([
  "children",
  "ref",
  "semantic",
  "hitMask",
  "onPaint",
  "onLayout",
  "pixels",
  "scrollOffset",
  "scrollOffsetX",
]);

export interface DebugNode {
  readonly id: number;
  readonly type: NodeType;
  /** Solid components that created this node, nearest first. */
  readonly owner: readonly string[];
  readonly name?: string;
  readonly role?: string;
  readonly text: string;
  readonly attrs: readonly string[];
  readonly bounds: Readonly<LayoutRect>;
  readonly children: readonly DebugNode[];
}

const intersection = (a: LayoutRect, b: LayoutRect): LayoutRect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
};

function formatAttr(name: string, value: unknown): string | null {
  if (value === undefined || value === null || value === false) return null;
  if (value === true) return name;
  if (typeof value === "string") return `${name}=${JSON.stringify(value)}`;
  if (typeof value === "number") return `${name}={${value}}`;
  if (typeof value === "function") return `${name}={${value.name || "fn"}}`;
  if (typeof value === "object") {
    if (isDitherGradientFill(value)) return `${name}={ditherGradient(…)}`;
    if (value instanceof Uint8Array) return `${name}={pattern}`;
    return `${name}={…}`;
  }
  return null;
}

function collectAttrs(node: CanvasNode): string[] {
  const attrs: string[] = [];
  const seen = new Set<string>();
  const push = (name: string, value: unknown) => {
    if (seen.has(name) || OMIT_PROPS.has(name)) return;
    const formatted = formatAttr(name, value);
    if (!formatted) return;
    seen.add(name);
    attrs.push(formatted);
  };
  for (const [name, value] of Object.entries(node.style)) push(name, value);
  for (const [name, value] of Object.entries(node.props)) push(name, value);
  for (const [name, value] of Object.entries(node._eventHandlers)) push(name, value);
  return attrs;
}

function leafText(node: CanvasNode): string {
  if (node.type === "_text_content") return node.textContent;
  return node.children.map(leafText).join("");
}

/** Hierarchical snapshot of the live tree, with clipped screen-space bounds. */
export function debugInspectTree(root: CanvasNode): DebugNode {
  function visit(node: CanvasNode, clip: LayoutRect, offset: { x: number; y: number }): DebugNode {
    const metadata = (node.props.semantic ?? {}) as SemanticMetadata;
    const rect = { ...node.layout, x: node.layout.x + offset.x, y: node.layout.y + offset.y };
    const bounds = Object.freeze(intersection(clip, rect));
    let childClip = clip;
    if (node.style.overflow === "hidden" || node.style.overflow === "scroll") {
      const border = resolveBorderWidth(node);
      childClip = intersection(clip, {
        x: rect.x + border,
        y: rect.y + border,
        width: Math.max(0, rect.width - 2 * border),
        height: Math.max(0, rect.height - 2 * border),
      });
    }
    const childOffset = {
      x: offset.x - scrollPaintOffsetX(node),
      y: offset.y - (node.style.overflow === "scroll" ? scrollPaintOffset(node) : 0),
    };
    const children = Object.freeze(node.children.map((child) => visit(child, childClip, childOffset)));
    return Object.freeze({
      id: node.id,
      type: node.type,
      owner: Object.freeze([...(node.debugOwner ?? [])]),
      name: metadata.name,
      role: metadata.role,
      text: leafText(node),
      attrs: Object.freeze(collectAttrs(node)),
      bounds,
      children,
    });
  }
  const tree = visit(root, root.layout, { x: 0, y: 0 });
  return tree;
}

export function findDebugNode(node: DebugNode, predicate: (n: DebugNode) => boolean): DebugNode | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const hit = findDebugNode(child, predicate);
    if (hit) return hit;
  }
  return null;
}

function formatOne(node: DebugNode, indent: number, maxDepth: number): string {
  const pad = "  ".repeat(indent);
  if (node.type === "_text_content") return `${pad}${node.text}`;
  if (node.type === "_root") {
    return node.children.map((child) => formatOne(child, indent, maxDepth)).join("\n");
  }
  const tag = node.type;
  const attr = node.attrs.length ? ` ${node.attrs.join(" ")}` : "";
  const kids = node.children.filter((child) => child.type !== "_text_content" || child.text.length > 0);
  const textOnly =
    kids.length === 1 && kids[0].type === "_text_content" && !kids[0].text.includes("\n");
  if (kids.length === 0) return `${pad}<${tag}${attr} />`;
  if (indent >= maxDepth) return `${pad}<${tag}${attr}>…</${tag}>`;
  if (textOnly) return `${pad}<${tag}${attr}>${kids[0].text}</${tag}>`;
  const inner = kids.map((child) => formatOne(child, indent + 1, maxDepth)).join("\n");
  return `${pad}<${tag}${attr}>\n${inner}\n${pad}</${tag}>`;
}

/** Reconstruct the host JSX a node produced. `_root` unwraps to its children. */
export function formatDebugJsx(node: DebugNode, options?: { maxDepth?: number }): string {
  return formatOne(node, 0, options?.maxDepth ?? 8);
}

/** Nearest named Solid component, if the renderer recorded one. */
export function debugComponent(node: DebugNode): string | undefined {
  return node.owner[0];
}
