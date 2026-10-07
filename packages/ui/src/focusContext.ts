/**
 * Focus context — provides `useFocus()` to framework components.
 * The FocusProvider wraps the component tree inside createUI().
 */

import { createContext, useContext, type Accessor } from "solid-js";
import type { CanvasNode } from "./nodes";
import type { FocusManager } from "./focus";

export interface FocusContextValue {
  manager: FocusManager;
  /** The CanvasNode associated with the current component — set by useFocus(). */
  getNode: () => CanvasNode | null;
}

export const FocusContext = createContext<FocusContextValue | null>(null);

export interface UseFocusResult {
  isFocused: Accessor<boolean>;
  focus: () => void;
  blur: () => void;
}

/**
 * Returns focus state for the nearest focusable element.
 *
 * Components must attach the returned ref to their root CanvasNode via
 * the `ref` prop or store the node manually and call `manager.focus(node)`.
 *
 * In practice, components wire focus imperatively via onMouseDown/onClick
 * and check `isFocused()` reactively.
 */
export function useFocus(nodeRef: { current: CanvasNode | null }): UseFocusResult {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useFocus() must be called inside a UI tree");

  const { manager } = ctx;
  const focused = manager.getFocusedSignal();

  return {
    isFocused: () => nodeRef.current !== null && focused() === nodeRef.current,
    focus: () => {
      if (nodeRef.current) manager.focus(nodeRef.current);
    },
    blur: () => {
      if (nodeRef.current && focused() === nodeRef.current) manager.blur();
    },
  };
}

export function getFocusManager(): FocusManager {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("getFocusManager() must be called inside a UI tree");
  return ctx.manager;
}
