/**
 * Menu item keyboard equivalents. A `shortcut` is one character, the key
 * pressed with ⌘, after any of ⌥ and ⇧: "S" is ⌘S, "⇧S" is ⇧⌘S, "⌥⇧S" is
 * ⌥⇧⌘S. The modifiers must be exactly those held, so ⇧⌘S is not ⌘S.
 */
import { COMMAND_KEY, OPTION_KEY, SHIFT_KEY, type Modifiers } from "@mockintosh/ui";
import type { MenubarActionItem, MenubarDefinition, MenubarItemDef } from "@mockintosh/sdk";

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

/**
 * Chords the browser or the host takes before the page sees them (quit, close,
 * new window, hide, minimize), with the meaning an item may still give each:
 * Quit on ⌘Q stays reachable with ⌃Q. Any other use can only be reached with ⌃.
 */
const HOST_RESERVED: ReadonlyMap<string, RegExp | null> = new Map([
  ["⌘Q", /^Quit\b/],
  ["⌘W", /^Close\b/],
  ["⌘N", /^New\b/],
  ["⌘T", /^New Tab\b/],
  ["⌘H", /^Hide\b/],
  ["⌘M", /^Minimize\b/],
  ["⇧⌘Q", null],
  ["⇧⌘W", null],
  ["⇧⌘N", null],
  ["⇧⌘T", null],
  ["⌥⌘H", null],
  ["⌥⌘M", null],
]);

/** Keys an app keeps from the original it recreates, reserved or not. */
const AUTHENTIC: Readonly<Record<string, readonly string[]>> = {
  macpaint: ["⌘M"], // Align Middle, as in MacPaint 1.0
  photobooth: ["⌘T"], // Take Photo, as in Photo Booth
};

/** Everything in `items` with a shortcut, inside submenus too (dimmed or not). */
function* shortcutItems(items: readonly MenubarItemDef[]): Generator<MenubarActionItem & { shortcut: string }> {
  for (const item of items) {
    if (item.type === "submenu") yield* shortcutItems(item.items);
    else if ((item.type === undefined || item.type === "action") && item.shortcut) yield item as MenubarActionItem & { shortcut: string };
  }
}

/**
 * What's wrong with a menubar's shortcuts: one that isn't a key, one chord on
 * two items (the first would always win), or a chord the host keeps used for
 * something else.
 */
export function menubarProblems(menus: readonly MenubarDefinition[], appId?: string): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const authentic = new Set(appId ? AUTHENTIC[appId] : []);
  for (const menu of menus) {
    for (const item of shortcutItems(menu.items)) {
      if (!parseShortcut(item.shortcut)) {
        problems.push(`“${item.label}” has shortcut "${item.shortcut}", which isn't one key after ⌥ or ⇧`);
        continue;
      }
      const chord = shortcutLabel(item.shortcut);
      const other = seen.get(chord);
      if (other !== undefined && other !== item.label) problems.push(`${chord} is both “${other}” and “${item.label}”`);
      seen.set(chord, item.label);
      const meaning = HOST_RESERVED.get(chord);
      if (meaning !== undefined && !meaning?.test(item.label) && !authentic.has(chord)) {
        problems.push(`${chord} never reaches the page (the browser or the host keeps it), so “${item.label}” can only be reached with ⌃`);
      }
    }
  }
  return problems;
}

const warned = new Set<string>();

/** Warn once about each of `menubarProblems`, for the app's author. */
export function warnMenubarProblems(appId: string, menus: readonly MenubarDefinition[]): void {
  for (const problem of menubarProblems(menus, appId)) {
    const key = `${appId}\n${problem}`;
    if (warned.has(key)) continue;
    warned.add(key);
    console.warn(`${appId} menus: ${problem}`);
  }
}
