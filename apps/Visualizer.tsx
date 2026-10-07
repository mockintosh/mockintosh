import { Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { defineApp, useApp, type AudioMonitor, type MenubarItemDef } from "@mockintosh/sdk";
import { createFrame, invertRect, type Frame } from "./showreel/painter";
import { SCENES, SCENE_GROUPS, groupOf, stepGroup, stepScene } from "./visualizer/catalog";
import { sprites } from "./visualizer/icons";
import { Listener, WINDOW } from "./visualizer/listen";
import { drawNotice, drawSceneTag } from "./visualizer/overlay";
import { noteLabel, noteText, type SceneDefinition } from "./visualizer/scene";

const BAR_H = 16;
const SETTINGS_KEY = "settings.json";
/** Auto-cycle moves on after this many beats, or this long without enough of them. */
const CYCLE_BEATS = 32;
const CYCLE_SECONDS = 30;
/** Silence this long before the "no signal" card comes up. */
const NOTICE_AFTER = 2;

type MonitorStatus = "opening" | "listening" | "unavailable" | "failed";

interface Settings {
  scene: string;
  inverted: boolean;
  autoCycle: boolean;
}

function parseSettings(text: string | null): Partial<Settings> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return {};
    const record = value as Record<string, unknown>;
    return {
      ...(typeof record.scene === "string" ? { scene: record.scene } : {}),
      ...(typeof record.inverted === "boolean" ? { inverted: record.inverted } : {}),
      ...(typeof record.autoCycle === "boolean" ? { autoCycle: record.autoCycle } : {}),
    };
  } catch {
    return {};
  }
}

function Visualizer(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [scene, setScene] = createSignal<SceneDefinition>(SCENES[0]!);
  const [inverted, setInverted] = createSignal(false);
  const [autoCycle, setAutoCycle] = createSignal(false);
  const [status, setStatus] = createSignal<MonitorStatus>(app.audio?.monitor ? "opening" : "unavailable");
  const [readout, setReadout] = createSignal("");
  const [frames, setFrames] = createSignal(0);

  const isFullScreen = () => win.kind() === "fullscreen";
  const view = () => ({
    width: win.width(),
    height: isFullScreen() ? win.height() : Math.max(1, win.height() - BAR_H - 1),
  });

  // A fresh scene each time one is chosen: scenes keep trails and particles.
  const running = createMemo(() => scene().create());
  let listener = new Listener(48000);
  let monitor: AudioMonitor | null = null;
  let chosenAt = 0;
  let chosenBeats = 0;
  let quietSince = 0;
  let frame: Frame | null = null;
  let loaded = false;

  function choose(next: SceneDefinition): void {
    chosenAt = listener.time;
    chosenBeats = listener.beats;
    setScene(next);
  }

  function chooseAtRandom(): void {
    const others = SCENES.filter((candidate) => candidate !== scene());
    choose(others[Math.floor(Math.random() * others.length)]!);
  }

  // ---------------------------------------------------------------------------
  // Listening, on the display's clock
  // ---------------------------------------------------------------------------

  const left = new Float32Array(WINDOW);
  const right = new Float32Array(WINDOW);
  let cancelFrame: (() => void) | null = null;
  let lastTick: number | null = null;

  function describe(): string {
    const state = status();
    if (state === "opening") return "Listening...";
    if (state === "unavailable") return "This speaker can't be monitored";
    if (state === "failed") return "Couldn't listen to the speaker";
    if (listener.silent) return "Nothing playing";
    if (listener.note !== null) return `${noteText(noteLabel(listener.note))}  ${Math.round(listener.pitch!)} Hz`;
    return "Listening";
  }

  function tick(now: number): void {
    cancelFrame = app.scheduler.requestFrame(tick);
    const dt = lastTick === null ? 1 / 60 : (now - lastTick) / 1000;
    lastTick = now;
    if (monitor) monitor.read(left, right);
    listener.hear(left, right, dt);
    if (!listener.silent) quietSince = listener.time;
    const cycleDue = listener.beats - chosenBeats >= CYCLE_BEATS || listener.time - chosenAt >= CYCLE_SECONDS;
    if (autoCycle() && !listener.silent && cycleDue) chooseAtRandom();
    setReadout(describe());
    setFrames((n) => n + 1);
  }

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(tick);
    void app.storage.read(SETTINGS_KEY).then((text) => {
      const saved = parseSettings(text);
      const found = SCENES.find((candidate) => candidate.id === saved.scene);
      if (found) choose(found);
      if (saved.inverted !== undefined) setInverted(saved.inverted);
      if (saved.autoCycle !== undefined) setAutoCycle(saved.autoCycle);
      loaded = true;
    });
    const open = app.audio?.monitor;
    if (!open) return;
    void open()
      .then((opened) => {
        monitor = opened;
        listener = new Listener(opened.sampleRate);
        chosenAt = 0;
        chosenBeats = 0;
        quietSince = 0;
        setStatus("listening");
      })
      .catch((err: unknown) => {
        console.error("Visualizer: couldn't monitor the speaker", err);
        setStatus("failed");
      });
  });

  onCleanup(() => {
    cancelFrame?.();
    monitor?.close();
  });

  createEffect(
    () => ({ scene: scene().id, inverted: inverted(), autoCycle: autoCycle() }),
    (settings: Settings) => {
      if (loaded) void app.storage.write(SETTINGS_KEY, JSON.stringify(settings));
    },
  );

  createEffect(
    () => scene().title,
    (title) => win.setTitle(`Visualizer: ${title}`),
  );

  // ---------------------------------------------------------------------------
  // Keys and menus
  // ---------------------------------------------------------------------------

  const onKeyDown = (key: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl || mods.alt) return;
    if (key === "ArrowRight") choose(stepScene(scene(), 1));
    else if (key === "ArrowLeft") choose(stepScene(scene(), -1));
    else if (key === "ArrowDown") choose(stepGroup(scene(), 1));
    else if (key === "ArrowUp") choose(stepGroup(scene(), -1));
    else if (key === "Escape" && isFullScreen()) win.setFullScreen(false);
  };

  createEffect(
    () => ({ scene: scene(), inverted: inverted(), autoCycle: autoCycle(), full: isFullScreen() }),
    (state) => {
      const current = groupOf(state.scene);
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "Open Synthesizer", onClick: () => app.os.openApp("synth") },
            { label: "Open Pocket Chord", onClick: () => app.os.openApp("chord") },
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
            {
              type: "radiogroup",
              value: state.inverted ? "normal" : "inverted",
              onValueChange: (value) => setInverted(value === "normal"),
              items: [
                { label: "White on Black", value: "inverted" },
                { label: "Black on White", value: "normal" },
              ],
            },
          ],
        },
        {
          label: "Visualization",
          items: [
            { label: "Next", shortcut: "]", onClick: () => choose(stepScene(scene(), 1)) },
            { label: "Previous", shortcut: "[", onClick: () => choose(stepScene(scene(), -1)) },
            { label: "Next Group", shortcut: "=", onClick: () => choose(stepGroup(scene(), 1)) },
            { label: "Previous Group", shortcut: "-", onClick: () => choose(stepGroup(scene(), -1)) },
            { label: "Surprise Me", shortcut: "R", onClick: chooseAtRandom },
            { type: "separator" },
            {
              label: state.autoCycle ? "Stop Auto-Cycle" : "Auto-Cycle",
              onClick: () => {
                chosenAt = listener.time;
                chosenBeats = listener.beats;
                setAutoCycle((on) => !on);
              },
            },
            { type: "separator" },
            ...SCENE_GROUPS.map((group): MenubarItemDef => ({
              type: "submenu",
              label: group.title,
              items: [
                {
                  type: "radiogroup",
                  value: group === current ? state.scene.id : "",
                  onValueChange: (id) => choose(group.scenes.find((candidate) => candidate.id === id)!),
                  items: group.scenes.map((candidate) => ({ label: candidate.title, value: candidate.id })),
                },
              ],
            })),
          ],
        },
      ]);
    },
  );

  const position = () => {
    const current = scene();
    return `${SCENES.indexOf(current) + 1}/${SCENES.length}  ${groupOf(current).title}: ${current.title}`;
  };

  return (
    <box
      width={win.width()}
      height={win.height()}
      flexDirection="column"
      background={1}
      tabIndex={0}
      autoFocus
      semantic={{ name: "visualizer", role: "application" }}
      onKeyDown={onKeyDown}
    >
      <raster
        width={view().width}
        height={view().height}
        revision={frames()}
        semantic={{ name: "visualization", role: "preview", value: scene().id }}
        onClick={() => choose(stepScene(scene(), 1))}
        onPaint={(surface) => {
          const size = view();
          if (!frame || frame.width !== size.width || frame.height !== size.height) {
            frame = createFrame(size.width, size.height);
          }
          running().render(frame, listener);
          const current = scene();
          drawSceneTag(frame, { number: SCENES.indexOf(current) + 1, title: current.title, age: listener.time - chosenAt });
          const state = status();
          if (state === "unavailable" || state === "failed") {
            drawNotice(frame, ["NO MONITOR", "THIS SPEAKER CAN'T BE HEARD BACK"], listener.time);
          } else if (state === "listening" && listener.time - quietSince > NOTICE_AFTER) {
            drawNotice(frame, ["NO SIGNAL", "PLAY SOMETHING IN SYNTHESIZER"], listener.time);
          }
          if (inverted()) invertRect(frame, { x0: 0, y0: 0, x1: frame.width, y1: frame.height });
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
          <text font="menu" spacing={1} nowrap>
            {position()}
          </text>
          <box flexGrow={1} />
          <text font="menu" spacing={1} nowrap>
            {readout()}
          </text>
        </box>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "visualizer",
  title: "Visualizer",
  icon: "visualizer/icon",
  sprites,
  requires: ["audio"],
  about: {
    version: "1.0",
    description:
      "Listens to everything this Macintosh plays and draws it in one bit: scopes and meters, generative systems, the shots of Showreel's first reel, and Surface plots. Arrow keys change the picture.",
  },
  defaultSize: { width: 400, height: 262 },
  minSize: { width: 220, height: 150 },
  scrollable: false,
  resizable: true,
  Component: Visualizer,
});
