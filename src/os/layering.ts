import type { OSWindow, OSWindowKind } from "./state";
import { windowDefinition } from "./windowKinds";

export function windowLayer(kind: OSWindowKind): number {
  return windowDefinition(kind).layer;
}

export function sortWindowsForPaint(windows: OSWindow[]): OSWindow[] {
  return windows
    .map((w, i) => ({ w, i }))
    .sort((a, b) => {
      const la = windowLayer(a.w.kind);
      const lb = windowLayer(b.w.kind);
      if (la !== lb) return la - lb;
      return a.i - b.i;
    })
    .map((x) => x.w);
}

export function isModalKind(kind: OSWindowKind): boolean {
  return windowDefinition(kind).modal;
}

/** Whether `win` blocks every other window: its own `modal`, else its kind's. */
export function isModalWindow(win: Pick<OSWindow, "kind" | "modal">): boolean {
  return win.modal ?? isModalKind(win.kind);
}

export function hasModalFront(windows: OSWindow[]): boolean {
  return windows.some(isModalWindow);
}

/** True if `win` must ignore input because a modal window is open above it. */
export function isBlockedByModal(win: OSWindow, windows: OSWindow[]): boolean {
  return !isModalWindow(win) && hasModalFront(windows);
}
