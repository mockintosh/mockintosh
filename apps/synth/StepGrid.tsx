import type { JSX } from "@mockintosh/ui";
import { GRAY, LIGHT, ensureFrame, invertRect, rect, type Frame } from "./pixels";
import { STEPS, STEP_RANGE, quantize, type Pattern, type Step } from "./sequencer";

export const STEP_W = 14;
const LANE_H = 5;
const LANE_GAP = 2;

export interface StepGridProps {
  pattern: Pattern;
  /** Scale index; clicks snap to its tones. */
  scale: number;
  /** Pattern length in steps; steps past it are shaded. */
  length: number;
  /** The step being heard, or −1; read at paint time. */
  playingStep(): number;
  revision: number;
  height: number;
  onChange(pattern: Pattern): void;
}

interface Lanes {
  ladderTop: number;
  ladderH: number;
  accentY: number;
  slideY: number;
}

function lanes(height: number): Lanes {
  const slideY = height - LANE_H;
  const accentY = slideY - LANE_GAP - LANE_H;
  return { ladderTop: 1, ladderH: accentY - LANE_GAP - 1, accentY, slideY };
}

/** Pixel row of a pitch offset's bar top. */
function rowOf(l: Lanes, offset: number): number {
  return l.ladderTop + l.ladderH - 1 - Math.round((offset / STEP_RANGE) * (l.ladderH - 3)) - 2;
}

function draw(frame: Frame, props: StepGridProps): void {
  const l = lanes(frame.height);
  frame.pixels.fill(0);
  const bottom = l.ladderTop + l.ladderH;
  // Octave rules: the root and each octave above it.
  for (const offset of [0, 12, 24]) {
    const y = rowOf(l, offset);
    for (let x = 0; x < frame.width; x += 2) rect(frame, x, y, 1, 1, 1);
  }
  for (let i = 0; i < STEPS; i++) {
    const step = props.pattern.steps[i]!;
    const x = i * STEP_W;
    const inside = i < props.length;
    if (!inside) rect(frame, x, l.ladderTop, STEP_W, frame.height - l.ladderTop, LIGHT);
    if (i % 4 === 0) rect(frame, x, bottom + 1, 1, frame.height - bottom - 1, 1);
    if (step.on) {
      const top = rowOf(l, step.offset);
      rect(frame, x + 2, top, STEP_W - 4, bottom - top, step.accent ? 1 : GRAY);
      rect(frame, x + 2, top, STEP_W - 4, 2, 1);
    } else {
      rect(frame, x + 4, bottom - 1, STEP_W - 8, 1, 1);
    }
    if (step.accent) rect(frame, x + 4, l.accentY, STEP_W - 8, LANE_H, 1);
    else rect(frame, x + STEP_W / 2 - 1, l.accentY + 2, 2, 1, 1);
    if (step.slide) {
      rect(frame, x + 3, l.slideY + 1, STEP_W, 2, 1);
      rect(frame, x + 3, l.slideY, 1, LANE_H - 1, 1);
    } else rect(frame, x + STEP_W / 2 - 1, l.slideY + 2, 2, 1, 1);
  }
  rect(frame, 0, bottom, frame.width, 1, 1);
  const playing = props.playingStep();
  if (playing >= 0 && playing < STEPS) invertRect(frame, playing * STEP_W, l.ladderTop, STEP_W, l.ladderH);
}

type Stroke = { kind: "draw" } | { kind: "erase" } | { kind: "accent"; on: boolean } | { kind: "slide"; on: boolean };

/**
 * Sixteen steps drawn as a bar graph of pitch, over two octaves. Click or
 * drag to set notes (snapped to the scale); click a step's top again to
 * clear it. The lanes below toggle accent and slide.
 */
export function StepGrid(props: StepGridProps): JSX.Element {
  let frame: Frame | null = null;
  let stroke: Stroke | null = null;
  const width = STEPS * STEP_W;

  const edit = (x: number, y: number, first: boolean) => {
    const i = Math.floor(x / STEP_W);
    if (i < 0 || i >= STEPS) return;
    const l = lanes(props.height);
    const current = props.pattern.steps[i]!;
    let next: Step = current;
    if (first) {
      if (y >= l.slideY - 1) stroke = { kind: "slide", on: !current.slide };
      else if (y >= l.accentY - 1) stroke = { kind: "accent", on: !current.accent };
      else stroke = { kind: "draw" };
    }
    if (!stroke) return;
    if (stroke.kind === "accent") next = { ...current, accent: stroke.on };
    else if (stroke.kind === "slide") next = { ...current, slide: stroke.on };
    else {
      const raw = ((l.ladderTop + l.ladderH - 3 - Math.min(y, l.ladderTop + l.ladderH - 1)) / (l.ladderH - 3)) * STEP_RANGE;
      const offset = quantize(Math.max(0, Math.min(STEP_RANGE, Math.round(raw))), props.scale);
      if (first && current.on && Math.abs(rowOf(l, current.offset) - y) <= 2) stroke = { kind: "erase" };
      next = stroke.kind === "erase" ? { ...current, on: false } : { ...current, on: true, offset };
    }
    if (next.on === current.on && next.offset === current.offset && next.accent === current.accent && next.slide === current.slide) {
      return;
    }
    const steps = props.pattern.steps.slice();
    steps[i] = next;
    props.onChange({ steps });
  };

  return (
    <raster
      width={width}
      height={props.height}
      revision={props.revision}
      semantic={{
        name: "steps",
        role: "grid",
        value: props.pattern.steps.map((s) => (s.on ? String(s.offset) : ".")).join(" "),
      }}
      onPaint={(surface) => {
        frame = ensureFrame(frame, width, props.height);
        draw(frame, props);
        surface.blitPixels(frame.pixels, frame.width, frame.height);
      }}
      onMouseDown={(x, y) => edit(x, y, true)}
      onDrag={(x, y) => edit(x, y, false)}
      onMouseUp={() => {
        stroke = null;
      }}
    />
  );
}