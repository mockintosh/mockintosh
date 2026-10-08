/**
 * Non-scrolling window bands — chrome the app fills, above or below the
 * scrollable body. Folder “N items” and Icon Gallery’s search bar both use
 * `WindowHeader`; a status strip uses `WindowFooter`. The window scrollbar
 * thumbs only the body between them.
 *
 * Children are registered as a live view (`() => props.children`) so the
 * chrome can render them. Storing a JSX snapshot remounts inputs on every
 * keystroke and steals focus. Only the height is tracked: reading
 * `props.children` builds the children, so tracking it would build a second,
 * unseen copy, whose menus and tooltips would still open on the screen.
 */
import { createContext, createEffect, onCleanup, useContext } from "@mockintosh/ui";
import { runWithOwner } from "solid-js";
import type { JSX } from "@mockintosh/ui";

export type WindowBandView = (() => JSX.Element) | null;

export interface WindowSlots {
  /**
   * `ruled` says the view draws the band's bottom rule itself, so the window
   * doesn't draw one over it: a process window's picture does, under the
   * app's open menus, which the window's own rule would cut across.
   */
  setHeader(view: WindowBandView, height: number, ruled?: boolean): void;
  setFooter(view: WindowBandView, height: number): void;
}

export const WindowSlotsContext = createContext<WindowSlots | null>(null);

function useWindowSlots(): WindowSlots {
  const slots = useContext(WindowSlotsContext);
  if (!slots) throw new Error("WindowHeader/WindowFooter must be used inside a window");
  return slots;
}

export function WindowHeader(props: { height: number; children: JSX.Element }): JSX.Element {
  const slots = useWindowSlots();
  createEffect(
    () => props.height,
    (height) => {
      slots.setHeader(() => props.children, height);
    },
  );
  onCleanup(() => runWithOwner(null, () => slots.setHeader(null, 0)));
  return null;
}

export function WindowFooter(props: { height: number; children: JSX.Element }): JSX.Element {
  const slots = useWindowSlots();
  createEffect(
    () => props.height,
    (height) => {
      slots.setFooter(() => props.children, height);
    },
  );
  onCleanup(() => runWithOwner(null, () => slots.setFooter(null, 0)));
  return null;
}
