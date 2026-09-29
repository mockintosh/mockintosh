/**
 * The pocket instrument's faceplate: seven chord buttons, the joystick's
 * gate, the display with its beat lights, and the speaker grille.
 */
import { For } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { createFrame, ensureFrame, rect, type Frame } from "../synth/pixels";
import { STEPS_PER_BAR } from "./drums";
import { JOYSTICK, MODIFIER_LABELS, type Direction } from "./theory";

/**
 * One chord button: the degree, the chord it plays, and its key. Held down,
 * it inverts. Like the Synthesizer's panel buttons it is not focusable, so
 * the instrument keeps the keyboard.
 */
export function ChordButton(props: {
  degree: number;
  numeral: string;
  chord: string;
  hint: string;
  width: number;
  height: number;
  lit: boolean;
  onPress(): void;
  onLift(): void;
}): JSX.Element {
  const ink = () => (props.lit ? 0 : 1);
  return (
    <box
      width={props.width}
      height={props.height}
      borderWidth={1}
      borderColor={1}
      borderRadius={5}
      background={props.lit ? 1 : 0}
      flexDirection="column"
      alignItems="center"
      paddingTop={4}
      gap={2}
      semantic={{ name: `chord-${props.degree + 1}`, role: "button", value: props.chord }}
      onMouseDown={props.onPress}
      onMouseUp={props.onLift}
    >
      <text font="body" color={ink()} align="center" nowrap>
        {props.numeral}
      </text>
      <text font="geneva" size={12} bold color={ink()} align="center" nowrap>
        {props.chord}
      </text>
      <text font="body" color={ink()} align="center" nowrap>
        {props.hint}
      </text>
    </box>
  );
}

const GATE: readonly (readonly Direction[])[] = [
  ["NW", "N", "NE"],
  ["W", "C", "E"],
  ["SW", "S", "SE"],
];

/**
 * The joystick, as the gate it moves in: the eight chord colours around a
 * centre that plays plain triads. Clicking a direction latches it; click it
 * again, or the centre, to let go. The arrow keys push the stick while held.
 */
export function Joystick(props: {
  cellWidth: number;
  cellHeight: number;
  /** Where the stick is now (arrow keys or latch). */
  direction: Direction;
  /** Where a click left it. */
  latched: Direction;
  onLatch(direction: Direction): void;
}): JSX.Element {
  const height = () => props.cellHeight;
  return (
    <box flexDirection="column" borderWidth={1} borderColor={1} borderRadius={3}>
      <For each={GATE}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(dir) => {
                const lit = () => props.direction === dir;
                const label = () => (dir === "C" ? "•" : MODIFIER_LABELS[JOYSTICK[dir]]);
                return (
                  <box
                    width={props.cellWidth}
                    height={height()}
                    background={lit() ? 1 : 0}
                    semantic={{ name: `joystick-${dir}`, role: "button", value: lit() ? "on" : "off" }}
                    onMouseDown={() => props.onLatch(dir === "C" || props.latched === dir ? "C" : dir)}
                  >
                    <text font="body" color={lit() ? 0 : 1} align="center" verticalAlign="middle" height={height()} nowrap>
                      {label()}
                    </text>
                  </box>
                );
              }}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

const BEAT_W = 5;
const BEAT_GAP = 1;
const BEATS_WIDTH = STEPS_PER_BAR * (BEAT_W + BEAT_GAP) - BEAT_GAP;
const BEATS_HEIGHT = 5;

/** Sixteen lights for the rhythm box's bar, white on the black display; downbeats are taller. */
function BeatLights(props: { step: number; revision: number }): JSX.Element {
  let frame: Frame | null = null;
  return (
    <raster
      width={BEATS_WIDTH}
      height={BEATS_HEIGHT}
      revision={props.revision}
      onPaint={(surface) => {
        frame = ensureFrame(frame, BEATS_WIDTH, BEATS_HEIGHT);
        frame.pixels.fill(1);
        for (let s = 0; s < STEPS_PER_BAR; s++) {
          const x = s * (BEAT_W + BEAT_GAP);
          const top = s % 4 === 0 ? 0 : 2;
          if (s === props.step) rect(frame, x, top, BEAT_W, BEATS_HEIGHT - top, 0);
          else rect(frame, x + 2, BEATS_HEIGHT - 1, 1, 1, 0);
        }
        surface.blitPixels(frame.pixels, frame.width, frame.height);
      }}
    />
  );
}

/** The inverted display: the chord in large type, what it is made of, and the status line. */
export function Lcd(props: {
  width: number;
  height: number;
  chord: string;
  detail: string;
  status: string;
  step: number;
  beatRevision: number;
}): JSX.Element {
  return (
    <box
      width={props.width}
      height={props.height}
      background={1}
      borderRadius={4}
      paddingLeft={6}
      paddingRight={6}
      paddingTop={3}
      flexDirection="column"
      semantic={{ name: "display", role: "status", value: `${props.chord} | ${props.detail} | ${props.status}` }}
    >
      <box flexDirection="row" alignItems="flex-start" justifyContent="space-between" height={24}>
        <text font="geneva" size={18} bold color={0} nowrap>
          {props.chord}
        </text>
        <box paddingTop={8}>
          <BeatLights step={props.step} revision={props.beatRevision} />
        </box>
      </box>
      <text font="body" color={0} nowrap>
        {props.detail}
      </text>
      <text font="body" color={0} nowrap>
        {props.status}
      </text>
    </box>
  );
}

/** The speaker: a round grille of holes. */
export function Grille(props: { size: number }): JSX.Element {
  const frame = createFrame(props.size, props.size);
  const c = (props.size - 1) / 2;
  const radius = props.size / 2 - 2;
  for (let y = 2; y < props.size - 2; y += 4) {
    for (let x = 2; x < props.size - 2; x += 4) {
      const ox = (y / 4) % 2 === 0 ? 0 : 2;
      if (Math.hypot(x + ox + 0.5 - c, y + 0.5 - c) <= radius - 1) rect(frame, x + ox, y, 2, 2, 1);
    }
  }
  return (
    <raster
      width={props.size}
      height={props.size}
      revision={0}
      onPaint={(surface) => surface.blitPixels(frame.pixels, frame.width, frame.height)}
    />
  );
}
