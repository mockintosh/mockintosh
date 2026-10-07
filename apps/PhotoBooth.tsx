import { Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, type Ink, type RasterSurface } from "@mockintosh/ui";
import {
  ASCII_DIFFUSE_DEFAULT,
  ASCII_DIRECTIONAL_DEFAULT,
  ASCII_NORMALIZE_DEFAULT,
  ASCII_PUNCH_DEFAULT,
  asciiOptionsRevision,
  coverFrame,
  defineApp,
  isBaselineAscii,
  renderAsciiGlyphAtlas,
  useApp,
  writeSpriteFile,
  type AsciiDitherOptions,
  type CameraSource,
  type ImageFrame,
  type MenubarItemDef,
  type PrintScale,
} from "@mockintosh/sdk";
import { AdjustSlider } from "./photobooth/AdjustSlider";
import { AsciiControls } from "./photobooth/AsciiControls";
import { AsciiCompare, COMPARE_WINDOW } from "./photobooth/AsciiCompare";
import { pictureOverflows, placedOrigin, type Point } from "./photobooth/pan";
import { photoSize, photoSizeLabel, type PhotoSizeId } from "./photobooth/photoSize";
import { PrintSettings, type PrintOrientationChoice, type PrintSettingsProps } from "./photobooth/PrintSettings";
import {
  applyAdjustInPlace,
  BRIGHTNESS_DEFAULT,
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  CONTRAST_DEFAULT,
  CONTRAST_MAX,
  CONTRAST_MIN,
} from "./photobooth/adjust";
import { createPhotoDitherer, type PhotoDither } from "./photobooth/ditherMode";
import {
  ensurePhotoLibrary,
  findPhotoLibrary,
  listStoredPhotos,
  storePhoto,
} from "./photobooth/library";

/** Viewfinder size in the app's own (windowed) window. */
const PREVIEW = 288;
const BAR_H = 40;
const COUNTDOWN_SECS = 3;
const CAPTURE_INTERVAL_MS = 66;

/** A 1-byte-per-pixel picture: photos keep the viewfinder size they were taken at. */
interface Photo {
  pixels: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  /** Set once the picture has a sprite file in the library. */
  fileId?: string;
}

interface Size {
  width: number;
  height: number;
}

/** Paint a picture in the surface on a flat `fill`. `pan` drags it off centre when it is larger than the view. */
function paintPicture(surface: RasterSurface, picture: Photo | null, view: Size, fill: Ink, pan: Point): void {
  surface.fill(fill);
  if (!picture) return;
  const origin = placedOrigin(picture, view, pan);
  surface.blitPixels(picture.pixels, picture.width, picture.height, origin.x, origin.y);
}

function photoDateLabel(photo: Photo): string {
  const date = new Date(photo.timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function PhotoBooth(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { print } = app;

  const [loading, setLoading] = createSignal(true);
  const [errorText, setErrorText] = createSignal("");
  const [countdown, setCountdown] = createSignal<number | null>(null);
  const [viewingPhoto, setViewingPhoto] = createSignal<number | null>(null);
  const [photos, setPhotos] = createSignal<Photo[]>([]);
  const [flash, setFlash] = createSignal(false);
  const [printing, setPrinting] = createSignal(false);
  const [ditherMode, setDitherMode] = createSignal<PhotoDither>("atkinson");
  const [showGlyphs, setShowGlyphs] = createSignal(false);
  const [contrast, setContrast] = createSignal(CONTRAST_DEFAULT);
  const [brightness, setBrightness] = createSignal(BRIGHTNESS_DEFAULT);
  const [punch, setPunch] = createSignal(ASCII_PUNCH_DEFAULT);
  const [directional, setDirectional] = createSignal(ASCII_DIRECTIONAL_DEFAULT);
  const [normalize, setNormalize] = createSignal(ASCII_NORMALIZE_DEFAULT);
  const [diffuse, setDiffuse] = createSignal(ASCII_DIFFUSE_DEFAULT);
  const [frame, setFrame] = createSignal(0);
  const [photoSizeId, setPhotoSizeId] = createSignal<PhotoSizeId>("square");
  const [cameraAspect, setCameraAspect] = createSignal(4 / 3);
  const [pan, setPan] = createSignal<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = createSignal(false);
  const [printScale, setPrintScale] = createSignal<PrintScale>("auto");
  const [printOrientation, setPrintOrientation] = createSignal<PrintOrientationChoice>("auto");

  const isFullScreen = () => win.kind() === "fullscreen";
  /** The viewfinder fills the window above the button bar — the whole screen in full screen. */
  const view = (): Size => ({ width: win.width(), height: win.height() - BAR_H });

  let camera: CameraSource | null = null;
  let live: Photo | null = null;
  let scaled: ImageFrame | null = null;
  let dither: ((frame: ImageFrame, out: Uint8Array) => void) | null = null;
  let ditherKey = "";
  let cancelFrame: (() => void) | null = null;
  let countdownTimer: ReturnType<typeof setTimeout> | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCapture = 0;
  let atlas: Uint8Array | null = null;
  let libraryQueue: Promise<void> = Promise.resolve();

  function enqueue(task: () => Promise<void>): void {
    libraryQueue = libraryQueue.then(task, task).catch((err) => {
      console.error("Photo Booth library:", err);
    });
  }
  let atlasW = 0;
  let atlasH = 0;
  let drag: { x: number; y: number; panX: number; panY: number } | null = null;

  /** Capture size from the Photo Size menu, not the window. */
  function chosenSize(): Size {
    const paper = print?.paperWidth ?? 576;
    return photoSize(photoSizeId(), paper, cameraAspect());
  }

  function stopLoop(): void {
    cancelFrame?.();
    cancelFrame = null;
  }

  function captureLoop(now: number): void {
    if (!win.isActive() || loading() || errorText() || viewingPhoto() !== null || showGlyphs()) {
      cancelFrame = app.scheduler.requestFrame(captureLoop);
      return;
    }
    const src = camera?.frame() ?? null;
    if (src && src.height > 0) {
      const next = src.width / src.height;
      if (Math.abs(next - cameraAspect()) > 0.002) setCameraAspect(next);
    }
    const { width, height } = chosenSize();
    if (src && width > 0 && height > 0 && now - lastCapture >= CAPTURE_INTERVAL_MS) {
      const mode = ditherMode();
      const ascii = asciiOpts();
      const key = `${mode}|${width}|${height}|${asciiOptionsRevision(ascii)}`;
      if (!dither || !scaled || ditherKey !== key) {
        ditherKey = key;
        dither = createPhotoDitherer(mode, width, height, ascii);
        scaled = { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
        live = { pixels: new Uint8Array(width * height), width, height, timestamp: 0 };
      }
      coverFrame(src, scaled, { mirror: true });
      applyAdjustInPlace(scaled, { contrast: contrast(), brightness: brightness() });
      dither(scaled, live!.pixels);
      lastCapture = now;
      setFrame((n) => n + 1);
    }
    cancelFrame = app.scheduler.requestFrame(captureLoop);
  }

  async function startCamera(): Promise<void> {
    try {
      camera = await app.camera!.open({ facing: "user" });
      setLoading(false);
      stopLoop();
      cancelFrame = app.scheduler.requestFrame(captureLoop);
    } catch {
      setErrorText("Camera access denied.");
      setLoading(false);
    }
  }

  /** The last dithered camera frame, as a picture. */
  function liveFrame(): Photo | null {
    return live;
  }

  function takePhoto(): void {
    const live = liveFrame();
    if (!live) return;
    const shot: Photo = {
      pixels: new Uint8Array(live.pixels),
      width: live.width,
      height: live.height,
      timestamp: Date.now(),
    };
    setFlash(true);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setFlash(false), 120);
    enqueue(async () => {
      try {
        const folder = await ensurePhotoLibrary(app.fs, app.storage);
        const stored = await storePhoto(app.fs, folder.id, shot);
        setPhotos((prev) => [...prev, { ...shot, fileId: stored.fileId, timestamp: stored.timestamp }]);
      } catch (err) {
        console.error("Failed to keep photo:", err);
        setPhotos((prev) => [...prev, shot]);
      }
    });
  }

  function startCountdown(): void {
    if (countdown() !== null || loading() || errorText()) return;
    let remaining = COUNTDOWN_SECS;
    setCountdown(remaining);
    const tick = () => {
      remaining--;
      if (remaining <= 0) {
        setCountdown(null);
        takePhoto();
      } else {
        setCountdown(remaining);
        countdownTimer = setTimeout(tick, 1000);
      }
    };
    countdownTimer = setTimeout(tick, 1000);
  }

  async function savePhoto(photo: Photo): Promise<void> {
    const name = `Photo ${photoDateLabel(photo)}`;
    const desktop = app.fs.locate("desktop");
    if (!desktop) return;
    try {
      await writeSpriteFile(
        app.fs,
        desktop.id,
        name,
        { width: photo.width, height: photo.height, data: photo.pixels },
        { attributes: { icon: "icon/photobooth-smr-32" } }
      );
    } catch (e) {
      console.error("Failed to save photo:", e);
    }
  }

  async function printPhoto(photo: Photo): Promise<void> {
    if (!print || printing()) return;
    setPrinting(true);
    try {
      await print.printPicture(
        { width: photo.width, height: photo.height, data: photo.pixels },
        { scale: printScale(), orientation: printOrientation() },
      );
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't print: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPrinting(false);
    }
  }

  function toggleFullScreen(): void {
    win.setFullScreen(!isFullScreen());
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
  }

  function openCompare(): void {
    app.openWindow({
      title: "ASCII Compare",
      size: { width: COMPARE_WINDOW.width, height: COMPARE_WINDOW.height },
      scrollable: false,
      resizable: false,
      Component: AsciiCompare,
    });
  }

  function openPrintSettings(): void {
    const settings: PrintSettingsProps = {
      image: () => {
        const photo = viewing();
        return photo ? { width: photo.width, height: photo.height, data: photo.pixels } : null;
      },
      scale: printScale,
      orientation: printOrientation,
      onScale: setPrintScale,
      onOrientation: setPrintOrientation,
      printing,
      onPrint: () => {
        const photo = viewing();
        if (photo) void printPhoto(photo);
      },
    };
    app.openWindow({
      kind: "utility",
      title: "Print Settings",
      size: { width: 284, height: 340 },
      scrollable: false,
      resizable: false,
      Component: PrintSettings,
      props: settings,
    });
  }

  createEffect(
    () => ({
      viewing: viewingPhoto(),
      counting: countdown() !== null,
      loading: loading(),
      errorText: errorText(),
      isFullScreen: isFullScreen(),
      printing: printing(),
      ditherMode: ditherMode(),
      showGlyphs: showGlyphs(),
      contrast: contrast(),
      brightness: brightness(),
      punch: punch(),
      directional: directional(),
      normalize: normalize(),
      diffuse: diffuse(),
      photoSizeId: photoSizeId(),
      cameraAspect: cameraAspect(),
      paper: print?.paperWidth,
    }),
    ({ viewing, counting, loading: isLoading, errorText: err, isFullScreen: full, printing: busy, ditherMode: mode, showGlyphs: glyphs, contrast: contrastAmt, brightness: brightAmt }) => {
    const ascii = asciiOpts();
    const toneDefault = contrastAmt === CONTRAST_DEFAULT && brightAmt === BRIGHTNESS_DEFAULT;
    const fileItems: MenubarItemDef[] = [
      {
        label: "Take Photo",
        shortcut: "T",
        disabled: counting || viewing !== null || isLoading || !!err || glyphs,
        onClick: () => startCountdown(),
      },
      {
        label: "Compare Reference",
        shortcut: "R",
        onClick: openCompare,
      },
    ];
    if (print) {
      fileItems.push(
        { type: "separator" },
        {
          label: "Print…",
          shortcut: "P",
          disabled: viewing === null || busy,
          onClick: () => {
            const photo = viewing !== null ? photos()[viewing] : undefined;
            if (photo) void printPhoto(photo);
          },
        },
        {
          label: "Print Settings…",
          disabled: viewing === null,
          onClick: openPrintSettings,
        },
      );
    }
    fileItems.push({ type: "separator" }, { label: "Quit", shortcut: "Q", onClick: () => app.quit() });
    const sizeIds: PhotoSizeId[] = print ? ["square", "wide", "printer", "lying"] : ["square", "wide"];
    const paper = print?.paperWidth ?? 576;
    app.setMenus([
      { label: "File", items: fileItems },
      {
        label: "View",
        items: [
          {
            label: full ? "Exit Full Screen" : "Full Screen",
            shortcut: "F",
            onClick: toggleFullScreen,
          },
          {
            label: glyphs ? "Hide Character Set" : "Character Set",
            onClick: () => {
              setShowGlyphs((on) => !on);
              setFrame((n) => n + 1);
            },
          },
        ],
      },
      {
        label: "Photo Size",
        items: [
          {
            type: "radiogroup",
            value: photoSizeId(),
            onValueChange: (value) => setPhotoSizeId(value as PhotoSizeId),
            items: sizeIds.map((id) => ({
              label: photoSizeLabel(id, photoSize(id, paper, cameraAspect())),
              value: id,
            })),
          },
        ],
      },
      {
        label: "Adjust",
        items: [
          {
            label: "Reset Tone",
            disabled: toneDefault,
            onClick: () => {
              setContrast(CONTRAST_DEFAULT);
              setBrightness(BRIGHTNESS_DEFAULT);
            },
          },
          {
            label: "Reset Ascii",
            disabled: mode !== "ascii" || isBaselineAscii(ascii),
            onClick: resetAscii,
          },
        ],
      },
      {
        label: "Dithering",
        items: [
          {
            type: "radiogroup",
            value: mode,
            onValueChange: (v) => setDitherMode(v as PhotoDither),
            items: [
              { label: "Atkinson", value: "atkinson" },
              { label: "Bayer", value: "bayer" },
              { label: "Thermal", value: "thermal" },
              { label: "Ascii", value: "ascii" },
            ],
          },
        ],
      },
    ]);
    },
  );

  onSettled(() => {
    void startCamera();
    enqueue(async () => {
      const folder = await findPhotoLibrary(app.fs, app.storage);
      if (!folder) return;
      const loaded = await listStoredPhotos(app.fs, folder.id);
      const ids = new Set(loaded.map((photo) => photo.fileId));
      setPhotos((prev) => [...loaded, ...prev.filter((photo) => !photo.fileId || !ids.has(photo.fileId))]);
    });
  });

  onCleanup(() => {
    stopLoop();
    if (countdownTimer) clearTimeout(countdownTimer);
    if (flashTimer) clearTimeout(flashTimer);
    camera?.close();
    camera = null;
  });

  createEffect(
    () => ({ size: photoSizeId(), viewing: viewingPhoto(), width: win.width(), height: win.height() }),
    () => {
      setPan({ x: 0, y: 0 });
    },
  );

  const viewing = () => {
    const i = viewingPhoto();
    return i !== null ? photos()[i] : undefined;
  };

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={0}>
      <box width={view().width} height={view().height} position="relative">
        <raster
          width={view().width}
          height={view().height}
          revision={frame()}
          cursor={pictureOverflows(viewing() ?? liveFrame() ?? chosenSize(), view()) ? (dragging() ? "grabbing" : "grab") : "arrow"}
          onDragStart={(_lx, _ly, gx, gy) => {
            const offset = pan();
            drag = { x: gx, y: gy, panX: offset.x, panY: offset.y };
            setDragging(true);
          }}
          onDrag={(_lx, _ly, gx, gy) => {
            if (!drag) return;
            setPan({ x: drag.panX + gx - drag.x, y: drag.panY + gy - drag.y });
            setFrame((n) => n + 1);
          }}
          onDragEnd={() => {
            drag = null;
            setDragging(false);
          }}
          onPaint={(surface) => {
            const size = { width: surface.rect.width, height: surface.rect.height };
            if (showGlyphs()) {
              if (!atlas || atlasW !== size.width || atlasH !== size.height) {
                atlas = renderAsciiGlyphAtlas(size.width, size.height);
                atlasW = size.width;
                atlasH = size.height;
              }
              surface.fill(0);
              surface.blitPixels(atlas, size.width, size.height, 0, 0);
              return;
            }
            if (flash()) {
              paintPicture(surface, null, size, 0, pan());
              return;
            }
            paintPicture(surface, viewing() ?? liveFrame(), size, 0, pan());
          }}
        />
        <Show when={viewingPhoto() === null && !showGlyphs() && !loading() && !errorText()}>
          <box
            position="absolute"
            left={0}
            bottom={0}
            width={view().width}
            padding={4}
            flexDirection="column"
            gap={2}
            background={0}
          >
            <AdjustSlider
              name="contrast"
              label="Contrast"
              labelWidth={48}
              value={contrast()}
              min={CONTRAST_MIN}
              max={CONTRAST_MAX}
              trackWidth={Math.max(80, view().width - 120)}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={setContrast}
            />
            <AdjustSlider
              name="brightness"
              label="Bright"
              labelWidth={48}
              value={brightness()}
              min={BRIGHTNESS_MIN}
              max={BRIGHTNESS_MAX}
              step={2}
              trackWidth={Math.max(80, view().width - 120)}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              onChange={setBrightness}
            />
            <Show when={ditherMode() === "ascii"}>
              <AsciiControls
                punch={punch()}
                directional={directional()}
                normalize={normalize()}
                diffuse={diffuse()}
                trackWidth={Math.max(80, view().width - 120)}
                labelWidth={48}
                onPunch={setPunch}
                onDirectional={setDirectional}
                onNormalize={setNormalize}
                onDiffuse={setDiffuse}
              />
            </Show>
          </box>
        </Show>
        <Show when={loading()}>
          <box position="absolute" left={0} top={0} width={view().width} height={view().height} justifyContent="center" alignItems="center">
            <box background={0} padding={2}>
              <text font="menu" spacing={1}>Initializing camera...</text>
            </box>
          </box>
        </Show>
        <Show when={!!errorText()}>
          <box position="absolute" left={0} top={0} width={view().width} height={view().height} justifyContent="center" alignItems="center">
            <box background={0} padding={2}>
              <text font="menu" spacing={1}>{errorText()}</text>
            </box>
          </box>
        </Show>
        <Show when={countdown() !== null && countdown()! > 0}>
          <box position="absolute" left={0} top={0} width={view().width} height={view().height} justifyContent="center" alignItems="center">
            <box
              width={28}
              height={24}
              background={0}
              borderColor={1}
              borderWidth={1}
              justifyContent="center"
              alignItems="center"
            >
              <text font="menu" spacing={1} align="center">{String(countdown())}</text>
            </box>
          </box>
        </Show>
      </box>
      <box height={1} background={1} />
      <box height={BAR_H - 1} padding={8} flexDirection="row" alignItems="center" gap={4} background={0}>
        <Show
          when={viewingPhoto() === null}
          fallback={
            <>
              <Button
                label="Delete"
                onClick={() => {
                  const i = viewingPhoto();
                  if (i === null) return;
                  const photo = photos()[i];
                  enqueue(async () => {
                    if (photo.fileId) await app.fs.remove(photo.fileId);
                    const next = photos().filter((item) => (photo.fileId ? item.fileId !== photo.fileId : item !== photo));
                    setPhotos(next);
                    setViewingPhoto(next.length > 0 ? Math.min(i, next.length - 1) : null);
                  });
                }}
              />
              <Button
                label="Save"
                onClick={() => {
                  const photo = viewing();
                  if (photo) void savePhoto(photo);
                }}
              />
              <Show when={print}>
                <Button
                  label="Print"
                  disabled={printing()}
                  onClick={() => {
                    const photo = viewing();
                    if (photo) void printPhoto(photo);
                  }}
                />
              </Show>
              <Show when={(viewingPhoto() ?? 0) > 0}>
                <Button label="<" onClick={() => setViewingPhoto((i) => (i ?? 1) - 1)} />
              </Show>
              <Show when={(viewingPhoto() ?? 0) < photos().length - 1}>
                <Button label=">" onClick={() => setViewingPhoto((i) => (i ?? 0) + 1)} />
              </Show>
              <box flexGrow={1} />
              <text font="body">{`${(viewingPhoto() ?? 0) + 1}/${photos().length}`}</text>
              <Button label="Back" onClick={() => setViewingPhoto(null)} />
            </>
          }
        >
          <box flexGrow={1} />
          <Button
            label={countdown() !== null ? String(countdown()) : "Snap"}
            disabled={countdown() !== null || loading() || !!errorText() || showGlyphs()}
            onClick={() => startCountdown()}
          />
          <box flexGrow={1} />
          <Show when={photos().length > 0}>
            <Button
              label={`${photos().length} pic${photos().length > 1 ? "s" : ""}`}
              onClick={() => setViewingPhoto(photos().length - 1)}
            />
          </Show>
        </Show>
      </box>
    </box>
  );
}

export default defineApp({
  id: "photobooth",
  requires: ["camera"],
  title: "Photo Booth",
  icon: "icon/photobooth-smr-32",
  defaultSize: { width: PREVIEW, height: PREVIEW + BAR_H },
  scrollable: false,
  resizable: false,
  Component: PhotoBooth,
});
