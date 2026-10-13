import type { JSX } from "@mockintosh/ui";
import { Show } from "solid-js";
import { ditherGradient } from "../nodes";
import { useRadius } from "../theme";
import { Dithered, type DitheredSrc } from "./Dithered";

/** Initials well: 50% → 90% ink, top-left → bottom-right. */
const INITIALS_WELL = ditherGradient(0.5, 0.95, "se");

export interface AvatarProps {
  /** One or two letters when there is no `src`. */
  initials?: string;
  src?: DitheredSrc;
  size?: number;
}

/** 32×32 well. Initials sit on a dithered gray ramp; a photograph goes through Dithered. */
export function Avatar(props: AvatarProps): JSX.Element {
  const size = () => props.size ?? 32;
  const face = () => Math.max(1, size() - 2);
  const letters = () => (props.initials ?? "?").slice(0, 2);
  const radius = useRadius("lg");

  return (
    <box
      semantic={{ role: "img", value: letters() }}
      width={size()}
      height={size()}
      borderColor={1}
      borderWidth={1}
      borderRadius={radius()}
      background={props.src ? 1 : INITIALS_WELL}
      overflow="hidden"
      justifyContent="center"
      alignItems="center"
      alignSelf="flex-start"
    >
      <Show when={props.src}>
        <Dithered src={props.src!} width={face()} height={face()} />
      </Show>
      <Show when={!props.src}>
        <text font="genova" size={9} outline color={1} nowrap>
          {letters()}
        </text>
      </Show>
    </box>
  );
}
