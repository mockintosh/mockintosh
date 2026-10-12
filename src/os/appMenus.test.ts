/**
 * Every bundled app's menubar, as it stands once the app opens, passes
 * `menubarProblems`: no chord on two items, and no item on a key the browser
 * or host keeps for itself unless it means what that key means there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MUSIC_KIT_IDLE } from "@mockintosh/sdk";
import { APP_MODULES } from "@/src/appModules";
import { bootOS, type BootedOS } from "./boot";
import { registerApp } from "./apps";
import { FINDER_APP_ID, getActiveAppId, getMenubarMenus } from "./state";
import { menubarProblems } from "./shortcuts";
import { createHeadlessPlatform } from "../platform/headless";
import { TOUR_DISK_ID } from "./tourDisk";
import type { Platform } from "../platform/types";

/**
 * A service that takes every call and never answers: enough to open an app
 * that needs one. `members` are real, for what an app reads or keeps.
 */
const inert = <T>(members: Record<string, unknown> = {}): T =>
  new Proxy(members, { get: (target, key) => (key in target ? target[key as string] : () => new Promise(() => {})) }) as T;

/**
 * Apps that open documents put up the Open dialog when opened by themselves;
 * these open one from the Tour disk instead, so their own menubar is checked.
 */
const DOCUMENTS: Record<string, { fileId: string; title: string }> = {
  showreel: { fileId: `${TOUR_DISK_ID}Reels/One Bit.motion`, title: "One Bit.motion" },
  video: { fileId: `${TOUR_DISK_ID}1984.mp4`, title: "1984.mp4" },
};

describe("bundled apps' menu shortcuts", () => {
  let os: BootedOS | undefined;

  afterEach(() => {
    os?.shutdown();
    os = undefined;
    vi.useRealTimers();
  });

  it("finder", async () => {
    vi.useFakeTimers();
    const platform = createHeadlessPlatform({ width: 512, height: 342 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    expect(getActiveAppId()).toBe(FINDER_APP_ID);
    expect(menubarProblems(getMenubarMenus(), FINDER_APP_ID)).toEqual([]);
  });

  for (const id of Object.keys(APP_MODULES)) {
    it(id, async () => {
      vi.useFakeTimers();
      const platform = createHeadlessPlatform({ width: 512, height: 342, audioSampleRate: 44100, microphoneSampleRate: 44100 });
      const services: Partial<Platform> = {
        // Music opens its window only once it has a developer token; everything else waits forever.
        fetch: (input) =>
          String(input).endsWith("/api/apple-music/token")
            ? Promise.resolve(Response.json({ developerToken: "test" }))
            : new Promise<Response>(() => {}),
        images: inert(), video: inert(), camera: inert(), browser: inert(), signInRelay: inert(),
        musicKit: inert({ state: MUSIC_KIT_IDLE, onChange: () => () => {}, onError: () => () => {} }),
      };
      Object.assign(platform, services);
      os = await bootOS(platform);
      vi.advanceTimersByTime(1000); // the splash
      registerApp((await APP_MODULES[id]!()).default);
      os.services.openApp(id, DOCUMENTS[id]);
      // Some apps open their window only after an `await` in `onOpen`.
      await vi.waitFor(async () => {
        platform.tick();
        await os!.render();
        expect(getActiveAppId()).toBe(id);
      });
      expect(menubarProblems(getMenubarMenus(), id)).toEqual([]);
    });
  }
});
