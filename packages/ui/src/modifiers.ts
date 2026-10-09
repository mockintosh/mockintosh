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

/**
 * A host key in the Macintosh's terms. ⌘ and ⌃ are both the Macintosh's ⌘:
 * a browser keeps ⌘W, ⌘N and ⌘Q for itself, so ⌃W, ⌃N, ⌃Q reach those
 * commands, and a PC keyboard's Ctrl is where its ⌘ is. A focus that takes
 * raw keys (a terminal) keeps ⌃ as ⌃, for ⌃C and the rest; there ⌃⇧ and a
 * letter is ⌘, as in a PC's terminals, since a terminal can't tell ⌃⇧C from ⌃C.
 */
export function macKey(key: string, host: Modifiers, rawFocus: boolean): { key: string; modifiers: Modifiers } {
  // ⌃Tab stays: it always moves focus (⌘Tab is the host's app switcher).
  if (!host.ctrl || key === "Tab") return { key, modifiers: host };
  if (!rawFocus) return { key, modifiers: { ...host, ctrl: false, meta: true } };
  if (host.shift && /^[a-z]$/i.test(key)) {
    return { key: key.toLowerCase(), modifiers: { ...host, shift: false, ctrl: false, meta: true } };
  }
  return { key, modifiers: host };
}
