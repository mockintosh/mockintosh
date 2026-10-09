/**
 * GitHub in a real Safari window, signed in: the contribution calendar is
 * wider than the page, so it opens on the latest weeks and scrolls
 * sideways; the header's account menu signs out; a starred repository's
 * Star button says it unstars; the current tab's line, and a hovered one's, sits on the rule;
 * the account menu opens from a ringed avatar; Tab goes from a new issue's
 * title to its description.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResponse } from "@mockintosh/sdk";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { createAppStorage } from "@/src/os/appStorage";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Safari from "../../../Safari";

function reply(body: unknown, status = 200): FetchResponse {
  return {
    ok: true,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
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

/** The filled star as the screen draws it: 1 is black. */
const FILLED_STAR = [
  "00000100000",
  "00001110000",
  "00001110000",
  "11111111111",
  "11111111111",
  "01111111110",
  "00111111100",
  "00111111100",
  "01111111110",
  "01111011110",
  "01110001110",
].join("\n");

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
      if (path.endsWith("/repos/octocat/hello")) return reply({ name: "hello", owner: { login: "octocat" }, default_branch: "main", stargazers_count: 7 });
      if (path.endsWith("/user/starred/octocat/hello")) return reply(null, 204);
      if (path.endsWith("/user")) return reply({ login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4" });
      return reply([]);
    };
    // Every picture decodes to plain mid-gray, which dithers to a pattern a solid ring stands out from.
    platform.images = { decode: async () => ({ width: 16, height: 16, rgba: new Uint8ClampedArray(16 * 16 * 4).fill(128) }) };
    // Registered before boot, as bundled apps are, so boot registers its sprites too.
    registerApp(Safari);
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
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

  it("fills a starred repository's star, and says over it that pressing it unstars", async () => {
    os.services.openApp("safari", { url: "https://github.com/octocat/hello" });
    await settle();
    const button = (await inspect()).find((node) => node.role === "button" && node.text === "Starred 7");
    expect(button, "the Starred button").toBeDefined();
    const { x, y, width, height } = button!.bounds;
    // The filled star is drawn before the label.
    await parkPointer();
    expect(pixels({ x: x + 8, y: y + 1, width: 11, height: 11 })).toBe(FILLED_STAR);
    platform.pointer({ type: "move", x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) });
    await settle();
    await settle();
    const tip = (await inspect()).find((node) => node.role === "tooltip" && node.value);
    expect(tip?.value).toBe("Unstar octocat/hello");
  });

  it("marks the current tab with a line on the rule under the tabs, a 2px border under it alone", async () => {
    const tabs = (await inspect()).filter((node) => node.role === "tab");
    expect(tabs.map((tab) => [tab.name, tab.value])).toEqual([["Overview", "current"], ["Repositories 0", undefined], ["Stars", undefined]]);
    await parkPointer();
    // The two rows at each tab's foot: the line under the tab, then the rule across the page.
    const foot = (tab: InspectionNode) => pixels({ x: tab.bounds.x, y: tab.bounds.y + tab.bounds.height - 1, width: tab.bounds.width, height: 2 }).split("\n");
    const [overview, repositories] = tabs;
    expect(foot(overview!)).toEqual(["1".repeat(overview!.bounds.width), "1".repeat(overview!.bounds.width)]);
    expect(foot(repositories!)).toEqual(["0".repeat(repositories!.bounds.width), "1".repeat(repositories!.bounds.width)]);

    // Hovering another tab draws its line too, until the pointer leaves.
    platform.pointer({ type: "move", x: repositories!.bounds.x + 1, y: repositories!.bounds.y + 1 });
    await settle();
    // The pointer is drawn over the tab's left end: look past it.
    const clear = 20;
    expect(foot(repositories!).map((row) => row.slice(clear))).toEqual(["1", "1"].map((ink) => ink.repeat(repositories!.bounds.width - clear)));
    await parkPointer();
    expect(foot(repositories!)[0]).toBe("0".repeat(repositories!.bounds.width));
  });

  it("rings the avatar the account menu opens from in 1px, round", async () => {
    const avatar = (await inspect()).find((node) => node.name === "octocat menu");
    expect(avatar?.bounds).toMatchObject({ width: 16, height: 16 });
    await parkPointer();
    const rows = pixels(avatar!.bounds).split("\n");
    // The ring's top and bottom, and its sides, solid black around the dithered picture.
    expect([rows[0], rows[15]]).toEqual(["0000011111100000", "0000011111100000"]);
    for (const row of rows.slice(5, 11)) expect([row[0], row[15]]).toEqual(["1", "1"]);
  });

  it("tabs from a new issue's title to its description", async () => {
    os.services.openApp("safari", { url: "https://github.com/octocat/hello/issues/new" });
    await settle();
    const fields = () => inspect().then((all) => all.filter((n) => n.role === "textbox"));
    const description = (await fields()).find((n) => n.name === "body");
    expect(description, "the description").toBeDefined();
    // The title is the field just above the description.
    const title = (await fields()).filter((n) => n.bounds.y < description!.bounds.y).sort((a, b) => b.bounds.y - a.bounds.y)[0]!;
    platform.click(title.bounds.x + 10, title.bounds.y + 5);
    await settle();
    const type = (key: string, modifiers = { shift: false, ctrl: false, alt: false, meta: false }) => {
      platform.key({ type: "down", key, modifiers });
      platform.key({ type: "up", key, modifiers });
    };
    type("A");
    type("Tab");
    type("B");
    await settle();
    const after = await fields();
    expect(after.find((n) => n.name === "body")?.value).toBe("B");
    expect(after.find((n) => n.bounds.x === title.bounds.x && n.bounds.y === title.bounds.y)?.value).toBe("A");
  });
});
