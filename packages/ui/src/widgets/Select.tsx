import { For, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Overlay } from "./Overlay";
import { PopUpFace } from "./PopUpFace";
import { truncateText } from "../fonts/bridge";

/** The face's height, frame included. */
const HEIGHT = 16;
/** The label's left inside the frame; room kept on the right for the triangle. */
const LABEL_X = 3;
const LABEL_RIGHT = 22;
import { useRadius } from "../theme";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  width?: number;
}

/** System 7 pop-up menu. Exclusive. The kit name is Select; the face is `PopUpFace`. */
export function Select(props: SelectProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const width = () => props.width ?? 140;
  const radius = useRadius("md");

  const label = () =>
    props.options.find((opt) => opt.value === props.value)?.label ?? props.value;

  const enabled = () => props.options.filter((opt) => !opt.disabled && !props.disabled);

  const pick = (value: string) => {
    props.onChange(value);
    setOpen(false);
  };

  const toggle = () => {
    if (!props.disabled) setOpen((on) => !on);
  };

  const step = (dir: 1 | -1) => {
    const list = enabled();
    if (list.length === 0) return;
    const idx = list.findIndex((opt) => opt.value === props.value);
    const next = list[(idx < 0 ? 0 : idx + dir + list.length) % list.length];
    props.onChange(next.value);
  };

  return (
    <Overlay
      open={open()}
      onDismiss={() => setOpen(false)}
      role="listbox"
      onKeyDown={(key) => {
        if (key === "ArrowDown") step(1);
        else if (key === "ArrowUp") step(-1);
        else if (key === "Enter" || key === " ") setOpen(false);
      }}
      trigger={
        <box
          semantic={{
            name: props.name,
            role: "combobox",
            value: props.value,
            enabled: !props.disabled,
          }}
          tabIndex={props.disabled ? undefined : 0}
          cursor={props.disabled ? "default" : "pointer"}
          onClick={toggle}
          onKeyDown={(key: string) => {
            if (key === "Escape" && open()) {
              setOpen(false);
              return;
            }
            if (key === " " || key === "Enter" || key === "ArrowDown") toggle();
          }}
        >
          <PopUpFace width={width()} height={HEIGHT} open={open()}>
            <text
              position="absolute"
              left={LABEL_X}
              top={0}
              width={width() - LABEL_X - LABEL_RIGHT}
              height={HEIGHT - 2}
              font="body"
              verticalAlign="middle"
              color={open() ? 0 : 1}
              stipple={props.disabled}
              nowrap
            >
              {truncateText(label(), width() - LABEL_X - LABEL_RIGHT, "body")}
            </text>
          </PopUpFace>
        </box>
      }
    >
      <box
        minWidth={width()}
        flexDirection="column"
        borderColor={1}
        borderWidth={1}
        borderRadius={radius()}
        background={0}
      >
        <For each={props.options}>
          {(opt) => {
            const selected = () => opt.value === props.value;
            const inert = () => props.disabled || opt.disabled;
            return (
              <box
                semantic={{
                  name: props.name ? `${props.name}:${opt.value}` : opt.value,
                  role: "option",
                  value: opt.value,
                  enabled: !inert(),
                }}
                paddingLeft={4}
                paddingRight={4}
                paddingTop={2}
                paddingBottom={2}
                background={selected() ? 1 : 0}
                cursor={inert() ? "default" : "pointer"}
                onClick={() => {
                  if (!inert()) pick(opt.value);
                }}
              >
                <text font="body" color={selected() ? 0 : 1} stipple={opt.disabled} nowrap>
                  {opt.label}
                </text>
              </box>
            );
          }}
        </For>
      </box>
    </Overlay>
  );
}
