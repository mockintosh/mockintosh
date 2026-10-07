import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {
  Errored,
  IMAGE_TYPES,
  Loading,
  MIME,
  Slider,
  alternateFileTypes,
  defineApp,
  encodePng1bit,
  isImageType,
  readImageFile,
  useApp,
  writeSpriteFile,
  type FileDocumentProps,
  type ImageFrame,
  type MenubarItemDef,
} from "@mockintosh/sdk";
import { sprites } from "./trace/icons";
import {
  BLOCK_MAX,
  BLOCK_MIN,
  MAX_BITMAP,
  THRESHOLD_DEFAULT,
  bitmapSize,
  centerInkFrame,
  clampFrameSize,
  detectGrid,
  fitInkFrame,
  frameBitmap,
  traceBitmap,
  type BitmapFrame,
  type PixelGrid,
  type TracedBitmap,
} from "./trace/grid";

const DECODE_MAX = 2048;
const CONTROLS_H = 128;
const FRAME_PRESETS = [16, 32, 48, 64] as const;

type TraceProps = Partial<FileDocumentProps> & Record<string, unknown>;

interface Tune {
  block: number;
  originX: number;
  originY: number;
  threshold: number;
  /** Absent until the user picks a frame; then Fit Ink / presets fill it in. */
  frame: BitmapFrame | null;
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function gridOf(tune: Tune): PixelGrid {
  return { block: tune.block, originX: tune.originX, originY: tune.originY };
}

function placed(bitmapW: number, bitmapH: number, viewW: number, viewH: number) {
  // Leave a 1px ring so the frame border stays visible.
  const fit = Math.min((viewW - 2) / bitmapW, (viewH - 2) / bitmapH);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  const width = Math.max(1, Math.round(bitmapW * scale));
  const height = Math.max(1, Math.round(bitmapH * scale));
  return {
    width,
    height,
    scale: width / bitmapW,
    x: Math.max(1, Math.floor((viewW - width) / 2)),
    y: Math.max(1, Math.floor((viewH - height) / 2)),
  };
}

function Trace(props: TraceProps): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [override, setOverride] = createSignal<{ id: string; title: string } | null>(null);
  const [tune, setTune] = createSignal<Tune | null>(null);

  const fileId = () => override()?.id ?? (typeof props.fileId === "string" ? props.fileId : undefined);
  const docTitle = () => override()?.title ?? (typeof props.title === "string" ? props.title : undefined);

  const source = createMemo(async () => {
    const id = fileId();
    if (!id) return null;
    const frame = await readImageFile(app.fs, app.images, id, { maxWidth: DECODE_MAX, maxHeight: DECODE_MAX });
    return { frame, detected: detectGrid(frame) };
  });

  let bitmap: TracedBitmap | null = null;
  let detected: PixelGrid | null = null;
  let drag: { lx: number; ly: number; cropX: number; cropY: number; scale: number } | null = null;
  let lastBox: { scale: number } | null = null;

  const view = () => ({
    width: win.width(),
    height: Math.max(1, win.height() - CONTROLS_H),
  });

  createEffect(
    () => docTitle(),
    (title) => {
      if (title) win.setTitle(title);
    },
  );

  function settingsFor(found: PixelGrid): Tune {
    return (
      tune() ?? {
        block: found.block,
        originX: found.originX,
        originY: found.originY,
        threshold: THRESHOLD_DEFAULT,
        frame: null,
      }
    );
  }

  function edit(found: PixelGrid, patch: Partial<Tune>): void {
    setTune({ ...settingsFor(found), ...patch });
  }

  function activeFrame(traced: TracedBitmap, settings: Tune): BitmapFrame {
    return settings.frame ?? fitInkFrame(traced);
  }

  function editFrame(found: PixelGrid, traced: TracedBitmap, patch: Partial<BitmapFrame>): void {
    const base = activeFrame(traced, settingsFor(found));
    edit(found, {
      frame: {
        width: clampFrameSize(patch.width ?? base.width),
        height: clampFrameSize(patch.height ?? base.height),
        cropX: patch.cropX ?? base.cropX,
        cropY: patch.cropY ?? base.cropY,
      },
    });
  }

  function snap(): void {
    const found = detected;
    if (!found) return;
    const current = tune();
    setTune({
      block: found.block,
      originX: found.originX,
      originY: found.originY,
      threshold: current?.threshold ?? THRESHOLD_DEFAULT,
      frame: current?.frame ?? null,
    });
  }

  function fitInk(): void {
    const found = detected;
    if (!found || !fullTrace) return;
    edit(found, { frame: fitInkFrame(fullTrace) });
  }

  let fullTrace: TracedBitmap | null = null;

  function setSquare(size: number): void {
    const found = detected;
    if (!found || !fullTrace) return;
    edit(found, { frame: centerInkFrame(fullTrace, size, size) });
  }

  function pictures(): { id: string; name: string }[] {
    const desktop = app.fs.locate("desktop");
    if (!desktop) return [];
    const found = [];
    for (const node of app.fs.children(desktop.id)) {
      if (node.kind === "file" && (node.type === MIME.sprite || isImageType(node.type))) {
        found.push({ id: node.id, name: node.name });
      }
    }
    return found;
  }

  async function openPicture(): Promise<void> {
    const files = pictures();
    if (files.length === 0) {
      await app.os.showDialog({ message: "No pictures on the desktop.", variant: "note" });
      return;
    }
    if (files.length <= 6) {
      const choice = await app.os.showDialog({
        message: "Open which picture?",
        buttons: [...files.map((file) => file.name), "Cancel"],
        variant: "note",
      });
      if (!choice || choice === "Cancel") return;
      const file = files.find((item) => item.name === choice);
      if (file) {
        setTune(null);
        setOverride({ id: file.id, title: file.name });
      }
      return;
    }
    const typed = await app.os.showDialog({
      message: "Name of a picture on the desktop:",
      buttons: ["Cancel", "Open"],
      showInput: true,
      variant: "note",
    });
    const name = typed?.trim();
    if (!name) return;
    const file = files.find((item) => item.name === name);
    if (!file) {
      await app.os.showDialog({ message: `"${name}" isn't on the desktop.`, variant: "note" });
      return;
    }
    setTune(null);
    setOverride({ id: file.id, title: file.name });
  }

  async function saveBitmap(): Promise<void> {
    const traced = bitmap;
    const desktop = app.fs.locate("desktop");
    if (!traced || !desktop) return;
    const base = docTitle() ? stem(docTitle()!) : "Trace";
    try {
      await writeSpriteFile(app.fs, desktop.id, `${base} bitmap`, {
        width: traced.width,
        height: traced.height,
        data: traced.pixels,
      }, { attributes: { icon: "trace/icon" } });
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
        buttons: ["OK"],
      });
    }
  }

  async function exportPng(): Promise<void> {
    const traced = bitmap;
    const download = app.download;
    if (!traced || !download) return;
    const base = docTitle() ? stem(docTitle()!) : "Trace";
    try {
      await download.save({
        name: `${base} bitmap.png`,
        type: "image/png",
        bytes: encodePng1bit(traced.pixels, traced.width, traced.height),
      });
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't export: ${err instanceof Error ? err.message : String(err)}`,
        buttons: ["OK"],
      });
    }
  }

  createEffect(
    () => ({
      fileId: fileId(),
      tuned: tune() !== null,
      canExport: !!app.download,
      frame: tune()?.frame,
    }),
    ({ fileId: id, tuned, canExport }) => {
      const frameItems: MenubarItemDef[] = [
        { label: "Fit Ink", disabled: !id, onClick: () => fitInk() },
        { type: "separator" },
        ...FRAME_PRESETS.map((size) => ({
          label: `${size} x ${size}`,
          disabled: !id,
          onClick: () => setSquare(size),
        })),
      ];
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "Open…", shortcut: "O", onClick: () => void openPicture() },
            { type: "separator" },
            { label: "Save Bitmap", shortcut: "S", disabled: !id, onClick: () => void saveBitmap() },
            ...(canExport
              ? [{ label: "Export…", shortcut: "E", disabled: !id, onClick: () => void exportPng() }]
              : []),
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "Trace",
          items: [
            { label: "Snap to Grid", disabled: !id || !tuned, onClick: snap },
            { type: "separator" },
            ...frameItems,
          ],
        },
      ]);
    },
  );

  const track = () => Math.max(72, view().width - 130);
  const halfTrack = () => Math.max(36, Math.floor(track() / 2) - 28);

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={0}>
      <Show
        when={fileId()}
        fallback={
          <box width={win.width()} height={win.height()} justifyContent="center" alignItems="center" padding={16} flexDirection="column" gap={6}>
            <text font="body" align="center">Drop a picture on</text>
            <text font="body" align="center">this window, or</text>
            <text font="body" align="center">choose File → Open.</text>
          </box>
        }
      >
        <Loading
          fallback={
            <box width={win.width()} height={win.height()} justifyContent="center" alignItems="center">
              <text font="menu" spacing={1}>Opening…</text>
            </box>
          }
        >
          <Errored
            fallback={(err) => (
              <box width={win.width()} height={win.height()} justifyContent="center" alignItems="center" padding={12}>
                <text font="menu" spacing={1} align="center">{err instanceof Error ? err.message : String(err)}</text>
              </box>
            )}
          >
            {(() => {
              const loaded = source();
              const img: ImageFrame | null = loaded?.frame ?? null;
              const found = loaded?.detected ?? null;
              detected = found;
              const settings = found ? settingsFor(found) : null;
              const traced = img && settings ? traceBitmap(img, gridOf(settings), settings.threshold) : null;
              fullTrace = traced;
              const windowFrame = traced && settings ? activeFrame(traced, settings) : null;
              const shown = traced && windowFrame ? frameBitmap(traced, windowFrame) : null;
              bitmap = shown;
              const size = view();
              const tooBig = img && settings && !traced ? bitmapSize(img, gridOf(settings)) : null;
              const revision =
                Math.round((settings?.block ?? 1) * 100) +
                Math.round((settings?.originX ?? 0) * 100) * 1_000 +
                Math.round((settings?.originY ?? 0) * 100) * 1_000_000 +
                (settings?.threshold ?? 0) * 17 +
                (windowFrame?.width ?? 0) * 31 +
                (windowFrame?.height ?? 0) * 97 +
                Math.round(windowFrame?.cropX ?? 0) * 131 +
                Math.round(windowFrame?.cropY ?? 0) * 173;
              return (
                <>
                  <box
                    width={size.width}
                    height={size.height}
                    semantic={{ name: "preview", role: "preview" }}
                    justifyContent="center"
                    alignItems="center"
                    onMouseDown={(lx, ly) => {
                      if (!windowFrame || !lastBox) return;
                      drag = {
                        lx,
                        ly,
                        cropX: windowFrame.cropX,
                        cropY: windowFrame.cropY,
                        scale: lastBox.scale,
                      };
                    }}
                    onDrag={(lx, ly) => {
                      if (!drag || !found || !traced) return;
                      const dx = Math.round((lx - drag.lx) / drag.scale);
                      const dy = Math.round((ly - drag.ly) / drag.scale);
                      editFrame(found, traced, {
                        cropX: drag.cropX - dx,
                        cropY: drag.cropY - dy,
                      });
                    }}
                    onDragEnd={() => {
                      drag = null;
                    }}
                  >
                    <Show
                      when={shown}
                      fallback={
                        <text font="menu" spacing={1} align="center">
                          {tooBig && (tooBig.width > 256 || tooBig.height > 256)
                            ? `${tooBig.width}x${tooBig.height} is too big. Raise Block.`
                            : "Nothing lines up. Nudge Block, X, or Y."}
                        </text>
                      }
                    >
                      {(bits) => (
                        <raster
                          width={size.width}
                          height={size.height}
                          revision={revision}
                          onPaint={(surface) => {
                            const picture = bits();
                            surface.fill(0);
                            const box = placed(picture.width, picture.height, size.width, size.height);
                            lastBox = { scale: box.scale };
                            // Frame border — the canvas the bitmap sits in.
                            for (let x = box.x - 1; x <= box.x + box.width; x++) {
                              surface.setPixel(x, box.y - 1, 1);
                              surface.setPixel(x, box.y + box.height, 1);
                            }
                            for (let y = box.y; y < box.y + box.height; y++) {
                              surface.setPixel(box.x - 1, y, 1);
                              surface.setPixel(box.x + box.width, y, 1);
                            }
                            for (let y = 0; y < box.height; y++) {
                              const sy = Math.min(picture.height - 1, Math.floor((y * picture.height) / box.height));
                              for (let x = 0; x < box.width; x++) {
                                const sx = Math.min(picture.width - 1, Math.floor((x * picture.width) / box.width));
                                const ink = picture.pixels[sy * picture.width + sx] ? 1 : 0;
                                surface.setPixel(box.x + x, box.y + y, ink);
                              }
                            }
                          }}
                        />
                      )}
                    </Show>
                  </box>
                  <box height={1} background={1} />
                  <Show when={settings && found && traced && windowFrame}>
                    <box height={CONTROLS_H - 1} padding={4} flexDirection="column" gap={2} background={0}>
                      <Slider
                        name="block"
                        label="Block"
                        labelWidth={36}
                        value={settings!.block}
                        min={BLOCK_MIN}
                        max={Math.min(BLOCK_MAX, Math.max(8, Math.floor(Math.min(img!.width, img!.height) / 2)))}
                        step={0.05}
                        width={track()}
                        format={(value) => value.toFixed(2)}
                        onChange={(value) => edit(found!, { block: value })}
                      />
                      <box flexDirection="row" gap={6} alignItems="center">
                        <Slider
                          name="origin-x"
                          label="GX"
                          labelWidth={20}
                          value={settings!.originX}
                          min={-32}
                          max={64}
                          step={0.25}
                          width={halfTrack()}
                          format={(value) => value.toFixed(1)}
                          onChange={(value) => edit(found!, { originX: value })}
                        />
                        <Slider
                          name="origin-y"
                          label="GY"
                          labelWidth={20}
                          value={settings!.originY}
                          min={-32}
                          max={64}
                          step={0.25}
                          width={halfTrack()}
                          format={(value) => value.toFixed(1)}
                          onChange={(value) => edit(found!, { originY: value })}
                        />
                      </box>
                      <Slider
                        name="threshold"
                        label="Ink"
                        labelWidth={36}
                        value={settings!.threshold}
                        min={32}
                        max={230}
                        step={2}
                        width={track()}
                        format={(value) => String(Math.round(value))}
                        onChange={(value) => edit(found!, { threshold: value })}
                      />
                      <box flexDirection="row" gap={6} alignItems="center">
                        <Slider
                          name="frame-w"
                          label="W"
                          labelWidth={12}
                          value={windowFrame!.width}
                          min={1}
                          max={Math.min(MAX_BITMAP, Math.max(traced!.width + 16, 64))}
                          step={1}
                          width={halfTrack()}
                          format={(value) => String(Math.round(value))}
                          onChange={(value) => editFrame(found!, traced!, { width: value })}
                        />
                        <Slider
                          name="frame-h"
                          label="H"
                          labelWidth={12}
                          value={windowFrame!.height}
                          min={1}
                          max={Math.min(MAX_BITMAP, Math.max(traced!.height + 16, 64))}
                          step={1}
                          width={halfTrack()}
                          format={(value) => String(Math.round(value))}
                          onChange={(value) => editFrame(found!, traced!, { height: value })}
                        />
                      </box>
                      <box flexDirection="row" gap={6} alignItems="center">
                        <Slider
                          name="crop-x"
                          label="PanX"
                          labelWidth={28}
                          value={windowFrame!.cropX}
                          min={-windowFrame!.width}
                          max={traced!.width}
                          step={1}
                          width={halfTrack()}
                          format={(value) => String(Math.round(value))}
                          onChange={(value) => editFrame(found!, traced!, { cropX: Math.round(value) })}
                        />
                        <Slider
                          name="crop-y"
                          label="PanY"
                          labelWidth={28}
                          value={windowFrame!.cropY}
                          min={-windowFrame!.height}
                          max={traced!.height}
                          step={1}
                          width={halfTrack()}
                          format={(value) => String(Math.round(value))}
                          onChange={(value) => editFrame(found!, traced!, { cropY: Math.round(value) })}
                        />
                        <text font="menu" spacing={1}>{`${windowFrame!.width}x${windowFrame!.height}`}</text>
                      </box>
                    </box>
                  </Show>
                </>
              );
            })()}
          </Errored>
        </Loading>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "trace",
  requires: ["images"],
  title: "Trace",
  icon: "trace/icon",
  sprites,
  about: {
    version: "1.1",
    description: "Recovers a 1-bit bitmap from a screenshot of pixel art.",
  },
  defaultSize: { width: 300, height: 320 },
  minSize: { width: 240, height: 240 },
  scrollable: false,
  resizable: true,
  fileTypes: alternateFileTypes([MIME.sprite, ...IMAGE_TYPES]),
  Component: Trace,
});
