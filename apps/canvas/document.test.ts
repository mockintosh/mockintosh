import { describe, expect, it } from "vitest";
import {
  allocateId,
  applyResize,
  bringToFront,
  containsPoint,
  duplicateElement,
  hitTest,
  lineEndpoints,
  lineFrame,
  normalizeFrame,
  parseDocument,
  replaceElement,
  resizeElement,
  sendToBack,
  type CanvasDocument,
  type ShapeElement,
  type TextElement,
} from "./document";

function rect(id: string, x: number, y: number, width: number, height: number): ShapeElement {
  return { id, type: "rect", x, y, width, height, fill: "none", stroke: true };
}

describe("parseDocument", () => {
  it("round-trips a mixed document and skips unknown types", () => {
    const raw = {
      version: 1,
      elements: [
        { id: "e1", type: "rect", x: 4, y: 6, width: 20, height: 10, fill: "gray50", stroke: true },
        { id: "e2", type: "text", x: 1, y: 2, width: 40, height: 14, text: "Hello", font: "menu", align: "center" },
        { id: "e3", type: "star", x: 0, y: 0, width: 8, height: 8 },
        { id: "e2", type: "oval", x: 0, y: 0, width: 8, height: 8, fill: "black" },
      ],
    };
    const doc = parseDocument(raw);
    expect(doc.elements).toHaveLength(3);
    expect(doc.elements[0]).toMatchObject({ id: "e1", type: "rect", fill: "gray50" });
    expect(doc.elements[1]).toMatchObject({ id: "e2", type: "text", text: "Hello", font: "menu", align: "center" });
    expect(doc.elements[2]?.type).toBe("oval");
    expect(doc.elements[2]?.id).not.toBe("e2");
    expect(doc.width).toBe(288);
    expect(doc.height).toBe(288);
  });

  it("keeps a saved page size", () => {
    const doc = parseDocument({ version: 1, width: 512, height: 384, elements: [] });
    expect(doc.width).toBe(512);
    expect(doc.height).toBe(384);
  });

  it("keeps Geist Pixel and falls unknown faces back to body", () => {
    const doc = parseDocument({
      version: 1,
      elements: [
        { id: "e1", type: "text", x: 0, y: 0, width: 40, height: 20, text: "Hi", font: "pixel", align: "left" },
        { id: "e2", type: "text", x: 0, y: 0, width: 40, height: 20, text: "Hi", font: "chicago", align: "left" },
      ],
    });
    expect((doc.elements[0] as TextElement).font).toBe("pixel");
    expect((doc.elements[1] as TextElement).font).toBe("body");
  });

  it("rejects the wrong version", () => {
    expect(() => parseDocument({ version: 2, elements: [] })).toThrow(/version/);
  });

  it("replaces one element without touching the original list or element", () => {
    const doc: CanvasDocument = { version: 1, width: 80, height: 60, elements: [rect("a", 0, 0, 8, 8), rect("b", 0, 0, 8, 8)] };
    const next = replaceElement(doc.elements, "a", (el) => ({ ...el, x: 99 }));
    expect(next).not.toBe(doc.elements);
    expect(next[0]).toMatchObject({ id: "a", x: 99 });
    expect(next[1]).toBe(doc.elements[1]);
    expect(doc.elements[0]?.x).toBe(0);
  });
});

describe("geometry", () => {
  it("normalizes a dragged frame", () => {
    expect(normalizeFrame(10, 10, 4, 6)).toEqual({ x: 4, y: 6, width: 6, height: 4 });
  });

  it("hit-tests front-most first and misses lines that are far away", () => {
    const back = rect("back", 0, 0, 40, 40);
    const front: TextElement = {
      id: "front",
      type: "text",
      x: 5,
      y: 5,
      width: 20,
      height: 12,
      text: "A",
      font: "body",
      align: "left",
    };
    const line: ShapeElement = {
      id: "line",
      type: "line",
      x: 50,
      y: 0,
      width: 20,
      height: 20,
      fill: "none",
      stroke: true,
    };
    expect(hitTest([back, front], 8, 8)?.id).toBe("front");
    expect(hitTest([back, front], 30, 30)?.id).toBe("back");
    expect(containsPoint(line, 60, 10)).toBe(true);
    expect(containsPoint(line, 70, 0)).toBe(false);
  });

  it("treats an oval as an ellipse, not its bounding box", () => {
    const oval: ShapeElement = {
      id: "o",
      type: "oval",
      x: 0,
      y: 0,
      width: 20,
      height: 10,
      fill: "white",
      stroke: true,
    };
    expect(containsPoint(oval, 10, 5)).toBe(true);
    expect(containsPoint(oval, 0, 0)).toBe(false);
  });

  it("resizes from the opposite corner and clamps the minimum", () => {
    const next = applyResize({ x: 10, y: 10, width: 20, height: 20 }, "se", 40, 50, 8, 8);
    expect(next).toEqual({ x: 10, y: 10, width: 30, height: 40 });
    const tiny = applyResize({ x: 10, y: 10, width: 20, height: 20 }, "nw", 28, 28, 8, 8);
    expect(tiny.width).toBeGreaterThanOrEqual(8);
    expect(tiny.height).toBeGreaterThanOrEqual(8);
  });

  it("records the NE–SW diagonal on a reversed line", () => {
    const el: ShapeElement = { id: "l", type: "line", ...lineFrame(20, 0, 0, 10), fill: "none", stroke: true };
    expect(el).toMatchObject({ x: 0, y: 0, width: 20, height: 10, reverse: true });
    expect(lineEndpoints(el)).toEqual({ x0: 19, y0: 0, x1: 0, y1: 9 });
  });

  it("resizes into a new element and leaves the original alone", () => {
    const orig = rect("r", 10, 10, 20, 20);
    const next = resizeElement(orig, "se", 5, 7);
    expect(next).toMatchObject({ id: "r", x: 10, y: 10, width: 25, height: 27 });
    expect(orig).toMatchObject({ width: 20, height: 20 });
  });

  it("drags a line endpoint and keeps the other end fixed", () => {
    const line: ShapeElement = { id: "l", type: "line", ...lineFrame(0, 0, 20, 10), fill: "none", stroke: true };
    expect(resizeElement(line, "end", -30, 0)).toMatchObject({ x: -11, y: 0, reverse: true });
    expect(resizeElement(rect("r", 0, 0, 8, 8), "start", 4, 4)).toMatchObject({ x: 0, y: 0 });
  });

  it("raises, lowers, and duplicates without sharing identity", () => {
    const a = rect("a", 0, 0, 8, 8);
    const b = rect("b", 1, 1, 8, 8);
    expect(bringToFront([a, b], "a").map((el) => el.id)).toEqual(["b", "a"]);
    expect(sendToBack([a, b], "b").map((el) => el.id)).toEqual(["b", "a"]);
    const copy = duplicateElement(a, "c");
    expect(copy).toMatchObject({ id: "c", x: 8, y: 8 });
    expect(copy).not.toBe(a);
  });

  it("allocates ids that do not collide", () => {
    expect(allocateId([rect("e1", 0, 0, 8, 8), rect("e2", 0, 0, 8, 8)])).toBe("e3");
  });
});
