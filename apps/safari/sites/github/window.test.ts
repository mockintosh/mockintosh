/**
 * GitHub in a real Safari window, signed in: the contribution calendar is
 * wider than the page, so it opens on the latest weeks and scrolls
 * sideways; the header's account menu signs out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResponse } from "@mockintosh/sdk";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { createAppStorage } from "@/src/os/appStorage";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Safari from "../../../Safari";

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

/** A year of weeks, one contribution a week on a day that moves along, so no two nearby weeks look alike. */
const WEEKS = Array.from({ length: 53 }, (_, index) => ({
  firstDay: new Date(Date.UTC(2025, 9, 5 + index * 7)).toISOString().slice(0, 10),
  contributionDays: [{ weekday: index % 7, contributionCount: 1, contributionLevel: "FIRST_QUARTILE" }],
}));

describe("GitHub in a Safari window", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T12:00:00Z") });
    platform = createHeadlessPlatform({ width: 512, height: 342 });
    platform.fetch = async (url) => {
      const path = String(url);
      if (path.endsWith("/graphql")) {
        return reply({ data: { repositoryOwner: {
          pinnedItems: { nodes: [] },
          status: null,
          year: { contributionCalendar: { totalContributions: 53, weeks: WEEKS } },
          month: { commitContributionsByRepository: [], pullRequestContributionsByRepository: [], issueContributionsByRepository: [] },
        } } });
      }
      if (path.endsWith("/users/octocat")) return reply({ login: "octocat", type: "User", public_repos: 0 });
      if (path.endsWith("/user")) return reply({ login: "octocat" });
      return reply([]);
    };
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Safari);
    await createAppStorage((os.services as unknown as { fs: never }).fs, "safari").write("github-token.txt", "token");
    os.services.openApp("safari", { url: "https://github.com/octocat" });
    await settle();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      platform.tick();
      await vi.advanceTimersByTimeAsync(50);
    }
  }

  async function graph(): Promise<InspectionNode> {
    const nodes = (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
    const found = nodes.find((node) => node.name === "Contribution graph");
    expect(found, "the contribution graph").toBeDefined();
    return found!;
  }

  /** The pane's pixels, as on screen. */
  function pixels(bounds: InspectionNode["bounds"]): string {
    const frame = platform.lastFrame()!;
    const rows: string[] = [];
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) rows.push(Array.from(frame.subarray(y * 512 + bounds.x, y * 512 + bounds.x + bounds.width)).join(""));
    return rows.join("\n");
  }

  async function drag(from: { x: number; y: number }, dx: number): Promise<void> {
    platform.pointer({ type: "down", x: from.x, y: from.y });
    for (let step = 1; step <= 10; step++) {
      platform.pointer({ type: "move", x: from.x + (dx * step) / 10, y: from.y });
      platform.tick();
      await vi.advanceTimersByTimeAsync(20);
    }
    platform.pointer({ type: "up", x: from.x + dx, y: from.y });
    await parkPointer();
  }

  /** The pointer is drawn on screen: move it off the pane before comparing pixels. */
  async function parkPointer(): Promise<void> {
    platform.pointer({ type: "move", x: 2, y: 330 });
    await settle();
  }

  it("opens on the latest weeks, and drags back to earlier ones", async () => {
    const pane = (await graph()).bounds;
    // The year is wider than the page: the pane shows part of it.
    expect(pane.width).toBeLessThan(528);
    await parkPointer();
    const opened = pixels(pane);
    const middle = { x: pane.x + Math.floor(pane.width / 2), y: pane.y + 10 };

    // Already at the latest end: dragging towards later weeks moves nothing.
    await drag(middle, -60);
    expect(pixels(pane)).toBe(opened);

    // Earlier weeks come in from the left, and dragging back restores the view.
    await drag(middle, 100);
    expect(pixels(pane)).not.toBe(opened);
    await drag(middle, -100);
    expect(pixels(pane)).toBe(opened);
  });

  it("scrolls sideways with a sideways wheel or trackpad swipe", async () => {
    const pane = (await graph()).bounds;
    await parkPointer();
    const opened = pixels(pane);
    const over = { x: pane.x + 20, y: pane.y + 10 };
    platform.pointer({ type: "scroll", x: over.x, y: over.y, deltaX: -120 });
    await parkPointer();
    expect(pixels(pane)).not.toBe(opened);
    platform.pointer({ type: "scroll", x: over.x, y: over.y, deltaX: 120 });
    await parkPointer();
    expect(pixels(pane)).toBe(opened);
  });

  it("names the day under the pointer: its contributions and its date", async () => {
    const pane = (await graph()).bounds;
    // The latest week sits at the pane's right edge; its one contribution is on Wednesday.
    const week = WEEKS.length - 1;
    const weekday = week % 7;
    platform.pointer({ type: "move", x: pane.x + pane.width - 4, y: pane.y + weekday * 10 + 4 });
    await settle();
    await settle();
    const nodes = (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
    const tip = nodes.find((node) => node.role === "tooltip" && node.value);
    expect(tip?.value).toBe("1 contribution on October 7, 2026");
    // At the window's right edge, the caption moves left to stay inside the window's body, clear of its scroll bar.
    const window = nodes.find((node) => node.role === "window")!;
    expect(tip!.bounds.x + tip!.bounds.width).toBeLessThanOrEqual(window.bounds.x + window.bounds.width - 15);
  });

  async function inspect(): Promise<InspectionNode[]> {
    return (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
  }

  async function click(name: string): Promise<void> {
    const node = (await inspect()).find((candidate) => candidate.name === name);
    expect(node, name).toBeDefined();
    const { x, y, width, height } = node!.bounds;
    platform.click(x + Math.floor(width / 2), y + Math.floor(height / 2));
    await settle();
    await settle();
  }

  it("opens the account menu from the login in the header, and signs out from it", async () => {
    await click("octocat menu");
    const items = (await inspect()).filter((node) => node.role === "menuitem").map((node) => node.name);
    expect(items).toEqual(["octocat:Your profile", "octocat:Your repositories", "octocat:Your stars", "octocat:Sign out"]);

    await click("octocat:Sign out");
    const after = await inspect();
    expect(after.some((node) => node.role === "button" && node.text === "Sign In")).toBe(true);
    expect(after.some((node) => node.name === "octocat menu")).toBe(false);
  });
});
