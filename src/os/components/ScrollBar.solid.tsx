/**
 * A scroll bar as the Control Manager's scrollBarProc draws it: two 16×16
 * arrows, the gray track between them while there is anything to scroll,
 * and its white box. Window chrome and the shell's own lists (the Open
 * dialog's) all draw it here, so they share one geometry.
 *
 * The bar is 16px across, from its separator line to the container's frame
 * line, which it overlaps; along its length it runs from one edge line to
 * the other, inclusive, so each arrow's outline lands on the container's
 * rule. Position the bar at its separator and the first edge line.
 */
import { Show, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import type { Sprite } from "@mockintosh/ui";
import { useOS } from "../context";

export const SCROLL_BAR_WIDTH = 16;
const ARROW = SCROLL_BAR_WIDTH;
/** The Control Manager's thumb: a 16px box, whatever the proportion. */
const THUMB = 16;

export interface ScrollBarProps {
  orientation: "vertical" | "horizontal";
  left: number;
  top: number;
  /** From the first edge line to the last, both included. */
  length: number;
  value: number;
  max: number;
  /**
   * How much of the whole is in view, 0…1, for a box sized to it (at least
   * 16px). Omitted, the box is the classic fixed 16px.
   */
  proportion?: number;
  /** An arrow was clicked: -1 toward the start, +1 toward the end. */
  onStep: (direction: -1 | 1) => void;
  /** The gray track was clicked on one side of the box. */
  onPage?: (direction: -1 | 1) => void;
  /** The box was dragged to `value`. */
  onDrag: (value: number) => void;
  /** Name for the semantic tree, so tests and the accessibility layer can find the bar. */
  name?: string;
}

export function ScrollBar(props: ScrollBarProps): JSX.Element {
  const os = useOS();
  const vertical = () => props.orientation === "vertical";
  const track = () => Math.max(0, props.length - 2 * ARROW);
  const thumb = () =>
    props.proportion === undefined ? Math.min(track(), THUMB) : Math.min(track(), Math.max(THUMB, Math.floor(props.length * props.proportion)));
  const thumbAt = () => ARROW + Math.floor(((track() - thumb()) * Math.min(props.value, props.max)) / Math.max(1, props.max));

  let pressAt = 0;
  let pressThumb = 0;
  const along = (x: number, y: number) => (vertical() ? y : x);
  /** A rect along the bar from `start` for `size`, `inset` in from the separator. */
  const rect = (start: number, size: number, inset: number, cross: number) =>
    vertical()
      ? { left: inset, top: start, width: cross, height: size }
      : { left: start, top: inset, width: size, height: cross };

  const sprite = (end: "start" | "end", pressed: boolean): Sprite | undefined => {
    const name = vertical() ? (end === "start" ? "up" : "down") : end === "start" ? "left" : "right";
    return os.sprites.get(`chrome/${name}${pressed ? "-pressed" : ""}`);
  };

  return (
    <box
      position="absolute"
      left={props.left}
      top={props.top}
      {...(vertical() ? { width: SCROLL_BAR_WIDTH, height: props.length } : { width: props.length, height: SCROLL_BAR_WIDTH })}
      semantic={props.name ? { name: props.name, role: "scrollbar", value: `${props.value}/${props.max}` } : undefined}
    >
      {/* White up to the container's frame line, which the bar's last column only overlaps; then the separator. */}
      <box position="absolute" {...rect(0, props.length, 0, SCROLL_BAR_WIDTH - 1)} background={0} />
      <box position="absolute" {...rect(0, props.length, 0, 1)} background={1} />
      <Arrow sprite={(pressed) => sprite("start", pressed)} {...rect(0, ARROW, 0, ARROW)} onClick={() => props.onStep(-1)} />
      <Show when={props.max > 0}>
        <box
          position="absolute"
          {...rect(ARROW, track(), 1, SCROLL_BAR_WIDTH - 2)}
          background="gray25"
          onMouseDown={(x, y) => props.onPage?.(along(x, y) + ARROW < thumbAt() ? -1 : 1)}
        />
        <box
          position="absolute"
          {...rect(thumbAt(), thumb(), 1, SCROLL_BAR_WIDTH - 2)}
          background={0}
          borderColor={1}
          borderWidth={1}
          onDragStart={(_lx, _ly, gx, gy) => {
            pressAt = along(gx, gy);
            pressThumb = thumbAt() - ARROW;
          }}
          onDrag={(_lx, _ly, gx, gy) => {
            const room = Math.max(1, track() - thumb());
            const at = Math.max(0, Math.min(room, pressThumb + along(gx, gy) - pressAt));
            props.onDrag(Math.round((at / room) * props.max));
          }}
        />
      </Show>
      <Arrow sprite={(pressed) => sprite("end", pressed)} {...rect(props.length - ARROW, ARROW, 0, ARROW)} onClick={() => props.onStep(1)} />
    </box>
  );
}

/** An arrow, drawn filled while the button is down on it. */
function Arrow(props: {
  sprite: (pressed: boolean) => Sprite | undefined;
  left: number;
  top: number;
  width: number;
  height: number;
  onClick: () => void;
}): JSX.Element {
  const [pressed, setPressed] = createSignal(false);
  const handlers = {
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false),
    onDragEnd: () => setPressed(false),
    onClick: props.onClick,
  };
  return (
    <Show
      when={props.sprite(pressed())}
      fallback={
        <box position="absolute" left={props.left} top={props.top} width={props.width} height={props.height} borderColor={1} borderWidth={1} {...handlers} />
      }
    >
      {(s) => <image position="absolute" left={props.left} top={props.top} width={props.width} height={props.height} src={s()} {...handlers} />}
    </Show>
  );
}
