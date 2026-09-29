/**
 * The app's part of a window lives in its own reactive root, which the OS
 * disposes before it removes the window.
 *
 * Solid forbids writing a signal inside an owned scope, and disposal runs
 * cleanups in whatever scope triggered it. Left to the window list, an app's
 * `onCleanup` would run inside the shell's own reconciliation — so a cleanup
 * that writes state, or closes a stream whose listener does, would throw and
 * halt the one reactive runtime every app shares. Tearing the root down here,
 * with no owner, gives every app's cleanups the same footing on every path:
 * the close box, File › Quit, and shutdown.
 */
import { createRoot, onCleanup, runWithOwner } from "solid-js";

interface WindowContentRoot {
  dispose(): void;
  onError(error: unknown): void;
}

const roots = new Map<string, WindowContentRoot>();

/**
 * Run `render` in a root the OS tears down ahead of window `windowId`.
 * Call it from inside the window's component tree, so the root inherits the
 * window's contexts. `onError` hears a cleanup that throws.
 */
export function mountWindowContent<T>(windowId: string, render: () => T, onError: (error: unknown) => void): T {
  return createRoot((dispose) => {
    const root: WindowContentRoot = { dispose, onError };
    roots.set(windowId, root);
    onCleanup(() => {
      if (roots.get(windowId) === root) roots.delete(windowId);
    });
    return render();
  });
}

/** Dispose a window's content now, outside any reactive scope. */
export function disposeWindowContent(windowId: string): void {
  const root = roots.get(windowId);
  if (!root) return;
  roots.delete(windowId);
  try {
    runWithOwner(null, root.dispose);
  } catch (error) {
    root.onError(error);
  }
}

export function disposeAllWindowContent(): void {
  for (const windowId of [...roots.keys()]) disposeWindowContent(windowId);
}
