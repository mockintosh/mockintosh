import { Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, MIME, Slider, defineApp, useApp, type AppContext, type FileDocumentProps, type VideoExcerpt } from "@mockintosh/sdk";
import { createFrame, type Frame } from "./showreel/painter";
import { REELS } from "./showreel/catalog";
import { motionReel } from "./showreel/motion";
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

/** A motion file, opened: the file, and the reel it names. Empty when the app itself is opened. */
type ShowreelProps = Partial<FileDocumentProps> & { reel?: string } & Record<string, unknown>;

function Showreel(props: ShowreelProps): JSX.Element {
  const app = useApp();
  const win = app.window;
  const reel = REELS.find((r) => r.id === props.reel) ?? REELS[0]!;

  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [looping, setLooping] = createSignal(true);
  const [muted, setMuted] = createSignal(false);
  const [soundState, setSoundState] = createSignal<ReelSoundState>("opening");
  /** The reel's footage, possibly still filling in. Set once, so the player rebuilds once. */
  const [footage, setFootage] = createSignal<VideoExcerpt | undefined>(undefined);
  /** How far the reel's footage has loaded, or null when it isn't loading. */
  const [loading, setLoading] = createSignal<number | null>(null);
  // Plain mirrors of the above for handlers, which mustn't read signals they just wrote.
  let loaded: VideoExcerpt | undefined;
  let loadingFootage = false;
  const abort = new AbortController();
  let playWhenLoaded = false;

  function assetsFor(excerpt = loaded): ReelAssets {
    return { sprite: (name) => app.getSprite(name), footage: excerpt };
  }

  function awaitingFootage(): boolean {
    return !!reel.footage && !loaded && loadingFootage;
  }

  /**
   * Start decoding the reel's footage; where video can't be decoded the reel
   * plays without it. Decoding fills the excerpt in reel order, so once it's
   * ahead and outrunning playback the reel starts while it finishes.
   */
  function loadFootage(r: ReelDefinition): void {
    const request = r.footage;
    const excerpt = app.video?.excerpt;
    if (!request || !excerpt) return;
    loadingFootage = true;
    setLoading(0);
    const { url, ...rest } = request;
    const seconds = request.ranges.reduce((sum, range) => sum + range.to - range.from, 0);
    const started = app.scheduler.now();
    let partial: VideoExcerpt | null = null;
    const admit = (decoded: VideoExcerpt) => {
      if (loaded) return;
      loaded = decoded;
      setFootage(decoded);
      setLoading(null);
      sound.setReel(r, assetsFor(decoded));
      if (playWhenLoaded) play();
    };
    excerpt(url, {
      ...rest,
      signal: abort.signal,
      onPartial: (footage) => (partial = footage),
      onProgress: (fraction) => {
        if (!loaded) setLoading(fraction);
        const decoded = fraction * seconds;
        const elapsed = (app.scheduler.now() - started) / 1000;
        if (partial && decoded >= FOOTAGE_LEAD && decoded > elapsed * FOOTAGE_OUTRUN) admit(partial);
      },
    })
      .then(admit)
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        console.error("Showreel: couldn't decode footage", err);
        loadingFootage = false;
        setLoading(null);
      });
  }

  const sound = new ReelSound(reel, assetsFor(), (state) => {
    setSoundState(state);
    // The picture ran on its own clock until now; start the sound where it is.
    if (state === "running") sound.cue(time(), playing());
  });

  const isFullScreen = () => win.kind() === "fullscreen";
  const statusText = () => {
    const progress = loading();
    if (progress !== null) return `Loading ${Math.round(progress * 100)}%`;
    return soundState() === "suspended" ? "Click for sound" : chapterAt(reel, time()).title;
  };
  const view = () => ({
    width: win.width(),
    height: isFullScreen() ? win.height() : Math.max(1, win.height() - BAR_H - 1),
  });

  const player = createMemo(() => reel.createPlayer(assetsFor(footage())));
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
    const { duration, fps } = reel;
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
    if (awaitingFootage()) {
      playWhenLoaded = true;
      return;
    }
    playWhenLoaded = false;
    if (cancelFrame) return;
    const from = !looping() && time() >= reel.duration - 1.5 / reel.fps ? 0 : time();
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
    const { duration, fps } = reel;
    const next = Math.round(time() * fps) + frames;
    const total = Math.round(duration * fps);
    seek((((next % total) + total) % total) / fps);
  }

  function seekChapter(offset: number): void {
    const { chapters } = reel;
    const current = chapters.indexOf(chapterAt(reel, time()));
    // "Previous" from well inside a chapter goes back to its start first.
    const within = time() - chapters[current]!.start > 0.5;
    const target = offset < 0 && within ? current : current + offset;
    const chapter = chapters[(target + chapters.length) % chapters.length]!;
    seek(chapter.start);
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
    loadFootage(reel);
    play();
    void sound.open(app.audio);
  });
  // Solid refuses signal writes while disposing, so cleanup can't use `stop`.
  onCleanup(() => {
    abort.abort();
    cancelTicks();
    sound.close();
  });

  // The menus show the chapter, not the time: rebuilding them every frame would shut an open menu.
  const chapter = createMemo(() => chapterAt(reel, time()).number);
  createEffect(
    () => ({
      playing: playing(),
      looping: looping(),
      muted: muted(),
      silent: soundState() === "unavailable",
      full: isFullScreen(),
      chapter: chapter(),
    }),
    (state) => {
      const { chapters } = reel;
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "Open…", shortcut: "O", onClick: () => void chooseReel(app, props.fileId) },
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
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
            max={reel.duration - 1 / reel.fps}
            step={1 / reel.fps}
            showValue={false}
            width={Math.max(40, win.width() - TIMECODE_W - 70)}
            onChange={(value) => {
              stop();
              seek(value);
            }}
          />
          <text font="menu" spacing={1} nowrap>
            {`${timecode(time(), reel.fps)} ${statusText()}`}
          </text>
        </box>
      </Show>
    </box>
  );
}

/** Open the reel a motion file names, in a window of its own; say so when it names none Showreel has. */
async function openReel(app: AppContext, { fileId, title }: FileDocumentProps): Promise<void> {
  const reel = motionReel(await app.fs.readJSON(fileId));
  if (!reel || !REELS.some((r) => r.id === reel)) {
    await app.os.showDialog({ message: `"${title}" isn't a reel Showreel can play.`, variant: "caution" });
    return;
  }
  app.openWindow<ShowreelProps>({ title, props: { fileId, title, reel } });
}

/** File › Open…: pick a motion file, starting beside `near`, and play it in a window of its own. */
async function chooseReel(app: AppContext, near?: string): Promise<void> {
  const file = await app.os.showOpenDialog({ types: [MIME.motion], near });
  if (file) app.os.openApp("showreel", { fileId: file.id, title: file.name });
}

export default defineApp<ShowreelProps>({
  id: "showreel",
  title: "Showreel",
  icon: "showreel/icon",
  smallIcon: "showreel/icon-16x16",
  sprites,
  about: {
    version: "4.0",
    description:
      "Plays motion files: reels in one bit, each with its own score. It knows four. One Bit: type, shape, depth, particles and the edit, to a 120 BPM groove. The Keeper: an engraved silent short, drawn on twos, with a waltz and a projector. Hello, Mockintosh: the machine introduces itself in its own pixels and sounds. A Lot Like 1984: the 1984 ad itself, re-cut and dithered, with Mockintosh taking over Big Brother's screens.",
  },
  defaultSize: { width: 400, height: 248 },
  minSize: { width: 224, height: 150 },
  scrollable: false,
  resizable: true,
  fileTypes: [MIME.motion],
  Component: Showreel,
  onOpen(app, props) {
    const release = app.keepAlive?.();
    const { fileId, title } = props;
    const opening = fileId ? openReel(app, { fileId, title: title ?? "Untitled" }) : chooseReel(app);
    void opening.finally(() => release?.());
  },
});
