import { Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {
  Errored,
  Loading,
  IMAGE_TYPES,
  MIME,
  alternateFileTypes,
  defineApp,
  encodePng1bit,
  readImageFile,
  fitNameWithSuffix,
  useApp,
  writeSpriteFile,
  ASCII_DIFFUSE_DEFAULT,
  ASCII_DIRECTIONAL_DEFAULT,
  ASCII_NORMALIZE_DEFAULT,
  ASCII_PUNCH_DEFAULT,
  asciiOptionsRevision,
  isBaselineAscii,
  type AsciiDitherOptions,
  type FileDocumentProps,
  type ImageFrame,
  type MenubarDefinition,
} from "@mockintosh/sdk";
import {
  applyAdjustInPlace,
  BRIGHTNESS_DEFAULT,
  CONTRAST_DEFAULT,
  IDENTITY_ADJUST,
  isIdentityAdjust,
} from "./photobooth/adjust";
import {
  CROP_SCALE_DEFAULT,
  IDENTITY_CROP,
  clampCrop,
  isIdentityCrop,
  sampleCover,
} from "./photobooth/crop";
import { DitherControls } from "./dither/Controls";
import { sprites } from "./dither/icons";
import { createPhotoDitherer, type PhotoDither } from "./photobooth/ditherMode";

/** Palette content size. Tall enough for the ascii row; the OS adds the title bar. */
const CONTROLS_W = 240;
const CONTROLS_H = 168;
const DECODE_MAX = 800;

type DitherProps = Partial<FileDocumentProps> & Record<string, unknown>;

interface MenuState {
  hasFile: boolean;
  canExport: boolean;
  mode: PhotoDither;
  contrast: number;
  brightness: number;
  scale: number;
  panX: number;
  panY: number;
  asciiBaseline: boolean;
  full: boolean;
  controlsOpen: boolean;
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function Dither(props: DitherProps): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [ditherMode, setDitherMode] = createSignal<PhotoDither>("ascii");
  const [contrast, setContrast] = createSignal(CONTRAST_DEFAULT);
  const [brightness, setBrightness] = createSignal(BRIGHTNESS_DEFAULT);
  const [punch, setPunch] = createSignal(ASCII_PUNCH_DEFAULT);
  const [directional, setDirectional] = createSignal(ASCII_DIRECTIONAL_DEFAULT);
  const [normalize, setNormalize] = createSignal(ASCII_NORMALIZE_DEFAULT);
  const [diffuse, setDiffuse] = createSignal(ASCII_DIFFUSE_DEFAULT);
  const [scale, setScale] = createSignal(CROP_SCALE_DEFAULT);
  const [panX, setPanX] = createSignal(IDENTITY_CROP.panX);
  const [panY, setPanY] = createSignal(IDENTITY_CROP.panY);
  const [frame, setFrame] = createSignal(0);
  const [controlsOpen, setControlsOpen] = createSignal(false);

  const isFullScreen = () => win.kind() === "fullscreen";
  const view = () => ({ width: win.width(), height: win.height() });

  let drag: { lx: number; ly: number; panX: number; panY: number } | null = null;
  let dither: ((src: ImageFrame, out: Uint8Array) => void) | null = null;
  let ditherKey = "";
  let scaled: ImageFrame | null = null;
  let bits: Uint8Array | null = null;
  let ready: ImageFrame | null = null;
  /** Id of the palette, while it is open. Shared with the palette's close cleanup. */
  const palette: { id: string | null } = { id: null };
  let viewAlive = true;

  const source = createMemo(async () => {
    const fileId = props.fileId;
    if (!fileId) return null;
    return readImageFile(app.fs, app.images, fileId, { maxWidth: DECODE_MAX, maxHeight: DECODE_MAX });
  });

  createEffect(
    () => props.title,
    (title) => {
      if (title) win.setTitle(String(title));
    },
  );

  function bump(): void {
    setFrame((n) => n + 1);
  }

  function resetAdjust(): void {
    setContrast(IDENTITY_ADJUST.contrast);
    setBrightness(IDENTITY_ADJUST.brightness);
    bump();
  }

  function resetCrop(): void {
    setScale(IDENTITY_CROP.scale);
    setPanX(IDENTITY_CROP.panX);
    setPanY(IDENTITY_CROP.panY);
    bump();
  }

  function asciiOpts(): AsciiDitherOptions {
    return {
      punch: punch(),
      directional: directional(),
      normalize: normalize(),
      diffuse: diffuse(),
    };
  }

  function resetAscii(): void {
    setPunch(ASCII_PUNCH_DEFAULT);
    setDirectional(ASCII_DIRECTIONAL_DEFAULT);
    setNormalize(ASCII_NORMALIZE_DEFAULT);
    setDiffuse(ASCII_DIFFUSE_DEFAULT);
    bump();
  }

  function beginPan(lx: number, ly: number): void {
    drag = { lx, ly, panX: panX(), panY: panY() };
  }

  function movePan(lx: number, ly: number): void {
    if (!drag) return;
    const next = clampCrop({
      scale: scale(),
      panX: drag.panX + (lx - drag.lx),
      panY: drag.panY + (ly - drag.ly),
    });
    setPanX(next.panX);
    setPanY(next.panY);
  }

  function renderBits(src: ImageFrame): Uint8Array {
    const { width, height } = view();
    const mode = ditherMode();
    const ascii = asciiOpts();
    const key = `${mode}|${width}|${height}|${asciiOptionsRevision(ascii)}`;
    if (!dither || ditherKey !== key) {
      ditherKey = key;
      dither = createPhotoDitherer(mode, width, height, ascii);
      scaled = { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
      bits = new Uint8Array(width * height);
    }
    sampleCover(src, scaled!, clampCrop({ scale: scale(), panX: panX(), panY: panY() }));
    applyAdjustInPlace(scaled!, { contrast: contrast(), brightness: brightness() });
    dither(scaled!, bits!);
    return bits!;
  }

  async function saveDithered(): Promise<void> {
    const src = ready;
    if (!src) return;
    const desktop = app.fs.locate("desktop");
    if (!desktop) return;
    const pixels = renderBits(src);
    const { width, height } = view();
    const base = props.title ? stem(String(props.title)) : "Dither";
    try {
      await writeSpriteFile(app.fs, desktop.id, fitNameWithSuffix(base, " 1-bit"), { width, height, data: pixels });
    } catch (e) {
      console.error("Failed to save dithered image:", e);
    }
  }

  async function exportPng(): Promise<void> {
    const src = ready;
    const download = app.download;
    if (!src || !download) return;
    const pixels = renderBits(src);
    const { width, height } = view();
    const base = props.title ? stem(String(props.title)) : "Dither";
    try {
      await download.save({
        name: `${base} 1-bit.png`,
        type: "image/png",
        bytes: encodePng1bit(pixels, width, height),
      });
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't export: ${err instanceof Error ? err.message : String(err)}`,
        buttons: ["OK"],
      });
    }
  }

  function noteControlsClosed(): void {
    palette.id = null;
    if (viewAlive) setControlsOpen(false);
  }

  function closeControls(): void {
    const id = palette.id;
    if (!id) return;
    app.os.closeWindow(id);
  }

  function openControls(): void {
    if (palette.id) return;
    palette.id = app.openWindow({
      kind: "utility",
      title: "",
      size: { width: CONTROLS_W, height: CONTROLS_H },
      position: { x: 480, y: 400 },
      scrollable: false,
      resizable: false,
      Component: DitherControls,
      props: {
        ditherMode,
        setDitherMode: (mode: PhotoDither) => {
          setDitherMode(mode);
          bump();
        },
        contrast,
        setContrast: (value: number) => {
          setContrast(value);
          bump();
        },
        brightness,
        setBrightness: (value: number) => {
          setBrightness(value);
          bump();
        },
        scale,
        setScale: (value: number) => {
          setScale(value);
          bump();
        },
        panX,
        setPanX,
        panY,
        setPanY,
        punch,
        setPunch: (value: number) => {
          setPunch(value);
          bump();
        },
        directional,
        setDirectional,
        normalize,
        setNormalize,
        diffuse,
        setDiffuse,
        snapshot,
        menusFor,
        onClose: noteControlsClosed,
      },
    });
    setControlsOpen(true);
  }

  function snapshot(): MenuState {
    return {
      hasFile: !!props.fileId,
      canExport: !!app.download,
      mode: ditherMode(),
      contrast: contrast(),
      brightness: brightness(),
      scale: scale(),
      panX: panX(),
      panY: panY(),
      asciiBaseline: isBaselineAscii(asciiOpts()),
      full: isFullScreen(),
      controlsOpen: controlsOpen(),
    };
  }

  function menusFor(state: MenuState): MenubarDefinition[] {
    return [
      {
        label: "File",
        items: [
          {
            label: "Save 1-bit",
            shortcut: "S",
            disabled: !state.hasFile,
            onClick: () => {
              void saveDithered();
            },
          },
          ...(state.canExport
            ? [
                {
                  label: "Export…",
                  shortcut: "E",
                  disabled: !state.hasFile,
                  onClick: () => {
                    void exportPng();
                  },
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
            label: state.full ? "Exit Full Screen" : "Full Screen",
            shortcut: "F",
            onClick: () => win.setFullScreen(win.kind() !== "fullscreen"),
          },
          {
            label: state.controlsOpen ? "Hide Controls" : "Show Controls",
            onClick: () => {
              if (palette.id) closeControls();
              else openControls();
            },
          },
        ],
      },
      {
        label: "Adjust",
        items: [
          {
            label: "Reset Tone",
            disabled: isIdentityAdjust({ contrast: state.contrast, brightness: state.brightness }),
            onClick: resetAdjust,
          },
          {
            label: "Reset Crop",
            disabled: isIdentityCrop({ scale: state.scale, panX: state.panX, panY: state.panY }),
            onClick: resetCrop,
          },
          {
            label: "Reset Ascii",
            disabled: state.mode !== "ascii" || state.asciiBaseline,
            onClick: resetAscii,
          },
        ],
      },
      {
        label: "Dithering",
        items: [
          {
            type: "radiogroup",
            value: state.mode,
            onValueChange: (v) => {
              setDitherMode(v as PhotoDither);
              bump();
            },
            items: [
              { label: "Atkinson", value: "atkinson" },
              { label: "Bayer", value: "bayer" },
              { label: "Ascii", value: "ascii" },
            ],
          },
        ],
      },
    ];
  }

  createEffect(snapshot, (state) => {
    app.setMenus(menusFor(state));
  });

  onSettled(() => openControls());

  onCleanup(() => {
    viewAlive = false;
    if (palette.id) app.os.closeWindow(palette.id);
  });

  return (
    <box width={win.width()} height={win.height()} background={0}>
      <Show
        when={props.fileId}
        fallback={
          <box width={win.width()} height={win.height()} justifyContent="center" alignItems="center" padding={16} flexDirection="column" gap={6}>
            <text font="body" align="center">Drop an image onto</text>
            <text font="body" align="center">the desktop, then</text>
            <text font="body" align="center">open it.</text>
          </box>
        }
      >
        <Loading
          fallback={
            <box width={view().width} height={view().height} justifyContent="center" alignItems="center">
              <text font="menu" spacing={1}>Opening…</text>
            </box>
          }
        >
          <Errored
            fallback={(err) => (
              <box width={view().width} height={view().height} justifyContent="center" alignItems="center" padding={12}>
                <text font="menu" spacing={1} align="center">{err instanceof Error ? err.message : String(err)}</text>
              </box>
            )}
          >
          {(() => {
            const src = source();
            ready = src;
            const size = view();
            const pixels = src ? renderBits(src) : null;
            const revision =
              frame() +
              size.width * 1_000_003 +
              size.height * 1_000_019 +
              Math.round(contrast() * 20) +
              Math.round(brightness() + 64) * 80 +
              Math.round(scale() * 50) * 8_000 +
              (panX() + 50) * 400_000 +
              (panY() + 50) * 40_000_000 +
              (ditherMode() === "ascii" ? 1 : ditherMode() === "bayer" ? 2 : 3) +
              asciiOptionsRevision(asciiOpts()) * 17;
            return (
              <box
                width={size.width}
                height={size.height}
                onMouseDown={beginPan}
                onDrag={movePan}
                onDragEnd={() => {
                  drag = null;
                }}
              >
                <raster
                  width={size.width}
                  height={size.height}
                  revision={revision}
                  onPaint={(surface) => {
                    surface.fill(0);
                    if (pixels) surface.blitPixels(pixels, size.width, size.height, 0, 0);
                  }}
                />
              </box>
            );
          })()}
          </Errored>
        </Loading>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "dither",
  requires: ["images"],
  title: "Dither",
  icon: "dither/icon",
  smallIcon: "dither/icon-16x16",
  sprites,
  defaultSize: { width: 288, height: 288 },
  minSize: { width: 120, height: 80 },
  scrollable: false,
  resizable: true,
  fileTypes: alternateFileTypes([MIME.sprite, ...IMAGE_TYPES]),
  Component: Dither,
});
