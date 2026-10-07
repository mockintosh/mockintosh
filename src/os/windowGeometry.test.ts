import { describe, expect, it } from "vitest";
import { footerBandHeight, hasGrowBand, headerBandHeight, titleBarOuterHeight, windowContentWidth, windowHeaderHeight, windowTotalHeight } from "./windowGeometry";
import type { OSWindow } from "./state";

const doc = { kind: "document" as const, height: 200, scrollable: true };

describe("window header/footer bands", () => {
  it("treats WindowHeader height as chrome below the title bar", () => {
    const win = { ...doc, headerHeight: 60 };
    expect(headerBandHeight(win)).toBe(60);
    expect(windowHeaderHeight(win)).toBe(20 + 60);
    expect(windowTotalHeight(win)).toBe(20 + 60 + 200 + 16);
  });

  it("falls back to the 20px info bar when headerHeight is unset", () => {
    const win = { ...doc, infoBar: ["3 items"] };
    expect(headerBandHeight(win)).toBe(20);
    expect(windowHeaderHeight(win)).toBe(40);
  });

  it("gives an untitled utility window the 11px drag bar", () => {
    expect(titleBarOuterHeight({ kind: "utility", title: "" })).toBe(12);
    expect(titleBarOuterHeight({ kind: "utility", title: "Tools" })).toBe(20);
    expect(windowHeaderHeight({ kind: "utility", title: "" })).toBe(12);
  });

  it("adds WindowFooter below the scrollable body", () => {
    const win = { ...doc, headerHeight: 0, footerHeight: 72 };
    expect(footerBandHeight(win)).toBe(72);
    expect(windowTotalHeight(win)).toBe(20 + 200 + 72 + 16);
  });
});

describe("the grow box of a window without scroll bars", () => {
  const win = (growBox?: OSWindow["growBox"]) =>
    ({ kind: "document", width: 300, height: 200, scrollable: false, resizable: true, growBox }) as OSWindow;

  it("keeps an empty scroll-bar band for it by default", () => {
    expect(hasGrowBand(win())).toBe(true);
    expect(windowContentWidth(win())).toBe(300 - 2 - 15);
  });

  it("gives the content the full width when the grow box sits over it", () => {
    expect(hasGrowBand(win("overlay"))).toBe(false);
    expect(windowContentWidth(win("overlay"))).toBe(300 - 2);
  });
});
