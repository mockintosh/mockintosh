import { createMemo, createSignal } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { createFrame, plot, type Frame } from "./pixels";
import { formatParam, fromTravel, toTravel, type ParamDef } from "./params";

export const KNOB_SIZE = 19;
export const KNOB_CELL = 25;
/** The face and its caption (one line of the body font). */
export const KNOB_HEIGHT = KNOB_SIZE + 12;
/** Pixels of vertical drag for the whole travel. */
const DRAG_RANGE = 110;
const SWEEP = (135 * Math.PI) / 180;
const CENTER = (KNOB_SIZE - 1) / 2;

/** Travel 0…1 → angle from twelve o'clock, clockwise. */
function angleOf(travel: number): number {
  return -SWEEP + travel * 2 * SWEEP;
}

/**
 * A knob face: a black cap with a white pointer, inside an arc that fills
 * from the rest position (the left stop, or twelve o'clock when bipolar) to
 * the value. Detented knobs show a dot for every position. Grabbed, the cap
 * turns white.
 */
function drawKnob(frame: Frame, travel: number, def: ParamDef, grabbed: boolean): void {
  frame.pixels.fill(0);
  const bipolar = def.kind === "number" && def.bipolar === true;
  const from = bipolar ? 0 : -SWEEP;
  const to = angleOf(travel);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const detents = def.kind === "choice" ? def.options.length : def.step ? Math.round((def.max - def.min) / def.step) + 1 : 0;

  for (let y = 0; y < KNOB_SIZE; y++) {
    for (let x = 0; x < KNOB_SIZE; x++) {
      const dx = x - CENTER;
      const dy = y - CENTER;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dx, -dy);
      if (d > 7.6 && d <= 9.2 && a >= -SWEEP - 0.05 && a <= SWEEP + 0.05) {
        const lit = a >= lo - 0.04 && a <= hi + 0.04;
        if (lit && d > 8) frame.pixels[y * KNOB_SIZE + x] = 1;
        else if (!lit && detents === 0 && d > 8.3 && (x + y) % 2 === 0) frame.pixels[y * KNOB_SIZE + x] = 1;
      }
      if (d <= 5.9) frame.pixels[y * KNOB_SIZE + x] = grabbed ? (d > 4.9 ? 1 : 0) : 1;
    }
  }
  if (detents > 1 && detents <= 25) {
    for (let k = 0; k < detents; k++) {
      const a = angleOf(k / (detents - 1));
      plot(frame, CENTER + Math.sin(a) * 8.6, CENTER - Math.cos(a) * 8.6, 1);
    }
  }
  const ink = grabbed ? 1 : 0;
  for (let r = grabbed ? 0 : 1; r <= 5; r += 0.5) plot(frame, CENTER + Math.sin(to) * r, CENTER - Math.cos(to) * r, ink);
}

export interface KnobProps {
  def: ParamDef;
  value: number;
  onChange(value: number): void;
  /** The knob under the pointer or in the hand, for the display; null when it lets go. */
  onInspect?(def: ParamDef | null): void;
}

/**
 * A rotary control. Drag up or down to turn it, scroll to nudge, click a
 * detented knob to step it, double-click to return to the default.
 */
export function Knob(props: KnobProps): JSX.Element {
  const [grabbed, setGrabbed] = createSignal(false);
  const frame = createFrame(KNOB_SIZE, KNOB_SIZE);
  const travel = () => Math.max(0, Math.min(1, toTravel(props.def, props.value)));
  let paints = 0;
  const revision = createMemo(() => {
    travel();
    grabbed();
    return ++paints;
  });

  let startY = 0;
  let startTravel = 0;
  let dragged = false;
  let hovering = false;

  const set = (t: number) => {
    const next = fromTravel(props.def, t);
    if (next !== props.value) props.onChange(next);
  };
  const stepBy = (delta: number) => {
    const def = props.def;
    if (def.kind === "choice") {
      const count = def.options.length;
      props.onChange((((Math.round(props.value) + delta) % count) + count) % count);
    } else if (def.step) {
      set(toTravel(def, Math.max(def.min, Math.min(def.max, props.value + delta * def.step))));
    } else {
      set(travel() + delta / 50);
    }
  };

  return (
    <box width={KNOB_CELL} flexDirection="column" alignItems="center">
      <raster
        width={KNOB_SIZE}
        height={KNOB_SIZE}
        revision={revision()}
        cursor="grab"
        semantic={{ name: props.def.key, role: "slider", value: formatParam(props.def, props.value) }}
        onPaint={(surface) => {
          drawKnob(frame, travel(), props.def, grabbed());
          surface.blitPixels(frame.pixels, KNOB_SIZE, KNOB_SIZE);
        }}
        onMouseEnter={() => {
          hovering = true;
          props.onInspect?.(props.def);
        }}
        onMouseLeave={() => {
          hovering = false;
          if (!grabbed()) props.onInspect?.(null);
        }}
        onMouseDown={() => {
          dragged = false;
          setGrabbed(true);
          props.onInspect?.(props.def);
        }}
        onDragStart={(_x, _y, _gx, gy) => {
          startY = gy;
          startTravel = travel();
        }}
        onDrag={(_x, _y, _gx, gy) => {
          if (Math.abs(gy - startY) >= 2) dragged = true;
          if (dragged) set(startTravel + (startY - gy) / DRAG_RANGE);
        }}
        onMouseUp={() => {
          setGrabbed(false);
          if (!hovering) props.onInspect?.(null);
        }}
        onClick={() => {
          if (!dragged && props.def.kind === "choice") stepBy(1);
        }}
        onDoubleClick={() => {
          if (props.def.kind === "number") props.onChange(props.def.default);
        }}
        onScroll={(deltaY) => {
          props.onInspect?.(props.def);
          stepBy(deltaY > 0 ? -1 : 1);
        }}
      />
      <text font="body" nowrap align="center">
        {props.def.label}
      </text>
    </box>
  );
}
