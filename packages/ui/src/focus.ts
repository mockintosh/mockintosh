/**
 * Focus system — tracks which node currently receives keyboard events.
 *
 * Rules:
 * - A node is focusable if its `_eventHandlers.tabIndex` is a non-negative number.
 * - Tab / Shift+Tab cycle through focusable nodes in tabIndex ascending order,
 *   using document order (depth-first) as the tiebreaker — matches DOM behavior.
 * - Clicking a focusable node focuses it; clicking elsewhere blurs
 *   (handled in pointer dispatch).
 * - `onFocus` fires on the newly focused node; `onBlur` fires on the old one.
 */

import { createSignal, flush, type Accessor } from "solid-js";
import type { CanvasNode, EventHandlers, Modifiers } from "./nodes";

export interface FocusManager {
  readonly focused: CanvasNode | null;
  focus(node: CanvasNode): void;
  blur(): void;
  focusNext(): void;
  focusPrev(): void;
  /** Restrict Tab cycling to descendants of `scope` (or the whole tree if null). */
  setActiveScope(scope: CanvasNode | null): void;
  getActiveScope(): CanvasNode | null;
  dispatchKeyboard(
    type: "keydown" | "keyup" | "keypress",
    key: string,
    modifiers: Modifiers
  ): void;
  /** Deliver pasted text to the focused node: `onPaste`, else one key-press per character. */
  dispatchPaste(text: string): void;
  /** The focused node takes raw keys (`rawKeys`): Tab and ⌃V are its own. */
  takesRawKeys(): boolean;
  /** For use in useFocus() hook — returns reactive accessor for the focused node. */
  getFocusedSignal(): Accessor<CanvasNode | null>;
}

export function createFocusManager(root: CanvasNode): FocusManager {
  const [focusedNode, setFocusedNode] = createSignal<CanvasNode | null>(null, {
    ownedWrite: true,
  });
  let activeScope: CanvasNode | null = null;
  const lastFocusedInScope = new WeakMap<CanvasNode, CanvasNode>();

  function collectFocusable(node: CanvasNode, out: CanvasNode[]): void {
    if (node._eventHandlers.tabIndex !== undefined && node._eventHandlers.tabIndex >= 0) {
      out.push(node);
    }
    for (const child of node.children) {
      collectFocusable(child, out);
    }
  }

  function getSortedFocusable(): CanvasNode[] {
    const nodes: CanvasNode[] = [];
    collectFocusable(activeScope ?? root, nodes);
    // Stable sort: primary key tabIndex ASC, secondary key document order (already DFS)
    return nodes.sort((a, b) => {
      const at = a._eventHandlers.tabIndex ?? 0;
      const bt = b._eventHandlers.tabIndex ?? 0;
      return at - bt;
    });
  }

  const manager: FocusManager = {
    get focused(): CanvasNode | null {
      return focusedNode();
    },

    focus(node: CanvasNode): void {
      const current = focusedNode();
      if (current === node) return;
      if (current) current._eventHandlers.onBlur?.();
      setFocusedNode(node);
      flush();
      node._eventHandlers.onFocus?.();
      if (activeScope) lastFocusedInScope.set(activeScope, node);
    },

    setActiveScope(scope: CanvasNode | null): void {
      activeScope = scope;
      if (!scope) return;
      const last = lastFocusedInScope.get(scope);
      if (last && last.parent) {
        manager.focus(last);
      }
    },

    getActiveScope(): CanvasNode | null {
      return activeScope;
    },

    blur(): void {
      const current = focusedNode();
      if (!current) return;
      current._eventHandlers.onBlur?.();
      setFocusedNode(null);
      flush();
    },

    focusNext(): void {
      const focusable = getSortedFocusable();
      if (focusable.length === 0) return;
      const current = focusedNode();
      if (!current) {
        manager.focus(focusable[0]);
        return;
      }
      const idx = focusable.indexOf(current);
      const next = focusable[(idx + 1) % focusable.length];
      manager.focus(next);
    },

    focusPrev(): void {
      const focusable = getSortedFocusable();
      if (focusable.length === 0) return;
      const current = focusedNode();
      if (!current) {
        manager.focus(focusable[focusable.length - 1]);
        return;
      }
      const idx = focusable.indexOf(current);
      const prev = focusable[(idx - 1 + focusable.length) % focusable.length];
      manager.focus(prev);
    },

    dispatchKeyboard(
      type: "keydown" | "keyup" | "keypress",
      key: string,
      modifiers: Modifiers
    ): void {
      const current = focusedNode();

      // Tab / Shift+Tab move focus, unless the focused node takes raw keys;
      // ⌃Tab always moves it, so a keyboard user can leave a terminal.
      if (type === "keydown" && key === "Tab" && (modifiers.ctrl || !current?._eventHandlers.rawKeys)) {
        if (modifiers.shift) {
          manager.focusPrev();
        } else {
          manager.focusNext();
        }
        return;
      }

      if (!current) return;
      const handlers = current._eventHandlers;

      if (type === "keydown") {
        handlers.onKeyDown?.(key, modifiers);
      } else if (type === "keyup") {
        handlers.onKeyUp?.(key, modifiers);
      } else if (type === "keypress") {
        handlers.onKeyPress?.(key);
      }
    },

    dispatchPaste(text: string): void {
      const current = focusedNode();
      if (!current) return;
      const handlers = current._eventHandlers;
      if (handlers.onPaste) {
        handlers.onPaste(text);
        return;
      }
      for (const ch of text) handlers.onKeyPress?.(ch);
    },

    takesRawKeys(): boolean {
      return focusedNode()?._eventHandlers.rawKeys === true;
    },

    getFocusedSignal(): Accessor<CanvasNode | null> {
      return focusedNode;
    },
  };

  return manager;
}

/** The nearest `focusScope` ancestor of `node` (a window), or null. */
export function focusScopeOf(node: CanvasNode): CanvasNode | null {
  let n: CanvasNode | null = node;
  while (n) {
    if (n.props["focusScope"] === true) return n;
    n = n.parent;
  }
  return null;
}

// -------------------------------------------------------------------------
// Auto-focus: a node given `autoFocus` takes focus once it is mounted, like
// HTML's attribute — at first render or later, e.g. in a window opened after
// boot. The renderer queues nodes as the prop is set; each UI instance
// drains the queue after flushing, before it lays out and draws.
// -------------------------------------------------------------------------

const pendingAutoFocus = new Set<CanvasNode>();
/** Roots of live UI instances; a queued node under one of them waits for that instance. */
const uiRoots = new WeakSet<CanvasNode>();

/** Called by the renderer when `autoFocus` is set on a node. */
export function requestAutoFocus(node: CanvasNode): void {
  pendingAutoFocus.add(node);
}

/** Called by a UI instance for its root, so other instances leave its queued nodes alone. */
export function registerFocusRoot(root: CanvasNode): void {
  uiRoots.add(root);
}

function rootOf(node: CanvasNode): CanvasNode {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

/**
 * Focus the first queued `autoFocus` node now mounted under `root`, and make
 * its focus scope the active one. Nodes queued under another UI instance
 * stay queued; nodes that never got mounted (or were unmounted) are dropped.
 */
export function applyPendingAutoFocus(root: CanvasNode, manager: FocusManager): void {
  if (pendingAutoFocus.size === 0) return;
  let target: CanvasNode | null = null;
  for (const node of pendingAutoFocus) {
    const top = rootOf(node);
    if (top !== root && uiRoots.has(top)) continue;
    pendingAutoFocus.delete(node);
    if (top === root && node._eventHandlers.autoFocus && !target) target = node;
  }
  if (!target) return;
  const scope = focusScopeOf(target);
  if (scope !== manager.getActiveScope()) manager.setActiveScope(scope);
  if (!isWithin(manager.focused, target)) manager.focus(target);
}

/** A container asking for focus is satisfied when a control inside it already has it. */
function isWithin(node: CanvasNode | null, ancestor: CanvasNode): boolean {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}
