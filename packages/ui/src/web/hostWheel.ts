/**
 * Chrome, Edge, and Firefox send trackpad pinch as `wheel` + `ctrlKey`.
 * The page must not zoom (callers `preventDefault`) and must not treat
 * those deltas as overflow scroll — they are large and not a scroll intent.
 */
export function wheelIsPinchZoom(e: { ctrlKey: boolean }): boolean {
  return e.ctrlKey;
}

/** Pixels a line of wheel travel stands for: Chrome reports a notch as 100 for its 3 lines. */
const LINE_PX = 33;

/**
 * A wheel event's vertical travel in pixels. Firefox reports a mouse wheel
 * in lines (`deltaMode` 1, about 3 a notch) and some devices in pages
 * (`deltaMode` 2); taken as pixels, those scroll thirty times too slowly.
 */
export function wheelDeltaY(e: { deltaY: number; deltaMode: number }, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * pageHeight;
  return e.deltaY;
}
