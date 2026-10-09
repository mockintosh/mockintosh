import { Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import type { CursorName } from "../cursor";
import type { Ink, LayoutStyle, PatternName } from "../nodes";
import type { Sprite } from "../sprite";
import { createPress } from "../primitives/press";
import { useRadius } from "../theme";

/** Control Manager default-button ring — outside the face, not inside it. */
const RING = { pen: 3, gap: 1, radius: 8 };
const FACE = { height: 16, padX: 8 };
/** Between an icon and the label after it. */
const ICON_GAP = 4;

export interface ButtonProps {
  name?: string;
  label: string;
  /** Drawn before the label, inverted with it while pressed. */
  icon?: Sprite;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Latched on: drawn inverted, as while pressed, until it is turned off —
   * a mode such as shuffle. The press still inverts it back while held.
   */
  selected?: boolean;
  /** Face type. Defaults to `"body"`. */
  font?: string;
  /** Native point size when `font` is a family with more than one strike. */
  size?: number;
  /** Font Manager bold smear on the label. */
  bold?: boolean;
  /** Font Manager italic shear on the label. */
  italic?: boolean;
  /** Window-style 1px drop shadow (right + below). Defaults on. */
  shadow?: boolean;
  /**
   * Drop the raise while pressed. Defaults on when `shadow` is set.
   * Unshadowed buttons still slide into a reserved 1px slot.
   */
  depress?: boolean;
  /** Face corner radius. Forwards to the inner box. */
  borderRadius?: number;
  /**
   * CDEF default ring outside the face (3px stroke, 1px gap).
   * The face keeps its own border box; this is a wrapping box.
   */
  ring?: boolean;
  /**
   * Paint the ring outside the button's layout box, as the Dialog Manager
   * does, so a default button's face lines up with its neighbours.
   */
  ringOverhang?: boolean;
  /** Named cursor. Buttons leave the host default (arrow) unless set. */
  cursor?: CursorName;
  width?: LayoutStyle["width"];
  /** Face height. Defaults to {@link FACE.height}. */
  height?: LayoutStyle["height"];
  minWidth?: LayoutStyle["minWidth"];
  /**
   * Where the button sits across its container. By default it follows the
   * container's `alignItems` (centred in a row that centres), except that it
   * keeps its own size where the container stretches; `"stretch"` fills.
   */
  alignSelf?: LayoutStyle["alignSelf"];
}

export function Button(props: ButtonProps): JSX.Element {
  const press = createPress(props);
  const shadow = () => props.shadow !== false;
  const depress = () => props.depress ?? shadow();
  const slot = () => (shadow() || depress() ? 1 : 0);
  // Shadowed faces drop 1px by turning the raise off. Unshadowed depress
  // still slides into the reserved slot.
  const inset = () => depress() && press.pressed() && !shadow();
  const radius = useRadius("md");

  // Inverted while pressed, or while latched on and not pressed.
  const inverted = () => press.pressed() !== !!props.selected;
  const background = (): Ink | PatternName =>
    inverted() ? 1 : props.disabled ? "checker" : 0;

  const borderStyle = (): "solid" | "dotted" =>
    props.disabled ? "dotted" : "solid";

  // The outer box only takes the container's alignment. Where the container
  // stretches it may be stretched; the button inside keeps its own size and
  // sits at its start, and is all that's drawn and all that takes a press.
  const fill = () => props.alignSelf === "stretch" || props.width !== undefined;

  return (
    <box width={props.width} alignSelf={props.alignSelf} alignItems={fill() ? "stretch" : "flex-start"}>
      <box
        {...press.rootProps()}
        margin={props.ring && props.ringOverhang ? -(RING.pen + RING.gap) : undefined}
        padding={props.ring ? RING.gap : 0}
        borderColor={props.ring ? 1 : undefined}
        borderWidth={props.ring ? RING.pen : undefined}
        borderRadius={props.ring ? RING.radius : undefined}
        background={props.ring ? 0 : undefined}
        cursor={props.cursor}
      >
        <box
          paddingLeft={inset() ? slot() : 0}
          paddingTop={inset() ? slot() : 0}
          paddingRight={!inset() ? slot() : 0}
          paddingBottom={!inset() ? slot() : 0}
        >
          <box
            width={props.width !== undefined ? "100%" : undefined}
            height={props.height ?? FACE.height}
            minWidth={props.minWidth ?? (props.ring ? 59 : undefined)}
            paddingLeft={FACE.padX}
            paddingRight={FACE.padX}
            background={background()}
            borderColor={1}
            borderWidth={1}
            borderStyle={borderStyle()}
            borderRadius={props.borderRadius ?? radius()}
            shadow={shadow() && !press.pressed()}
            flexDirection="row"
            gap={ICON_GAP}
            justifyContent="center"
            alignItems="center"
          >
            <Show when={props.icon}>
              {(icon) => <image src={icon()} width={icon().width} height={icon().height} mode={inverted() ? "inverted" : "normal"} />}
            </Show>
            {/* An icon-only button has no label, and no gap after its icon. */}
            <Show when={props.label}>
              <text font={props.font ?? "body"} size={props.size} bold={props.bold} italic={props.italic} color={inverted() ? 0 : 1} align="center" verticalAlign="middle" nowrap>
                {props.label}
              </text>
            </Show>
          </box>
        </box>
      </box>
    </box>
  );
}
