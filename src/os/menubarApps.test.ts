/**
 * Menubar apps (`kind: "menubar"`) on the headless platform, with Spotlight
 * as the one under test: its icon shares the application menu's slot, the
 * hotkey and the icon toggle its panel, and the panel takes the keyboard but
 * not the menubar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "./boot";
import { createHeadlessPlatform, type HeadlessPlatform } from "../platform/headless";
import { registerApp, unregisterApp } from "./apps";
import { FINDER_APP_ID, getActiveAppId, getActiveWindowId, getWindows } from "./state";
import { runningAppIds } from "./appSwitcher";
import Spotlight from "@/apps/Spotlight";

const WIDTH = 512;
const HEIGHT = 342;
const SMALL_ICON = 16;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest rectangle around the black pixels of `area` in the last frame. */
function inkBounds(frame: Uint8Array, area: Bounds): Bounds | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      if (!frame[y * WIDTH + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The 16×16 cell centred in a title, where its icon has to fall. */
function iconCell(title: Bounds): Bounds {
  return {
    x: title.x + Math.floor((title.width - SMALL_ICON) / 2),
    y: title.y + Math.floor((title.height - SMALL_ICON) / 2),
    width: SMALL_ICON,
    height: SMALL_ICON,
  };
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

describe("menubar apps", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;
  const none = { shift: false, ctrl: false, alt: false, meta: false };
  const ctrl = { ...none, ctrl: true };

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: WIDTH, height: HEIGHT });
    // Before boot, as `systemApps.ts` does: boot registers the apps' sprites.
    registerApp(Spotlight);
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000); // dismiss the splash
    platform.tick();
  });

  afterEach(() => {
    os.shutdown();
    unregisterApp(Spotlight.id);
    vi.useRealTimers();
  });

  async function titles(): Promise<{ app: Bounds; spotlight: Bounds }> {
    const nodes = (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as Array<{
      name?: string;
      windowId?: string;
      bounds: Bounds;
    }>;
    const find = (name: string) => nodes.find((n) => n.name === name && !n.windowId)!.bounds;
    return { app: find("Application"), spotlight: find("Spotlight") };
  }

  function hotkey(): void {
    platform.key({ type: "down", key: " ", modifiers: ctrl });
    platform.key({ type: "up", key: " ", modifiers: ctrl });
    platform.tick();
  }

  const panel = () => getWindows().find((w) => w.appId === Spotlight.id);

  it("draws its icon in a slot like the application menu's, right beside it", async () => {
    const { app, spotlight } = await titles();
    expect({ y: spotlight.y, width: spotlight.width, height: spotlight.height }).toEqual({ y: app.y, width: app.width, height: app.height });
    expect(spotlight.x + spotlight.width).toBe(app.x);

    const frame = platform.lastFrame()!;
    for (const title of [app, spotlight]) {
      const ink = inkBounds(frame, title);
      expect(ink, "the title shows an icon").not.toBeNull();
      expect(contains(iconCell(title), ink!), `ink ${JSON.stringify(ink)} inside the 16×16 cell of ${JSON.stringify(title)}`).toBe(true);
    }
  });

  it("lights its slot while the panel is open, as the application menu's lights while it is down", async () => {
    const { spotlight } = await titles();
    platform.click(spotlight.x + 5, spotlight.y + 5);
    platform.tick();
    expect(panel()).toBeDefined();
    const frame = platform.lastFrame()!;
    // Inverted: the margins beside the icon are solid black.
    expect(frame[(spotlight.y + 2) * WIDTH + spotlight.x + 1]).toBe(1);
    expect(frame[(spotlight.y + spotlight.height - 2) * WIDTH + spotlight.x + spotlight.width - 2]).toBe(1);

    platform.click(spotlight.x + 5, spotlight.y + 5);
    platform.tick();
    expect(panel()).toBeUndefined();
  });

  it("toggles from anywhere with its hotkey, keeping the menubar and the keyboard's way back", () => {
    os.services.openApp(FINDER_APP_ID, { directoryId: os.services.fs.locate("desktop")!.id });
    os.services.openFolderWindow("Desktop Folder", os.services.fs.locate("desktop")!.id);
    platform.tick();
    const folder = getActiveWindowId();
    expect(folder).not.toBeNull();

    hotkey();
    const open = panel();
    expect(open?.kind).toBe("panel");
    expect(getActiveWindowId()).toBe(open!.id);
    // The panel has the keyboard; the Finder keeps the menubar and the application menu.
    expect(getActiveAppId()).toBe(FINDER_APP_ID);
    expect(runningAppIds(getWindows(), FINDER_APP_ID)).not.toContain(Spotlight.id);

    hotkey();
    expect(panel()).toBeUndefined();
    expect(getActiveWindowId()).toBe(folder);
  });

  it("goes away on Escape once its field is empty", async () => {
    hotkey();
    expect(panel()).toBeDefined();
    // The field takes focus once it is laid out.
    await vi.advanceTimersByTimeAsync(50);
    platform.tick();
    platform.key({ type: "down", key: "Escape", modifiers: none });
    platform.key({ type: "up", key: "Escape", modifiers: none });
    platform.tick();
    expect(panel()).toBeUndefined();
  });
});
