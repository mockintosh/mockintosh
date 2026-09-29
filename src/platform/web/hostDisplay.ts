/**
 * Host screen: which framebuffer the web canvas mounts, and how many CSS
 * pixels show one screen pixel. The choice is remembered in localStorage
 * and applied live through the screen canvas.
 */
import type { ScreenCanvas, ScreenCanvasSize } from "@mockintosh/ui/web";
import type { HostDisplay, HostResolution, HostScale } from "../types";

export const HOST_RESOLUTIONS: readonly HostResolution[] = [
  { id: "classic", label: "512 x 342", width: 512, height: 342 },
  { id: "600x400", label: "600 x 400", width: 600, height: 400 },
  { id: "viewport", label: "Fit window" },
];

const STORAGE_KEY = "mockintosh-host-display";

interface SavedHostDisplay {
  resolution: string;
  scale: HostScale;
}

/** Largest whole zoom that still fits a fixed framebuffer in the CSS viewport. */
export function maxFixedScale(width: number, height: number, cssWidth: number, cssHeight: number): number {
  if (width < 1 || height < 1 || cssWidth < 1 || cssHeight < 1) return 1;
  return Math.max(1, Math.min(Math.floor(cssWidth / width), Math.floor(cssHeight / height)));
}

function nativeViewportScale(): number {
  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  return Math.max(1, Math.round(dpr));
}

function cssViewport(): { width: number; height: number } {
  return { width: window.innerWidth || 1, height: window.innerHeight || 1 };
}

export function readHostDisplayPreference(): SavedHostDisplay | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedHostDisplay>;
    if (typeof parsed.resolution !== "string" || !HOST_RESOLUTIONS.some((r) => r.id === parsed.resolution)) return null;
    if (parsed.scale !== "auto" && (typeof parsed.scale !== "number" || !Number.isInteger(parsed.scale) || parsed.scale < 1)) return null;
    return { resolution: parsed.resolution, scale: parsed.scale };
  } catch {
    return null;
  }
}

function writeHostDisplayPreference(saved: SavedHostDisplay): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private mode or a host without storage. The live canvas still changes.
  }
}

function preset(id: string): HostResolution | undefined {
  return HOST_RESOLUTIONS.find((r) => r.id === id);
}

function layoutFor(resolution: string, scale: HostScale): ScreenCanvasSize {
  const chosen = preset(resolution);
  const numeric = scale === "auto" ? undefined : Math.max(1, Math.round(scale));
  if (!chosen?.width || !chosen.height) {
    return { mode: "viewport", scale: scale === "auto" ? nativeViewportScale() : numeric };
  }
  return { width: chosen.width, height: chosen.height, scale: numeric };
}

/** Canvas size for this boot, including a saved Host panel choice. */
export function initialScreenSize(fallback: { width: number; height: number }): ScreenCanvasSize {
  const saved = readHostDisplayPreference();
  if (!saved) return { width: fallback.width, height: fallback.height };
  return layoutFor(saved.resolution, saved.scale);
}

function matchResolution(width: number, height: number): string {
  return HOST_RESOLUTIONS.find((r) => r.width === width && r.height === height)?.id ?? "classic";
}

export function createHostDisplay(
  screen: ScreenCanvas,
  fallback: { width: number; height: number },
  resizeListeners: Set<(width: number, height: number) => void>,
): HostDisplay {
  const saved = readHostDisplayPreference();
  let resolution = saved?.resolution ?? matchResolution(fallback.width, fallback.height);
  let scale: HostScale = saved?.scale ?? "auto";
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const onWindow = () => notify();
  window.addEventListener("resize", onWindow);

  function apply(): void {
    screen.setLayout(layoutFor(resolution, scale));
    writeHostDisplayPreference({ resolution, scale });
    notify();
  }

  return {
    resolutions: HOST_RESOLUTIONS,
    state() {
      const chosen = preset(resolution);
      const fixed = chosen?.width != null && chosen.height != null;
      const css = cssViewport();
      return {
        resolution,
        width: screen.width,
        height: screen.height,
        scale,
        maxScale: fixed ? maxFixedScale(chosen!.width!, chosen!.height!, css.width, css.height) : 4,
      };
    },
    setResolution(id: string) {
      if (!preset(id) || id === resolution) return;
      resolution = id;
      apply();
    },
    setScale(next: HostScale) {
      const normalized = next === "auto" ? "auto" : Math.max(1, Math.round(next));
      if (normalized === scale) return;
      scale = normalized;
      apply();
    },
    onResize(listener) {
      resizeListeners.add(listener);
      return () => resizeListeners.delete(listener);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
