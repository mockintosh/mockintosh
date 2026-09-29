import { Show, createMemo } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {
  Button,
  PrintPreview,
  PrintScaleSelect,
  Select,
  printDotsToMillimetres,
  printScaleLabel,
  useApp,
  type PrintOrientation,
  type PrintScale,
  type PrintableImage,
} from "@mockintosh/sdk";

export type PrintOrientationChoice = "auto" | PrintOrientation;

export interface PrintSettingsProps {
  image: () => PrintableImage | null;
  scale: () => PrintScale;
  orientation: () => PrintOrientationChoice;
  onScale: (scale: PrintScale) => void;
  onOrientation: (orientation: PrintOrientationChoice) => void;
  printing: () => boolean;
  onPrint: () => void;
  [key: string]: unknown;
}

const PREVIEW_W = 268;
const PREVIEW_H = 168;

export function PrintSettings(props: PrintSettingsProps): JSX.Element {
  const app = useApp();
  const print = app.print!;

  const layout = createMemo(() => {
    const image = props.image();
    if (!image) return null;
    return print.layoutPicture(image, { scale: props.scale(), orientation: props.orientation() });
  });

  const summary = () => {
    const laid = layout();
    if (!laid) return "No photo to print.";
    return `Printed at ${printScaleLabel(laid.scale)}, ${laid.orientation}, ${printDotsToMillimetres(laid.page.height)} mm long`;
  };

  return (
    <box width={app.window.width()} height={app.window.height()} flexDirection="column" padding={8} gap={6} background={0}>
      <box flexDirection="row" alignItems="center" gap={6}>
        <text font="body">Orientation</text>
        <Select
          name="orientation"
          width={120}
          value={props.orientation()}
          onChange={(value) => props.onOrientation(value as PrintOrientationChoice)}
          options={[
            { value: "auto", label: "Auto" },
            { value: "portrait", label: "Portrait" },
            { value: "landscape", label: "Landscape" },
          ]}
        />
      </box>
      <box flexDirection="row" alignItems="center" gap={6}>
        <text font="body">Scale</text>
        <PrintScaleSelect width={120} value={props.scale()} onChange={props.onScale} />
      </box>
      <text font="body">{`${print.paperWidth} dots, ${printDotsToMillimetres(print.paperWidth)} mm`}</text>
      <PrintPreview layout={layout()} width={PREVIEW_W} height={PREVIEW_H} />
      <text font="body">{summary()}</text>
      <Show when={props.image()}>
        <Button label="Print" disabled={props.printing()} onClick={() => props.onPrint()} />
      </Show>
    </box>
  );
}
