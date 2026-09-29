/**
 * Standard Macintosh 1-bit faces for the named cursor API.
 *
 * Arrow is QuickDraw's ROM cursor. Watch and plus are System 7.5.3 `CURS`
 * 4 and 3 from `scripts/extract-system753-resources.py`. iBeam and cross
 * dumped as empty (all-transparent) from that image — reconstructed to the
 * documented hot spots. Pointer is HyperCard's browse finger (`CURS` 128).
 * Grab / fist are the open-hand sprites.
 *
 * The full suitcase (Color Tools, Finder busy-watch frames, …) stays in
 * `src/os/resourceCatalog`. Override any face via `cursorFaces` on mount.
 */

import { globals } from "@mockintosh/quickdraw";
import {
  faceFromCursor,
  resolveCursorFace,
  type CursorFace,
  type CursorFaceTable,
} from "../cursorFace";
import type { CursorSpec, NamedCursor } from "../cursor";
import { defineSprite, fromGrid } from "../sprite";

const I_BEAM = fromGrid(16, 16, [
  "....##....##....",
  ".....##..##.....",
  "......####......",
  ".......##.......",
  ".......##.......",
  ".......##.......",
  ".......##.......",
  ".......##.......",
  ".......##.......",
  ".......##.......",
  ".......##.......",
  "......####......",
  ".....##..##.....",
  "....##....##....",
  "................",
  "................",
]);

const CROSS = fromGrid(16, 16, [
  ".....#..........",
  ".....#..........",
  ".....#..........",
  ".....#..........",
  ".....#..........",
  ".###########....",
  ".....#..........",
  ".....#..........",
  ".....#..........",
  ".....#..........",
  ".....#..........",
  "................",
  "................",
  "................",
  "................",
  "................",
]);

const PLUS = defineSprite(
  16,
  16,
  "AFVQAABqpAAAZWkAAGVpAFVlaVVqpWqkZVAVaWVQFWllUBVpaqVqqRqlaqkVZWlVAGVpAABqqQAAGqkAAAVUAA==",
);

const WATCH = defineSprite(
  16,
  16,
  "CqoAAAqqAAAKqgAACqoAACVVgACVZWAAlWVgAJVlYACWpWAAlVVgAJVVYAAlVYAACqoAAAqqAAAKqgAACqoAAA==",
);

/** HyperCard browse tool — index finger up, hot spot on the tip. */
const POINTING = defineSprite(
  16,
  16,
  "AAqAAAAloAAAJaAAACWgAAAloAAAJaAAKiWqgJalmaglpZmaCWVVmgllVVoCVVVaAJVVWgCVVWgAJVVoACVVaA==",
);

const HAND = defineSprite(
  16,
  16,
  "AAKAAAKJagAJaWWACWlliAJZZaYCWWWWKJVVlpaVVVaVlVVYJVVVWAlVVVgJVVVgAlVVYACVVYAAJVWAACVVgA==",
);

const FIST = defineSprite(
  16,
  16,
  "AAAAAAAAAAAAAAAAAAAAAACiigACWWWgAlVVmACVVVgClVVYCVVVWAlVVVgJVVVgAlVVYACVVYAAJVWAACVVgA==",
);

const arrow = faceFromCursor(globals.arrow);
const iBeam: CursorFace = { sprite: I_BEAM, hotSpot: { v: 4, h: 7 } };
const cross: CursorFace = { sprite: CROSS, hotSpot: { v: 5, h: 5 } };
const plus: CursorFace = { sprite: PLUS, hotSpot: { v: 8, h: 8 } };
const watch: CursorFace = { sprite: WATCH, hotSpot: { v: 8, h: 8 } };
const pointing: CursorFace = { sprite: POINTING, hotSpot: { v: 0, h: 7 } };
const grab: CursorFace = { sprite: HAND, hotSpot: { v: 8, h: 8 } };
const grabbing: CursorFace = { sprite: FIST, hotSpot: { v: 8, h: 8 } };

export type MacCursorName = Exclude<NamedCursor, "none">;

/** Default Macintosh faces for every named cursor except `none`. */
export const MAC_CURSOR_FACES: Record<MacCursorName, CursorFace> = {
  default: arrow,
  arrow,
  pointer: pointing,
  text: iBeam,
  iBeam,
  wait: watch,
  watch,
  crosshair: cross,
  cross,
  plus,
  grab,
  grabbing,
};

export function resolveMacCursorFace(
  name: CursorSpec,
  overrides?: CursorFaceTable,
): CursorFace | undefined {
  const faces = overrides ? { ...MAC_CURSOR_FACES, ...overrides } : MAC_CURSOR_FACES;
  return resolveCursorFace(name, faces);
}
