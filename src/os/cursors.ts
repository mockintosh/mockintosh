/**
 * The OS's cursors, as QuickDraw `Cursor`s (16×16 data + mask + hot spot).
 *
 * Faces come from `@mockintosh/ui` (`MAC_CURSOR_FACES`) — the same table the
 * catalog uses. Change the cursor with `SetCursor(cursors.watch)`; `drawCursor`
 * paints whatever `cursorState` holds. Hover follows widget `cursor` names
 * via {@link cursorForName} unless an app has locked a cursor.
 */

import { type Cursor } from "@mockintosh/quickdraw";
import {
  cursorFromFace,
  cursorFromFaceCached,
  isCursorFace,
  MAC_CURSOR_FACES,
  resolveMacCursorFace,
  type CursorSpec,
} from "@mockintosh/ui";

export const cursors = {
  arrow: cursorFromFace(MAC_CURSOR_FACES.arrow),
  iBeam: cursorFromFace(MAC_CURSOR_FACES.iBeam),
  cross: cursorFromFace(MAC_CURSOR_FACES.cross),
  plus: cursorFromFace(MAC_CURSOR_FACES.plus),
  watch: cursorFromFace(MAC_CURSOR_FACES.watch),
  grab: cursorFromFace(MAC_CURSOR_FACES.grab),
  grabbing: cursorFromFace(MAC_CURSOR_FACES.grabbing),
} satisfies Record<string, Cursor>;

const named: Record<string, Cursor> = {
  default: cursors.arrow,
  arrow: cursors.arrow,
  pointer: cursors.arrow,
  text: cursors.iBeam,
  iBeam: cursors.iBeam,
  wait: cursors.watch,
  watch: cursors.watch,
  crosshair: cursors.cross,
  cross: cursors.cross,
  plus: cursors.plus,
  grab: cursors.grab,
  grabbing: cursors.grabbing,
};

/**
 * QuickDraw cursor for a widget's `cursor` — a name or the app's own face.
 * `pointer` is the arrow here (classic buttons); the catalog maps it to the hand.
 */
export function cursorForName(spec: CursorSpec): Cursor {
  if (isCursorFace(spec)) return cursorFromFaceCached(spec);
  return named[spec] ?? cursors.arrow;
}

export { resolveMacCursorFace };
