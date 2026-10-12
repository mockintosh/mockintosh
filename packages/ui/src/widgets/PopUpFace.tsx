import type { JSX } from "@mockintosh/ui";
import { fromGrid, type Sprite } from "../sprite";

/** The System 7 pop-up menu's down triangle: 11 wide, 6 tall. */
export const POPUP_TRIANGLE: Sprite = fromGrid(11, 6, [
  "###########",
  ".#########.",
  "..#######..",
  "...#####...",
  "....###....",
  ".....#.....",
]);

/** The triangle's right edge sits this far in from the box's right edge (frame included). */
const TRIANGLE_RIGHT = 6;
/** The shadow starts this far in from the box's far corners. */
const SHADOW_INSET = 3;

export interface PopUpFaceProps {
  /** The box, frame included; the 1px shadow falls outside it, right and below. */
  width: number;
  height: number;
  /** While the menu is down the box inverts. */
  open?: boolean;
  /** Where the label and its icon go: absolutely positioned inside the frame. */
  children?: JSX.Element;
}

/**
 * The face of a System 7 pop-up menu (the popupMenuProc CDEF), as Apple's
 * Standard File dialog draws it: a 1px box with a 1px drop shadow that
 * starts 3px in from the corners, and the down triangle 6px from the right,
 * centred down the box. The label is the caller's, inside the frame.
 */
export function PopUpFace(props: PopUpFaceProps): JSX.Element {
  const ink = () => (props.open ? 0 : 1);
  return (
    <box width={props.width + 1} height={props.height + 1}>
      <box position="absolute" left={props.width} top={SHADOW_INSET} width={1} height={props.height + 1 - SHADOW_INSET} background={1} />
      <box position="absolute" left={SHADOW_INSET} top={props.height} width={props.width + 1 - SHADOW_INSET} height={1} background={1} />
      <box position="absolute" left={0} top={0} width={props.width} height={props.height} background={props.open ? 1 : 0} borderColor={1} borderWidth={1}>
        {props.children}
        <image
          position="absolute"
          left={props.width - 1 - TRIANGLE_RIGHT - POPUP_TRIANGLE.width}
          top={Math.floor((props.height - 2 - POPUP_TRIANGLE.height) / 2)}
          width={POPUP_TRIANGLE.width}
          height={POPUP_TRIANGLE.height}
          src={POPUP_TRIANGLE}
          mode={ink() ? "normal" : "inverted"}
        />
      </box>
    </box>
  );
}
