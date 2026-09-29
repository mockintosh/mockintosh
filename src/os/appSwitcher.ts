/**
 * The application menu — MultiFinder's switcher. The Finder is always
 * running. Other apps are running while they own a window. Switching brings
 * that app's windows in front of the others, keeping each app's own order.
 */

import { isModalWindow } from "./layering";
import { windowDefinition, type OSWindowKind } from "./windowKinds";

/** System windows (alerts) are not applications you switch to. */
function isSwitcherApp(appId: string, finderId: string): boolean {
  return appId !== finderId && !appId.startsWith("__");
}

/** Finder first, then each other app in the order its first window opened. */
export function runningAppIds(windows: readonly { appId: string }[], finderId: string): string[] {
  const ids = [finderId];
  for (const win of windows) {
    if (!isSwitcherApp(win.appId, finderId) || ids.includes(win.appId)) continue;
    ids.push(win.appId);
  }
  return ids;
}

/**
 * Move `appId`'s windows to the front of the list without reordering the
 * windows inside an app. Paint order within a layer follows this list, so
 * the chosen app covers the others while palettes and alerts keep their layers.
 */
export function orderWindowsForApp<T extends { appId: string }>(windows: readonly T[], appId: string): T[] {
  const others: T[] = [];
  const mine: T[] = [];
  for (const win of windows) (win.appId === appId ? mine : others).push(win);
  return [...others, ...mine];
}

/** The window that should be key after a switch: the app's front document, else its front window. */
export function keyWindowId(
  windows: readonly { id: string; appId: string; kind: OSWindowKind; modal?: boolean }[],
  appId: string,
): string | null {
  const mine = windows.filter((win) => win.appId === appId && !isModalWindow(win));
  const documents = mine.filter((win) => {
    const def = windowDefinition(win.kind);
    return !def.toolPalette && !def.backdrop;
  });
  return (documents.at(-1) ?? mine.at(-1))?.id ?? null;
}
