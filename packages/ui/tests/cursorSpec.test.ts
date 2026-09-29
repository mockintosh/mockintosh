import { describe, expect, it } from "vitest";
import { createNode } from "../src/nodes";
import { cssCursor, cursorOf } from "../src/cursor";
import { resolveCursorFace, type CursorFace } from "../src/cursorFace";
import { heldModifiers, noteModifiers } from "../src/modifiers";

const face: CursorFace = {
  sprite: { width: 16, height: 16, data: new Uint8Array(256), mask: new Uint8Array(256) },
  hotSpot: { h: 8, v: 8 },
};

describe("app cursor faces", () => {
  it("inherit like names and present as a PNG in CSS", () => {
    const parent = createNode("box");
    parent._eventHandlers = { cursor: face };
    const child = createNode("box");
    child._eventHandlers = {};
    child.parent = parent;
    expect(cursorOf(child)).toBe(face);
    expect(cssCursor(face)).toMatch(/^url\("data:image\/png;base64,.+"\) 8 8, default$/);
    expect(resolveCursorFace(face, {})).toBe(face);
  });

  it("fall back to the default face for names the table lacks", () => {
    expect(resolveCursorFace("toString", { default: face })).toBe(face);
  });
});

describe("heldModifiers", () => {
  it("reports the last modifiers a host noted", () => {
    noteModifiers({ shift: true, ctrl: false, alt: true, meta: false });
    expect(heldModifiers()).toEqual({ shift: true, ctrl: false, alt: true, meta: false });
    noteModifiers({ shift: false, ctrl: false, alt: false, meta: false });
    expect(heldModifiers().alt).toBe(false);
  });
});
