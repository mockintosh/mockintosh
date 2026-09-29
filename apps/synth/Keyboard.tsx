import type { JSX } from "@mockintosh/ui";
import { noteName } from "@mockintosh/sdk";
import { GRAY, ensureFrame, rect, type Frame } from "./pixels";

const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];
/** White-key degrees that have a black key to their right. */
const HAS_SHARP = [true, true, false, true, true, true, false];
/** Room above the keys for the computer-keyboard range bar. */
const BAR = 4;

export interface KeyboardProps {
  width: number;
  height: number;
  /** MIDI note of the leftmost key, a C. */
  low: number;
  octaves: number;
  /** Whether a key is sounding; read at paint time. */
  isLit(note: number): boolean;
  /** Bump to repaint. */
  revision: number;
  /** The notes the computer keyboard reaches, marked above the keys. */
  reach?: { low: number; high: number };
  onNoteOn(note: number): void;
  onNoteOff(note: number): void;
}

interface KeyGeometry {
  x0: number;
  whiteW: number;
  blackW: number;
  blackH: number;
  whites: number;
}

function geometry(props: KeyboardProps): KeyGeometry {
  const whites = props.octaves * 7 + 1;
  const whiteW = Math.max(4, Math.floor(props.width / whites));
  const blackW = Math.max(3, Math.round(whiteW * 0.6) | 1);
  return {
    x0: Math.floor((props.width - whiteW * whites) / 2),
    whiteW,
    blackW,
    blackH: Math.round((props.height - BAR) * 0.6),
    whites,
  };
}

const whiteNote = (low: number, k: number) => low + Math.floor(k / 7) * 12 + WHITE_STEPS[k % 7]!;

/** Left edge of a note's key, in pixels. */
function keyLeft(g: KeyGeometry, low: number, note: number): number {
  const rel = note - low;
  const octave = Math.floor(rel / 12);
  const semitone = ((rel % 12) + 12) % 12;
  const degree = WHITE_STEPS.indexOf(semitone);
  if (degree >= 0) return g.x0 + (octave * 7 + degree) * g.whiteW;
  const below = WHITE_STEPS.indexOf(semitone - 1);
  return g.x0 + (octave * 7 + below + 1) * g.whiteW - (g.blackW >> 1);
}

function noteAt(g: KeyGeometry, low: number, x: number, y: number): number | null {
  if (y >= BAR && y < BAR + g.blackH) {
    for (let k = 0; k < g.whites - 1; k++) {
      if (!HAS_SHARP[k % 7]) continue;
      const left = g.x0 + (k + 1) * g.whiteW - (g.blackW >> 1);
      if (x >= left && x < left + g.blackW) return whiteNote(low, k) + 1;
    }
  }
  const k = Math.floor((x - g.x0) / g.whiteW);
  if (k < 0 || k >= g.whites) return null;
  return whiteNote(low, k);
}

function draw(frame: Frame, props: KeyboardProps, g: KeyGeometry): void {
  frame.pixels.fill(0);
  const { height } = frame;
  const top = BAR;
  if (props.reach) {
    const left = Math.max(g.x0, keyLeft(g, props.low, props.reach.low));
    const right = Math.min(g.x0 + g.whites * g.whiteW, keyLeft(g, props.low, props.reach.high) + g.whiteW);
    rect(frame, left, 0, right - left, 2, 1);
  }
  for (let k = 0; k < g.whites; k++) {
    const x = g.x0 + k * g.whiteW;
    if (props.isLit(whiteNote(props.low, k))) rect(frame, x + 1, top + 1, g.whiteW - 1, height - top - 2, GRAY);
    rect(frame, x, top, 1, height - top, 1);
  }
  const right = g.x0 + g.whites * g.whiteW;
  rect(frame, g.x0, top, right - g.x0, 1, 1);
  rect(frame, g.x0, height - 1, right - g.x0, 1, 1);
  rect(frame, right, top, 1, height - top, 1);
  for (let k = 0; k < g.whites - 1; k++) {
    if (!HAS_SHARP[k % 7]) continue;
    const left = g.x0 + (k + 1) * g.whiteW - (g.blackW >> 1);
    rect(frame, left, top, g.blackW, g.blackH, 1);
    if (props.isLit(whiteNote(props.low, k) + 1)) {
      rect(frame, left + 1, top + 1, g.blackW - 2, g.blackH - 2, (x, y) => (GRAY(x, y) ? 0 : 1));
    }
  }
}

/** A piano keyboard. Press a key to play it; drag across the keys for a glissando. */
export function Keyboard(props: KeyboardProps): JSX.Element {
  let frame: Frame | null = null;
  let held: number | null = null;

  const press = (x: number, y: number) => {
    const note = noteAt(geometry(props), props.low, x, y);
    if (note === held) return;
    if (held !== null) props.onNoteOff(held);
    held = note;
    if (note !== null) props.onNoteOn(note);
  };
  const lift = () => {
    if (held !== null) props.onNoteOff(held);
    held = null;
  };

  return (
    <raster
      width={props.width}
      height={props.height}
      revision={props.revision}
      semantic={{ name: "keyboard", role: "keyboard", value: `${noteName(props.low)}–${noteName(props.low + props.octaves * 12)}` }}
      onPaint={(surface) => {
        frame = ensureFrame(frame, props.width, props.height);
        draw(frame, props, geometry(props));
        surface.blitPixels(frame.pixels, frame.width, frame.height);
      }}
      onMouseDown={press}
      onDrag={press}
      onMouseUp={lift}
      onDragEnd={lift}
    />
  );
}
