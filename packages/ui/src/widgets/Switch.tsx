import type { JSX } from "@mockintosh/ui";
import { Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useUIServices } from "../services";

const TRACK_W = 28;
const TRACK_H = 16;
const THUMB = 12;
const PAD = 2;
const OFF_X = PAD;
const ON_X = TRACK_W - THUMB - PAD;
const SLIDE_MS = 140;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function thumbX(checked: boolean): number {
  return checked ? ON_X : OFF_X;
}

export interface SwitchProps {
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

/** Pill track, circular thumb. Slides and fills when on. */
export function Switch(props: SwitchProps): JSX.Element {
  const [x, setX] = createSignal(thumbX(props.checked));
  let cancelFrame: (() => void) | undefined;
  let primed = false;
  const { scheduler } = useUIServices();
  onCleanup(() => cancelFrame?.());

  createEffect(
    () => props.checked,
    (checked) => {
      const to = thumbX(checked);
      const from = untrack(x);
      cancelFrame?.();
      if (!primed || !scheduler) {
        primed = true;
        setX(to);
        return;
      }
      const started = scheduler.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / SLIDE_MS);
        setX(Math.round(from + (to - from) * easeOutCubic(t)));
        if (t < 1) cancelFrame = scheduler.requestFrame(tick);
      };
      cancelFrame = scheduler.requestFrame(tick);
    },
  );

  const flip = () => {
    if (!props.disabled) props.onChange(!props.checked);
  };

  return (
    <box
      semantic={{
        name: props.name,
        role: "switch",
        value: String(props.checked),
        enabled: !props.disabled,
      }}
      flexDirection="row"
      gap={6}
      alignItems="center"
      alignSelf="flex-start"
      tabIndex={props.disabled ? undefined : 0}
      cursor={props.disabled ? "default" : "pointer"}
      onClick={flip}
      onKeyDown={(key: string) => {
        if (key === " " || key === "Enter") flip();
      }}
    >
      <box
        width={TRACK_W}
        height={TRACK_H}
        borderColor={1}
        borderWidth={1}
        borderRadius={TRACK_H / 2}
        background={props.checked ? 1 : 0}
      >
        <box
          position="absolute"
          left={x()}
          top={PAD - 1}
          width={THUMB}
          height={THUMB}
          borderRadius={THUMB / 2}
          borderColor={1}
          borderWidth={1}
          background={0}
        />
      </box>
      <Show when={!!props.label}>
        <text font="body" stipple={props.disabled} verticalAlign="middle" nowrap>
          {props.label!}
        </text>
      </Show>
    </box>
  );
}
