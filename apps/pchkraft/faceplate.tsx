/**
 * The cassette's face: two reels, the tape window, four chunky keys and a
 * row of transport buttons. None of them take focus, so the instrument keeps
 * the keyboard while you click.
 */
import type { JSX } from "@mockintosh/ui";
import { createFrame, rect, type Frame } from "../synth/pixels";
import { drawTape, GRID_H, GRID_W } from "./screen";
import type { Loop } from "./loop";

export const SHELL_W = 468;
export const SHELL_H = 260;
export const PAD = 10;
export const GAP = 8;
export const BORDER = 2;
const REEL_SIZE = 100;
export const TRANSPORT_H = 24;
export const KEY_H = 96;
export const SCREEN_W = SHELL_W - 2 * BORDER - 2 * PAD - 2 * REEL_SIZE - 2 * GAP;
export const SCREEN_H = REEL_SIZE;

function drawReel(frame: Frame, angle: number, hot: boolean): void {
  const size = frame.width;
  const c = (size - 1) / 2;
  const radius = c - 0.5;
  frame.pixels.fill(0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const i = y * size + x;
      if (dist > radius - 1.4) frame.pixels[i] = 1;
      else if (dist < 4.5) frame.pixels[i] = hot ? 0 : 1;
      else if (dist < 13) frame.pixels[i] = dist > 11.5 ? 1 : 0;
      else {
        const spoke = ((Math.atan2(dy, dx) - angle) / (Math.PI / 3) + 8) % 1;
        frame.pixels[i] = spoke < 0.36 ? 0 : 1;
      }
    }
  }
}

export function Reel(props: { angle: number; hot: boolean; revision: number; name: string }): JSX.Element {
  const frame = createFrame(REEL_SIZE, REEL_SIZE);
  return (
    <raster
      width={REEL_SIZE}
      height={REEL_SIZE}
      revision={props.revision}
      semantic={{ name: props.name, role: "img" }}
      onPaint={(surface) => {
        drawReel(frame, props.angle, props.hot);
        surface.blitPixels(frame.pixels, REEL_SIZE, REEL_SIZE);
      }}
    />
  );
}

export function Screw(): JSX.Element {
  const size = 8;
  const frame = createFrame(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - c, y - c);
      if (dist <= c) frame.pixels[y * size + x] = dist > c - 1.2 ? 1 : 0;
    }
  }
  rect(frame, 1, 3, 6, 1, 1);
  return (
    <raster
      width={size}
      height={size}
      revision={0}
      onPaint={(surface) => surface.blitPixels(frame.pixels, size, size)}
    />
  );
}

export function Screen(props: {
  title: string;
  aside: string;
  status: string;
  summary: string;
  tape(): Loop;
  step: number;
  tracker: string | null;
  revision: number;
}): JSX.Element {
  const frame = createFrame(GRID_W, GRID_H);
  return (
    <box
      width={SCREEN_W}
      height={SCREEN_H}
      background={1}
      borderRadius={3}
      padding={4}
      flexDirection="column"
      justifyContent="space-between"
      semantic={{ name: "display", role: "status", value: props.summary }}
    >
      <box flexDirection="row" justifyContent="space-between" height={16}>
        <text font="geneva" size={12} bold color={0} nowrap>
          {props.title}
        </text>
        <text font="body" color={0} nowrap>
          {props.aside}
        </text>
      </box>
      {props.tracker === null ? (
        <raster
          width={GRID_W}
          height={GRID_H}
          revision={props.revision}
          onPaint={(surface) => {
            drawTape(frame, props.tape(), props.step);
            surface.blitPixels(frame.pixels, GRID_W, GRID_H);
          }}
        />
      ) : (
        <text width={GRID_W} height={GRID_H} font="menu" spacing={1} color={0}>
          {props.tracker}
        </text>
      )}
      <text font="body" color={0} nowrap>
        {props.status}
      </text>
    </box>
  );
}

/** One of the four keys. Held, it inverts. */
export function Pad(props: {
  index: number;
  caption: string;
  title: string;
  hint: string;
  lit: boolean;
  onPress(): void;
  onLift(): void;
}): JSX.Element {
  const ink = () => (props.lit ? 0 : 1);
  return (
    <box
      flexGrow={1}
      height={KEY_H}
      borderWidth={1}
      borderColor={1}
      borderRadius={6}
      background={props.lit ? 1 : 0}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={2}
      semantic={{ name: `key-${props.index + 1}`, role: "button", value: props.lit ? `${props.title || props.caption} down` : props.title || props.caption }}
      onMouseDown={props.onPress}
      onMouseUp={props.onLift}
    >
      <text font="body" color={ink()} align="center" nowrap>
        {props.caption}
      </text>
      <text font="geneva" size={14} bold color={ink()} align="center" nowrap>
        {props.title}
      </text>
      <text font="body" color={ink()} align="center" nowrap>
        {props.hint}
      </text>
    </box>
  );
}

export function Transport(props: { name: string; label: string; lit: boolean; onPress(): void }): JSX.Element {
  return (
    <box
      flexGrow={1}
      height={TRANSPORT_H}
      borderWidth={1}
      borderColor={1}
      borderRadius={3}
      background={props.lit ? 1 : 0}
      semantic={{ name: props.name, role: "button", value: props.lit ? "on" : "off" }}
      onMouseDown={props.onPress}
    >
      <text font="body" color={props.lit ? 0 : 1} align="center" verticalAlign="middle" height={TRANSPORT_H - 2} nowrap>
        {props.label}
      </text>
    </box>
  );
}
