import { Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, Slider, defineApp, useApp } from "@mockintosh/sdk";
import { createFrame, type Frame } from "./showreel/painter";
import { CHAPTERS, REEL_DURATION, REEL_FPS, ReelRenderer, chapterAt, timecode } from "./showreel/reel";
import { sprites } from "./showreel/icons";

const BAR_H = 22;
const TIMECODE_W = 92;
/** Longest step one display frame may advance, so a stalled tab doesn't skip a shot. */
const MAX_STEP = 0.1;

function Showreel(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [looping, setLooping] = createSignal(true);

  const isFullScreen = () => win.kind() === "fullscreen";
  const view = () => ({
    width: win.width(),
    height: isFullScreen() ? win.height() : Math.max(1, win.height() - BAR_H - 1),
  });

  const reel = new ReelRenderer();
  let frame: Frame | null = null;
  let paints = 0;
  const revision = createMemo(() => {
    time();
    win.width();
    win.height();
    return ++paints;
  });

  let cancelFrame: (() => void) | null = null;
  let lastTick: number | null = null;

  function tick(now: number): void {
    const step = lastTick === null ? 0 : Math.min(MAX_STEP, (now - lastTick) / 1000);
    lastTick = now;
    const next = time() + step;
    if (next >= REEL_DURATION && !looping()) {
      setTime(REEL_DURATION - 1 / REEL_FPS);
      stop();
      return;
    }
    setTime(next % REEL_DURATION);
    cancelFrame = app.scheduler.requestFrame(tick);
  }

  function play(): void {
    if (cancelFrame) return;
    if (!looping() && time() >= REEL_DURATION - 1.5 / REEL_FPS) setTime(0);
    lastTick = null;
    setPlaying(true);
    cancelFrame = app.scheduler.requestFrame(tick);
  }

  function cancelTicks(): void {
    cancelFrame?.();
    cancelFrame = null;
  }

  function stop(): void {
    cancelTicks();
    setPlaying(false);
  }

  function toggle(): void {
    if (playing()) stop();
    else play();
  }

  /** Jump by whole reel frames, pausing so the frame can be studied. */
  function stepFrames(frames: number): void {
    stop();
    const next = Math.round(time() * REEL_FPS) + frames;
    const total = REEL_DURATION * REEL_FPS;
    setTime((((next % total) + total) % total) / REEL_FPS);
  }

  function seekChapter(offset: number): void {
    const current = CHAPTERS.indexOf(chapterAt(time()));
    // "Previous" from well inside a chapter goes back to its start first.
    const within = time() - CHAPTERS[current]!.start > 0.5;
    const target = offset < 0 && within ? current : current + offset;
    const chapter = CHAPTERS[(target + CHAPTERS.length) % CHAPTERS.length]!;
    setTime(chapter.start);
  }

  onSettled(play);
  // Solid refuses signal writes while disposing, so cleanup can't use `stop`.
  onCleanup(cancelTicks);

  createEffect(
    () => ({ playing: playing(), looping: looping(), full: isFullScreen(), chapter: chapterAt(time()).number }),
    (state) => {
      app.setMenus([
        {
          label: "File",
          items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }],
        },
        {
          label: "View",
          items: [
            {
              label: state.full ? "Exit Full Screen" : "Full Screen",
              shortcut: "F",
              onClick: () => win.setFullScreen(!isFullScreen()),
            },
          ],
        },
        {
          label: "Playback",
          items: [
            { label: state.playing ? "Pause" : "Play", shortcut: "R", onClick: toggle },
            { label: "Rewind", onClick: () => setTime(0) },
            { type: "separator" },
            { label: "Next Frame", shortcut: "]", onClick: () => stepFrames(1) },
            { label: "Previous Frame", shortcut: "[", onClick: () => stepFrames(-1) },
            { label: "Next Chapter", shortcut: "=", onClick: () => seekChapter(1) },
            { label: "Previous Chapter", shortcut: "-", onClick: () => seekChapter(-1) },
            { type: "separator" },
            { label: state.looping ? "Don't Loop" : "Loop", onClick: () => setLooping((on) => !on) },
          ],
        },
        {
          label: "Chapters",
          items: [
            {
              type: "radiogroup",
              value: String(state.chapter),
              onValueChange: (value) => setTime(CHAPTERS.find((c) => String(c.number) === value)!.start),
              items: CHAPTERS.map((c) => ({
                label: `${String(c.number).padStart(2, "0")}  ${c.title}`,
                value: String(c.number),
              })),
            },
          ],
        },
      ]);
    },
  );

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={1}>
      <raster
        width={view().width}
        height={view().height}
        revision={revision()}
        semantic={{ name: "reel", role: "preview" }}
        onClick={toggle}
        onPaint={(surface) => {
          const size = view();
          if (!frame || frame.width !== size.width || frame.height !== size.height) {
            frame = createFrame(size.width, size.height);
          }
          reel.render(frame, time());
          surface.blitPixels(frame.pixels, frame.width, frame.height);
        }}
      />
      <Show when={!isFullScreen()}>
        <box height={1} background={1} />
        <box
          height={BAR_H}
          flexDirection="row"
          alignItems="center"
          paddingLeft={4}
          paddingRight={4}
          gap={6}
          background={0}
        >
          <Button name="play" label={playing() ? "Pause" : "Play"} onClick={toggle} />
          <Slider
            name="scrub"
            value={time()}
            min={0}
            max={REEL_DURATION - 1 / REEL_FPS}
            step={1 / REEL_FPS}
            showValue={false}
            width={Math.max(40, win.width() - TIMECODE_W - 70)}
            onChange={(value) => {
              stop();
              setTime(value);
            }}
          />
          <text font="menu" nowrap>
            {`${timecode(time())} ${chapterAt(time()).title}`}
          </text>
        </box>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "showreel",
  title: "Showreel",
  icon: "showreel/icon",
  sprites,
  about: {
    version: "1.0",
    description: "Fifteen seconds of motion design in one bit: type, shape, depth, particles, rhythm and the edit.",
  },
  defaultSize: { width: 400, height: 248 },
  minSize: { width: 224, height: 150 },
  scrollable: false,
  resizable: true,
  Component: Showreel,
});
