import { describe, expect, it } from "vitest";
import { parseShortcut, shortcutLabel, shortcutMatches } from "./shortcuts";

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
