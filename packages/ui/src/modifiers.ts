/**
 * The modifier keys held down, as of the latest keyboard or pointer event —
 * the Toolbox's `GetKeys` for Shift, Option, Control and Command.
 *
 * Mouse handlers take coordinates only; a paint tool that constrains on
 * Shift or copies on Option asks here, during the press, like
 * `KeyIsDown(shiftCode)` inside a `WHILE StillDown` loop.
 */

import type { Modifiers } from "./nodes";

const held: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };

/** A copy of the modifier keys held now. */
export function heldModifiers(): Modifiers {
  return { ...held };
}

/** Record the modifiers a host event reported. Hosts call this; apps read {@link heldModifiers}. */
export function noteModifiers(modifiers: Modifiers): void {
  held.shift = modifiers.shift;
  held.ctrl = modifiers.ctrl;
  held.alt = modifiers.alt;
  held.meta = modifiers.meta;
}
