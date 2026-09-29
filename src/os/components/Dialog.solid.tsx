import { For, Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, Spacer, TextInput, createSignal } from "@mockintosh/ui";
import type { DialogVariant } from "@mockintosh/sdk";
import { useWindow } from "../windowContext";
import { alertIcon } from "../iconCatalog/catalog";

export interface DialogProps {
  message: string;
  buttons?: string[];
  showInput?: boolean;
  inputDefault?: string;
  variant?: DialogVariant;
  resolve: (value: string | null) => void;
}

const ICON_SIZE = 32;

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
      padding={16}
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
      <box flexDirection="row" gap={16} alignItems="flex-start">
        <Show when={icon()}>
          {(s) => (
            <image
              width={ICON_SIZE}
              height={ICON_SIZE}
              src={{ width: s().width, height: s().height, data: s().data, mask: s().mask }}
            />
          )}
        </Show>
        <text font="menu" wrap flexGrow={1}>
          {props.message}
        </text>
      </box>
      <Show when={props.showInput}>
        <box marginTop={8}>
          <TextInput
            value={value()}
            onChange={setValue}
            onSubmit={() => finish(defaultLabel())}
            width={win.width() - 32}
            autoFocus
          />
        </box>
      </Show>
      <Spacer />
      <box flexDirection="row" gap={16}>
        <For each={buttons()}>
          {(label) => (
            <Button
              label={label}
              font="menu"
              height={20}
              borderRadius={5}
              ring={label === defaultLabel()}
              onClick={() => finish(label)}
            />
          )}
        </For>
      </box>
    </box>
  );
}
