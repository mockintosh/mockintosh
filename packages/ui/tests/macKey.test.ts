import { describe, expect, it } from "vitest";
import { macKey } from "../src/modifiers";

const NONE = { shift: false, ctrl: false, alt: false, meta: false };
const CTRL = { ...NONE, ctrl: true };
const CMD = { ...NONE, meta: true };

describe("macKey", () => {
  it("reads ⌘, and ⌃ (a PC's Ctrl), as the Macintosh's ⌘", () => {
    expect(macKey("s", CMD, false)).toEqual({ key: "s", modifiers: CMD });
    expect(macKey("s", CTRL, false)).toEqual({ key: "s", modifiers: CMD });
    expect(macKey("Z", { ...CTRL, shift: true }, false)).toEqual({ key: "Z", modifiers: { ...CMD, shift: true } });
    expect(macKey("ArrowLeft", { ...CTRL, alt: true }, false).modifiers).toEqual({ ...CMD, alt: true });
  });

  it("leaves a terminal its ⌃ keys, and makes ⌃⇧ and a letter its ⌘", () => {
    expect(macKey("c", CTRL, true)).toEqual({ key: "c", modifiers: CTRL });
    expect(macKey("ArrowUp", CTRL, true)).toEqual({ key: "ArrowUp", modifiers: CTRL });
    expect(macKey("C", { ...CTRL, shift: true }, true)).toEqual({ key: "c", modifiers: CMD });
    expect(macKey("c", CMD, true)).toEqual({ key: "c", modifiers: CMD });
  });

  it("keeps ⌃Tab, which always moves focus", () => {
    expect(macKey("Tab", CTRL, false)).toEqual({ key: "Tab", modifiers: CTRL });
  });
});
