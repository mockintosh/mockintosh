import { createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Overlay } from "./Overlay";
import { useRadius } from "../theme";

export interface TooltipProps {
  label: string;
  /** Pixels between the trigger and the caption above it. */
  offset?: number;
  children?: JSX.Element;
}

/**
 * A caption above its trigger while the pointer is over it: white on
 * black, centred, and kept inside the window. Not modal.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const radius = useRadius("sm");

  return (
    <Overlay
      open={open()}
      modal={false}
      side="top"
      offset={props.offset ?? 1}
      align="center"
      role="tooltip"
      trigger={
        <box
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {props.children}
        </box>
      }
    >
      <box
        semantic={{ name: "tooltip", role: "tooltip", value: props.label }}
        paddingLeft={3}
        paddingRight={3}
        paddingTop={2}
        paddingBottom={2}
        borderRadius={radius()}
        background={1}
      >
        <text font="body" color={0} nowrap>{props.label}</text>
      </box>
    </Overlay>
  );
}
