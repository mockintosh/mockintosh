import { describe, expect, it } from "vitest";
import type { SolidApp } from "./apps";
import { buildAppWindow } from "./appWindow";
import { windowTotalHeight } from "./windowGeometry";

const app: SolidApp = {
  id: "tall-app",
  title: "Tall app",
  icon: "icon/computer",
  defaultSize: { width: 288, height: 328 },
  Component: () => null,
};

const env = {
  screen: { width: 512, height: 342 },
  menubarHeight: 20,
  openWindowCount: 0,
};

describe("app window placement", () => {
  it.each([
    { kind: "document" as const, scrollable: false },
    { kind: "document" as const, scrollable: true },
    { kind: "plain" as const, scrollable: false },
  ])("keeps tall $kind windows and their standard bounds on screen (scrollable=$scrollable)", (spec) => {
    const win = buildAppWindow(app, spec, env);
    expect(win.y).toBeGreaterThanOrEqual(23);
    expect(win.y + windowTotalHeight(win)).toBeLessThanOrEqual(339);
    const zoomed = { ...win, ...win.standardBounds };
    expect(zoomed.y + windowTotalHeight(zoomed)).toBeLessThanOrEqual(339);
  });

  it("clamps a requested bottom-edge position using the whole frame", () => {
    const win = buildAppWindow(app, {
      size: { width: 100, height: 100 },
      position: { x: 500, y: 330 },
    }, env);
    expect(win.height).toBe(100);
    expect(win.x + win.width).toBeLessThanOrEqual(509);
    expect(win.y + windowTotalHeight(win)).toBeLessThanOrEqual(339);
  });

  it("centres an alert in the upper desktop", () => {
    const win = buildAppWindow(app, {
      kind: "alert",
      size: { width: 376, height: 112 },
    }, env);
    expect(win.x).toBe(Math.floor((512 - 376) / 2));
    expect(win.y).toBe(20 + 40);
    expect(win.kind).toBe("alert");
  });

  it("still gives fullscreen content the entire display", () => {
    const win = buildAppWindow(app, { kind: "fullscreen" }, env);
    expect({ x: win.x, y: win.y, width: win.width, height: win.height }).toEqual({
      x: 0, y: 0, width: 512, height: 342,
    });
  });

  it("gives a short scrollable window nothing to scroll until its content reports a size", () => {
    const win = buildAppWindow(app, { scrollable: true, size: { width: 160, height: 120 } }, env);
    expect(win.contentHeight).toBe(win.height);
    expect(win.contentWidth).toBe(0);
  });
});
