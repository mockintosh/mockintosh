/**
 * `<box onLayout>` delivery. After each layout pass, boxes whose measured
 * box differs from the last one reported get their callback — deferred to
 * a microtask so a callback that writes signals never runs mid-layout.
 */
import type { CanvasNode, LayoutChangeFn, LayoutSize } from "./nodes";

const lastReported = new WeakMap<CanvasNode, LayoutSize>();

export function notifyLayoutChanges(root: CanvasNode): void {
  const pending: Array<{ onLayout: LayoutChangeFn; size: LayoutSize }> = [];
  collect(root, pending);
  if (pending.length === 0) return;
  queueMicrotask(() => {
    for (const { onLayout, size } of pending) onLayout(size);
  });
}

function sameBox(a: LayoutSize, b: LayoutSize): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function collect(node: CanvasNode, pending: Array<{ onLayout: LayoutChangeFn; size: LayoutSize }>): void {
  const onLayout = node.props["onLayout"] as LayoutChangeFn | undefined;
  if (onLayout) {
    const { x, y, width, height } = node.layout;
    const size = { x, y, width, height };
    const prev = lastReported.get(node);
    if (!prev || !sameBox(prev, size)) {
      lastReported.set(node, size);
      pending.push({ onLayout, size });
    }
  }
  for (const child of node.children) collect(child, pending);
}
