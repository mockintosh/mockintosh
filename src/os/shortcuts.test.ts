import { describe, expect, it } from "vitest";
import { menubarProblems, parseShortcut, shortcutLabel, shortcutMatches } from "./shortcuts";

const NONE = { shift: false, ctrl: false, alt: false, meta: true };
const SHIFT = { ...NONE, shift: true };
const OPTION = { ...NONE, alt: true };

describe("parseShortcut", () => {
  it("reads the key after any ⌥ and ⇧", () => {
    expect(parseShortcut("S")).toEqual({ key: "S", shift: false, option: false });
    expect(parseShortcut("s")).toEqual({ key: "S", shift: false, option: false });
    expect(parseShortcut("⇧Z")).toEqual({ key: "Z", shift: true, option: false });
    expect(parseShortcut("⌥⇧⌘S")).toEqual({ key: "S", shift: true, option: true });
    expect(parseShortcut("[")).toEqual({ key: "[", shift: false, option: false });
    expect(parseShortcut("⇧")).toEqual({ key: "⇧", shift: false, option: false });
    expect(parseShortcut("SS")).toBeNull();
    expect(parseShortcut("")).toBeNull();
  });

  it("labels it in the Mac's order", () => {
    expect(shortcutLabel("S")).toBe("⌘S");
    expect(shortcutLabel("⇧⌥s")).toBe("⌥⇧⌘S");
  });
});

describe("shortcutMatches", () => {
  it("wants exactly the modifiers it names", () => {
    expect(shortcutMatches("S", "s", "KeyS", NONE)).toBe(true);
    expect(shortcutMatches("S", "S", "KeyS", SHIFT)).toBe(false);
    expect(shortcutMatches("⇧S", "S", "KeyS", SHIFT)).toBe(true);
    expect(shortcutMatches("⇧S", "s", "KeyS", NONE)).toBe(false);
    expect(shortcutMatches("S", "s", "KeyS", OPTION)).toBe(false);
  });

  it("finds a letter by its place when ⌥ or the layout typed something else", () => {
    expect(shortcutMatches("⌥S", "ß", "KeyS", OPTION)).toBe(true);
    expect(shortcutMatches("S", "ы", "KeyS", NONE)).toBe(true);
    expect(shortcutMatches("A", "a", "KeyQ", NONE)).toBe(true); // AZERTY: the letter wins
    expect(shortcutMatches("S", "s", undefined, NONE)).toBe(true);
  });

  it("takes a character typed with ⇧ as itself, and a shifted key as the shortcut that says ⇧", () => {
    expect(shortcutMatches("?", "?", "Slash", SHIFT)).toBe(true);
    expect(shortcutMatches("=", "+", "Equal", SHIFT)).toBe(false);
    expect(shortcutMatches("⇧[", "{", "BracketLeft", SHIFT)).toBe(true);
    expect(shortcutMatches("[", "[", "BracketLeft", NONE)).toBe(true);
    expect(shortcutMatches("⌥=", "≠", "Equal", OPTION)).toBe(true);
    expect(shortcutMatches("5", "5", "Digit5", NONE)).toBe(true);
  });
});

describe("menubarProblems", () => {
  const menubar = (...items: { label: string; shortcut: string; disabled?: boolean }[]) => [{ label: "File", items }];

  it("passes standard menus, and Quit, Close and New on the keys the browser keeps", () => {
    expect(menubarProblems(menubar(
      { label: "New Window", shortcut: "N" },
      { label: "Close Window", shortcut: "W" },
      { label: "Undo", shortcut: "Z" },
      { label: "Redo", shortcut: "⇧Z" },
      { label: "Quit", shortcut: "Q" },
    ))).toEqual([]);
  });

  it("finds a chord on two items, inside submenus and dimmed items too", () => {
    expect(menubarProblems([
      { label: "File", items: [{ label: "Save", shortcut: "S" }] },
      { label: "Style", items: [{ type: "submenu", label: "Face", items: [{ label: "Shadow", shortcut: "S", disabled: true }] }] },
    ])).toEqual(["⌘S is both “Save” and “Shadow”"]);
  });

  it("finds a key the browser or host keeps used for something else, unless the app keeps it from its original", () => {
    expect(menubarProblems(menubar({ label: "Home", shortcut: "H" }))).toEqual([
      "⌘H never reaches the page (the browser or the host keeps it), so “Home” can only be reached with ⌃",
    ]);
    expect(menubarProblems(menubar({ label: "Minimize All", shortcut: "⌥M" }))).toHaveLength(1);
    expect(menubarProblems(menubar({ label: "Align Middle", shortcut: "M" }), "macpaint")).toEqual([]);
    expect(menubarProblems(menubar({ label: "Home", shortcut: "⇧H" }))).toEqual([]);
  });

  it("finds a shortcut that isn't one key", () => {
    expect(menubarProblems(menubar({ label: "Save", shortcut: "Ctrl+S" }))).toHaveLength(1);
  });
});
