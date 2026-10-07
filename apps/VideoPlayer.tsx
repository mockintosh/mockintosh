import { createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { ImageFrame, JSX } from "@mockintosh/ui";
import { Button, Slider, createDitherer, defineApp, useApp, type VideoSource } from "@mockintosh/sdk";

const BAR_H = 22;
const CLOCK_W = 78;

function formatTime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** Nearest-neighbour letterbox. Bars stay white so they dither to paper. */
function containFrame(src: ImageFrame, dest: ImageFrame): void {
  dest.rgba.fill(255);
  const scale = Math.min(dest.width / src.width, dest.height / src.height);
  const dw = Math.max(1, Math.round(src.width * scale));
  const dh = Math.max(1, Math.round(src.height * scale));
  const ox = (dest.width - dw) >> 1;
  const oy = (dest.height - dh) >> 1;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / dh));
    const srcRow = sy * src.width;
    const dstRow = (oy + y) * dest.width;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / dw));
      const si = (srcRow + sx) << 2;
      const di = (dstRow + ox + x) << 2;
      dest.rgba[di] = src.rgba[si];
      dest.rgba[di + 1] = src.rgba[si + 1];
      dest.rgba[di + 2] = src.rgba[si + 2];
      dest.rgba[di + 3] = 255;
    }
  }
}

function VideoPlayer(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const [playing, setPlaying] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [frame, setFrame] = createSignal(0);
  let source: VideoSource | null = null;
  let cancelled = false;
  let bits: Uint8Array | null = null;
  let scaled: ImageFrame | null = null;
  let dither: ((src: ImageFrame, out: Uint8Array) => void) | null = null;
  let bw = 0;
  let bh = 0;
  let cancelFrame: (() => void) | null = null;
  /** Playhead the user just dragged to. Holds the clock until the decoder arrives. */
  let holdTime: number | null = null;
  let holdFrames = 0;

  const view = () => ({
    width: Math.max(1, win.width()),
    height: Math.max(1, win.height() - BAR_H),
  });

  function stopTick(): void {
    cancelFrame?.();
    cancelFrame = null;
  }

  function paint(): void {
    const f = source?.frame() ?? null;
    if (!f) return;
    const size = view();
    if (!scaled || !bits || !dither || bw !== size.width || bh !== size.height) {
      bw = size.width;
      bh = size.height;
      scaled = { width: bw, height: bh, rgba: new Uint8ClampedArray(bw * bh * 4) };
      bits = new Uint8Array(bw * bh);
      dither = createDitherer(bw, bh, "atkinson");
    }
    containFrame(f, scaled);
    dither(scaled, bits);
    setFrame((n) => n + 1);
  }

  function sampleClock(): void {
    if (!source) return;
    const length = source.duration;
    if (length !== duration()) setDuration(length);
    const now = source.currentTime;
    if (holdTime !== null) {
      holdFrames -= 1;
      if (holdFrames <= 0 || Math.abs(now - holdTime) < 0.2) holdTime = null;
      else return;
    }
    if (Math.abs(now - time()) > 0.05) setTime(now);
  }

  function tick(): void {
    cancelFrame = null;
    paint();
    sampleClock();
    if (playing() || holdTime !== null) cancelFrame = app.scheduler.requestFrame(tick);
  }

  function startTick(): void {
    if (!cancelFrame) cancelFrame = app.scheduler.requestFrame(tick);
  }

  function scrub(value: number): void {
    holdTime = value;
    holdFrames = 8;
    source?.seek(value);
    setTime(value);
    startTick();
  }

  function toggle(): void {
    if (!source) return;
    if (playing()) {
      source.pause();
      setPlaying(false);
      stopTick();
      return;
    }
    setPlaying(true);
    startTick();
    void source.play().catch(() => {
      setPlaying(false);
      stopTick();
    });
  }

  createEffect(
    () => view(),
    () => paint(),
  );

  onSettled(() => {
    void app.video!.open("/1984.mp4", { loop: true }).then((opened) => {
      if (cancelled) {
        opened.close();
        return;
      }
      source = opened;
      setDuration(opened.duration);
      setTime(opened.currentTime);
      setReady(true);
      paint();
    });
  });
  onCleanup(() => {
    cancelled = true;
    stopTick();
    source?.close();
    source = null;
  });

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={0}>
      <raster
        width={view().width}
        height={view().height}
        revision={frame()}
        onPaint={({ blitPixels }) => {
          if (bits) blitPixels(bits, bw, bh);
        }}
      />
      <box height={BAR_H} flexDirection="row" alignItems="center" paddingLeft={4} paddingRight={4} gap={4} background={0}>
        <Button name="play" width={58} label={playing() ? "Pause" : "Play"} disabled={!ready()} onClick={toggle} />
        <Slider
          name="timeline"
          value={time()}
          min={0}
          max={Math.max(duration(), 0.001)}
          width={Math.max(40, win.width() - CLOCK_W - 74)}
          showValue={false}
          disabled={!ready() || duration() <= 0}
          onChange={scrub}
        />
        <box width={CLOCK_W}>
          <text font="menu" spacing={1} nowrap>
            {`${formatTime(time())} / ${formatTime(duration())}`}
          </text>
        </box>
      </box>
    </box>
  );
}

export default defineApp({
  id: "video",
  requires: ["video"],
  title: "1984.mp4",
  icon: "icon/MacFlim",
  defaultSize: { width: 340, height: 260 },
  minSize: { width: 220, height: 140 },
  scrollable: false,
  resizable: true,
  Component: VideoPlayer,
});
