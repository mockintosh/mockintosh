/**
 * The Synthesizer on a headless Macintosh with a speaker: it opens a stream
 * when launched, the computer keyboard plays it, and quitting closes the
 * stream. Everything the speaker played is kept by the headless platform.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { getWindows } from "@/src/os/state";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import type { InspectionNode } from "@mockintosh/ui";
import Synth from "../Synth";

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };
const COMMAND = { ...NO_MODS, meta: true };

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

describe("Synthesizer on the headless platform", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 512, height: 342, audioSampleRate: 48000 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Synth);
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  it("opens a stream, plays the keyboard and sequencer, and closes the stream on Quit", async () => {
    os.services.openApp("synth");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getWindows().some((w) => w.appId === "synth")).toBe(true);

    const captured = platform.audio!.streams;
    expect(captured).toHaveLength(1);
    const { stream } = captured[0]!;
    expect(stream.state()).toBe("running");
    expect(stream.channels).toBe(2);

    for (let i = 0; i < 10; i++) platform.tick();
    const quietUntil = captured[0]!.samples()[0]!.length;

    platform.key({ type: "down", key: "a", modifiers: NO_MODS });
    for (let i = 0; i < 20; i++) platform.tick();
    platform.key({ type: "up", key: "a", modifiers: NO_MODS });
    platform.tick();

    const [left] = captured[0]!.samples();
    expect(rms(left!, 0, quietUntil)).toBe(0);
    expect(rms(left!, quietUntil, left!.length)).toBeGreaterThan(0.01);

    const display = async () => {
      const nodes = (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
      return String(nodes.find((node) => node.name === "display")?.value ?? "");
    };
    // Space starts the demo pattern at 128 BPM: a sixteenth every ~117 ms,
    // and the display follows the step the speaker is playing.
    platform.key({ type: "down", key: " ", modifiers: NO_MODS });
    platform.key({ type: "up", key: " ", modifiers: NO_MODS });
    for (let i = 0; i < 40; i++) platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(await display()).toMatch(/SEQ 06\/16$/);

    platform.key({ type: "down", key: "q", modifiers: COMMAND });
    platform.key({ type: "up", key: "q", modifiers: COMMAND });
    platform.tick();
    expect(getWindows().some((w) => w.appId === "synth")).toBe(false);
    expect(stream.state()).toBe("closed");
  });
});
