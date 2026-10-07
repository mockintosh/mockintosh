import { For, Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { DialogButton, Spacer, TextInput, createSignal, layoutText, resolveFont } from "@mockintosh/ui";
import type { DialogVariant } from "@mockintosh/sdk";
import { useWindow } from "../windowContext";
import { alertIcon } from "../iconCatalog/catalog";
import { windowFrame } from "../windowGeometry";

export interface DialogProps {
  message: string;
  buttons?: string[];
  showInput?: boolean;
  inputDefault?: string;
  inputMaxLength?: number;
  variant?: DialogVariant;
  resolve: (value: string | null) => void;
}

const ICON_SIZE = 32;
const PADDING = 16;
const GAP = 16;
/** Room between the message and the buttons. */
const BUTTON_GAP = 20;
/** Room for the default ring's 4px overhang above and below the faces. */
const RING_OVERHANG = 4;
/** A 20px button face plus the default ring's overhang. */
const BUTTON_ROW = 20 + 2 * RING_OVERHANG;
const INPUT_ROW = 36;
const WIDTH = 376;

/** Window size that fits the message wrapped beside the icon, plus input and buttons. */
export function dialogSize(options: { message: string; showInput?: boolean }): { width: number; height: number } {
  // The alert frame comes out of the window's width, not its height.
  const contentWidth = WIDTH - 2 * windowFrame({ kind: "alert" });
  const textWidth = contentWidth - PADDING * 2 - ICON_SIZE - GAP;
  const textHeight = layoutText(resolveFont("menu"), options.message, textWidth).height;
  const height = PADDING + Math.max(ICON_SIZE, textHeight) + BUTTON_GAP + BUTTON_ROW + PADDING;
  return { width: WIDTH, height: height + (options.showInput ? INPUT_ROW : 0) };
}

export function DialogApp(props: DialogProps): JSX.Element {
  const win = useWindow();
  const buttons = () => (props.buttons && props.buttons.length > 0 ? props.buttons : ["OK"]);
  const [value, setValue] = createSignal(props.inputDefault ?? "");
  const icon = () => alertIcon(props.variant ?? "stop");
  const defaultLabel = () => buttons()[buttons().length - 1];

  function finish(label: string): void {
    if (props.showInput) props.resolve(label === "Cancel" ? null : value());
    else props.resolve(label);
    win.close();
  }

  return (
    <box
      width={win.width()}
      height={win.height()}
      padding={PADDING}
      flexDirection="column"
      tabIndex={0}
      autoFocus
      onKeyDown={(key) => {
        if (key === "Enter") finish(defaultLabel());
        if (key === "Escape") {
          const cancel = buttons().find((b) => b === "Cancel");
          if (cancel) finish(cancel);
        }
      }}
    >
      <box flexDirection="row" gap={GAP} alignItems="flex-start">
        <Show when={icon()}>
          {(s) => (
            <image
              width={ICON_SIZE}
              height={ICON_SIZE}
              src={{ width: s().width, height: s().height, data: s().data, mask: s().mask }}
            />
          )}
        </Show>
        <text font="menu" wrap flexGrow={1} flexShrink={1} flexBasis={0}>
          {props.message}
        </text>
      </box>
      <Show when={props.showInput}>
        <box marginTop={8}>
          <TextInput
            value={value()}
            onChange={setValue}
            onSubmit={() => finish(defaultLabel())}
            width={win.width() - PADDING * 2}
            maxLength={props.inputMaxLength}
            autoFocus
          />
        </box>
      </Show>
      <Spacer />
      <box flexDirection="row" gap={16} paddingTop={RING_OVERHANG} paddingBottom={RING_OVERHANG}>
        <For each={buttons()}>
          {(label) => (
            <DialogButton label={label} default={label === defaultLabel()} onClick={() => finish(label)} />
          )}
        </For>
      </box>
    </box>
  );
}
