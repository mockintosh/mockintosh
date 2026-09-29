/**
 * The Print dialog, and the pieces of it an app's own print panel can reuse:
 * the scale pop-up and a preview of the page as it will leave the printer.
 * Everything here asks `PrintService.layoutPicture`, so what the dialog
 * shows is what `printPicture` sends.
 */
import { createMemo, createSignal, onCleanup } from "solid-js";
import { Button, RadioGroup, Select, type JSX, type RasterSurface } from "@mockintosh/ui";
import { useApp } from "./index";
import type {
  AppContext,
  PrintOrientation,
  PrintPictureLayout,
  PrintPictureOptions,
  PrintableImage,
} from "./index";

/** Thermal heads print 203 dots per inch. */
const DOTS_PER_INCH = 203;

/** Millimetres of paper `dots` covers. */
export function printDotsToMillimetres(dots: number): number {
  return Math.round((dots / DOTS_PER_INCH) * 25.4);
}

/**
 * `2x`, or `1.37x` when the picture was stretched or shrunk to the paper.
 * The system fonts have no `×`, so this is a letter x.
 */
export function printScaleLabel(scale: number): string {
  const whole = Math.round(scale);
  return Math.abs(scale - whole) < 0.005 ? `${whole}x` : `${scale.toFixed(2)}x`;
}

// --- Scale pop-up ---

export type PrintScale = NonNullable<PrintPictureOptions["scale"]>;

const SCALE_CHOICES = [
  { value: "auto", label: "Auto" },
  { value: "1", label: printScaleLabel(1) },
  { value: "2", label: printScaleLabel(2) },
  { value: "3", label: printScaleLabel(3) },
  { value: "4", label: printScaleLabel(4) },
  { value: "fit", label: "Fit Width" },
] as const;

function scaleValue(scale: PrintScale): string {
  return typeof scale === "number" ? String(scale) : scale;
}

function parseScale(value: string): PrintScale {
  return value === "auto" || value === "fit" ? value : Number(value);
}

export interface PrintScaleSelectProps {
  value: PrintScale;
  onChange: (scale: PrintScale) => void;
  name?: string;
  width?: number;
}

/** Pop-up of the scales `printPicture` understands: Auto, 1×–4×, Fit Width. */
export function PrintScaleSelect(props: PrintScaleSelectProps): JSX.Element {
  return (
    <Select
      name={props.name ?? "scale"}
      width={props.width ?? 100}
      value={scaleValue(props.value)}
      onChange={(value) => props.onChange(parseScale(value))}
      options={SCALE_CHOICES}
    />
  );
}

// --- Page preview ---

export interface PrintPreviewProps {
  /** The page from `layoutPicture`; blank when null. */
  layout: PrintPictureLayout | null;
  width: number;
  height: number;
}

/** Nearest-neighbour reduction so the page fits the preview. */
function reducePage(page: PrintableImage, maxW: number, maxH: number): PrintableImage {
  const fit = Math.min(1, maxW / page.width, maxH / page.height);
  const width = Math.max(1, Math.floor(page.width * fit));
  const height = Math.max(1, Math.floor(page.height * fit));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(page.height - 1, Math.floor(y / fit));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(page.width - 1, Math.floor(x / fit));
      data[y * width + x] = page.data[sy * page.width + sx]!;
    }
  }
  return { width, height, data };
}

function outline(surface: RasterSurface, x: number, y: number, width: number, height: number): void {
  for (let i = 0; i < width; i++) {
    surface.setPixel(x + i, y, 1);
    surface.setPixel(x + i, y + height - 1, 1);
  }
  for (let i = 0; i < height; i++) {
    surface.setPixel(x, y + i, 1);
    surface.setPixel(x + width - 1, y + i, 1);
  }
}

/** The printed page reduced to fit, framed so the paper's edges show. */
export function PrintPreview(props: PrintPreviewProps): JSX.Element {
  let paints = 0;
  const revision = createMemo(() => {
    void props.layout;
    return ++paints;
  });
  return (
    <raster
      width={props.width}
      height={props.height}
      revision={revision()}
      semantic={{ name: "print-preview", role: "image" }}
      onPaint={(surface) => {
        surface.fill(0);
        const laid = props.layout;
        if (!laid) return;
        const preview = reducePage(laid.page, props.width - 2, props.height - 2);
        const x = Math.floor((props.width - preview.width) / 2);
        const y = Math.floor((props.height - preview.height) / 2);
        surface.blitPixels(preview.data, preview.width, preview.height, x, y);
        outline(surface, x, y, preview.width, preview.height);
      }}
    />
  );
}

// --- The Print dialog ---

export interface PrintDialogRequest {
  image: PrintableImage;
  /** Shown as `Print "<name>"`. */
  documentName?: string;
  /** Settings to start from — the last ones used, say. Orientation defaults to what `"auto"` would choose. */
  options?: PrintPictureOptions;
}

/** What the user chose. Orientation is always explicit: the dialog shows one. */
export interface PrintDialogChoice {
  scale: PrintScale;
  orientation: PrintOrientation;
}

interface PrintDialogProps extends Record<string, unknown> {
  request: PrintDialogRequest;
  settle: (choice: PrintDialogChoice | null) => void;
}

const DIALOG_SIZE = { width: 360, height: 180 } as const;
const PREVIEW_SIZE = { width: 84, height: 84 } as const;
const LABEL_W = 76;

const ORIENTATION_CHOICES = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
] as const;

function PrintDialog(props: PrintDialogProps): JSX.Element {
  const app = useApp();
  const print = app.print!;
  const { image } = props.request;
  const [scale, setScale] = createSignal<PrintScale>(props.request.options?.scale ?? "auto");
  const [orientation, setOrientation] = createSignal<PrintOrientation>(
    props.request.options?.orientation && props.request.options.orientation !== "auto"
      ? props.request.options.orientation
      : print.layoutPicture(image, { scale: scale() }).orientation,
  );
  const layout = createMemo(() => print.layoutPicture(image, { scale: scale(), orientation: orientation() }));
  onCleanup(() => props.settle(null));

  function finish(choice: PrintDialogChoice | null): void {
    props.settle(choice);
    app.window.close();
  }
  const confirm = () => finish({ scale: scale(), orientation: orientation() });
  const cancel = () => finish(null);

  const summary = () => {
    const laid = layout();
    const shrunk = typeof scale() === "number" && laid.scale < (scale() as number);
    const size = `${laid.page.width} x ${laid.page.height} dots, ${printDotsToMillimetres(laid.page.height)} mm long`;
    return `Prints at ${printScaleLabel(laid.scale)}${shrunk ? " (reduced to fit)" : ""}: ${size}`;
  };

  const field = (label: string, control: JSX.Element) => (
    <box flexDirection="row" alignItems="flex-start" gap={4}>
      <box width={LABEL_W}>
        <text font="body" nowrap>{label}</text>
      </box>
      {control}
    </box>
  );

  return (
    <box
      width={app.window.width()}
      height={app.window.height()}
      padding={12}
      flexDirection="column"
      gap={8}
      background={0}
      tabIndex={0}
      autoFocus
      onKeyDown={(key) => {
        if (key === "Enter") confirm();
        if (key === "Escape") cancel();
      }}
    >
      <box flexDirection="row" gap={12}>
        <box flexDirection="column" gap={6} flexGrow={1}>
          <text font="menu" nowrap>
            {props.request.documentName ? `Print "${props.request.documentName}"` : "Print"}
          </text>
          {field("Document:", <text font="body" nowrap>{`${image.width} x ${image.height} pixels`}</text>)}
          {field(
            "Orientation:",
            <RadioGroup
              name="orientation"
              value={orientation()}
              onChange={(value) => setOrientation(value as PrintOrientation)}
              options={ORIENTATION_CHOICES}
            />,
          )}
          {field("Scale:", <PrintScaleSelect value={scale()} onChange={setScale} />)}
        </box>
        <box flexDirection="column" gap={8} alignItems="stretch">
          <Button name="print" label="Print" font="menu" width={70} ring onClick={confirm} />
          <Button name="cancel" label="Cancel" font="menu" width={70} onClick={cancel} />
          <PrintPreview layout={layout()} width={PREVIEW_SIZE.width} height={PREVIEW_SIZE.height} />
        </box>
      </box>
      <text font="body" wrap>{summary()}</text>
    </box>
  );
}

/**
 * Ask how to print `image`: the classic Print dialog, modal, showing the
 * document's size in pixels, portrait or landscape, and the scale. Resolves
 * with the choice — pass it to `printPicture` — or `null` if the user
 * cancels. Needs `app.print`; hide Print… when it is undefined.
 */
export function showPrintDialog(app: AppContext, request: PrintDialogRequest): Promise<PrintDialogChoice | null> {
  if (!app.print) return Promise.reject(new Error("This Macintosh has no printer."));
  return new Promise((resolve) => {
    let settled = false;
    const settle = (choice: PrintDialogChoice | null) => {
      if (settled) return;
      settled = true;
      resolve(choice);
    };
    const props: PrintDialogProps = { request, settle };
    app.openWindow({
      kind: "alert",
      title: "",
      size: DIALOG_SIZE,
      scrollable: false,
      resizable: false,
      Component: PrintDialog,
      props,
    });
  });
}
