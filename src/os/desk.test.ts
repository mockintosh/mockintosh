import { afterEach, describe, expect, it } from "vitest";
import { keyWindowId } from "./appSwitcher";
import {
  bringToFront,
  closeAllWindows,
  closeOSWindow,
  getActiveWindowId,
  getWindows,
  openOSWindow,
  type OSWindow,
} from "./state";

function win(id: string, appId: string, kind: OSWindow["kind"] = "document"): OSWindow {
  return {
    id,
    appId,
    kind,
    title: id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    props: {},
    scrollX: 0,
    scrollY: 0,
    contentWidth: 100,
    contentHeight: 100,
    scrollable: false,
    resizable: false,
  };
}

const order = () => getWindows().map((w) => w.id);

describe("desk windows", () => {
  afterEach(() => closeAllWindows());

  it("opens behind the app's own windows", () => {
    openOSWindow(win("finder", "finder"));
    openOSWindow(win("doc", "paint"));
    openOSWindow(win("desk", "paint", "desk"));
    expect(order()).toEqual(["finder", "desk", "doc"]);
    expect(getActiveWindowId()).toBe("doc");
  });

  it("is never the key window while the app has another", () => {
    openOSWindow(win("desk", "paint", "desk"));
    openOSWindow(win("doc", "paint"));
    bringToFront("desk");
    expect(getActiveWindowId()).toBe("doc");
    expect(keyWindowId(getWindows(), "paint")).toBe("doc");
  });

  it("comes forward with any of its app's windows", () => {
    openOSWindow(win("desk", "paint", "desk"));
    openOSWindow(win("doc", "paint"));
    openOSWindow(win("safari", "safari"));
    bringToFront("doc");
    expect(order()).toEqual(["safari", "desk", "doc"]);
  });

  it("keeps its app front when the document closes", () => {
    openOSWindow(win("safari", "safari"));
    openOSWindow(win("desk", "paint", "desk"));
    openOSWindow(win("doc", "paint"));
    closeOSWindow("doc");
    expect(getActiveWindowId()).toBe("desk");
  });
});
