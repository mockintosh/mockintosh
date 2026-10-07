/**
 * Zooming the map with the mouse on a headless Macintosh: a double-click,
 * even one whose second press twitches, and the wheel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Maps from "../Maps";
import { MapRenderer } from "./view";

describe("Maps zooming", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 640, height: 480 });
    platform.fetch = async () => {
      throw new Error("offline");
    };
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Maps);
    os.services.openApp("maps");
    await settle();
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

  async function map(): Promise<InspectionNode> {
    const nodes = (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
    return nodes.find((n) => n.name === "map")!;
  }

  async function zoom(): Promise<number> {
    return Number(/zoom (\d+)/.exec(String((await map()).value))![1]);
  }

  async function middle(): Promise<{ x: number; y: number }> {
    const { x, y, width, height } = (await map()).bounds;
    return { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
  }

  it("zooms in on a double-click, even when the second press moves a little", async () => {
    const before = await zoom();
    const { x, y } = await middle();
    platform.pointer({ type: "down", x, y });
    platform.pointer({ type: "up", x, y });
    platform.pointer({ type: "down", x, y });
    platform.pointer({ type: "move", x: x + 2, y: y + 1 });
    platform.pointer({ type: "up", x: x + 2, y: y + 1 });
    await settle();
    expect(await zoom()).toBe(before + 1);
  });

  it("turns and tilts the 3D view, and faces north again from the compass", async () => {
    // Long enough for the view to finish swinging.
    const swing = async () => {
      for (let i = 0; i < 6; i++) await settle();
    };
    const press = async (key: string, alt = false) => {
      const modifiers = { shift: false, ctrl: false, alt, meta: false };
      platform.key({ type: "down", key, modifiers });
      platform.key({ type: "up", key, modifiers });
      await swing();
    };
    const node = async (name: string) =>
      ((await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[]).find((n) => n.name === name);
    const clickOn = async (name: string) => {
      const { x, y, width, height } = (await node(name))!.bounds;
      platform.click(x + (width >> 1), y + (height >> 1));
      await swing();
    };

    await clickOn("maps-3d");
    expect(String((await map()).value)).toMatch(/3D facing 0°, tilted 45°$/);
    const { x, y } = await middle();
    platform.click(x, y);
    await settle();

    await press("ArrowRight", true);
    await press("ArrowUp", true);
    expect(String((await map()).value)).toMatch(/3D facing 15°, tilted 50°$/);
    expect((await node("maps-compass"))?.value).toBe("15°");

    await clickOn("maps-compass");
    expect(String((await map()).value)).toMatch(/3D facing 0°, tilted 50°$/);

    // Quick presses add up, rather than each cutting the last one's swing short.
    const modifiers = { shift: false, ctrl: false, alt: true, meta: false };
    for (const key of ["ArrowRight", "ArrowRight", "ArrowUp"]) {
      platform.key({ type: "down", key, modifiers });
      platform.key({ type: "up", key, modifiers });
    }
    await swing();
    expect(String((await map()).value)).toMatch(/3D facing 30°, tilted 55°$/);

    // Back to the flat map, still facing the same way, the compass still there.
    await clickOn("maps-3d");
    expect(String((await map()).value)).toMatch(/, facing 30°$/);
    // Facing north again; the compass stays, pointing up.
    await clickOn("maps-compass");
    expect(String((await map()).value)).not.toContain("facing");
    expect((await node("maps-compass"))?.value).toBe("0°");
  });

  it("tilts back to the flat map before zooming out of 3D", async () => {
    const node = async (name: string) =>
      ((await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[]).find((n) => n.name === name);
    const { x, y, width, height } = (await node("maps-3d"))!.bounds;
    platform.click(x + (width >> 1), y + (height >> 1));
    for (let i = 0; i < 6; i++) await settle();
    expect(String((await map()).value)).toMatch(/^zoom 15, .*3D facing 0°, tilted 45°$/);

    const zoomOut = (await node("maps-zoom-out"))!.bounds;
    platform.click(zoomOut.x + (zoomOut.width >> 1), zoomOut.y + (zoomOut.height >> 1));
    // Partway: still at zoom 15, tilting back.
    const tilts: number[] = [];
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(16);
      platform.tick();
      const value = String((await map()).value);
      if (value.startsWith("zoom 15")) tilts.push(Number(/tilted (\d+)°/.exec(value)?.[1] ?? 0));
    }
    expect(tilts.some((t) => t > 0 && t < 45)).toBe(true);
    for (let i = 0; i < 6; i++) await settle();
    // Then out, flat, where there's no 3D to go back to.
    expect(String((await map()).value)).toMatch(/^zoom 14, -?[\d.]+, -?[\d.]+$/);
    expect((await node("maps-3d"))?.enabled).toBe(false);
    expect((await node("maps-zoom-out"))?.enabled).toBe(true);
  });

  it("turns the flat map too, the compass showing which way it faces", async () => {
    const node = async (name: string) =>
      ((await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[]).find((n) => n.name === name);
    expect((await node("maps-compass"))?.value).toBe("0°");
    const { x, y } = await middle();
    platform.click(x, y);
    await settle();
    const modifiers = { shift: false, ctrl: false, alt: true, meta: false };
    platform.key({ type: "down", key: "ArrowLeft", modifiers });
    platform.key({ type: "up", key: "ArrowLeft", modifiers });
    for (let i = 0; i < 6; i++) await settle();
    expect(String((await map()).value)).toMatch(/, facing 345°$/);
    expect((await node("maps-compass"))?.value).toBe("345°");
  });

  it("glides on after a flick, and stops where it's let go after a pause", async () => {
    const centre = async () => {
      const [, lat, lon] = /zoom \d+, (-?[\d.]+), (-?[\d.]+)/.exec(String((await map()).value))!;
      return { lat: Number(lat), lon: Number(lon) };
    };
    const drag = async (pauseMs: number) => {
      const { x, y } = await middle();
      // No Option held, which would turn the map instead.
      const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
      platform.pointer({ type: "down", x, y, modifiers });
      // A move a frame, as the app hears them.
      const frame = async () => {
        platform.tick();
        await vi.advanceTimersByTimeAsync(16);
      };
      for (let k = 1; k <= 5; k++) {
        await frame();
        platform.pointer({ type: "move", x: x - k * 12, y });
      }
      for (let t = 0; t < pauseMs; t += 16) await frame();
      platform.pointer({ type: "up", x: x - 60, y });
      const released = await centre();
      for (let i = 0; i < 6; i++) await settle();
      return { released, settled: await centre() };
    };
    // Dragged left, the map moves east, and keeps on going.
    const flick = await drag(0);
    expect(flick.settled.lon).toBeGreaterThan(flick.released.lon);
    const held = await drag(200);
    expect(held.settled.lon).toBe(held.released.lon);
  });

  it("doesn't draw the map again while only the search field's caret blinks over it", async () => {
    const field = ((await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[]).find((n) => n.name === "maps-search")!;
    const { x, y, width, height } = field.bounds;
    platform.click(x + Math.floor(width / 2), y + Math.floor(height / 2));
    for (let i = 0; i < 4; i++) await settle();
    const render = vi.spyOn(MapRenderer.prototype, "render");
    // A few seconds of blinking.
    for (let i = 0; i < 12; i++) await settle();
    expect(render).not.toHaveBeenCalled();
    render.mockRestore();
  });

  it("zooms a step at the first turn of the wheel, however small", async () => {
    const before = await zoom();
    const { x, y } = await middle();
    platform.pointer({ type: "scroll", x, y, deltaY: 4 });
    await settle();
    expect(await zoom()).toBe(before - 1);
  });
});
