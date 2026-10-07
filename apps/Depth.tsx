import { Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { createDitherer, defineApp, useApp, type DitherMode, type GpuProgram, type ImageFrame } from "@mockintosh/sdk";
import { sprites } from "./depth/icons";
import { SCENES, stepScene, type Orbit, type SceneDefinition } from "./depth/scenes";

const BAR_H = 16;
const SETTINGS_KEY = "settings.json";
/** Radians of orbit per pixel dragged. */
const DRAG_TURN = 0.012;
const MAX_PITCH = 1.45;
const MIN_PITCH = -0.1;

type Dither = Exclude<DitherMode, "ascii">;

const DITHERS: { id: Dither; label: string }[] = [
  { id: "atkinson", label: "Atkinson" },
  { id: "bayer", label: "Ordered" },
  { id: "pattern", label: "Patterns" },
  { id: "thermal", label: "Halftone" },
  { id: "threshold", label: "Threshold" },
];

const QUALITIES = [
  { samples: 1, label: "Draft" },
  { samples: 2, label: "Smooth" },
  { samples: 3, label: "Best" },
];

interface Settings {
  scene: string;
  dither: Dither;
  samples: number;
  spin: boolean;
}

function parseSettings(text: string | null): Partial<Settings> {
  if (!text) return {};
  try {
    const record = JSON.parse(text) as Record<string, unknown>;
    return {
      ...(typeof record.scene === "string" ? { scene: record.scene } : {}),
      ...(DITHERS.some((d) => d.id === record.dither) ? { dither: record.dither as Dither } : {}),
      ...(QUALITIES.some((q) => q.samples === record.samples) ? { samples: record.samples as number } : {}),
      ...(typeof record.spin === "boolean" ? { spin: record.spin } : {}),
    };
  } catch {
    return {};
  }
}

function Depth(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const gpu = app.gpu!;

  const [scene, setScene] = createSignal<SceneDefinition>(SCENES[0]!);
  const [dither, setDither] = createSignal<Dither>("atkinson");
  const [samples, setSamples] = createSignal(2);
  const [spin, setSpin] = createSignal(true);
  const [paused, setPaused] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [status, setStatus] = createSignal("Compiling...");
  const [hardware, setHardware] = createSignal("");

  const isFullScreen = () => win.kind() === "fullscreen";
  const view = () => ({
    width: Math.max(1, win.width()),
    height: Math.max(1, isFullScreen() ? win.height() : win.height() - BAR_H - 1),
  });

  /** Compiled programs by scene id, kept so switching back is instant. */
  const programs = new Map<string, Promise<GpuProgram>>();
  let program: GpuProgram | null = null;
  let orbit: Orbit = { ...SCENES[0]!.orbit };
  let clock = 0;
  /** Seconds spent spinning, for the camera's own motion on top of `orbit`. */
  let spinClock = 0;
  let lastTick: number | null = null;
  let inFlight = false;
  let disposed = false;
  let cancelFrame: (() => void) | null = null;
  let loaded = false;

  let pixels = new Uint8Array(1);
  let pixelsWidth = 1;
  let pixelsHeight = 1;
  let ditherer: ((frame: ImageFrame, out: Uint8Array) => void) | null = null;
  let dithererKey = "";

  let frames = 0;
  let gpuMs = 0;
  let fpsSince = 0;

  function programFor(definition: SceneDefinition): Promise<GpuProgram> {
    let compiled = programs.get(definition.id);
    if (!compiled) {
      compiled = gpu.compile(definition.source);
      programs.set(definition.id, compiled);
      compiled.catch(() => programs.delete(definition.id));
    }
    return compiled;
  }

  function choose(next: SceneDefinition): void {
    setScene(next);
    orbit = { ...next.orbit };
    spinClock = 0;
  }

  function spinAngle(): number {
    const { spin: speed, sway } = scene();
    return sway ? sway * Math.sin((spinClock * speed) / sway) : spinClock * speed;
  }

  createEffect(
    () => scene(),
    (current) => {
      program = null;
      setStatus("Compiling...");
      programFor(current).then(
        (compiled) => {
          if (disposed || scene() !== current) return;
          program = compiled;
          fpsSince = app.scheduler.now();
          frames = 0;
          gpuMs = 0;
        },
        (err: unknown) => {
          console.error(`Depth: ${current.title} didn't compile`, err);
          if (scene() === current) setStatus("This scene didn't compile");
        },
      );
      win.setTitle(`Depth: ${current.title}`);
    },
  );

  function show(frame: ImageFrame): void {
    const key = `${frame.width}x${frame.height}:${dither()}`;
    if (key !== dithererKey) {
      ditherer = createDitherer(frame.width, frame.height, dither());
      dithererKey = key;
      pixels = new Uint8Array(frame.width * frame.height);
      pixelsWidth = frame.width;
      pixelsHeight = frame.height;
    }
    ditherer!(frame, pixels);
    setRevision((n) => n + 1);
  }

  function tick(now: number): void {
    cancelFrame = app.scheduler.requestFrame(tick);
    const dt = lastTick === null ? 0 : Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (!paused()) {
      clock += dt;
      if (spin()) spinClock += dt;
    }
    if (inFlight || !program) return;
    inFlight = true;
    const size = view();
    const started = app.scheduler.now();
    const current = program;
    current
      .render({
        width: size.width,
        height: size.height,
        time: clock,
        params: [orbit.yaw + spinAngle(), orbit.pitch, orbit.distance, 0],
        samples: samples(),
      })
      .then(
        (frame) => {
          if (disposed || current !== program) return;
          show(frame);
          frames++;
          gpuMs += app.scheduler.now() - started;
          const elapsed = app.scheduler.now() - fpsSince;
          if (elapsed >= 500) {
            setStatus(`${Math.round((frames * 1000) / elapsed)} fps  ${Math.round(gpuMs / frames)} ms`);
            frames = 0;
            gpuMs = 0;
            fpsSince = app.scheduler.now();
          }
        },
        (err: unknown) => {
          console.error("Depth: render failed", err);
          setStatus("The graphics processor stopped");
        },
      )
      .finally(() => {
        inFlight = false;
      });
  }

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(tick);
    void gpu.describe().then((name) => setHardware(name), () => {});
    void app.storage.read(SETTINGS_KEY).then((text) => {
      const saved = parseSettings(text);
      const found = SCENES.find((candidate) => candidate.id === saved.scene);
      if (found) choose(found);
      if (saved.dither) setDither(saved.dither);
      if (saved.samples) setSamples(saved.samples);
      if (saved.spin !== undefined) setSpin(saved.spin);
      loaded = true;
    });
  });

  onCleanup(() => {
    disposed = true;
    cancelFrame?.();
    for (const compiled of programs.values()) void compiled.then((p) => p.close(), () => {});
  });

  createEffect(
    () => ({ scene: scene().id, dither: dither(), samples: samples(), spin: spin() }),
    (settings: Settings) => {
      if (loaded) void app.storage.write(SETTINGS_KEY, JSON.stringify(settings));
    },
  );

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  function turn(yaw: number, pitch: number): void {
    orbit.yaw += yaw;
    orbit.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, orbit.pitch + pitch));
  }

  function zoom(factor: number): void {
    const current = scene();
    orbit.distance = Math.min(current.maxDistance, Math.max(current.minDistance, orbit.distance * factor));
  }

  let dragFrom: { x: number; y: number } | null = null;

  const onKeyDown = (key: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl || mods.alt) return;
    if (key === "ArrowLeft") turn(-0.15, 0);
    else if (key === "ArrowRight") turn(0.15, 0);
    else if (key === "ArrowUp") turn(0, 0.1);
    else if (key === "ArrowDown") turn(0, -0.1);
    else if (key === "+" || key === "=") zoom(0.9);
    else if (key === "-" || key === "_") zoom(1 / 0.9);
    else if (key === "]" || key === "Tab") choose(stepScene(scene(), 1));
    else if (key === "[") choose(stepScene(scene(), -1));
    else if (key === " ") setPaused((p) => !p);
    else if (key === "Escape" && isFullScreen()) win.setFullScreen(false);
  };

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  createEffect(
    () => ({ scene: scene(), dither: dither(), samples: samples(), spin: spin(), paused: paused(), full: isFullScreen() }),
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
            { type: "separator" },
            { label: "Zoom In", shortcut: "=", onClick: () => zoom(0.85) },
            { label: "Zoom Out", shortcut: "-", onClick: () => zoom(1 / 0.85) },
            {
              label: "Reset Camera",
              onClick: () => {
                orbit = { ...scene().orbit };
                spinClock = 0;
              },
            },
            { type: "separator" },
            {
              type: "submenu",
              label: "Dither",
              items: [
                {
                  type: "radiogroup",
                  value: state.dither,
                  onValueChange: (value) => setDither(value as Dither),
                  items: DITHERS.map((d) => ({ label: d.label, value: d.id })),
                },
              ],
            },
            {
              type: "submenu",
              label: "Quality",
              items: [
                {
                  type: "radiogroup",
                  value: String(state.samples),
                  onValueChange: (value) => setSamples(Number(value)),
                  items: QUALITIES.map((q) => ({ label: `${q.label} (${q.samples * q.samples}× samples)`, value: String(q.samples) })),
                },
              ],
            },
          ],
        },
        {
          label: "Scene",
          items: [
            { label: "Next", shortcut: "]", onClick: () => choose(stepScene(scene(), 1)) },
            { label: "Previous", shortcut: "[", onClick: () => choose(stepScene(scene(), -1)) },
            { type: "separator" },
            {
              type: "radiogroup",
              value: state.scene.id,
              onValueChange: (id) => choose(SCENES.find((candidate) => candidate.id === id)!),
              items: SCENES.map((candidate) => ({ label: candidate.title, value: candidate.id })),
            },
            { type: "separator" },
            { label: state.spin ? "Stop Spinning" : "Spin", onClick: () => setSpin((on) => !on) },
            { label: state.paused ? "Resume" : "Pause", onClick: () => setPaused((on) => !on) },
          ],
        },
      ]);
    },
  );

  const position = () => `${SCENES.indexOf(scene()) + 1}/${SCENES.length}  ${scene().title}`;
  const readout = () => [hardware() ? `WebGPU ${hardware()}` : "WebGPU", paused() ? "Paused" : status()].join("  ");

  return (
    <box
      width={win.width()}
      height={win.height()}
      flexDirection="column"
      background={1}
      tabIndex={0}
      autoFocus
      semantic={{ name: "depth", role: "application" }}
      onKeyDown={onKeyDown}
    >
      <raster
        width={view().width}
        height={view().height}
        revision={revision()}
        semantic={{ name: "scene", role: "preview", value: scene().id }}
        onDragStart={(_x, _y, gx, gy) => {
          dragFrom = { x: gx, y: gy };
        }}
        onDrag={(_x, _y, gx, gy) => {
          if (!dragFrom) return;
          turn(-(gx - dragFrom.x) * DRAG_TURN, (gy - dragFrom.y) * DRAG_TURN);
          dragFrom = { x: gx, y: gy };
        }}
        onDragEnd={() => {
          dragFrom = null;
        }}
        onPaint={(surface) => {
          surface.fill(1);
          surface.blitPixels(pixels, pixelsWidth, pixelsHeight);
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
  id: "depth",
  title: "Depth",
  icon: "depth/icon",
  smallIcon: "depth/icon-16x16",
  sprites,
  requires: ["gpu"],
  about: {
    version: "1.0",
    description:
      "Real-time 3D on the graphics processor, in one bit: raymarched scenes with soft shadows and ambient occlusion, dithered as they're drawn. Drag to turn the camera; [ and ] change the scene.",
  },
  defaultSize: { width: 400, height: 280 },
  minSize: { width: 200, height: 140 },
  scrollable: false,
  resizable: true,
  Component: Depth,
});
