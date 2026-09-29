/**
 * Screen captures, the way the macOS Screenshot utility does them: the whole
 * screen, or a rectangle dragged under a crosshair. Each one is a 1-bit PNG
 * on the desktop, named `Picture 1.png`, `Picture 2.png`, and so on.
 *
 * The cursor and the selection marquee are not part of the picture. Callers
 * hand `readScreen` a framebuffer painted without the cursor.
 */
import type { FileSystem, FSFile } from "@mockintosh/fs";
import { encodePng1bit } from "@mockintosh/ui";
import type { PlatformKeyEvent, PlatformPointerEvent } from "../platform/types";

/** Apple menu title for the capture commands. */
export const SCREENSHOT_MENU_LABEL = "Screenshot";
/** Save the whole framebuffer. Matches the Screenshot utility's first tool. */
export const CAPTURE_ENTIRE_SCREEN_LABEL = "Capture Entire Screen";
/** Drag a rectangle, then save it. Matches the Screenshot utility's portion tool. */
export const CAPTURE_SELECTED_PORTION_LABEL = "Capture Selected Portion";

/** Packed 1-bit screen: `1` is black, the high bit of each byte is the left pixel. */
export interface PackedScreen {
  width: number;
  height: number;
  rowBytes: number;
  bytes: Uint8Array;
}

/** Inclusive pixel rectangle in screen coordinates. */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the Apple menu can ask for. The drag itself stays inside the shell. */
export interface ScreenshotCommands {
  captureEntireScreen(): Promise<void>;
  beginPortionCapture(): void;
  /** Resolves when every capture started so far has finished saving. */
  settled(): Promise<void>;
}

export interface Screenshots extends ScreenshotCommands {
  /** A crosshair drag is waiting or in progress. */
  selecting(): boolean;
  pointer(event: PlatformPointerEvent): void;
  /** Escape and ⌘. cancel. Other keys are swallowed while selecting. */
  key(event: PlatformKeyEvent): boolean;
}

interface ScreenshotDeps {
  fs: FileSystem;
  bounds(): { width: number; height: number };
  /** Paint, then return packed bits with no cursor and no selection marquee. */
  readScreen(): PackedScreen;
  setOutline(rect: CaptureRect | null): void;
  scheduleRepaint(): void;
  onError?(message: string): void;
}

/**
 * The next free classic screenshot name: `Picture 1.png`, `Picture 2.png`, …
 * System 7 numbered them this way. A timestamped macOS name is wider than a
 * desktop icon cell, so it paints across the icons beside it.
 */
export function pictureFileName(taken: readonly string[]): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const name = `Picture ${n}.png`;
    if (!used.has(name)) return name;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Both corners of a drag, as a rectangle clipped to `bounds`. */
export function selectionRect(
  anchorX: number,
  anchorY: number,
  x: number,
  y: number,
  bounds: { width: number; height: number },
): CaptureRect {
  const maxX = Math.max(0, bounds.width - 1);
  const maxY = Math.max(0, bounds.height - 1);
  const x0 = clamp(Math.min(anchorX, x), 0, maxX);
  const y0 = clamp(Math.min(anchorY, y), 0, maxY);
  const x1 = clamp(Math.max(anchorX, x), 0, maxX);
  const y1 = clamp(Math.max(anchorY, y), 0, maxY);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Unpack `rect` to one byte per pixel, `0` white and `1` black — the layout
 * `encodePng1bit` expects.
 */
export function cropScreen(screen: PackedScreen, rect: CaptureRect): Uint8Array {
  if (rect.width < 1 || rect.height < 1) throw new Error("The selection is empty.");
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > screen.width ||
    rect.y + rect.height > screen.height
  ) {
    throw new Error("The selection is outside the screen.");
  }
  const pixels = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const row = (rect.y + y) * screen.rowBytes;
    const dest = y * rect.width;
    for (let x = 0; x < rect.width; x++) {
      const sx = rect.x + x;
      const byte = screen.bytes[row + (sx >> 3)] ?? 0;
      pixels[dest + x] = (byte >> (7 - (sx & 7))) & 1;
    }
  }
  return pixels;
}

/** Write `png` onto the desktop as the next `Picture N.png`. */
export async function saveScreenshotToDesktop(fs: FileSystem, png: Uint8Array): Promise<FSFile> {
  const desktop = fs.locate("desktop");
  if (!desktop) throw new Error("The Desktop Folder is missing, so the screenshot could not be saved.");
  const taken = fs.children(desktop.id).map((node) => node.name);
  return fs.writeFile(desktop.id, pictureFileName(taken), png, { type: "image/png" });
}

type Phase =
  | { kind: "idle" }
  | { kind: "armed" }
  | { kind: "dragging"; anchorX: number; anchorY: number; x: number; y: number };

function pointInBounds(event: PlatformPointerEvent, bounds: { width: number; height: number }): { x: number; y: number } {
  return {
    x: clamp(Math.floor(event.x), 0, Math.max(0, bounds.width - 1)),
    y: clamp(Math.floor(event.y), 0, Math.max(0, bounds.height - 1)),
  };
}

function cancelsCapture(event: PlatformKeyEvent): boolean {
  if (event.type !== "down") return false;
  if (event.key === "Escape") return true;
  return (event.modifiers.meta || event.modifiers.ctrl) && event.key === ".";
}

export function createScreenshots(deps: ScreenshotDeps): Screenshots {
  let phase: Phase = { kind: "idle" };
  let tail: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): Promise<void> {
    const run = tail.then(async () => {
      try {
        await work();
      } catch (error) {
        const message = error instanceof Error ? error.message : "The screenshot could not be saved.";
        deps.onError?.(message);
      }
    });
    tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async function grab(rect: CaptureRect): Promise<void> {
    deps.setOutline(null);
    const screen = deps.readScreen();
    const png = encodePng1bit(cropScreen(screen, rect), rect.width, rect.height);
    await saveScreenshotToDesktop(deps.fs, png);
    deps.scheduleRepaint();
  }

  function cancel(): void {
    phase = { kind: "idle" };
    deps.setOutline(null);
  }

  return {
    selecting: () => phase.kind !== "idle",
    captureEntireScreen() {
      cancel();
      const bounds = deps.bounds();
      return enqueue(() => grab({ x: 0, y: 0, width: bounds.width, height: bounds.height }));
    },
    beginPortionCapture() {
      phase = { kind: "armed" };
      deps.setOutline(null);
      deps.scheduleRepaint();
    },
    pointer(event) {
      if (phase.kind === "idle" || event.type === "scroll") return;
      const bounds = deps.bounds();
      if (event.type === "down") {
        const anchor = pointInBounds(event, bounds);
        phase = { kind: "dragging", anchorX: anchor.x, anchorY: anchor.y, x: anchor.x, y: anchor.y };
        deps.setOutline(selectionRect(anchor.x, anchor.y, anchor.x, anchor.y, bounds));
        return;
      }
      if (phase.kind !== "dragging") return;
      const current = pointInBounds(event, bounds);
      if (event.type === "move") {
        phase = { ...phase, x: current.x, y: current.y };
        deps.setOutline(selectionRect(phase.anchorX, phase.anchorY, current.x, current.y, bounds));
        return;
      }
      const moved = current.x !== phase.anchorX || current.y !== phase.anchorY;
      const rect = selectionRect(phase.anchorX, phase.anchorY, current.x, current.y, bounds);
      phase = moved ? { kind: "idle" } : { kind: "armed" };
      deps.setOutline(null);
      if (moved) void enqueue(() => grab(rect));
    },
    key(event) {
      if (phase.kind === "idle") return false;
      if (cancelsCapture(event)) cancel();
      return true;
    },
    settled: () => tail,
  };
}
