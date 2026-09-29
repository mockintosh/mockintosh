/**
 * Per-window Solid context — apps push chrome/menu/size instead of the
 * OS pulling getContentHeight / getMenubar / getInfoBar.
 */

import { createContext, useContext, type Accessor } from "solid-js";
import type { MenubarDefinition } from "@mockintosh/sdk";
import type { OSWindow, OSWindowKind } from "./state";

export interface WindowAPI {
  id: string;
  win: OSWindow;
  width: Accessor<number>;
  height: Accessor<number>;
  isActive: Accessor<boolean>;
  scrollY: Accessor<number>;
  scrollTo: (y: number) => void;
  kind: Accessor<OSWindowKind>;
  setTitle: (title: string) => void;
  setContentSize: (width: number, height: number) => void;
  setInfoBar: (items: string[] | null) => void;
  setMenus: (menus: MenubarDefinition[]) => void;
  /** Cover the whole screen with this window, or return it to its windowed form. */
  setFullScreen: (on: boolean) => void;
  close: () => void;
}

export const WindowCtx = createContext<WindowAPI | null>(null);

export function useWindow(): WindowAPI {
  const ctx = useContext(WindowCtx);
  if (!ctx) throw new Error("useWindow() must be called inside a Window");
  return ctx;
}
