import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { getWindows } from "@/src/os/state";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Safari from "../Safari";
import { ABOUT_BOX_TITLE, SOURCE_REPO_URL, contributorUrl, openAboutBox } from "./AboutBox";
import { contributors } from "./contributors.generated";

describe("About This Computer", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 640, height: 480 });
    platform.fetch = async () => {
      throw new Error("no network in this test");
    };
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Safari);
  });

  afterEach(() => {
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

  async function clickLink(name = "about-github"): Promise<void> {
    // Zoom holds the kernel render barrier until its timers finish.
    const clicking = os.kernel.invoke(session(), "click", { name });
    await vi.advanceTimersByTimeAsync(1000);
    platform.tick();
    await clicking;
  }

  it("opens the source repository in Safari", async () => {
    openAboutBox(os.services);
    await settle();
    expect(getWindows().some((w) => w.title === ABOUT_BOX_TITLE)).toBe(true);
    expect((await nodes()).some((n) => n.name === "about-github")).toBe(true);

    await clickLink();
    const safari = getWindows().find((w) => w.appId === "safari");
    expect(safari?.props.url).toBe(SOURCE_REPO_URL);
    expect(safari?.openedFromRect).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    }));
    expect(safari!.openedFromRect!.width).toBeGreaterThan(0);
    expect(safari!.openedFromRect!.height).toBeGreaterThan(0);
  });

  it("does not zoom when Safari is already open", async () => {
    os.services.openApp("safari");
    await settle();
    openAboutBox(os.services);
    await settle();
    await clickLink();
    const repo = getWindows().find((w) => w.appId === "safari" && w.props.url === SOURCE_REPO_URL);
    expect(repo).toBeDefined();
    expect(repo?.openedFromRect).toBeUndefined();
  });

  it("opens a contributor's GitHub profile in Safari", async () => {
    const [first] = contributors;
    expect(first).toBeDefined();
    openAboutBox(os.services);
    await settle();
    await clickLink(`about-contributor-${first!.username}`);
    const safari = getWindows().find((w) => w.appId === "safari");
    expect(safari?.props.url).toBe(contributorUrl(first!.username));
    expect(safari!.openedFromRect!.width).toBeGreaterThan(0);
  });
});
