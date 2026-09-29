/**
 * The TP-7 on a headless Macintosh with a speaker and a microphone: record a
 * tone, mark it, find it on disk as a WAV with its mark, play it back, hold
 * and turn the reel, browse the memo list, and quit with every device closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeWav, readWavMarkers } from "@mockintosh/sdk";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { getWindows } from "@/src/os/state";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import type { InspectionNode } from "@mockintosh/ui";
import TP7 from "../TP7";
import { reelPoint } from "./faceplate";
import { LIBRARY_NAME } from "./library";

const RATE = 48000;
const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };
const COMMAND = { ...NO_MODS, meta: true };

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

function tone(seconds: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE));
}

describe("TP-7 on the headless platform", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  const boot = async (options: { microphone: boolean }) => {
    platform = createHeadlessPlatform({
      width: 640,
      height: 480,
      audioSampleRate: RATE,
      ...(options.microphone ? { microphoneSampleRate: RATE } : {}),
    });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(TP7);
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  const settle = async () => {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
  };
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) platform.tick();
  };
  const tap = (key: string, modifiers = NO_MODS) => {
    platform.key({ type: "down", key, modifiers });
    platform.key({ type: "up", key, modifiers });
  };
  const inspect = async () => {
    await vi.advanceTimersByTimeAsync(0);
    return (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
  };
  const node = async (name: string) => (await inspect()).find((n) => n.name === name);
  const display = async () => String((await node("display"))?.value ?? "");
  const click = async (name: string) => {
    const target = await node(name);
    expect(target, name).toBeTruthy();
    const { x, y, width, height } = target!.bounds!;
    platform.click(x + Math.floor(width / 2), y + Math.floor(height / 2));
    platform.tick();
    await settle();
  };
  const open = async () => {
    os.services.openApp("tp7");
    platform.tick();
    await settle();
    expect(getWindows().some((w) => w.appId === "tp7")).toBe(true);
  };

  it("records a memo to disk with its mark, plays it, scrubs it, lists it, and lets go of everything on Quit", async () => {
    await boot({ microphone: true });
    await open();
    const speaker = platform.audio!.streams;
    expect(speaker).toHaveLength(1);
    const output = speaker[0]!;
    ticks(2);
    expect(await display()).toBe("STOP |  | PRESS RECORD");

    // Record: the microphone opens, hears a tone, and a mark goes in halfway.
    await click("record");
    const input = platform.microphone!.inputs[0]!;
    expect(input.state()).toBe("running");
    expect((await node("record"))?.value).toBe("on");
    expect((await node("microphone"))?.value).toBe("listening");
    platform.microphone!.speak(tone(1));
    ticks(30);
    tap("m");
    ticks(30);
    expect(await display()).toMatch(/^REC \| /);
    await click("stop");
    await settle();
    expect(input.state()).toBe("closed");
    expect((await node("microphone"))?.value).toBe("off");

    // It is a WAV in the TP-7 folder at the top of the disk, mark and all.
    const fs = os.services.fs;
    const volume = fs.volumeOf(fs.locate("desktop")!.id)!;
    const folder = fs.child(volume.id, LIBRARY_NAME)!;
    expect(folder.kind).toBe("directory");
    const [memo] = fs.children(folder.id);
    expect(memo?.name).toBe("Memo 001.wav");
    const bytes = (await fs.readBytes(memo!.id))!;
    const wav = decodeWav(bytes)!;
    expect(wav.sampleRate).toBe(RATE);
    const frames = wav.channels[0]!.length;
    expect(frames / RATE).toBeGreaterThan(0.9);
    expect(rms(wav.channels[0]!, 0, RATE / 2)).toBeGreaterThan(0.3);
    const [mark] = readWavMarkers(bytes);
    expect(mark! / RATE).toBeCloseTo(0.48, 1);
    ticks(1);
    expect(await display()).toMatch(/^STOP \| SAVED MEMO 001$/);

    // Play it back through the speaker.
    const before = output.samples()[0]!.length;
    await click("play");
    ticks(20);
    expect(rms(output.samples()[0]!, before, output.samples()[0]!.length)).toBeGreaterThan(0.05);
    expect(await display()).toMatch(/^PLAY \| /);

    // Hold the platter: the tape stops under the finger, then scrubs when turned.
    const reel = (await node("reel"))!.bounds!;
    const at = reelPoint("platter", 0);
    platform.pointer({ type: "down", x: reel.x + at.x, y: reel.y + at.y, button: 0 });
    ticks(2);
    expect((await node("reel"))?.value).toBe("platter");
    expect(await display()).toMatch(/^SCRUB \| /);
    const turned = reelPoint("platter", Math.PI / 2);
    platform.pointer({ type: "move", x: reel.x + turned.x, y: reel.y + turned.y, button: 0 });
    ticks(4);
    platform.pointer({ type: "up", x: reel.x + turned.x, y: reel.y + turned.y, button: 0 });
    ticks(2);
    expect((await node("reel"))?.value).toBe("free");

    // Stop twice rewinds; the list shows the memo.
    await click("stop");
    await click("stop");
    await vi.advanceTimersByTimeAsync(2000);
    ticks(1);
    expect(await display()).toMatch(/^STOP \| MEMO 001$/);
    await click("list");
    ticks(1);
    expect(await display()).toBe("MEMOS | MEMO 001");
    tap("l");
    ticks(1);

    tap("q", COMMAND);
    platform.tick();
    expect(getWindows().some((w) => w.appId === "tp7")).toBe(false);
    expect(output.stream.state()).toBe("closed");
  });

  it("says so when there is no microphone, and still opens", async () => {
    await boot({ microphone: false });
    await open();
    await click("record");
    ticks(1);
    expect(await display()).toMatch(/^STOP \| NO MICROPHONE/);
    expect((await node("record"))?.value).toBe("off");
  });

  it("closes the microphone when the app quits mid-recording", async () => {
    await boot({ microphone: true });
    await open();
    await click("record");
    const input = platform.microphone!.inputs[0]!;
    platform.microphone!.speak(tone(0.5));
    ticks(10);
    tap("q", COMMAND);
    platform.tick();
    await settle();
    expect(input.state()).toBe("closed");
  });
});
