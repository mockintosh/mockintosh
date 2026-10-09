/**
 * Menu item keyboard equivalents. A `shortcut` is one character, the key
 * pressed with ⌘, after any of ⌥ and ⇧: "S" is ⌘S, "⇧S" is ⇧⌘S, "⌥⇧S" is
 * ⌥⇧⌘S. The modifiers must be exactly those held, so ⇧⌘S is not ⌘S.
 */
import { COMMAND_KEY, OPTION_KEY, SHIFT_KEY, type Modifiers } from "@mockintosh/ui";

export interface Shortcut {
  /** The key: a capital letter, or the character itself ("5", "[", "?"). */
  key: string;
  shift: boolean;
  option: boolean;
}

/** `text` read as a shortcut, or null when it isn't one. */
export function parseShortcut(text: string): Shortcut | null {
  const chars = [...text];
  let shift = false;
  let option = false;
  while (chars.length > 1) {
    const c = chars[0];
    if (c === SHIFT_KEY) shift = true;
    else if (c === OPTION_KEY) option = true;
    else if (c !== COMMAND_KEY) break;
    chars.shift();
  }
  if (chars.length !== 1) return null;
  return { key: chars[0].toUpperCase(), shift, option };
}

/** As the menu shows it, modifiers in the Mac's order: "⌥⇧⌘S". */
export function shortcutLabel(text: string): string {
  const s = parseShortcut(text);
  if (!s) return `${COMMAND_KEY}${text}`;
  return `${s.option ? OPTION_KEY : ""}${s.shift ? SHIFT_KEY : ""}${COMMAND_KEY}${s.key}`;
}

/** Characters of the keys that aren't letters or digits, by `KeyboardEvent.code`. */
const CODE_CHARACTERS: Readonly<Record<string, string>> = {
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
};

/** The character on the key at `code` (US layout), unshifted. */
function physicalCharacter(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return CODE_CHARACTERS[code];
}

/**
 * Whether ⌘ with `key` and `mods` is the shortcut `text`. `key` is what the
 * key typed; `code` is where it is, for when a modifier changed what it
 * typed (on a Mac ⌥S types ß, and ⇧[ types {).
 */
export function shortcutMatches(text: string, key: string, code: string | undefined, mods: Modifiers): boolean {
  const s = parseShortcut(text);
  if (!s || s.option !== mods.alt) return false;
  const physical = physicalCharacter(code);
  if (/^[A-Z]$/.test(s.key)) {
    if (s.shift !== mods.shift) return false;
    return /^[a-z]$/i.test(key) ? key.toUpperCase() === s.key : physical === s.key;
  }
  // "?" arrives as "?", whatever it took to type it.
  if (key === s.key) return !s.shift || mods.shift;
  return physical === s.key && s.shift === mods.shift && (mods.shift || mods.alt);
}
