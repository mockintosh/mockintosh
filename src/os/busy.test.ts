/**
 * `os.busy`: the watch reaches the screen before the work runs, stays up
 * while the pointer moves, and gives way to the hover cursor when the work
 * settles, whether it succeeds or fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cursorState } from "@mockintosh/quickdraw";
import { bootOS, type BootedOS } from "./boot";
import { cursors } from "./cursors";
import { createHeadlessPlatform, type HeadlessPlatform } from "../platform/headless";

describe("os.busy", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 512, height: 342 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  it("shows the watch, runs the work once a frame is on screen, then brings the cursor back", async () => {
    const work = vi.fn(() => 42);
    const frames = platform.frameCount;
    const result = os.services.busy(work);
    expect(cursorState.cursor).toBe(cursors.watch);
    await vi.advanceTimersByTimeAsync(0);
    expect(work).not.toHaveBeenCalled();

    platform.pointer({ type: "move", x: 100, y: 100 });
    expect(cursorState.cursor).toBe(cursors.watch);

    platform.tick();
    expect(platform.frameCount).toBeGreaterThan(frames);
    await expect(result).resolves.toBe(42);
    expect(work).toHaveBeenCalledTimes(1);
    expect(cursorState.cursor).not.toBe(cursors.watch);
  });

  it("waits for a display that shows frames late to show the watch", async () => {
    os.shutdown();
    platform = createHeadlessPlatform({ width: 512, height: 342 });
    const shown: Array<() => void> = [];
    platform.display.whenVisible = (callback) => shown.push(callback);
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();

    const work = vi.fn();
    const result = os.services.busy(work);
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(work).not.toHaveBeenCalled();
    expect(cursorState.cursor).toBe(cursors.watch);

    for (const callback of shown.splice(0)) callback();
    await result;
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("keeps the watch up until async work settles, and gives it back when the work fails", async () => {
    let finish = () => {};
    const slow = os.services.busy(() => new Promise<void>((resolve) => (finish = resolve)));
    const failing = os.services.busy(() => {
      throw new Error("no");
    });
    platform.tick();
    await expect(failing).rejects.toThrow("no");
    expect(cursorState.cursor).toBe(cursors.watch);
    finish();
    await slow;
    expect(cursorState.cursor).not.toBe(cursors.watch);
  });
});
