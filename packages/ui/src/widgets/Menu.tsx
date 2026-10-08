import { For } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Overlay, type OverlayAlign } from "./Overlay";
import { useRadius } from "../theme";

export interface MenuItem {
  id?: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
}

export interface MenuProps {
  name?: string;
  open: boolean;
  onDismiss: () => void;
  trigger: JSX.Element;
  items: readonly MenuItem[];
  /** `end` hangs the menu from the trigger's right edge, for a trigger at the right of a bar. */
  align?: OverlayAlign;
}

/** In-window menu. Not the OS menubar. */
export function Menu(props: MenuProps): JSX.Element {
  const radius = useRadius("md");
  return (
    <Overlay open={props.open} onDismiss={props.onDismiss} role="menu" align={props.align} trigger={props.trigger}>
      <box
        semantic={{ name: props.name ?? "menu", role: "menu" }}
        minWidth={100}
        flexDirection="column"
        borderColor={1}
        borderWidth={1}
        borderRadius={radius()}
        background={0}
      >
        <For each={props.items}>
          {(item) => {
            const id = () => item.id ?? item.label;
            return (
              <box
                semantic={{
                  name: props.name ? `${props.name}:${id()}` : id(),
                  role: "menuitem",
                  value: item.checked ? "true" : "false",
                  enabled: !item.disabled,
                }}
                paddingLeft={6}
                paddingRight={8}
                paddingTop={2}
                paddingBottom={2}
                cursor={item.disabled ? "default" : "pointer"}
                onClick={() => {
                  if (item.disabled) return;
                  item.onClick?.();
                  props.onDismiss();
                }}
              >
                <text font="body" color={1} stipple={item.disabled} nowrap>
                  {`${item.checked ? "✓ " : ""}${item.label}`}
                </text>
              </box>
            );
          }}
        </For>
      </box>
    </Overlay>
  );
}
