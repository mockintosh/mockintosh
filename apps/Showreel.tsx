import { Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, Slider, defineApp, useApp, type VideoExcerpt } from "@mockintosh/sdk";
import { createFrame, type Frame } from "./showreel/painter";
import { REELS } from "./showreel/catalog";
import { chapterAt, timecode, type ReelAssets, type ReelDefinition } from "./showreel/reels";
import { ReelSound, type ReelSoundState } from "./showreel/sound/reelSound";
import { sprites } from "./showreel/icons";

const BAR_H = 22;
const TIMECODE_W = 92;
/** Longest step one display frame may advance, so a stalled tab doesn't skip a shot. */
const MAX_STEP = 0.1;
/** Seconds of footage decoded before a reel may start while the rest decodes… */
const FOOTAGE_LEAD = 2;
/** …and how much faster than playback decoding must be running for that. */
const FOOTAGE_OUTRUN = 1.25;

function Showreel(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [looping, setLooping] = createSignal(true);
  const [reel, setReel] = createSignal<ReelDefinition>(REELS[0]!);
  const [muted, setMuted] = createSignal(false);
  const [soundState, setSoundState] = createSignal<ReelSoundState>("opening");
  /** Footage by reel id, possibly still filling in. Changes once per reel, so players rebuild once. */
  const [excerpts, setExcerpts] = createSignal<ReadonlyMap<string, VideoExcerpt>>(new Map());
  /** How far the current reel's footage has loaded, or null when it isn't loading. */
  const [loading, setLoading] = createSignal<number | null>(null);
  // Plain mirrors of the above for handlers, which mustn't read signals they just wrote.
  const loaded = new Map<string, VideoExcerpt>();
  const loads = new Set<string>();
  const abort = new AbortController();
  let current: ReelDefinition = reel();
  let playWhenLoaded = false;

  function assetsFor(r: ReelDefinition, footage = loaded.get(r.id)): ReelAssets {
    return { sprite: (name) => app.getSprite(name), footage };
  }

  function awaitingFootage(r: ReelDefinition): boolean {
    return !!r.footage && !loaded.has(r.id) && loads.has(r.id);
  }

  /**
   * Start decoding a reel's footage, once; where video can't be decoded the
   * reel plays without it. Decoding fills the excerpt in reel order, so once
   * it's ahead and outrunning playback the reel starts while it finishes.
   */
  function loadFootage(r: ReelDefinition): void {
    const request = r.footage;
    const excerpt = app.video?.excerpt;
    if (!request || !excerpt || loaded.has(r.id) || loads.has(r.id)) return;
    loads.add(r.id);
    setLoading(0);
    const { url, ...rest } = request;
    const seconds = request.ranges.reduce((sum, range) => sum + range.to - range.from, 0);
    const started = app.scheduler.now();
    let partial: VideoExcerpt | null = null;
    const admit = (footage: VideoExcerpt) => {
      if (loaded.has(r.id)) return;
      loaded.set(r.id, footage);
      setExcerpts(new Map(loaded));
      if (current !== r) return;
      setLoading(null);
      sound.setReel(r, assetsFor(r, footage));
      if (playWhenLoaded) play();
    };
    excerpt(url, {
      ...rest,
      signal: abort.signal,
      onPartial: (footage) => (partial = footage),
      onProgress: (fraction) => {
        if (current === r && !loaded.has(r.id)) setLoading(fraction);
        const decoded = fraction * seconds;
        const elapsed = (app.scheduler.now() - started) / 1000;
        if (partial && decoded >= FOOTAGE_LEAD && decoded > elapsed * FOOTAGE_OUTRUN) admit(partial);
      },
    })
      .then(admit)
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        console.error("Showreel: couldn't decode footage", err);
        loads.delete(r.id);
        if (current === r) setLoading(null);
      });
  }

  const sound = new ReelSound(reel(), assetsFor(reel()), (state) => {
    setSoundState(state);
    // The picture ran on its own clock until now; start the sound where it is.
    if (state === "running") sound.cue(time(), playing());
  });

  const isFullScreen = () => win.kind() === "fullscreen";
  const statusText = () => {
    const progress = loading();
    if (progress !== null) return `Loading ${Math.round(progress * 100)}%`;
    return soundState() === "suspended" ? "Click for sound" : chapterAt(reel(), time()).title;
  };
  const view = () => ({
    width: win.width(),
    height: isFullScreen() ? win.height() : Math.max(1, win.height() - BAR_H - 1),
  });

  const player = createMemo(() => reel().createPlayer({ sprite: (name) => app.getSprite(name), footage: excerpts().get(reel().id) }));
  let frame: Frame | null = null;
  let paints = 0;
  const revision = createMemo(() => {
    player();
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
    const { duration, fps } = reel();
    const heard = sound.heard();
    const next = heard ? heard.time : time() + step;
    if ((heard ? heard.ended : next >= duration) && !looping()) {
      setTime(duration - 1 / fps);
      stop(duration - 1 / fps);
      return;
    }
    setTime(next % duration);
    cancelFrame = app.scheduler.requestFrame(tick);
  }

  function play(): void {
    if (awaitingFootage(current)) {
      playWhenLoaded = true;
      return;
    }
    playWhenLoaded = false;
    if (cancelFrame) return;
    const from = !looping() && time() >= reel().duration - 1.5 / reel().fps ? 0 : time();
    setTime(from);
    lastTick = null;
    setPlaying(true);
    sound.cue(from, true);
    cancelFrame = app.scheduler.requestFrame(tick);
  }

  function cancelTicks(): void {
    cancelFrame?.();
    cancelFrame = null;
  }

  // Solid defers signal writes, so a read straight after a write in the same
  // handler sees the old value: what the sound is told is passed explicitly.
  function stop(at = time()): void {
    playWhenLoaded = false;
    cancelTicks();
    setPlaying(false);
    sound.cue(at, false);
  }

  /** Every jump in reel time goes through here so the sound follows the picture. */
  function seek(t: number): void {
    setTime(t);
    sound.seek(t);
  }

  function toggle(): void {
    if (playing() || playWhenLoaded) stop();
    else play();
  }

  /** Jump by whole reel frames, pausing so the frame can be studied. */
  function stepFrames(frames: number): void {
    stop();
    const { duration, fps } = reel();
    const next = Math.round(time() * fps) + frames;
    const total = Math.round(duration * fps);
    seek((((next % total) + total) % total) / fps);
  }

  function seekChapter(offset: number): void {
    const { chapters } = reel();
    const current = chapters.indexOf(chapterAt(reel(), time()));
    // "Previous" from well inside a chapter goes back to its start first.
    const within = time() - chapters[current]!.start > 0.5;
    const target = offset < 0 && within ? current : current + offset;
    const chapter = chapters[(target + chapters.length) % chapters.length]!;
    seek(chapter.start);
  }

  /** Cut to another reel from its first frame, keeping the transport state. */
  function selectReel(next: ReelDefinition): void {
    if (next === current) return;
    const resume = playing() || playWhenLoaded;
    current = next;
    setReel(next);
    setLoading(null);
    sound.setReel(next, assetsFor(next));
    loadFootage(next);
    if (awaitingFootage(next)) {
      stop(0);
      setTime(0);
      playWhenLoaded = resume;
      return;
    }
    seek(0);
  }

  function toggleLoop(): void {
    const on = !looping();
    setLooping(on);
    sound.setLooping(on);
  }

  function toggleMute(): void {
    const on = !muted();
    setMuted(on);
    sound.setMuted(on);
  }

  onSettled(() => {
    play();
    void sound.open(app.audio);
  });
  // Solid refuses signal writes while disposing, so cleanup can't use `stop`.
  onCleanup(() => {
    abort.abort();
    cancelTicks();
    sound.close();
  });

  createEffect(
    () => reel().title,
    (title) => win.setTitle(title),
  );

  // The menus show the chapter, not the time: rebuilding them every frame would shut an open menu.
  const chapter = createMemo(() => chapterAt(reel(), time()).number);
  createEffect(
    () => ({
      reel: reel(),
      playing: playing(),
      looping: looping(),
      muted: muted(),
      silent: soundState() === "unavailable",
      full: isFullScreen(),
      chapter: chapter(),
    }),
    (state) => {
      const { chapters } = state.reel;
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
          label: "Reel",
          items: [
            {
              type: "radiogroup",
              value: state.reel.id,
              onValueChange: (value) => selectReel(REELS.find((r) => r.id === value)!),
              items: REELS.map((r) => ({ label: r.title, value: r.id })),
            },
          ],
        },
        {
          label: "Playback",
          items: [
            { label: state.playing ? "Pause" : "Play", shortcut: "R", onClick: toggle },
            { label: "Rewind", onClick: () => seek(0) },
            { type: "separator" },
            { label: "Next Frame", shortcut: "]", onClick: () => stepFrames(1) },
            { label: "Previous Frame", shortcut: "[", onClick: () => stepFrames(-1) },
            { label: "Next Chapter", shortcut: "=", onClick: () => seekChapter(1) },
            { label: "Previous Chapter", shortcut: "-", onClick: () => seekChapter(-1) },
            { type: "separator" },
            { label: state.looping ? "Don't Loop" : "Loop", onClick: toggleLoop },
            { label: state.muted ? "Unmute Sound" : "Mute Sound", shortcut: "⇧M", disabled: state.silent, onClick: toggleMute },
          ],
        },
        {
          label: "Chapters",
          items: [
            {
              type: "radiogroup",
              value: String(state.chapter),
              onValueChange: (value) => seek(chapters.find((c) => String(c.number) === value)!.start),
              items: chapters.map((c) => ({
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
        onClick={() => {
          // The click that unlocks sound shouldn't also pause the reel it's asking to hear.
          if (soundState() !== "suspended") toggle();
        }}
        onPaint={(surface) => {
          const size = view();
          if (!frame || frame.width !== size.width || frame.height !== size.height) {
            frame = createFrame(size.width, size.height);
          }
          player().render(frame, time());
          surface.blitPixels(frame.pixels, frame.width, frame.height);
        }}
      />
      <Show when={!isFullScreen()}>
        <box height={1} background={1} />
        <box height={BAR_H} flexDirection="row" alignItems="center" paddingLeft={4} paddingRight={4} gap={6} background={0}>
          <Button name="play" label={playing() ? "Pause" : "Play"} onClick={toggle} />
          <Slider
            name="scrub"
            value={time()}
            min={0}
            max={reel().duration - 1 / reel().fps}
            step={1 / reel().fps}
            showValue={false}
            width={Math.max(40, win.width() - TIMECODE_W - 70)}
            onChange={(value) => {
              stop();
              seek(value);
            }}
          />
          <text font="menu" spacing={1} nowrap>
            {`${timecode(time(), reel().fps)} ${statusText()}`}
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
  smallIcon: "showreel/icon-16x16",
  sprites,
  about: {
    version: "4.0",
    description:
      "Four reels in one bit, each with its own score. One Bit: type, shape, depth, particles and the edit, to a 120 BPM groove. The Keeper: an engraved silent short, drawn on twos, with a waltz and a projector. Hello, Mockintosh: the machine introduces itself in its own pixels and sounds. A Lot Like 1984: the 1984 ad itself, re-cut and dithered, with Mockintosh taking over Big Brother's screens.",
  },
  defaultSize: { width: 400, height: 248 },
  minSize: { width: 224, height: 150 },
  scrollable: false,
  resizable: true,
  Component: Showreel,
});
