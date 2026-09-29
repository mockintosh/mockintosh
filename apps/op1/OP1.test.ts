/**
 * The OP-1 on a headless Macintosh with a speaker: the home row plays the
 * synth, the T keys turn pages, drum mode strikes pads, the tape records and
 * plays back, and quitting closes the stream. Patterns are entered by key and
 * on the display, the sampler records the OP-1 itself, and tapes go on and
 * are saved: the Sunday Tape to start with, the other demos bounced on under
 * the watch, and an edited demo only under a name of the user's own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { cursors } from "@/src/os/cursors";
import { getMenubarMenus, getWindows } from "@/src/os/state";
import { cursorState } from "@mockintosh/quickdraw";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import type { MenubarActionItem, MenubarItemDef } from "@mockintosh/sdk";
import type { InspectionNode } from "@mockintosh/ui";
import OP1 from "../OP1";
import { sampleFromWav } from "./sampler";
import { ART_Y, SEQ_COL, SEQ_X0 } from "./screen";

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };
const COMMAND = { ...NO_MODS, meta: true };

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

describe("OP-1 on the headless platform", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 512, height: 342, audioSampleRate: 48000 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(OP1);
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  const tap = (key: string, modifiers = NO_MODS) => {
    platform.key({ type: "down", key, modifiers });
    platform.key({ type: "up", key, modifiers });
  };
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) platform.tick();
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
  };

  it("plays, turns pages, drums, records onto the tape, and closes the stream on Quit", async () => {
    os.services.openApp("op1");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getWindows().some((w) => w.appId === "op1")).toBe(true);

    const captured = platform.audio!.streams;
    expect(captured).toHaveLength(1);
    const { stream } = captured[0]!;
    expect(stream.state()).toBe("running");
    ticks(5);
    expect(await display()).toBe("CLUSTER | 1 CLOUDS  OCT 0");

    // The home row plays the synth.
    const quietUntil = captured[0]!.samples()[0]!.length;
    platform.key({ type: "down", key: "a", modifiers: NO_MODS });
    ticks(10);
    platform.key({ type: "up", key: "a", modifiers: NO_MODS });
    ticks(2);
    const [left] = captured[0]!.samples();
    expect(rms(left!, 0, quietUntil)).toBe(0);
    expect(rms(left!, quietUntil, left!.length)).toBeGreaterThan(0.005);

    // T2 is the envelope; T1 on the engine page steps to the next engine.
    tap("2");
    ticks(1);
    expect(await display()).toMatch(/^ENVELOPE \|/);
    expect((await node("encoder-1"))?.value).toMatch(/^ATTACK /);
    tap("1");
    tap("1");
    ticks(1);
    expect(await display()).toMatch(/^FM \|/);

    // Scrolling an encoder turns it, and the display reads it out.
    const encoder = (await node("encoder-2"))!.bounds!;
    platform.pointer({ type: "scroll", x: encoder.x + 10, y: encoder.y + 10, deltaY: -1 });
    ticks(1);
    expect(await display()).toMatch(/^FM \| MOD DEPTH 47$/);

    // Drum mode: a key strikes its pad, and the display names it.
    await click("mode-drum");
    platform.key({ type: "down", key: "s", modifiers: NO_MODS });
    platform.key({ type: "up", key: "s", modifiers: NO_MODS });
    ticks(2);
    expect(await display()).toMatch(/^SNARE \|/);

    // Record a kick onto track 2, then hear it back from the tape alone.
    await click("mode-tape");
    tap("2");
    await click("record");
    expect((await node("record"))?.value).toBe("on");
    tap("a");
    ticks(20);
    await click("stop");
    expect((await node("play"))?.value).toBe("off");
    await click("stop");
    expect(await display()).toMatch(/^TAPE \| T2  0:00\.0/);
    const before = captured[0]!.samples()[0]!.length;
    await click("play");
    ticks(10);
    const [played] = captured[0]!.samples();
    expect(rms(played!, before, played!.length)).toBeGreaterThan(0.01);

    // Recording changed the Sunday Tape, so Quit offers to save it first.
    const dialog = vi.spyOn(os.services, "showDialog").mockResolvedValueOnce("Don't Save");
    tap("q", COMMAND);
    await vi.advanceTimersByTimeAsync(0);
    platform.tick();
    expect(dialog.mock.calls[0]![0].message).toBe("Save the changes to the tape “Sunday Tape”?");
    expect(getWindows().some((w) => w.appId === "op1")).toBe(false);
    expect(stream.state()).toBe("closed");
  });

  const open = async () => {
    os.services.openApp("op1");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    ticks(5);
    // The Sunday Tape bounces on under the watch at launch.
    await vi.advanceTimersByTimeAsync(0);
    return platform.audio!.streams[0]!;
  };

  it("enters a drum pattern step by step and on the display, and plays it with the tape", async () => {
    const captured = await open();
    await click("mode-drum");
    tap("q");
    ticks(1);
    expect(await display()).toMatch(/^PATTERN \| STEP 1\/16/);

    // A key puts its pad on the step and moves on; T2 skips a step.
    tap("a");
    ticks(1);
    expect(await display()).toMatch(/STEP 2\/16/);
    tap("2");
    tap("s");
    ticks(1);
    expect(await display()).toMatch(/STEP 4\/16/);

    // Clicking a cell of the lane puts the pad last struck on that step.
    const screen = (await node("display"))!.bounds!;
    platform.click(screen.x + SEQ_X0 + 4 * SEQ_COL + 6, screen.y + ART_Y + 6);
    ticks(1);
    expect(await display()).toMatch(/STEP 5\/16  SNARE$/);
    expect((await node("t4"))?.value).toBe("on");

    const quietUntil = captured.samples()[0]!.length;
    tap(" ");
    ticks(40);
    const [left] = captured.samples();
    expect(rms(left!, quietUntil, left!.length)).toBeGreaterThan(0.01);
    expect((await node("play"))?.value).toBe("on");
    tap(" ");
    ticks(2);
  });

  it("samples its own output into the SAMPLER and keeps the take", async () => {
    await open();
    for (let i = 0; i < 6; i++) tap("1");
    ticks(1);
    expect(await display()).toMatch(/^SAMPLER \| 1 CLOUDS/);

    await click("record");
    expect(await display()).toBe("SAMPLER • ARM | WAITING FOR SOUND");
    platform.key({ type: "down", key: "g", modifiers: NO_MODS });
    ticks(20);
    platform.key({ type: "up", key: "g", modifiers: NO_MODS });
    ticks(5);
    expect(await display()).toMatch(/^SAMPLER • REC \| 0\.\d \/ 6 S$/);
    await click("record");
    ticks(2);
    expect(await display()).toMatch(/^SAMPLER \| 1 CLOUDS/);

    await vi.advanceTimersByTimeAsync(0);
    const fs = os.services.fs;
    const folder = fs.child(fs.locate("preferences")!.id, "op1")!;
    const file = fs.child(folder.id, "sample-1.wav");
    expect(file).toMatchObject({ kind: "file", type: "audio/wav" });
    expect(sampleFromWav((await fs.readBytes(file!.id))!)!.data.length).toBeGreaterThan(4800);
  });

  /** The item at the end of `path`, through any submenus on the way, and what it holds if it's a submenu. */
  const menuItem = (menu: string, ...path: string[]) => {
    let items: readonly MenubarItemDef[] = getMenubarMenus().find((m) => m.label === menu)?.items ?? [];
    let item: MenubarItemDef | undefined;
    for (const label of path) {
      item = items.find((i) => "label" in i && i.label === label);
      items = item?.type === "submenu" ? item.items : [];
    }
    return { item, items };
  };

  /** Choose the item at the end of `path`. */
  const chooseMenu = (menu: string, ...path: string[]) => {
    const { item } = menuItem(menu, ...path);
    const isAction = (i: MenubarItemDef | undefined): i is MenubarActionItem => !!i && (i.type === undefined || i.type === "action");
    const onClick = isAction(item) ? item.onClick : undefined;
    expect(onClick, [menu, ...path].join(" › ")).toBeTypeOf("function");
    onClick!();
  };

  it("holds and accents a synth step while it's entered", async () => {
    await open();
    tap("q");
    ticks(1);
    expect(await display()).toMatch(/^PATTERN \| STEP 1\/16/);

    // Shift accents the step; T2 while the key is down holds it a step longer.
    platform.key({ type: "down", key: "a", modifiers: { ...NO_MODS, shift: true } });
    tap("2");
    tap("2");
    ticks(1);
    expect(await display()).toMatch(/STEP 1\/16  \S+ x3 !$/);
    tap("1");
    ticks(1);
    expect(await display()).toMatch(/STEP 1\/16  \S+ x2 !$/);
    platform.key({ type: "up", key: "a", modifiers: NO_MODS });
    ticks(1);
    // Letting go moves on past the held steps.
    expect(await display()).toMatch(/STEP 3\/16  $/);

    // Without Shift the next step is plain, a step long.
    tap("a");
    ticks(1);
    tap("ArrowLeft");
    ticks(1);
    expect(await display()).toMatch(/STEP 3\/16  \S+$/);
  });

  it("turns the mixer to its PAN page and back", async () => {
    await open();
    await click("mode-mixer");
    ticks(1);
    expect(await display()).toMatch(/^MIXER \|/);
    await click("mode-mixer");
    ticks(1);
    expect(await display()).toMatch(/^PAN \|/);
    expect((await node("encoder-1"))?.value).toBe("TRACK 1 PAN C");
    await click("mode-mixer");
    ticks(1);
    expect(await display()).toMatch(/^MIXER \|/);
  });

  const title = () => getWindows().find((w) => w.appId === "op1")?.title;

  it("starts with the Sunday Tape on, and puts another demo on in one go under the watch", async () => {
    const captured = await open();
    expect(title()).toBe("OP-1: Sunday Tape");
    expect((await node("play"))?.value).toBe("off");
    const quietUntil = captured.samples()[0]!.length;
    tap(" ");
    ticks(30);
    expect(rms(captured.samples()[0]!, quietUntil, captured.samples()[0]!.length)).toBeGreaterThan(0.02);
    tap(" ");

    chooseMenu("File", "Open Tape", "Acid Desktop");
    await vi.advanceTimersByTimeAsync(0);
    // The watch goes up first; the bounce waits for it to reach the screen.
    expect(cursorState.cursor).toBe(cursors.watch);
    expect(await display()).toMatch(/^TAPE \| T1  0:00\.0/);

    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    ticks(2);
    expect(cursorState.cursor).not.toBe(cursors.watch);
    expect(await display()).toMatch(/^TAPE \| T1  0:0\d\.\d  BAR 1$/);
    expect((await node("play"))?.value).toBe("on");
    expect(title()).toBe("OP-1: Acid Desktop");
    const acid = menuItem("File", "Open Tape", "Acid Desktop").item;
    expect(acid && "checked" in acid && acid.checked).toBe(true);

    const from = captured.samples()[0]!.length;
    ticks(30);
    const [left] = captured.samples();
    expect(rms(left!, from, left!.length)).toBeGreaterThan(0.02);
  });

  it("saves an edited demo only under a name of its own, and puts it back on next launch", async () => {
    await open();
    await click("mode-tape");
    tap("2");
    await click("record");
    tap("a");
    ticks(10);
    await click("stop");
    await vi.advanceTimersByTimeAsync(0);
    expect(title()).toBe("OP-1: Sunday Tape •");

    // Save asks for a name; the demo's own is refused, and asked for again.
    const dialog = vi
      .spyOn(os.services, "showDialog")
      .mockResolvedValueOnce("Sunday Tape")
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce("My Sunday");
    tap("s", COMMAND);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(0);
      platform.tick();
    }
    const asked = dialog.mock.calls.map(([options]) => options);
    expect(asked[0]).toMatchObject({ showInput: true, inputDefault: "Sunday Tape copy" });
    expect(asked[1]!.message).toMatch(/“Sunday Tape” is a demo tape/);
    expect(asked[2]).toMatchObject({ showInput: true, inputDefault: "Sunday Tape" });
    expect(title()).toBe("OP-1: My Sunday");

    const fs = os.services.fs;
    const folder = fs.child(fs.locate("preferences")!.id, "op1")!;
    expect(fs.child(folder.id, "My Sunday.tape.wav")).toMatchObject({ kind: "file", type: "audio/wav" });
    expect(menuItem("File", "Open Tape").items.some((i) => "label" in i && i.label === "My Sunday")).toBe(true);
    const remove = menuItem("File", "Delete Tape…").item;
    expect(remove && "disabled" in remove && remove.disabled).toBe(false);

    // Nothing is unsaved, so Quit just quits; the next launch puts My Sunday back on.
    await vi.advanceTimersByTimeAsync(1000);
    tap("q", COMMAND);
    await vi.advanceTimersByTimeAsync(0);
    platform.tick();
    expect(getWindows().some((w) => w.appId === "op1")).toBe(false);
    expect(dialog).toHaveBeenCalledTimes(3);

    os.services.openApp("op1");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    ticks(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(title()).toBe("OP-1: My Sunday");
  });
});
