import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {
  Button,
  Slider,
  TextInput,
  defineApp,
  drawPixels,
  drawString,
  fontLineHeight,
  measureText,
  uniqueChildName,
  useApp,
  writeSpriteFile,
  type MenubarItemDef,
  type PrintService,
} from "@mockintosh/sdk";
import { PRINT_SERIES_SIZE, PrintSeries, type PrintSeriesProps } from "./surface/PrintSeries";
import {
  DEFAULT_SEED,
  ExprError,
  PARAMETER_DEFAULT,
  compileSurface,
  type CompiledSurface,
  type SurfaceFn,
} from "./surface/expr";
import {
  DEFAULT_CAMERA,
  DEFAULT_DOMAIN,
  buildScene,
  clampPitch,
  sampleSurface,
  widenRange,
  type HeightGrid,
  type OrbitCamera,
  type ZRange,
} from "./surface/mesh";
import { createFrame, renderScene, type PixelFrame, type RenderMode } from "./surface/render";
import { sprites } from "./surface/icons";

const BAR_H = 22;
const DRAG_RADIANS_PER_PX = 0.012;
const ZOOM_STEP = 1.25;
/** A 100-unit mouse-wheel notch zooms about as far as one ⌘= step. */
const WHEEL_ZOOM_PER_UNIT = Math.log(ZOOM_STEP) / 100;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const RESOLUTIONS = [12, 24, 32, 48] as const;

const PARAM_ROW_H = 18;
const PARAM_PADDING = 2;
const PARAM_MIN = -5;
const PARAM_MAX = 5;
const PARAM_STEP = 0.05;
/** Room for the value text, e.g. `-5.00`. */
const PARAM_VALUE_W = 34;

/** An equation to try. Examples change what is plotted, never how it is viewed. */
interface SurfaceExample {
  label: string;
  source: string;
  /** Pin the z axis instead of fitting it to the surface. */
  zRange?: ZRange;
}

/** A submenu of the Examples menu. */
interface ExampleGroup {
  label: string;
  examples: SurfaceExample[];
}

const EXAMPLE_GROUPS: ExampleGroup[] = [
  { label: "Classic", examples: [
    { label: "Drumhead", source: "cos(2t) cos(pi x / 4) cos(pi y / 4)", zRange: { min: -1.6, max: 1.6 } },
    { label: "Hill", source: "exp(-(x^2 + y^2))" },
    { label: "Rippling Hill", source: "exp(-(x^2 + y^2)) + 0.08 sin(5x + 2t)" },
    { label: "Pond", source: "sin(4r - 3t) / (1 + 2r)" },
    { label: "Saddle", source: "x^2 - y^2" },
    { label: "Egg Crate", source: "sin(2x + t) cos(2y)" },
    { label: "Sombrero", source: "sin(3r) / (3r)" },
    { label: "Twin Peaks", source: "exp(-((x-0.8)^2 + y^2)*2) + exp(-((x+0.8)^2 + y^2)*2) cos(t)" },
  ] },
  { label: "Terrain", examples: [
    { label: "Mountains", source: "fbm(0.5x, 0.5y)" },
    { label: "Ridges", source: "ridged(0.5x, 0.5y)" },
    { label: "Pulsar", source: "exp(-3x^2) (0.4 + fbm(2x, 5y))" },
    { label: "Island", source: "max(fbm(x, y) / 2 + exp(-r^2 / 2) - 0.5, 0)" },
    { label: "Dunes", source: "sin(3x + 2 noise(x, y)) / 4 + fbm(x / 2, y / 2) / 2" },
    { label: "Alien Terrain", source: "fbm(x + fbm(x, y), y + fbm(y + 5, x))" },
    { label: "Rolling Fog", source: "fbm(x, y, 0.3t)" },
    { label: "Clouds", source: "turb(x, y, 0.2t)" },
  ] },
  { label: "With Sliders", examples: [
    { label: "Tunable Ripples", source: "sin(4k r - 2t) / (1 + a r)" },
    { label: "Noisy Hill", source: "exp(-r^2) + a fbm(2k x, 2k y) / 4" },
    { label: "Lissajous", source: "sin(a x + t) cos(b y)" },
  ] },
];

const DEFAULT_EXAMPLE = EXAMPLE_GROUPS.flatMap((group) => group.examples)
  .find((example) => example.label === "Lissajous")!;

function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 0x7fffffff);
}

function formatParam(value: number): string {
  return value.toFixed(2);
}

const PRINT_MARGIN = 8;
const PRINT_FONT = "mono";
/** Two dots per pixel, as Preview prints a saved plot; one-dot lines come out faint. */
const PRINT_SCALE = 2;

/** Greedy word wrap; a word wider than the line breaks between characters. */
function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const ch of word) {
      if (line && measure(line + ch) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface DragStart {
  lx: number;
  ly: number;
  camera: OrbitCamera;
}

function compile(source: string): { surface: CompiledSurface | null; error: string | null } {
  try {
    return { surface: compileSurface(source), error: null };
  } catch (err) {
    if (err instanceof ExprError) return { surface: null, error: `${err.message} (at ${err.at + 1})` };
    throw err;
  }
}

function Surface(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [draft, setDraft] = createSignal(DEFAULT_EXAMPLE.source);
  const [compiled, setCompiled] = createSignal<CompiledSurface | null>(compile(DEFAULT_EXAMPLE.source).surface);
  // The text behind `compiled`, which the field may since have been edited away from.
  const [plotted, setPlotted] = createSignal(DEFAULT_EXAMPLE.source);
  const [fixedRange, setFixedRange] = createSignal<ZRange | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [camera, setCamera] = createSignal<OrbitCamera>(DEFAULT_CAMERA);
  const [mode, setMode] = createSignal<RenderMode>("hidden");
  const [inverted, setInverted] = createSignal(true);
  const [showAxes, setShowAxes] = createSignal(true);
  const [cells, setCells] = createSignal<number>(24);
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  /** Progress text while a print job runs; `null` when idle. */
  const [printing, setPrinting] = createSignal<string | null>(null);
  // Kept by name across edits, so retyping the equation doesn't reset the sliders.
  const [paramValues, setParamValues] = createSignal<Readonly<Record<string, number>>>({});
  const [seed, setSeed] = createSignal(DEFAULT_SEED);

  const params = () => compiled()?.params ?? [];
  const paramLabelWidth = () => Math.max(8, ...params().map((name) => measureText(name, "body")));
  const paramValue = (name: string) => paramValues()[name] ?? PARAMETER_DEFAULT;
  const surfaceFn = createMemo<SurfaceFn | null>(() => {
    const surface = compiled();
    return surface ? surface.bind({ params: paramValues(), seed: seed() }) : null;
  });

  const isFullScreen = () => win.kind() === "fullscreen";
  const paramsHeight = () => (params().length === 0 ? 0 : params().length * PARAM_ROW_H + PARAM_PADDING * 2 + 1);
  // Full screen is just the plot; a window adds two bars plus their 1px
  // dividers, and a slider row per parameter.
  const view = () => ({
    width: win.width(),
    height: isFullScreen() ? win.height() : Math.max(1, win.height() - BAR_H * 2 - 2 - paramsHeight()),
  });

  // Sampling is independent of the camera, so orbiting only re-projects.
  let grid: HeightGrid | null = null;
  let gridKey: { fn: SurfaceFn; cells: number; t: number } | null = null;
  // Held across frames so an animated surface doesn't rescale as it moves;
  // reset when the equation or resolution changes, but not for a slider or a
  // new seed, so dragging an amplitude visibly changes the height.
  let range: ZRange | null = null;
  let rangeKey: { surface: CompiledSurface; cells: number } | null = null;
  let frame: PixelFrame | null = null;
  let drag: DragStart | null = null;

  function currentGrid(): HeightGrid | null {
    const surface = compiled();
    const fn = surfaceFn();
    if (!surface || !fn) return null;
    const t = time();
    const n = cells();
    if (!rangeKey || rangeKey.surface !== surface || rangeKey.cells !== n) {
      range = null;
      rangeKey = { surface, cells: n };
    }
    if (!grid || !gridKey || gridKey.fn !== fn || gridKey.cells !== n || gridKey.t !== t) {
      grid = sampleSurface(fn, DEFAULT_DOMAIN, n, t);
      gridKey = { fn, cells: n, t };
      range = widenRange(range, grid.range);
    }
    return grid;
  }

  /** `heights` seen with the current camera and look, rendered into `target`. */
  function renderGrid(target: PixelFrame, heights: HeightGrid | null, zRange: ZRange | null): PixelFrame {
    const size = { width: target.width, height: target.height };
    const scene = heights
      ? buildScene(heights, zRange, camera(), size)
      : buildScene(sampleSurface(() => NaN, DEFAULT_DOMAIN, 1, 0), null, camera(), size);
    renderScene(scene, target, { mode: mode(), inverted: inverted(), axes: showAxes() });
    return target;
  }

  /** The current frame — same surface, camera and look — rendered into `target`. */
  function renderInto(target: PixelFrame): PixelFrame {
    const heights = currentGrid();
    return renderGrid(target, heights, fixedRange() ?? range);
  }

  function paint(): PixelFrame {
    const size = view();
    if (!frame || frame.width !== size.width || frame.height !== size.height) {
      frame = createFrame(size.width, size.height);
    }
    return renderInto(frame);
  }

  let paints = 0;
  const revision = createMemo(() => {
    surfaceFn();
    fixedRange();
    camera();
    mode();
    inverted();
    showAxes();
    cells();
    time();
    win.width();
    win.height();
    return ++paints;
  });

  function submit(source: string): void {
    const result = compile(source);
    setError(result.error);
    if (result.surface) {
      setCompiled(result.surface);
      setPlotted(source.trim());
      if (!result.surface.usesTime) stop();
    }
  }

  function loadExample(example: SurfaceExample): void {
    setDraft(example.source);
    setTime(0);
    setParamValues({});
    setFixedRange(example.zRange ?? null);
    submit(example.source);
  }

  let cancelFrame: (() => void) | null = null;
  let lastTick: number | null = null;

  function tick(now: number): void {
    if (lastTick !== null) setTime((t) => t + Math.min(0.1, (now - lastTick!) / 1000));
    lastTick = now;
    cancelFrame = app.scheduler.requestFrame(tick);
  }

  function play(): void {
    if (cancelFrame) return;
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

  let seriesDialog: string | null = null;

  // Solid refuses signal writes while disposing, so cleanup can't use `stop`.
  onCleanup(() => {
    cancelTicks();
    if (seriesDialog) app.os.closeWindow(seriesDialog);
  });

  function zoomBy(factor: number): void {
    setCamera((c) => ({ ...c, zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * factor)) }));
  }

  async function savePicture(): Promise<void> {
    const desktop = app.fs.locate("desktop");
    if (!desktop) return;
    const picture = paint();
    try {
      await writeSpriteFile(
        app.fs,
        desktop.id,
        uniqueChildName(app.fs, desktop.id, "Surface Plot"),
        { width: picture.width, height: picture.height, data: new Uint8Array(picture.pixels) },
        { attributes: { icon: "icon/camera" } },
      );
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
        buttons: ["OK"],
      });
    }
  }

  /**
   * One page: the equation, `t` when the surface moves, and the plot `render`
   * draws — at half the paper's resolution, printed 2×.
   */
  async function printSurfacePage(
    print: PrintService,
    t: number | null,
    render: (target: PixelFrame) => PixelFrame,
  ): Promise<void> {
    const width = Math.floor(print.paperWidth / PRINT_SCALE);
    const lineHeight = fontLineHeight(PRINT_FONT);
    const equation = plotted().replace(/^\s*z\s*=\s*/i, "");
    const settings = [
      ...params().map((name) => `${name} = ${formatParam(paramValue(name))}`),
      ...(compiled()?.usesNoise ? [`seed ${seed()}`] : []),
    ];
    const wrap = (text: string) => wrapText(text, width - PRINT_MARGIN * 2, (line) => measureText(line, PRINT_FONT));
    const rows = [
      ...wrap(`z = ${equation}`),
      ...(settings.length ? wrap(settings.join(", ")) : []),
      ...(t === null ? [] : [`t = ${t.toFixed(2)}`]),
    ];
    const plotTop = PRINT_MARGIN * 2 + rows.length * lineHeight;
    const plot = render(createFrame(width, Math.round((width * 3) / 4)));
    await print.printPage(plotTop + plot.height + PRINT_MARGIN, (port) => {
      rows.forEach((row, k) => drawString(port, row, PRINT_MARGIN, PRINT_MARGIN + k * lineHeight, PRINT_FONT));
      drawPixels(port, plot.pixels, plot.width, plot.height, 0, plotTop);
    }, { scale: PRINT_SCALE });
  }

  async function reportPrintError(err: unknown, what = "print"): Promise<void> {
    await app.os.showDialog({
      message: `Couldn't ${what}: ${err instanceof Error ? err.message : String(err)}`,
      buttons: ["OK"],
    });
  }

  async function printPlot(): Promise<void> {
    const print = app.print;
    const surface = compiled();
    if (!print || !surface || printing()) return;
    setPrinting("Printing…");
    try {
      await printSurfacePage(print, surface.usesTime ? time() : null, renderInto);
    } catch (err) {
      await reportPrintError(err);
    } finally {
      setPrinting(null);
    }
  }

  /**
   * One page per `t`. Every frame is sampled first so the whole series shares
   * one z axis, the way playing it back does once the range has settled.
   */
  async function printSeries(times: number[]): Promise<void> {
    const print = app.print;
    const fn = surfaceFn();
    if (!print || !fn || printing() || times.length === 0) return;
    if (!print.connected()) {
      await print.connect();
      if (!print.connected()) return;
    }
    stop();
    const grids = times.map((t) => sampleSurface(fn, DEFAULT_DOMAIN, cells(), t));
    const zRange = fixedRange() ?? grids.reduce<ZRange | null>((r, grid) => widenRange(r, grid.range), range);
    try {
      for (const [k, t] of times.entries()) {
        setPrinting(`Printing ${k + 1} of ${times.length}…`);
        await printSurfacePage(print, t, (target) => renderGrid(target, grids[k]!, zRange));
      }
    } catch (err) {
      await reportPrintError(err, "print the series");
    } finally {
      setPrinting(null);
    }
  }

  function openPrintSeries(): void {
    if (seriesDialog) return;
    const props: PrintSeriesProps = {
      start: time(),
      onPrint: (times) => void printSeries(times),
      onClosed: () => {
        seriesDialog = null;
      },
    };
    seriesDialog = app.openWindow({
      kind: "dialog",
      title: "Print Series",
      size: PRINT_SERIES_SIZE,
      scrollable: false,
      resizable: false,
      Component: PrintSeries,
      props,
    });
  }

  createEffect(
    () => ({
      mode: mode(),
      inverted: inverted(),
      axes: showAxes(),
      full: isFullScreen(),
      cells: cells(),
      playing: playing(),
      printing: printing() !== null,
      animated: compiled()?.usesTime ?? false,
      noisy: compiled()?.usesNoise ?? false,
    }),
    (state) => {
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "Save Picture", shortcut: "S", onClick: () => void savePicture() },
            ...(app.print
              ? [
                  { label: "Print…", shortcut: "P", disabled: state.printing, onClick: () => void printPlot() },
                  {
                    label: "Print Series…",
                    disabled: state.printing || !state.animated,
                    onClick: openPrintSeries,
                  },
                ]
              : []),
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "View",
          items: [
            {
              type: "radiogroup",
              value: state.mode,
              onValueChange: (value) => setMode(value as RenderMode),
              items: [
                { label: "Wireframe", value: "wireframe" },
                { label: "Hidden Line", value: "hidden" },
                { label: "Shaded", value: "shaded" },
                { label: "Ridgeline", value: "ridgeline" },
              ],
            },
            { type: "separator" },
            {
              type: "radiogroup",
              value: state.inverted ? "inverted" : "normal",
              onValueChange: (value) => setInverted(value === "inverted"),
              items: [
                { label: "White on Black", value: "inverted" },
                { label: "Black on White", value: "normal" },
              ],
            },
            { type: "separator" },
            { label: state.axes ? "Hide Axes" : "Show Axes", onClick: () => setShowAxes((on) => !on) },
            {
              label: state.full ? "Exit Full Screen" : "Full Screen",
              shortcut: "F",
              onClick: () => win.setFullScreen(!isFullScreen()),
            },
            { type: "separator" },
            { label: "Zoom In", shortcut: "=", onClick: () => zoomBy(ZOOM_STEP) },
            { label: "Zoom Out", shortcut: "-", onClick: () => zoomBy(1 / ZOOM_STEP) },
            { label: "Reset View", shortcut: "0", onClick: () => setCamera(DEFAULT_CAMERA) },
          ],
        },
        {
          label: "Plot",
          items: [
            {
              label: state.playing ? "Pause" : "Play",
              shortcut: "R",
              disabled: !state.animated,
              onClick: () => (state.playing ? stop() : play()),
            },
            { label: "Rewind", disabled: !state.animated, onClick: () => setTime(0) },
            { label: "New Seed", disabled: !state.noisy, onClick: () => setSeed(randomSeed()) },
            { type: "separator" },
            {
              type: "radiogroup",
              value: String(state.cells),
              onValueChange: (value) => setCells(Number(value)),
              items: RESOLUTIONS.map((n) => ({ label: `${n} × ${n} Grid`, value: String(n) })),
            },
          ],
        },
        {
          label: "Examples",
          items: EXAMPLE_GROUPS.map((group): MenubarItemDef => ({
            type: "submenu",
            label: group.label,
            items: group.examples.map((example) => ({ label: example.label, onClick: () => loadExample(example) })),
          })),
        },
      ]);
    },
  );

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={0}>
      <Show when={!isFullScreen()}>
        <box height={BAR_H} flexDirection="row" alignItems="center" paddingLeft={4} paddingRight={4} gap={4}>
          <text font="menu" spacing={1}>z =</text>
          <TextInput
            name="equation"
            value={draft()}
            onChange={setDraft}
            onSubmit={(source) => {
              setFixedRange(null);
              submit(source);
            }}
            width={Math.max(60, win.width() - 32)}
          />
        </box>
        <box height={1} background={1} />
      </Show>
      <raster
        width={view().width}
        height={view().height}
        revision={revision()}
        semantic={{ name: "plot", role: "preview" }}
        onMouseDown={(lx, ly) => {
          drag = { lx, ly, camera: camera() };
        }}
        onDrag={(lx, ly) => {
          const start = drag;
          if (!start) return;
          setCamera({
            ...start.camera,
            yaw: start.camera.yaw - (lx - start.lx) * DRAG_RADIANS_PER_PX,
            pitch: clampPitch(start.camera.pitch + (ly - start.ly) * DRAG_RADIANS_PER_PX),
          });
        }}
        onDragEnd={() => {
          drag = null;
        }}
        onScroll={(deltaY) => zoomBy(Math.exp(-deltaY * WHEEL_ZOOM_PER_UNIT))}
        onPaint={(surface) => {
          const picture = paint();
          surface.blitPixels(picture.pixels, picture.width, picture.height);
        }}
      />
      <Show when={!isFullScreen() && params().length > 0}>
        <box height={1} background={1} />
        <box flexDirection="column" paddingTop={PARAM_PADDING} paddingBottom={PARAM_PADDING} paddingLeft={4}>
          <For each={params()}>
            {(name) => (
              <box height={PARAM_ROW_H} flexDirection="row" alignItems="center">
                <Slider
                  name={`param-${name}`}
                  label={name}
                  labelWidth={paramLabelWidth()}
                  value={paramValue(name)}
                  min={PARAM_MIN}
                  max={PARAM_MAX}
                  step={PARAM_STEP}
                  width={Math.max(40, win.width() - paramLabelWidth() - PARAM_VALUE_W - 20)}
                  format={formatParam}
                  onChange={(value) => setParamValues((values) => ({ ...values, [name]: value }))}
                />
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={!isFullScreen()}>
        <box height={1} background={1} />
        <box height={BAR_H} flexDirection="row" alignItems="center" paddingLeft={4} paddingRight={4} gap={6}>
          <Button
            name="play"
            label={playing() ? "Pause" : "Play"}
            disabled={!(compiled()?.usesTime ?? false)}
            onClick={() => (playing() ? stop() : play())}
          />
          <text font="menu" spacing={1}>
            {printing() ?? error() ?? (compiled()?.usesTime ? `t = ${time().toFixed(1)}` : "Drag to orbit")}
          </text>
        </box>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "surface",
  title: "Surface",
  icon: "surface/icon",
  sprites,
  about: {
    version: "0.1",
    description: "Plots z = f(x, y, t) as a 3D mesh you can orbit.",
  },
  defaultSize: { width: 320, height: 300 },
  minSize: { width: 200, height: 180 },
  scrollable: false,
  resizable: true,
  Component: Surface,
});
