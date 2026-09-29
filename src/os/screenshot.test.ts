import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystem, InMemoryBackend } from "@mockintosh/fs";
import { cursorState } from "@mockintosh/quickdraw";
import { bootOS, type BootedOS } from "./boot";
import { cursors } from "./cursors";
import { createHeadlessPlatform, type HeadlessPlatform } from "../platform/headless";
import { APPLE_MENU_LABEL } from "./kernel/menus";
import { bootstrapFileSystem } from "./fsBootstrap";
import {
  CAPTURE_ENTIRE_SCREEN_LABEL,
  CAPTURE_SELECTED_PORTION_LABEL,
  cropScreen,
  createScreenshots,
  pictureFileName,
  saveScreenshotToDesktop,
  SCREENSHOT_MENU_LABEL,
  selectionRect,
  type PackedScreen,
  type Screenshots,
} from "./screenshot";

const none = { shift: false, ctrl: false, alt: false, meta: false };
const meta = { shift: false, ctrl: false, alt: false, meta: true };

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!)).toBe("IHDR");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Undo `encodePng1bit`: stored-deflate 1-bit greyscale, `1` = black. */
function pngPixels(png: Uint8Array): Uint8Array {
  const { width, height } = pngSize(png);
  let idat = new Uint8Array();
  let offset = 8;
  while (offset + 12 <= png.length) {
    const view = new DataView(png.buffer, png.byteOffset + offset, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(png[offset + 4]!, png[offset + 5]!, png[offset + 6]!, png[offset + 7]!);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") {
      const joined = new Uint8Array(idat.length + data.length);
      joined.set(idat);
      joined.set(data, idat.length);
      idat = joined;
    }
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw: number[] = [];
  let p = 2;
  while (p < idat.length) {
    const header = idat[p++]!;
    if (((header >> 1) & 3) !== 0) break;
    const n = idat[p]! | (idat[p + 1]! << 8);
    p += 4;
    for (let i = 0; i < n; i++) raw.push(idat[p++]!);
    if (header & 1) break;
  }
  const pixels = new Uint8Array(width * height);
  const rowBytes = 1 + ((width + 7) >> 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = (raw[y * rowBytes + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1;
      pixels[y * width + x] = bit ? 0 : 1;
    }
  }
  return pixels;
}

async function desktopFs(): Promise<FileSystem> {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  return fs;
}

function shotNames(fs: FileSystem): string[] {
  return fs.children(fs.locate("desktop")!.id).map((node) => node.name).filter((name) => /^Picture \d+\.png$/.test(name));
}

describe("screenshot pictures", () => {
  it("numbers pictures the way System 7 did, skipping names already taken", () => {
    expect(pictureFileName([])).toBe("Picture 1.png");
    expect(pictureFileName(["Picture 1.png", "Picture 3.png"])).toBe("Picture 2.png");
    expect(pictureFileName(["Picture 1.png", "Picture 2.png"])).toBe("Picture 3.png");
  });

  it("crops packed screen bits, including a rectangle that starts mid-byte", () => {
    const screen: PackedScreen = {
      width: 16,
      height: 2,
      rowBytes: 2,
      bytes: new Uint8Array([0b10000000, 0b01000000, 0, 0]),
    };
    const pixels = cropScreen(screen, { x: 1, y: 0, width: 10, height: 1 });
    expect(pixels).toHaveLength(10);
    expect(pixels.every((pixel, index) => pixel === (index === 8 ? 1 : 0))).toBe(true);
  });

  it("turns a drag into an inclusive rectangle, whichever way it went", () => {
    const bounds = { width: 100, height: 80 };
    expect(selectionRect(10, 20, 14, 23, bounds)).toEqual({ x: 10, y: 20, width: 5, height: 4 });
    expect(selectionRect(14, 23, 10, 20, bounds)).toEqual({ x: 10, y: 20, width: 5, height: 4 });
    expect(selectionRect(0, 0, 200, 200, bounds)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  it("saves onto the desktop and numbers the next picture", async () => {
    const fs = await desktopFs();
    const png = new Uint8Array([137, 80, 78, 71]);
    const first = await saveScreenshotToDesktop(fs, png);
    const second = await saveScreenshotToDesktop(fs, png);
    expect(first.name).toBe("Picture 1.png");
    expect(second.name).toBe("Picture 2.png");
    expect(first.type).toBe("image/png");
    expect(fs.child(fs.locate("desktop")!.id, first.name)?.id).toBe(first.id);
  });
});

describe("portion capture", () => {
  let fs: FileSystem;
  let outline: { x: number; y: number; width: number; height: number } | null;
  let shots: Screenshots;

  beforeEach(async () => {
    fs = await desktopFs();
    outline = null;
    shots = createScreenshots({
      fs,
      bounds: () => ({ width: 80, height: 60 }),
      readScreen: () => ({
        width: 80,
        height: 60,
        rowBytes: 10,
        bytes: new Uint8Array(10 * 60).fill(0xff),
      }),
      setOutline: (rect) => {
        outline = rect;
      },
      scheduleRepaint: () => {},
    });
  });

  it("saves a dragged rectangle and ignores a click that did not move", async () => {
    shots.beginPortionCapture();
    expect(shots.selecting()).toBe(true);

    shots.pointer({ type: "down", x: 4, y: 5 });
    shots.pointer({ type: "up", x: 4, y: 5 });
    expect(shots.selecting()).toBe(true);
    expect(outline).toBeNull();
    await shots.settled();
    expect(shotNames(fs)).toEqual([]);

    shots.pointer({ type: "down", x: 4.9, y: 5 });
    expect(outline).toEqual({ x: 4, y: 5, width: 1, height: 1 });
    shots.pointer({ type: "move", x: 13, y: 8 });
    expect(outline).toEqual({ x: 4, y: 5, width: 10, height: 4 });
    shots.pointer({ type: "up", x: 13.2, y: 8 });
    expect(shots.selecting()).toBe(false);
    expect(outline).toBeNull();
    await shots.settled();

    const file = fs.child(fs.locate("desktop")!.id, shotNames(fs)[0]!)!;
    const bytes = (await fs.readBytes(file.id))!;
    expect(pngSize(bytes)).toEqual({ width: 10, height: 4 });
    expect(pngPixels(bytes).every((pixel) => pixel === 1)).toBe(true);
  });

  it("cancels on Escape and on Command-period", async () => {
    shots.beginPortionCapture();
    shots.pointer({ type: "down", x: 2, y: 2 });
    shots.pointer({ type: "move", x: 20, y: 20 });
    expect(shots.key({ type: "down", key: "Escape", modifiers: none })).toBe(true);
    expect(shots.selecting()).toBe(false);
    expect(outline).toBeNull();

    shots.beginPortionCapture();
    expect(shots.key({ type: "down", key: ".", modifiers: meta })).toBe(true);
    expect(shots.selecting()).toBe(false);
    expect(shots.key({ type: "down", key: "Escape", modifiers: none })).toBe(false);
    await shots.settled();
    expect(shotNames(fs)).toEqual([]);
  });
});

const WIDTH = 512;
const HEIGHT = 342;

describe("screenshots from the Apple menu", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: WIDTH, height: HEIGHT });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  async function pngNamed(name: string): Promise<Uint8Array> {
    const file = os.services.fs.child(os.services.fs.locate("desktop")!.id, name);
    expect(file?.kind).toBe("file");
    return (await os.services.fs.readBytes(file!.id))!;
  }

  it("saves the whole screen, without the cursor, when Capture Entire Screen is chosen", async () => {
    await os.services.desktopSettings!.set("white");
    platform.pointer({ type: "move", x: 30, y: 50 });
    platform.tick();
    const shown = platform.lastFrame()!;
    let cursorAt = -1;
    for (let y = 40; y < 70 && cursorAt < 0; y++) {
      for (let x = 16; x < 50; x++) if (shown[y * WIDTH + x] === 1) cursorAt = y * WIDTH + x;
    }
    expect(cursorAt).toBeGreaterThan(0);

    const caller = os.kernel.createSession();
    await os.kernel.invoke(caller, "menu", { menu: APPLE_MENU_LABEL, item: CAPTURE_ENTIRE_SCREEN_LABEL });
    await os.services.screenshots.settled();

    const names = shotNames(os.services.fs);
    expect(names).toHaveLength(1);
    const png = await pngNamed(names[0]!);
    expect(pngSize(png)).toEqual({ width: WIDTH, height: HEIGHT });
    const pixels = pngPixels(png);
    expect(pixels[8 * WIDTH + 400]).toBe(0);
    expect(pixels[cursorAt]).toBe(0);
  });

  it("saves the dragged rectangle and leaves a click that did not move armed", async () => {
    await os.services.desktopSettings!.set("white");
    os.services.screenshots.beginPortionCapture();
    platform.pointer({ type: "move", x: 30, y: 40 });
    expect(cursorState.cursor).toBe(cursors.cross);

    platform.pointer({ type: "down", x: 8, y: 30 });
    platform.pointer({ type: "up", x: 8, y: 30 });
    await os.services.screenshots.settled();
    expect(shotNames(os.services.fs)).toEqual([]);
    expect(cursorState.cursor).toBe(cursors.cross);

    platform.pointer({ type: "down", x: 8, y: 30 });
    platform.pointer({ type: "move", x: 27, y: 45 });
    platform.pointer({ type: "up", x: 27, y: 45 });
    await os.services.screenshots.settled();
    platform.tick();

    const names = shotNames(os.services.fs);
    expect(names).toHaveLength(1);
    const pixels = pngPixels(await pngNamed(names[0]!));
    expect(pixels).toHaveLength(20 * 16);
    expect(pixels.every((pixel) => pixel === 0)).toBe(true);
    expect(cursorState.cursor).not.toBe(cursors.cross);
  });

  it("drops the crosshair on Escape without writing a file", async () => {
    os.services.screenshots.beginPortionCapture();
    platform.pointer({ type: "move", x: 12, y: 24 });
    platform.key({ type: "down", key: "Escape", modifiers: none });
    platform.pointer({ type: "down", x: 12, y: 24 });
    platform.pointer({ type: "up", x: 40, y: 50 });
    await os.services.screenshots.settled();
    expect(shotNames(os.services.fs)).toEqual([]);
    expect(cursorState.cursor).not.toBe(cursors.cross);
  });

  it("lists both commands under Screenshot", async () => {
    const caller = os.kernel.createSession();
    const menus = (await os.kernel.invoke(caller, "menu", {})) as {
      label: string;
      items: { label?: string; type?: string; items?: { label?: string }[] }[];
    }[];
    const screenshot = menus.find((menu) => menu.label === APPLE_MENU_LABEL)!.items.find(
      (item) => item.label === SCREENSHOT_MENU_LABEL,
    );
    expect(screenshot?.type).toBe("submenu");
    expect(screenshot?.items?.map((item) => item.label)).toEqual([
      CAPTURE_ENTIRE_SCREEN_LABEL,
      CAPTURE_SELECTED_PORTION_LABEL,
    ]);
  });
});
