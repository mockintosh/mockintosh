export interface ScreenCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  zoom(): number;
  /** Switch fixed resolution or viewport mode. Logical-size changes fire `onLogicalSize`. */
  setLayout(size: ScreenCanvasSize): void;
  toScreen(e: Pick<MouseEvent, "clientX" | "clientY">): { x: number; y: number };
  /**
   * The browser discarded the on-screen bitmap (pinch, DPR, tab restore)
   * without changing the logical size. Re-blit the framebuffer.
   */
  subscribeInvalidate(cb: () => void): () => void;
  dispose(): void;
}

export type ScreenCanvasSize =
  | { width: number; height: number; scale?: number }
  | { mode: "viewport"; scale?: number };

export interface CreateScreenCanvasOptions {
  /** Fires when the logical backing-store size changes (viewport mode). */
  onLogicalSize?: (width: number, height: number) => void;
}

/** Logical framebuffer for a CSS viewport at `scale` CSS pixels per pixel. */
export function viewportLogicalSize(
  cssWidth: number,
  cssHeight: number,
  scale: number,
): { width: number; height: number } {
  const s = Math.max(1, Math.round(scale));
  return {
    width: Math.max(1, Math.floor(cssWidth / s)),
    height: Math.max(1, Math.floor(cssHeight / s)),
  };
}

export function createScreenCanvas(
  root: HTMLElement,
  width: number,
  height: number,
): ScreenCanvas;
export function createScreenCanvas(
  root: HTMLElement,
  size: ScreenCanvasSize,
  options?: CreateScreenCanvasOptions,
): ScreenCanvas;
export function createScreenCanvas(
  root: HTMLElement,
  widthOrSize: number | ScreenCanvasSize,
  heightOrOptions?: number | CreateScreenCanvasOptions,
): ScreenCanvas {
  const size: ScreenCanvasSize =
    typeof widthOrSize === "number"
      ? { width: widthOrSize, height: heightOrOptions as number }
      : widthOrSize;
  const hooks = typeof heightOrOptions === "object" ? heightOrOptions : undefined;

  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.style.display = "block";
  canvas.style.outline = "none";
  canvas.style.imageRendering = "pixelated";
  canvas.style.touchAction = "none";
  root.appendChild(canvas);

  const rawCtx = canvas.getContext("2d", { alpha: false });
  if (!rawCtx) throw new Error("2D canvas is unavailable");
  const ctx: CanvasRenderingContext2D = rawCtx;

  let logicalWidth = 1;
  let logicalHeight = 1;
  let zoom = 1;
  let viewport: { mode: "viewport"; scale?: number } | null = "mode" in size ? size : null;
  let fixed: { width: number; height: number; scale?: number } | null = "mode" in size ? null : size;
  const invalidators = new Set<() => void>();

  function invalidate(): void {
    invalidators.forEach((cb) => cb());
  }

  function applyBackingStore(width: number, height: number): void {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.imageSmoothingEnabled = false;
    logicalWidth = width;
    logicalHeight = height;
  }

  function fitFixed(width: number, height: number, scale?: number): void {
    const fit = Math.min(
      Math.floor(window.innerWidth / width),
      Math.floor(window.innerHeight / height),
    );
    const room = Math.max(1, fit);
    const wanted = scale != null ? Math.max(1, Math.round(scale)) : room;
    zoom = Math.min(wanted, room);
    applyBackingStore(width, height);
    canvas.style.width = `${width * zoom}px`;
    canvas.style.height = `${height * zoom}px`;
  }

  function cssViewport(): { width: number; height: number } {
    // Layout viewport, not visualViewport — the URL bar toggling mid-flick
    // must not reallocate the framebuffer.
    const doc = document.documentElement;
    return {
      width: window.innerWidth || doc.clientWidth,
      height: window.innerHeight || doc.clientHeight,
    };
  }

  function fitViewport(scale: number): boolean {
    zoom = Math.max(1, Math.round(scale));
    const css = cssViewport();
    const next = viewportLogicalSize(css.width, css.height, zoom);
    const changed = next.width !== logicalWidth || next.height !== logicalHeight;
    applyBackingStore(next.width, next.height);
    canvas.style.width = `${next.width * zoom}px`;
    canvas.style.height = `${next.height * zoom}px`;
    return changed;
  }

  /**
   * Reallocate only when the logical size changes. Same-size events still
   * wipe the GPU texture (pinch / DPR), so those go through `invalidate`.
   */
  function onWindowResize(): void {
    if (viewport) {
      if (fitViewport(viewport.scale ?? 1)) {
        hooks?.onLogicalSize?.(logicalWidth, logicalHeight);
        return;
      }
    } else if (fixed) {
      fitFixed(fixed.width, fixed.height, fixed.scale);
    }
    invalidate();
  }

  function applyLayout(next: ScreenCanvasSize): void {
    const prevW = logicalWidth;
    const prevH = logicalHeight;
    if ("mode" in next) {
      viewport = next;
      fixed = null;
      if (fitViewport(next.scale ?? 1) || logicalWidth !== prevW || logicalHeight !== prevH) {
        hooks?.onLogicalSize?.(logicalWidth, logicalHeight);
        return;
      }
    } else {
      viewport = null;
      fixed = next;
      fitFixed(next.width, next.height, next.scale);
      if (logicalWidth !== prevW || logicalHeight !== prevH) {
        hooks?.onLogicalSize?.(logicalWidth, logicalHeight);
        return;
      }
    }
    invalidate();
  }

  function preventGesture(e: Event): void {
    e.preventDefault();
  }

  let dprMedia: MediaQueryList | null = null;
  const onDprChange = () => {
    watchDpr();
    invalidate();
  };
  function watchDpr(): void {
    dprMedia?.removeEventListener("change", onDprChange);
    if (typeof matchMedia !== "function") return;
    dprMedia = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMedia.addEventListener("change", onDprChange);
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") invalidate();
  };

  if (viewport) {
    fitViewport(viewport.scale ?? 1);
  } else if (fixed) {
    fitFixed(fixed.width, fixed.height, fixed.scale);
  }
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("pageshow", invalidate);
  document.addEventListener("visibilitychange", onVisible);
  const vv = typeof visualViewport !== "undefined" ? visualViewport : null;
  vv?.addEventListener("resize", onWindowResize);
  watchDpr();
  canvas.addEventListener("gesturestart", preventGesture);
  canvas.addEventListener("gesturechange", preventGesture);
  canvas.addEventListener("contextlost", invalidate);
  canvas.addEventListener("contextrestored", () => {
    ctx.imageSmoothingEnabled = false;
    invalidate();
  });

  return {
    canvas,
    ctx,
    get width() {
      return logicalWidth;
    },
    get height() {
      return logicalHeight;
    },
    zoom: () => zoom,
    setLayout: applyLayout,
    toScreen(e: Pick<MouseEvent, "clientX" | "clientY">) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.floor((e.clientX - rect.left) / zoom),
        y: Math.floor((e.clientY - rect.top) / zoom),
      };
    },
    subscribeInvalidate(cb) {
      invalidators.add(cb);
      return () => {
        invalidators.delete(cb);
      };
    },
    dispose() {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("pageshow", invalidate);
      document.removeEventListener("visibilitychange", onVisible);
      vv?.removeEventListener("resize", onWindowResize);
      dprMedia?.removeEventListener("change", onDprChange);
      canvas.removeEventListener("gesturestart", preventGesture);
      canvas.removeEventListener("gesturechange", preventGesture);
      canvas.removeEventListener("contextlost", invalidate);
      canvas.remove();
    },
  };
}
