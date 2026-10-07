import type { JSX } from "@mockintosh/ui";
import { Button } from "./Button";
import type { ButtonProps } from "./Button";

/** System 7 alert button: 20px Chicago face, 5px corners, at least 59px wide. */
const FACE = { height: 20, radius: 5, minWidth: 59 };

export interface DialogButtonProps extends Pick<ButtonProps, "name" | "label" | "onClick" | "disabled" | "width" | "alignSelf"> {
  /** The default (Return) button: ringed, the ring outside its box. */
  default?: boolean;
}

/**
 * A push button as the Dialog Manager draws it: flat, no shadow, and the
 * default ring painted outside the item so every face in a row lines up.
 */
export function DialogButton(props: DialogButtonProps): JSX.Element {
  return (
    <Button
      name={props.name}
      label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      width={props.width}
      alignSelf={props.alignSelf}
      font="menu"
      height={FACE.height}
      minWidth={FACE.minWidth}
      borderRadius={FACE.radius}
      shadow={false}
      ring={props.default}
      ringOverhang
    />
  );
}
