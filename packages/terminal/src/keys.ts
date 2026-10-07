/**
 * Keys to the bytes a terminal sends, in xterm's encoding. A pure table:
 * the view calls it for each key-down, and sends typed characters (which
 * arrive as key-presses) as themselves.
 *
 * ⌘ is never sent: ⌘-keys belong to the menubar. ⌥ types the Mac
 * character, as Apple's Terminal does by default, except on keys with no
 * character, where it is the Meta modifier.
 */

export interface KeyModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

export interface KeyModes {
  applicationCursorKeys: boolean;
}

const ESC = "\x1b";
const CSI = "\x1b[";
const SS3 = "\x1bO";

const CURSOR: Record<string, string> = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D", Home: "H", End: "F" };
const TILDE: Record<string, number> = { Insert: 2, Delete: 3, PageUp: 5, PageDown: 6, F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24 };
const PF: Record<string, string> = { F1: "P", F2: "Q", F3: "R", F4: "S" };

/** xterm's modifier parameter: 1 + Shift + 2·Alt + 4·Ctrl. */
function modifierParam(m: KeyModifiers): number {
  return 1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0);
}

/** The control code ⌃ + `key` types, or null. */
export function controlCode(key: string): string | null {
  if (key.length !== 1) return null;
  const c = key.toLowerCase();
  if (c >= "a" && c <= "z") return String.fromCharCode(c.charCodeAt(0) - 96);
  switch (c) {
    case "@": case " ": case "2": return "\x00";
    case "[": case "3": return "\x1b";
    case "\\": case "4": return "\x1c";
    case "]": case "5": return "\x1d";
    case "^": case "6": return "\x1e";
    case "_": case "-": case "7": case "/": return "\x1f";
    case "?": case "8": return "\x7f";
    default: return null;
  }
}

/**
 * Bytes for a key-down, or null when the key-down sends nothing (a plain
 * character, which arrives as a key-press, a ⌘-key, a lone modifier).
 */
export function encodeKey(key: string, mods: KeyModifiers, modes: KeyModes): string | null {
  if (mods.meta) return null;
  const param = modifierParam(mods);
  const cursor = CURSOR[key];
  if (cursor) {
    if (param > 1) return `${CSI}1;${param}${cursor}`;
    return (modes.applicationCursorKeys ? SS3 : CSI) + cursor;
  }
  const tilde = TILDE[key];
  if (tilde !== undefined) return param > 1 ? `${CSI}${tilde};${param}~` : `${CSI}${tilde}~`;
  const pf = PF[key];
  if (pf) return param > 1 ? `${CSI}1;${param}${pf}` : SS3 + pf;
  const meta = mods.alt ? ESC : "";
  switch (key) {
    case "Enter": return meta + "\r";
    case "Backspace": return meta + (mods.ctrl ? "\x08" : "\x7f");
    case "Tab": return mods.shift ? `${CSI}Z` : meta + "\t";
    case "Escape": return ESC;
  }
  if (key.length === 1 && mods.ctrl) {
    const code = controlCode(key);
    return code === null ? null : meta + code;
  }
  return null;
}

/** What a typed character sends. */
export function encodeText(text: string): string {
  return text.replace(/\r?\n/g, "\r");
}

/** Wrap a paste the way the program asked for. Pasted newlines become returns. */
export function encodePaste(text: string, bracketed: boolean): string {
  const body = text.replace(/\r?\n/g, "\r");
  if (!bracketed) return body;
  // A paste can't end bracketed paste early by containing the end marker.
  return `${CSI}200~${body.replaceAll(`${CSI}201~`, "")}${CSI}201~`;
}

export type MouseButton = 0 | 1 | 2;
export type MouseAction = "press" | "release" | "drag" | "move" | "wheel-up" | "wheel-down";

/**
 * A mouse report for a 0-based cell: SGR (`?1006`) when the program asked
 * for it, else the original X10 bytes, which can't address past column 223.
 */
export function encodeMouse(action: MouseAction, button: MouseButton, col: number, row: number, mods: KeyModifiers, sgr = true): string {
  let code: number;
  switch (action) {
    case "wheel-up": code = 64; break;
    case "wheel-down": code = 65; break;
    case "move": code = 35; break;
    case "drag": code = 32 + button; break;
    default: code = button;
  }
  code += (mods.shift ? 4 : 0) + (mods.alt ? 8 : 0) + (mods.ctrl ? 16 : 0);
  if (sgr) return `${CSI}<${code};${col + 1};${row + 1}${action === "release" ? "m" : "M"}`;
  // X10 has no release button: a release is button 3.
  if (action === "release") code = 3 + (code & ~3);
  const byte = (n: number) => String.fromCharCode(Math.min(255, n + 32));
  return `${CSI}M${byte(code)}${byte(col + 1)}${byte(row + 1)}`;
}

/** The focus report a program asked for with `?1004h`. */
export function encodeFocus(focused: boolean): string {
  return focused ? `${CSI}I` : `${CSI}O`;
}
