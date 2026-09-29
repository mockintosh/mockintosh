/**
 * Solid universal renderer wired to the CanvasNode tree.
 *
 * Uses `createRenderer` from `@solidjs/universal` to translate Solid JSX
 * into CanvasNode mutations. The rendered result is a retained node tree
 * that the draw pass traverses each frame.
 */

import { createRenderer } from "@solidjs/universal";
import {
  createNode,
  insertChild,
  removeChild,
  markDirty,
  setNodeProperty,
  type CanvasNode,
  type NodeType,
} from "./nodes";
import { applySelectable } from "./selectable";
import { applyRuns } from "./textRuns";
import { requestAutoFocus } from "./focus";

const ELEMENT_TYPES = new Set(["box", "text", "image", "raster", "bitmap"]);

function toNodeType(tagName: string): NodeType {
  if (ELEMENT_TYPES.has(tagName)) return tagName as NodeType;
  // Unknown element types fall back to box (safe default for composition)
  return "box";
}

function applyProp(node: CanvasNode, name: string, value: unknown): void {
  setNodeProperty(node, name, value);
  if (name === "selectable") applySelectable(node, value);
  if (name === "runs") applyRuns(node, value);
  if (name === "autoFocus" && value) requestAutoFocus(node);
}

function applyProps(node: CanvasNode, props: Record<string, unknown> | undefined): void {
  if (!props) return;
  for (const [name, value] of Object.entries(props)) applyProp(node, name, value);
}

// Module-level repaint hook — set by createUI so any reactive tree mutation
// automatically schedules a host repaint. Components never need to call
// scheduleRender() explicitly.
let _repaintHook: () => void = () => {};
export function _setRepaintHook(fn: () => void): void {
  _repaintHook = fn;
}

/** Host repaint from non-Solid mutations (e.g. overflow=scroll wheel). */
export function scheduleRepaint(): void {
  _repaintHook();
}

/**
 * Function components that are on the stack while host nodes are created.
 * `createComponent` pushes; `createElement` snapshots onto `debugOwner`.
 * Nearest component is last on the stack, first on the frozen path.
 */
const ownerStack: string[] = [];

function snapshotOwner(): readonly string[] | undefined {
  if (ownerStack.length === 0) return undefined;
  const path: string[] = [];
  for (let i = ownerStack.length - 1; i >= 0; i--) path.push(ownerStack[i]);
  return Object.freeze(path);
}

const renderer = createRenderer<CanvasNode>({
  createElement(type: string, staticProps?: Record<string, unknown>): CanvasNode {
    const node = createNode(toNodeType(type));
    node.debugOwner = snapshotOwner();
    applyProps(node, staticProps);
    return node;
  },

  createTextNode(value: string): CanvasNode {
    const node = createNode("_text_content");
    node.textContent = value;
    node.debugOwner = snapshotOwner();
    return node;
  },

  replaceText(node: CanvasNode, value: string): void {
    node.textContent = value;
    markDirty(node);
    _repaintHook();
  },

  setProperty(node: CanvasNode, name: string, value: unknown, _prev?: unknown): void {
    applyProp(node, name, value);
    _repaintHook();
  },

  insertNode(parent: CanvasNode, node: CanvasNode, anchor?: CanvasNode): void {
    insertChild(parent, node, anchor ?? null);
    _repaintHook();
  },

  removeNode(parent: CanvasNode, node: CanvasNode): void {
    applySelectable(node, false);
    removeChild(parent, node);
    _repaintHook();
  },

  isTextNode(node: CanvasNode): boolean {
    return node.type === "_text_content";
  },

  getParentNode(node: CanvasNode): CanvasNode | undefined {
    return node.parent ?? undefined;
  },

  getFirstChild(node: CanvasNode): CanvasNode | undefined {
    return node.children[0];
  },

  getNextSibling(node: CanvasNode): CanvasNode | undefined {
    const parent = node.parent;
    if (!parent) return undefined;
    const idx = parent.children.indexOf(node);
    return parent.children[idx + 1];
  },
});

export const {
  render,
  effect,
  memo,
  createElement,
  createTextNode,
  insertNode,
  spread,
  setProp,
  mergeProps,
  applyRef,
  ref,
} = renderer;

/**
 * Compiled JSX passes a `null` marker for a dynamic child with nothing static
 * after it ("append here"). `@solidjs/universal` 2.0.0-rc.8 keeps no node for
 * such a slot while it renders an empty list, so the slot's next nodes are
 * appended after later siblings — a `<For>` that starts empty ends up painted
 * above the `<Show>` written after it. Pin every appended slot to its own empty
 * anchor; layout ignores empty text nodes.
 */
export function insert(...args: Parameters<typeof renderer.insert>): ReturnType<typeof renderer.insert> {
  const [parent, accessor, marker, ...rest] = args;
  if (marker !== null) return renderer.insert(parent, accessor, marker, ...rest);
  const anchor = createNode("_text_content");
  insertChild(parent, anchor, null);
  return renderer.insert(parent, accessor, anchor, ...rest);
}

function hostTrace(message: string): void {
  const write = (globalThis as { trace?: (s: string) => void }).trace;
  if (typeof write === "function") write(`${message}\n`);
}

/** Push the component name so host leaves created inside it record `debugOwner`. */
export function createComponent<T>(Comp: (props: T) => CanvasNode, props: T): CanvasNode {
  const label = typeof Comp === "function" ? Comp.name || "?" : String(Comp);
  if (typeof Comp !== "function") {
    hostTrace(`cc:not-fn ${label}`);
    throw new TypeError(`createComponent: ${label} is not a function`);
  }
  if (label) ownerStack.push(label);
  try {
    return renderer.createComponent(Comp, props);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hostTrace(`cc:${label}: ${message}`);
    throw error;
  } finally {
    if (label) ownerStack.pop();
  }
}
