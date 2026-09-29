/**
 * pchkraft on a headless Macintosh: the four keys play chords, the arrows
 * move the key and the scale, Space runs the tape, and a hum becomes a chord.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { getWindows } from "@/src/os/state";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import type { InspectionNode } from "@mockintosh/ui";
import Pchkraft from "../Pchkraft";

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };
const COMMAND = { ...NO_MODS, meta: true };

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

function sine(hz: number, frames: number, sampleRate: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.5;
  return out;
}

describe("pchkraft on the headless platform", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 512, height: 342, audioSampleRate: 48000, microphoneSampleRate: 48000 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Pchkraft);
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  const press = (key: string) => platform.key({ type: "down", key, modifiers: NO_MODS });
  const lift = (key: string) => platform.key({ type: "up", key, modifiers: NO_MODS });
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) platform.tick();
  };
  const inspect = async () => {
    await vi.advanceTimersByTimeAsync(0);
    return (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
  };
  const display = async () => String((await inspect()).find((node) => node.name === "display")?.value ?? "");

  it("plays a chord from the keys, follows the arrows, and closes the stream on Quit", async () => {
    os.services.openApp("pchkraft");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getWindows().some((w) => w.appId === "pchkraft")).toBe(true);
    expect(await display()).toBe("C MAJOR | C F G Am | STOP 100 BPM 1 BAR");

    const captured = platform.audio!.streams;
    expect(captured).toHaveLength(1);
    const { stream } = captured[0]!;
    expect(stream.state()).toBe("running");

    ticks(8);
    const quietUntil = captured[0]!.samples()[0]!.length;
    press("a");
    ticks(10);
    expect((await inspect()).find((node) => node.name === "key-1")?.value).toBe("C down");
    lift("a");

    const [left] = captured[0]!.samples();
    expect(rms(left!, 0, quietUntil)).toBe(0);
    expect(rms(left!, quietUntil, left!.length)).toBeGreaterThan(0.01);

    press("ArrowRight");
    lift("ArrowRight");
    expect(await display()).toMatch(/^Db MAJOR \|/);
    press("ArrowUp");
    lift("ArrowUp");
    expect(await display()).toMatch(/^Db MINOR \|/);

    press(" ");
    lift(" ");
    expect(await display()).toMatch(/PLAY 100 BPM 1 BAR$/);

    platform.key({ type: "down", key: "q", modifiers: COMMAND });
    platform.key({ type: "up", key: "q", modifiers: COMMAND });
    platform.tick();
    expect(getWindows().some((w) => w.appId === "pchkraft")).toBe(false);
    expect(stream.state()).toBe("closed");
  });

  it("turns a hum into the chord that contains that note", async () => {
    os.services.openApp("pchkraft");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);

    press("m");
    lift("m");
    await vi.advanceTimersByTimeAsync(0);
    expect(await display()).toMatch(/HUM/);

    platform.microphone!.speak(sine(440, 4096, 48000));
    platform.tick(120);
    await vi.advanceTimersByTimeAsync(0);
    // A4 is the root of Am, the last of the four keys.
    expect(await display()).toMatch(/HUM Am /);
    expect((await inspect()).find((node) => node.name === "key-4")?.value).toBe("Am down");
  });
});
