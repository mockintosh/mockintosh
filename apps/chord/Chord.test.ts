/**
 * Pocket Chord on a headless Macintosh with a speaker: the number keys play
 * chords, the arrow keys bend them, Space starts the rhythm box, and quitting
 * closes the stream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { getWindows } from "@/src/os/state";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import type { InspectionNode } from "@mockintosh/ui";
import Chord from "../Chord";

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };
const COMMAND = { ...NO_MODS, meta: true };

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

describe("Pocket Chord on the headless platform", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 512, height: 342, audioSampleRate: 48000 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Chord);
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

  it("plays chords from the keys, bends them with the arrows, and closes the stream on Quit", async () => {
    os.services.openApp("chord");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getWindows().some((w) => w.appId === "chord")).toBe(true);

    const captured = platform.audio!.streams;
    expect(captured).toHaveLength(1);
    const { stream } = captured[0]!;
    expect(stream.state()).toBe("running");

    ticks(10);
    const quietUntil = captured[0]!.samples()[0]!.length;

    press("6");
    ticks(10);
    expect(await display()).toMatch(/^Am \| vi • A C E \|/);
    press("ArrowUp");
    ticks(10);
    expect(await display()).toMatch(/^Am7 \| vi 7 • A C E G \|/);
    const chords = (await inspect()).filter((node) => node.name?.startsWith("chord-")).map((node) => node.value);
    expect(chords).toEqual(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"]);
    lift("ArrowUp");
    lift("6");
    platform.tick();

    const [left] = captured[0]!.samples();
    expect(rms(left!, 0, quietUntil)).toBe(0);
    expect(rms(left!, quietUntil, left!.length)).toBeGreaterThan(0.01);

    // Space starts the rhythm box at 100 BPM: a sixteenth every 150 ms.
    press(" ");
    lift(" ");
    ticks(40);
    expect(await display()).toMatch(/ROCK • 100 BPM$/);

    platform.key({ type: "down", key: "q", modifiers: COMMAND });
    platform.key({ type: "up", key: "q", modifiers: COMMAND });
    platform.tick();
    expect(getWindows().some((w) => w.appId === "chord")).toBe(false);
    expect(stream.state()).toBe("closed");
  });
});
