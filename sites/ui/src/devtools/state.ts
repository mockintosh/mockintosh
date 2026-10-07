import {
  createSignal,
  findDebugNode,
  type DebugNode,
} from "@mockintosh/ui";
import type { CanvasNode, SemanticMetadata } from "@mockintosh/ui";
import type { CanvasUIHost } from "@mockintosh/ui/web";

export const DEVTOOLS_ROLE = "devtools";

export interface ContextMenuState {
  x: number;
  y: number;
  id: number;
}

const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
const [panelOpen, setPanelOpen] = createSignal(false);
const [picking, setPicking] = createSignal(false);
const [selectedId, setSelectedId] = createSignal<number | null>(null);
const [hoverId, setHoverId] = createSignal<number | null>(null);
const [panelHeight, setPanelHeight] = createSignal(128);
const [tree, setTree] = createSignal<DebugNode | null>(null);

export {
  contextMenu,
  panelOpen,
  picking,
  selectedId,
  hoverId,
  panelHeight,
  tree,
  setContextMenu,
  setSelectedId,
  setHoverId,
  setPanelHeight,
};

export function setPickMode(on: boolean): void {
  setPicking(on);
  if (host) host.canvas.style.cursor = on ? "crosshair" : "";
}

let host: CanvasUIHost | null = null;

export function setDevtoolsHost(next: CanvasUIHost): void {
  host = next;
}

export function isDevtoolsChrome(node: CanvasNode): boolean {
  const semantic = node.props.semantic as SemanticMetadata | undefined;
  return semantic?.role === DEVTOOLS_ROLE || (semantic?.name?.startsWith("devtools") ?? false);
}

function isDevtoolsDebug(node: DebugNode): boolean {
  return node.role === DEVTOOLS_ROLE || (node.name?.startsWith("devtools") ?? false);
}

export function stripDevtools(node: DebugNode): DebugNode {
  const children = Object.freeze(
    node.children.filter((child) => !isDevtoolsDebug(child)).map(stripDevtools),
  );
  return Object.freeze({ ...node, children });
}

export function captureTree(): DebugNode | null {
  if (!host) return null;
  host.paint();
  const next = stripDevtools(host.ui.debugInspect());
  setTree(next);
  return next;
}

export function dismissMenu(): void {
  setContextMenu(null);
}

export function closeDevTools(): void {
  setPanelOpen(false);
  setPickMode(false);
  setHoverId(null);
  setContextMenu(null);
}

export function openInspect(id: number): void {
  setContextMenu(null);
  setPickMode(false);
  setHoverId(null);
  setSelectedId(id);
  setPanelOpen(true);
  captureTree();
  requestAnimationFrame(() => {
    captureTree();
  });
}

export function selectNode(id: number): void {
  setSelectedId(id);
  setHoverId(null);
}

export function findInTree(id: number | null): DebugNode | null {
  const root = tree();
  if (id == null || !root) return null;
  return findDebugNode(root, (node) => node.id === id);
}
