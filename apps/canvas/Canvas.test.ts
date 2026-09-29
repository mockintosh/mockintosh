/**
 * Canvas on a headless Macintosh: drawing tools are one-shot like MacDraw,
 * Figma, and Sketch, and the selection frame tracks its object while it is
 * being dragged or resized.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import type { InspectionNode } from "@mockintosh/ui";
import Canvas from "../Canvas";

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };

describe("Canvas on the headless platform", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 640, height: 480 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Canvas);
    os.services.openApp("canvas");
    platform.tick();
    await vi.advanceTimersByTimeAsync(0);
    platform.tick();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  async function nodes(): Promise<InspectionNode[]> {
    return (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
  }

  async function node(name: string): Promise<InspectionNode | undefined> {
    return (await nodes()).find((n) => n.name === name);
  }

  async function named(prefix: string): Promise<InspectionNode[]> {
    return (await nodes()).filter((n) => n.name?.startsWith(prefix));
  }

  function press(x: number, y: number): void {
    platform.pointer({ type: "move", x, y });
    platform.pointer({ type: "down", x, y, button: 0 });
    platform.tick();
  }

  function release(x: number, y: number): void {
    platform.pointer({ type: "up", x, y, button: 0 });
    platform.tick();
  }

  function moveTo(x: number, y: number): void {
    platform.pointer({ type: "move", x, y });
    platform.tick();
  }

  function click(x: number, y: number): void {
    press(x, y);
    release(x, y);
  }

  function drag(x0: number, y0: number, x1: number, y1: number): void {
    press(x0, y0);
    moveTo(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
    moveTo(x1, y1);
    release(x1, y1);
  }

  async function clickNode(name: string): Promise<void> {
    const n = await node(name);
    expect(n, name).toBeDefined();
    click(n!.bounds.x + Math.floor(n!.bounds.width / 2), n!.bounds.y + Math.floor(n!.bounds.height / 2));
  }

  async function artboardOrigin(): Promise<{ x: number; y: number }> {
    const board = await node("artboard");
    expect(board).toBeDefined();
    return { x: board!.bounds.x, y: board!.bounds.y };
  }

  it("frames the page on a gray pasteboard, centered where it fits", async () => {
    const paste = (await node("pasteboard"))!.bounds;
    const page = (await node("artboard"))!.bounds;
    const frame = platform.lastFrame()!;
    const ink = (x: number, y: number) => frame[y * 640 + x];

    const left = page.x - paste.x;
    const right = paste.x + paste.width - (page.x + page.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
    expect(page.y - paste.y).toBeGreaterThan(1);

    const midY = page.y + 40;
    expect(ink(page.x - 1, midY)).toBe(1);
    expect(ink(page.x + page.width, midY)).toBe(1);
    expect(ink(page.x + page.width + 1, midY + 1)).toBe(1);
    expect(ink(page.x + 5, midY)).toBe(0);
    const gray = Array.from({ length: 8 }, (_, i) => ink(paste.x + 2 + i, midY));
    expect(gray).toContain(0);
    expect(gray).toContain(1);
  });

  it("deselects when the pasteboard is clicked and keeps keyboard shortcuts", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-rect");
    drag(o.x + 10, o.y + 10, o.x + 50, o.y + 40);
    expect(await node("handle-se")).toBeDefined();
    const paste = (await node("pasteboard"))!.bounds;
    click(paste.x + 3, paste.y + 40);
    expect(await node("handle-se")).toBeUndefined();

    await clickNode("el-e1");
    platform.key({ type: "down", key: "Backspace", modifiers: NO_MODS });
    platform.tick();
    expect(await named("el-")).toHaveLength(0);
  });

  it("shows the shape itself, not its bounding box, while it is dragged out", async () => {
    const o = await artboardOrigin();
    const ink = (x: number, y: number) => platform.lastFrame()![y * 640 + x];

    await clickNode("tool-line");
    press(o.x + 10, o.y + 10);
    moveTo(o.x + 30, o.y + 30);
    moveTo(o.x + 70, o.y + 50);
    expect((await node("draft"))?.value).toBe("line");
    expect(ink(o.x + 40, o.y + 30)).toBe(1);
    expect(ink(o.x + 69, o.y + 10)).toBe(0);
    expect(ink(o.x + 10, o.y + 49)).toBe(0);
    release(o.x + 70, o.y + 50);
    expect(await node("draft")).toBeUndefined();
    expect(await named("el-")).toHaveLength(1);

    await clickNode("tool-oval");
    press(o.x + 10, o.y + 100);
    moveTo(o.x + 40, o.y + 120);
    moveTo(o.x + 90, o.y + 160);
    expect((await node("draft"))?.value).toBe("oval");
    expect(ink(o.x + 10, o.y + 130)).toBe(1);
    expect(ink(o.x + 50, o.y + 100)).toBe(1);
    expect(ink(o.x + 10, o.y + 100)).toBe(0);
    expect(ink(o.x + 89, o.y + 159)).toBe(0);
    release(o.x + 90, o.y + 160);
    expect(await named("el-")).toHaveLength(2);
  });

  it("draws the shape being dragged out above everything already on the page", async () => {
    const o = await artboardOrigin();
    const ink = (x: number, y: number) => platform.lastFrame()![y * 640 + x];
    await clickNode("fill-black");
    await clickNode("tool-rect");
    drag(o.x + 20, o.y + 20, o.x + 120, o.y + 90);
    const paste = (await node("pasteboard"))!.bounds;
    click(paste.x + 3, paste.y + 40);
    await clickNode("fill-white");

    await clickNode("tool-oval");
    press(o.x + 60, o.y + 50);
    moveTo(o.x + 120, o.y + 95);
    moveTo(o.x + 180, o.y + 140);
    expect(await node("draft")).toBeDefined();
    expect(ink(o.x + 100, o.y + 80)).toBe(0);
    expect(ink(o.x + 110, o.y + 70)).toBe(0);
    expect(ink(o.x + 40, o.y + 40)).toBe(1);
    release(o.x + 180, o.y + 140);
    expect(ink(o.x + 100, o.y + 80)).toBe(0);
  });

  it("drops the old selection's handles as soon as a new shape is started", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-rect");
    drag(o.x + 20, o.y + 20, o.x + 120, o.y + 90);
    expect(await node("handle-se")).toBeDefined();
    await clickNode("tool-oval");
    press(o.x + 60, o.y + 50);
    moveTo(o.x + 120, o.y + 95);
    expect(await node("draft")).toBeDefined();
    expect(await node("handle-se")).toBeUndefined();
    release(o.x + 120, o.y + 95);
    expect((await node("el-e2"))).toBeDefined();
    expect(await node("handle-se")).toBeDefined();
  });

  it("draws handles above the page frame for an object past the page edge", async () => {
    const o = await artboardOrigin();
    const ink = (x: number, y: number) => platform.lastFrame()![y * 640 + x];
    await clickNode("fill-black");
    await clickNode("tool-rect");
    drag(o.x + 4, o.y + 4, o.x + 44, o.y + 34);
    const SHIFT = { ...NO_MODS, shift: true };
    platform.key({ type: "down", key: "ArrowLeft", modifiers: SHIFT });
    platform.key({ type: "down", key: "ArrowUp", modifiers: SHIFT });
    platform.tick();

    const nw = (await node("handle-nw"))!.bounds;
    expect(nw.width).toBe(5);
    expect(nw.height).toBe(5);
    expect(nw.x).toBeLessThan(o.x - 1);
    expect(nw.y).toBeLessThan(o.y - 1);
    for (let i = 0; i < 5; i++) {
      expect(ink(nw.x + i, nw.y)).toBe(1);
      expect(ink(nw.x, nw.y + i)).toBe(1);
    }
    expect(ink(nw.x + 2, nw.y + 2)).toBe(0);

    const before = (await named("el-"))[0]!.bounds;
    press(nw.x + 2, nw.y + 2);
    moveTo(nw.x + 8, nw.y + 8);
    moveTo(nw.x + 12, nw.y + 12);
    release(nw.x + 12, nw.y + 12);
    const after = (await named("el-"))[0]!.bounds;
    expect(after.x + after.width).toBe(before.x + before.width);
    expect(after.width).toBeLessThan(before.width);
  });

  it("returns to the selection tool after placing a text box", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-text");
    expect((await node("tool-text"))?.value).toBe("on");

    click(o.x + 20, o.y + 20);
    expect(await named("el-")).toHaveLength(1);
    expect((await node("tool-select"))?.value).toBe("on");

    click(o.x + 150, o.y + 150);
    click(o.x + 160, o.y + 100);
    expect(await named("el-")).toHaveLength(1);
  });

  it("keeps a double-clicked tool until another tool is chosen", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-rect");
    await clickNode("tool-rect");
    expect((await node("tool-rect"))?.value).toBe("locked");

    drag(o.x + 10, o.y + 10, o.x + 40, o.y + 30);
    drag(o.x + 60, o.y + 10, o.x + 90, o.y + 30);
    expect(await named("el-")).toHaveLength(2);
    expect((await node("tool-rect"))?.value).toBe("locked");

    await clickNode("tool-select");
    expect((await node("tool-rect"))?.value).toBe("off");
  });

  it("edits an existing text box instead of stacking a new one on it", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-text");
    click(o.x + 20, o.y + 20);
    platform.key({ type: "down", key: "Escape", modifiers: NO_MODS });
    platform.tick();

    await clickNode("tool-text");
    click(o.x + 24, o.y + 24);
    expect(await named("el-")).toHaveLength(1);
    expect(await named("text-")).toHaveLength(1);
  });

  it("keeps typed text in place when editing ends", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-text");
    click(o.x + 20, o.y + 20);
    await vi.advanceTimersByTimeAsync(0);
    platform.tick();
    for (const ch of "Hi there") platform.key({ type: "down", key: ch, modifiers: NO_MODS });
    moveTo(o.x + 200, o.y + 150);

    const box = (await node("el-e1"))!.bounds;
    const crop = () => {
      const frame = platform.lastFrame()!;
      const out: number[] = [];
      for (let y = box.y; y < box.y + box.height; y++) {
        for (let x = box.x; x < box.x + box.width; x++) out.push(frame[y * 640 + x]!);
      }
      return out;
    };
    const editing = crop();
    expect(editing.includes(1)).toBe(true);

    click(o.x + 200, o.y + 150);
    expect((await node("el-e1"))?.value).toBe("Hi there");
    expect(await named("text-")).toHaveLength(0);
    const shown = crop();

    const columns = new Set<number>();
    editing.forEach((ink, i) => {
      if (ink !== shown[i]) columns.add(i % box.width);
    });
    expect(columns.size).toBeLessThanOrEqual(1);
  });

  it("moves the selection frame with the object during a drag", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-rect");
    drag(o.x + 10, o.y + 10, o.x + 50, o.y + 40);
    await clickNode("tool-select");
    await clickNode("el-e1");
    const [el] = await named("el-");
    expect(el).toBeDefined();
    const before = (await node("handle-se"))!.bounds;

    press(el!.bounds.x + 10, el!.bounds.y + 10);
    moveTo(el!.bounds.x + 20, el!.bounds.y + 15);
    moveTo(el!.bounds.x + 30, el!.bounds.y + 20);

    const moved = (await named("el-"))[0]!.bounds;
    const during = (await node("handle-se"))!.bounds;
    expect(moved.x - el!.bounds.x).toBe(20);
    expect(during.x - before.x).toBe(20);
    expect(during.y - before.y).toBe(10);
    release(el!.bounds.x + 30, el!.bounds.y + 20);
  });

  it("resizes the selection frame with the object during a drag", async () => {
    const o = await artboardOrigin();
    await clickNode("tool-rect");
    drag(o.x + 10, o.y + 10, o.x + 50, o.y + 40);
    await clickNode("tool-select");
    await clickNode("el-e1");
    const handle = (await node("handle-se"))!.bounds;
    const hx = handle.x + 2;
    const hy = handle.y + 2;

    press(hx, hy);
    moveTo(hx + 10, hy + 5);
    moveTo(hx + 20, hy + 10);

    const el = (await named("el-"))[0]!.bounds;
    const during = (await node("handle-se"))!.bounds;
    expect(during.x).toBe(handle.x + 20);
    expect(during.y).toBe(handle.y + 10);
    expect(el.x + el.width).toBe(handle.x + 2 + 20);
    release(hx + 20, hy + 10);
  });
});
