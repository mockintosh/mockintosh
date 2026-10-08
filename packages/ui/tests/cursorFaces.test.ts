import { describe, expect, it } from "vitest";
import { globals } from "@mockintosh/quickdraw";
import { cssCursorFromFace, cursorFromFace, faceFromCursor } from "../src/cursorFace";
import { MAC_CURSOR_FACES, resolveMacCursorFace } from "../src/cursors/mac";

/** Pixels that mark the screen: opaque black, or inverting (data set, mask clear). */
function inkCount(name: keyof typeof MAC_CURSOR_FACES): number {
  const { sprite } = MAC_CURSOR_FACES[name];
  let n = 0;
  for (let i = 0; i < sprite.data.length; i++) {
    if (sprite.data[i]) n += 1;
  }
  return n;
}

function maskCount(name: keyof typeof MAC_CURSOR_FACES): number {
  const { sprite } = MAC_CURSOR_FACES[name];
  let n = 0;
  for (let i = 0; i < sprite.data.length; i++) {
    if (sprite.mask ? sprite.mask[i] : 1) n += 1;
  }
  return n;
}

describe("Macintosh cursor faces", () => {
  it("ships ink for the System set", () => {
    expect(maskCount("arrow")).toBeGreaterThan(10);
    expect(inkCount("iBeam")).toBeGreaterThan(10);
    expect(inkCount("cross")).toBeGreaterThan(10);
    expect(inkCount("plus")).toBeGreaterThan(10);
    expect(inkCount("watch")).toBeGreaterThan(10);
    expect(inkCount("pointer")).toBeGreaterThan(10);
    expect(inkCount("grab")).toBeGreaterThan(10);
  });

  it("draws the I-beam and cross as inverting cursors, like the System's", () => {
    for (const name of ["iBeam", "cross"] as const) {
      expect(maskCount(name)).toBe(0);
      expect(inkCount(name)).toBeGreaterThan(10);
    }
  });

  it("round-trips the ROM arrow through faceFromCursor", () => {
    const face = faceFromCursor(globals.arrow);
    const back = cursorFromFace(face);
    expect([...back.data]).toEqual([...globals.arrow.data]);
    expect([...back.mask]).toEqual([...globals.arrow.mask]);
    expect(back.hotSpot).toEqual(globals.arrow.hotSpot);
  });

  it("resolves aliases onto the same face", () => {
    expect(resolveMacCursorFace("text")).toBe(MAC_CURSOR_FACES.iBeam);
    expect(resolveMacCursorFace("wait")).toBe(MAC_CURSOR_FACES.watch);
    expect(resolveMacCursorFace("pointer")).toBe(MAC_CURSOR_FACES.pointer);
    expect(MAC_CURSOR_FACES.pointer).not.toBe(MAC_CURSOR_FACES.grab);
    expect(resolveMacCursorFace("none")).toBeUndefined();
  });

  it("lets the host override a face", () => {
    const custom = MAC_CURSOR_FACES.watch;
    expect(resolveMacCursorFace("pointer", { pointer: custom })).toBe(custom);
  });

  it("encodes a CSS url() with the hot spot", () => {
    const css = cssCursorFromFace(MAC_CURSOR_FACES.watch);
    expect(css.startsWith("url(\"data:image/png;base64,")).toBe(true);
    expect(css.endsWith(", default")).toBe(true);
    expect(css).toContain(" 8 8, ");
  });
});
