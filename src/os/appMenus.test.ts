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
import type { Platform } from "../platform/types";

/**
 * A service that takes every call and never answers: enough to open an app
 * that needs one. `members` are real, for what an app reads or keeps.
 */
const inert = <T>(members: Record<string, unknown> = {}): T =>
  new Proxy(members, { get: (target, key) => (key in target ? target[key as string] : () => new Promise(() => {})) }) as T;

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
        fetch: () => new Promise<Response>(() => {}),
        images: inert(), video: inert(), camera: inert(), browser: inert(), signInRelay: inert(),
        musicKit: inert({ state: MUSIC_KIT_IDLE, onChange: () => () => {}, onError: () => () => {} }),
      };
      Object.assign(platform, services);
      os = await bootOS(platform);
      vi.advanceTimersByTime(1000); // the splash
      registerApp((await APP_MODULES[id]!()).default);
      os.services.openApp(id);
      platform.tick();
      await os.render();
      expect(getActiveAppId()).toBe(id);
      expect(menubarProblems(getMenubarMenus(), id)).toEqual([]);
    });
  }
});
