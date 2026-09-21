/**
 * Cursor compositing — the software stand-in for the Mac's VBL cursor task.
 *
 * QuickDraw tracks *which* cursor is current and whether it is hidden
 * (`cursorState`, `SetCursor`, `HideCursor`, `ObscureCursor`); it never draws
 * it. The OS stamps it onto a presentation copy after the frame, with two
 * `CopyBits` exactly as the ROM did: punch the mask out (`srcBic`), then XOR
 * the data in. Pointer motion restamps that copy; it does not re-paint the tree.
 */
import { cursorState, type Cursor, type GrafPort } from "@mockintosh/quickdraw";
import { blitQuickdrawCursor } from "@mockintosh/ui";

/** Current QuickDraw cursor, or `undefined` when hidden / obscured. */
export function liveCursor(): Cursor | undefined {
  if (!cursorState.visible || cursorState.obscured) return undefined;
  return cursorState.cursor;
}

/**
 * Draw the current cursor into `port` with its hot spot at (`x`, `y`).
 * Honors `HideCursor`/`ObscureCursor`; clips to the port.
 */
export function drawCursor(port: GrafPort, x: number, y: number): void {
  const cursor = liveCursor();
  if (!cursor) return;
  blitQuickdrawCursor(port, cursor, x, y);
}
