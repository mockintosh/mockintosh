/**
 * Safari's window on a headless Macintosh: the toolbar sits in the header
 * band, the tab bar appears once there is more than one tab, and each tab
 * keeps its own page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResponse } from "@mockintosh/sdk";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { getWindows, updateOSWindow } from "@/src/os/state";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Safari from "../Safari";

const STORIES = Array.from({ length: 30 }, (_, n) => ({
  objectID: String(n + 1),
  title: `Story ${n + 1}`,
  url: `https://example.com/${n + 1}`,
  points: 10,
  author: "pg",
  num_comments: 2,
  created_at_i: 0,
}));

function reply(body: unknown): FetchResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("Safari", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;
  let hangFetch = false;
  let finishHang: ((value: FetchResponse) => void) | undefined;

  beforeEach(async () => {
    vi.useFakeTimers();
    hangFetch = false;
    finishHang = undefined;
    platform = createHeadlessPlatform({ width: 640, height: 480 });
    platform.fetch = async (url) => {
      if (hangFetch) return new Promise<FetchResponse>((resolve) => { finishHang = resolve; });
      if (!String(url).startsWith("https://hn.algolia.com/")) throw new Error("no network in this test");
      return reply({ hits: STORIES });
    };
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Safari);
    os.services.openApp("safari");
    await settle();
  });

  afterEach(() => {
    finishHang?.(reply({ message: "hung fetch ended" }));
    os.shutdown();
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      platform.tick();
      await vi.advanceTimersByTimeAsync(50);
    }
    platform.tick();
  }

  const session = () => os.kernel.createSession();

  async function nodes(): Promise<InspectionNode[]> {
    return (await os.kernel.invoke(session(), "inspect", {})) as InspectionNode[];
  }

  async function node(name: string): Promise<InspectionNode | undefined> {
    return (await nodes()).find((n) => n.name === name);
  }

  async function click(name: string): Promise<void> {
    const target = await node(name);
    expect(target, name).toBeDefined();
    const { x, y, width, height } = target!.bounds;
    platform.click(x + Math.floor(width / 2), y + Math.floor(height / 2));
    await settle();
  }

  async function hover(name: string): Promise<void> {
    const target = await node(name);
    expect(target, name).toBeDefined();
    const { x, y, width, height } = target!.bounds;
    platform.pointer({ type: "move", x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) });
    await settle();
  }

  async function texts(): Promise<string[]> {
    return (await nodes()).flatMap((n) => (n.text ? [n.text] : []));
  }

  async function openBookmark(label: string): Promise<void> {
    await os.kernel.invoke(session(), "menu", { menu: "Bookmarks", item: label });
    await settle();
  }

  it("opens a window on the start page, with the new-tab button and no tab bar", async () => {
    expect(getWindows().some((w) => w.appId === "safari")).toBe(true);
    expect(await node("safari-new-tab")).toBeDefined();
    expect(await node("safari-tab:1")).toBeUndefined();
    expect(await texts()).toContain("Bookmarks");
  });

  it("opens a new tab on the start page and keeps the other tab's page", async () => {
    await openBookmark("GitHub");
    expect((await node("safari-address"))?.value).toBe("github.com");

    await click("safari-new-tab");
    expect(await node("safari-tab:1")).toBeDefined();
    expect(await node("safari-tab:2")).toBeDefined();
    expect((await node("safari-address"))?.value).toBe("");
    expect(await texts()).toContain("Start page");
    expect(await texts()).toContain("Bookmarks");

    await click("safari-tab:1");
    expect((await node("safari-address"))?.value).toBe("github.com");
  });

  it("shows a close button on a hovered tab and closes that tab", async () => {
    await openBookmark("GitHub");
    await click("safari-new-tab");
    expect(await node("safari-tab-close:1")).toBeUndefined();

    await hover("safari-tab:1");
    expect(await node("safari-tab-close:1")).toBeDefined();
    await click("safari-tab-close:1");

    expect(await node("safari-tab:1")).toBeUndefined();
    expect(await node("safari-tab:2")).toBeUndefined();
    expect((await node("safari-address"))?.value).toBe("");
    expect(await texts()).toContain("Bookmarks");
  });

  it("scrolls a long page in the window, and each tab comes back where it was", async () => {
    const safari = () => getWindows().find((w) => w.appId === "safari")!;
    await openBookmark("Hacker News");
    expect(await texts()).toContain("30.");
    expect(safari().contentHeight).toBeGreaterThan(safari().height);

    updateOSWindow(safari().id, { scrollY: 120 });
    await settle();
    await click("safari-new-tab");
    expect(safari().scrollY).toBe(0);

    await click("safari-tab:1");
    expect(safari().scrollY).toBe(120);
  });

  it("paints the window before a remote page arrives", async () => {
    hangFetch = true;
    os.services.openApp("safari", { url: "https://github.com/mockintosh/mockintosh" });
    await settle();
    const repo = getWindows().find((w) => w.props.url === "https://github.com/mockintosh/mockintosh");
    expect(repo).toBeDefined();
    const inRepo = (await os.kernel.invoke(session(), "inspect", { window: repo!.id })) as InspectionNode[];
    expect(inRepo.some((n) => n.name === "safari-address")).toBe(true);
    expect(inRepo.some((n) => n.text.includes("Loading…"))).toBe(true);
  });

  it("shows mockintosh.com as the micro desktop picture", async () => {
    const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
    await click("safari-address");
    for (const key of [..."mockintosh.com", "Enter"]) {
      platform.key({ type: "down", key, modifiers });
      platform.key({ type: "up", key, modifiers });
    }
    await settle();
    expect((await node("safari-address"))?.value).toBe("mockintosh.com");
    expect(await node("safari-picture")).toBeDefined();
  });

  it("closes the tab in front with ⌘W, and the window with its last tab", async () => {
    await click("safari-new-tab");
    await os.kernel.invoke(session(), "menu", { menu: "File", item: "Close Tab" });
    await settle();
    expect(await node("safari-tab:2")).toBeUndefined();
    expect(await node("safari-tab:1")).toBeUndefined();
    expect(getWindows().some((w) => w.appId === "safari")).toBe(true);

    await os.kernel.invoke(session(), "menu", { menu: "File", item: "Close Tab" });
    await settle();
    expect(getWindows().some((w) => w.appId === "safari")).toBe(false);
  });
});
