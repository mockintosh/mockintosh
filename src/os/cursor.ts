/**
 * Cursor compositing — the software stand-in for the Mac's VBL cursor task.
 *
 * QuickDraw tracks *which* cursor is current and whether it is hidden
 * (`cursorState`, `SetCursor`, `HideCursor`, `ObscureCursor`); it never draws
 * it. The OS draws it here, on top of the finished frame, with two `CopyBits`
 * exactly as the ROM did: punch the mask out (`srcBic`), then XOR the data in.
 */
import { cursorState, type GrafPort } from "@mockintosh/quickdraw";
import { blitQuickdrawCursor } from "@mockintosh/ui";

/**
 * Draw the current cursor into `port` with its hot spot at (`x`, `y`).
 * Honors `HideCursor`/`ObscureCursor`; clips to the port.
 */
export function drawCursor(port: GrafPort, x: number, y: number): void {
  if (!cursorState.visible || cursorState.obscured) return;
  blitQuickdrawCursor(port, cursorState.cursor, x, y);
}
