import { describe, expect, it, vi } from "vitest";
import type { BrowserService, MusicKitError } from "@mockintosh/sdk";
import { createWebMusicKit } from "./musicKit";

/** A MusicKit instance whose `play` rejects with `reason`, and the browser that loads it. */
function setup(reason?: string) {
  const listeners = new Map<string, (event: unknown) => void>();
  const instance = {
    isAuthorized: true,
    isPlaying: false,
    nowPlayingItem: undefined,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 0,
    volume: 1,
    shuffleMode: 0,
    repeatMode: 0,
    subscribeURL: "https://finance-app.itunes.apple.com/deeplink?p=subscribe",
    play: vi.fn(async () => {
      if (reason) throw Object.assign(new Error("MKError"), { reason });
    }),
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    removeEventListener: vi.fn(),
  };
  const browser = {
    openExternal: vi.fn(async () => {}),
    authorize: vi.fn(),
    loadScript: vi.fn(async () => ({ configure: async () => instance, getInstance: () => instance })),
  } as unknown as BrowserService;
  const musicKit = createWebMusicKit(browser, "https://mockintosh.test");
  const errors: MusicKitError[] = [];
  musicKit.onError((error) => errors.push(error));
  return { musicKit, browser, errors, emit: (name: string, event: unknown) => listeners.get(name)?.(event) };
}

describe("createWebMusicKit", () => {
  it("reports a play refused for want of a membership, and rejects with the same message", async () => {
    const { musicKit, errors } = setup("SUBSCRIPTION_ERROR");
    await musicKit.configure({ developerToken: "dev" });
    await expect(musicKit.play()).rejects.toThrow("Apple Music membership required");
    expect(errors).toEqual([{ message: "Apple Music membership required", membershipRequired: true }]);
  });

  it("passes other refusals through untouched, and reports playback errors as they are", async () => {
    const { musicKit, errors, emit } = setup("CONTENT_UNAVAILABLE");
    await musicKit.configure({ developerToken: "dev" });
    await expect(musicKit.play()).rejects.toThrow("MKError");
    expect(errors).toEqual([]);
    emit("mediaPlaybackError", { reason: "STREAM_UPSELL" });
    emit("mediaPlaybackError", { reason: "MEDIA_PLAYBACK" });
    expect(errors).toEqual([
      { message: "Apple Music membership required", membershipRequired: true },
      { message: "Apple Music couldn't play that.", membershipRequired: false },
    ]);
  });

  it("opens Apple Music's sign-up page for the storefront, or Apple Music's own page before MusicKit loads", async () => {
    const { musicKit, browser } = setup();
    await musicKit.openSignUp();
    expect(browser.openExternal).toHaveBeenLastCalledWith("https://www.apple.com/apple-music/");
    await musicKit.configure({ developerToken: "dev" });
    await musicKit.openSignUp();
    expect(browser.openExternal).toHaveBeenLastCalledWith("https://finance-app.itunes.apple.com/deeplink?p=subscribe");
  });

  it("opens pages on Apple Music, and no other links", async () => {
    const { musicKit, browser } = setup();
    await musicKit.openInAppleMusic("https://music.apple.com/se/album/1440833098");
    expect(browser.openExternal).toHaveBeenCalledWith("https://music.apple.com/se/album/1440833098");
    await expect(musicKit.openInAppleMusic("https://example.com/music.apple.com")).rejects.toThrow("That isn't an Apple Music link");
    await expect(musicKit.openInAppleMusic("http://music.apple.com/se/album/1")).rejects.toThrow("That isn't an Apple Music link");
    await expect(musicKit.openInAppleMusic("javascript:alert(1)")).rejects.toThrow("That isn't an Apple Music link");
    expect(browser.openExternal).toHaveBeenCalledTimes(1);
  });
});
