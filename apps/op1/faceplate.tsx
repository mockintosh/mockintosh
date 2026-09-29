/**
 * The OP-1's faceplate: the display, four endless encoders, square buttons
 * with pictures on them, the two-octave keyboard, and the speaker.
 *
 * Like the Synthesizer's controls, none of these take focus, so the
 * instrument keeps the keyboard while you click them.
 */
import { createMemo, createSignal, For } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { GRAY, createFrame, ensureFrame, line, plot, rect, type Frame } from "../synth/pixels";
import { KEY_COUNT, KEY_SLOTS, WHITE_KEYS } from "./keys";
import type { EncoderIndex } from "./params";
import {
  COLUMN_W,
  LABEL_X,
  LABEL_Y,
  SCREEN_H,
  SCREEN_W,
  STRIP_H,
  STRIP_W,
  drawScreen,
  drawStrip,
  encoderInk,
  type ScreenArt,
  type StripView,
} from "./screen";

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export interface ScreenProps {
  title: string;
  info: string;
  /** Read at paint time. */
  art(): ScreenArt;
  revision: number;
  /** A click on the display, in display pixels. */
  onPress?(x: number, y: number): void;
}

/** The black display: pictures drawn into a raster, words set over it. */
export function Screen(props: ScreenProps): JSX.Element {
  const frame = createFrame(SCREEN_W, SCREEN_H);
  return (
    <box
      width={SCREEN_W}
      height={SCREEN_H}
      semantic={{ name: "display", role: "status", value: `${props.title} | ${props.info}` }}
      onMouseDown={(x, y) => props.onPress?.(x, y)}
    >
      <raster
        width={SCREEN_W}
        height={SCREEN_H}
        revision={props.revision}
        onPaint={(surface) => {
          drawScreen(frame, props.art());
          surface.blitPixels(frame.pixels, SCREEN_W, SCREEN_H);
        }}
      />
      <text position="absolute" left={4} top={1} font="body" color={0} nowrap>
        {props.title}
      </text>
      <text position="absolute" left={70} top={1} width={SCREEN_W - 74} align="right" font="body" color={0} nowrap>
        {props.info}
      </text>
    </box>
  );
}

export interface EncoderStripProps {
  /** The four encoders' captions. */
  labels: readonly string[];
  /** Read at paint time. */
  strip(): StripView;
  revision: number;
}

/** The small display under the encoders: each one's caption and value, set under its knob. */
export function EncoderStrip(props: EncoderStripProps): JSX.Element {
  const frame = createFrame(STRIP_W, STRIP_H);
  return (
    <box width={STRIP_W} height={STRIP_H} semantic={{ name: "encoder-strip", role: "status", value: props.labels.join(" | ") }}>
      <raster
        width={STRIP_W}
        height={STRIP_H}
        revision={props.revision}
        onPaint={(surface) => {
          drawStrip(frame, props.strip());
          surface.blitPixels(frame.pixels, STRIP_W, STRIP_H);
        }}
      />
      <For each={[0, 1, 2, 3]}>
        {(i) => (
          <text position="absolute" left={Math.round(i * COLUMN_W) + LABEL_X} top={LABEL_Y} font="body" color={0} nowrap>
            {props.labels[i] ?? ""}
          </text>
        )}
      </For>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

export const ENCODER_SIZE = 38;
const CAP_R = 12.5;
const RIM_R = 18;
/** Pixels of drag per tick. */
const DRAG_PX_FINE = 2;
const DRAG_PX_DETENT = 9;

function drawEncoder(frame: Frame, index: EncoderIndex, angle: number, grabbed: boolean): void {
  frame.pixels.fill(0);
  const c = (ENCODER_SIZE - 1) / 2;
  const ink = encoderInk(index);
  for (let y = 0; y < ENCODER_SIZE; y++) {
    for (let x = 0; x < ENCODER_SIZE; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      const i = y * ENCODER_SIZE + x;
      if (d <= RIM_R && d > CAP_R + 1.5) {
        // The knurled rim: ridges that turn with the knob.
        const ridge = Math.floor(((Math.atan2(dy, dx) - angle) / (2 * Math.PI)) * 36 + 360) % 2 === 0;
        frame.pixels[i] = d > RIM_R - 1 || ridge || grabbed ? 1 : 0;
      } else if (d <= CAP_R) {
        frame.pixels[i] = d > CAP_R - 1 ? 1 : typeof ink === "function" ? ink(x, y) : ink;
      }
    }
  }
  // The notch: a white dot ringed in black, visible on any fill.
  const nx = Math.round(c + Math.sin(angle) * (CAP_R - 5));
  const ny = Math.round(c - Math.cos(angle) * (CAP_R - 5));
  rect(frame, nx - 2, ny - 2, 5, 5, 1);
  rect(frame, nx - 1, ny - 1, 3, 3, 0);
}

export interface EncoderProps {
  index: EncoderIndex;
  /** What it is turning now, for its semantic value. */
  name: string;
  value: string;
  /** Detented parameters take a longer drag per step. */
  detented: boolean;
  onTurn(ticks: number): void;
  onReset(): void;
}

/**
 * An endless encoder: drag up or down, or scroll, to turn it; the value lives
 * on the display. Double-click returns the parameter to its default.
 */
export function Encoder(props: EncoderProps): JSX.Element {
  const [angle, setAngle] = createSignal(0);
  const [grabbed, setGrabbed] = createSignal(false);
  const frame = createFrame(ENCODER_SIZE, ENCODER_SIZE);
  let paints = 0;
  const revision = createMemo(() => {
    angle();
    grabbed();
    return ++paints;
  });

  let startY = 0;
  let sent = 0;
  const turn = (ticks: number) => {
    if (ticks === 0) return;
    setAngle((a) => a + ticks * (props.detented ? 0.5 : 0.09));
    props.onTurn(ticks);
  };

  return (
    <raster
      width={ENCODER_SIZE}
      height={ENCODER_SIZE}
      revision={revision()}
      cursor="grab"
      semantic={{ name: `encoder-${props.index + 1}`, role: "slider", value: `${props.name} ${props.value}` }}
      onPaint={(surface) => {
        drawEncoder(frame, props.index, angle(), grabbed());
        surface.blitPixels(frame.pixels, ENCODER_SIZE, ENCODER_SIZE);
      }}
      onMouseDown={() => setGrabbed(true)}
      onMouseUp={() => setGrabbed(false)}
      onDragStart={(_x, _y, _gx, gy) => {
        startY = gy;
        sent = 0;
      }}
      onDrag={(_x, _y, _gx, gy) => {
        const px = props.detented ? DRAG_PX_DETENT : DRAG_PX_FINE;
        const total = Math.trunc((startY - gy) / px);
        turn(total - sent);
        sent = total;
      }}
      onDragEnd={() => setGrabbed(false)}
      onScroll={(deltaY) => turn((deltaY > 0 ? -1 : 1) * (props.detented ? 1 : 2))}
      onDoubleClick={props.onReset}
    />
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export const ICON_W = 13;
export const ICON_H = 9;

/** A button picture: `#` is ink. */
function icon(rows: readonly string[]): Frame {
  const frame = createFrame(ICON_W, ICON_H);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") frame.pixels[y * ICON_W + x] = 1;
  });
  return frame;
}

export const ICONS = {
  seq: icon([
    ".............",
    "##.##.##.##..",
    "##.##.##.##..",
    ".............",
    "##....##.....",
    "##....##.....",
    ".............",
    "#.#.#.#.#.#.#",
    ".............",
  ]),
  synth: icon([
    ".............",
    "..##.........",
    ".#..#........",
    "#....#.......",
    "#....#......#",
    "......#....#.",
    ".......#..#..",
    "........##...",
    ".............",
  ]),
  drum: icon([
    "...#######...",
    ".##.......##.",
    "#...........#",
    "##.........##",
    "#.#########.#",
    "#...#...#...#",
    "#...#...#...#",
    ".##.#...#.##.",
    "...#######...",
  ]),
  tape: icon([
    ".............",
    "..###...###..",
    ".#...#.#...#.",
    ".#.#.#.#.#.#.",
    ".#...#.#...#.",
    "..###...###..",
    ".............",
    ".###########.",
    ".............",
  ]),
  mixer: icon([
    "..#...#...#..",
    "..#...#..###.",
    "..#..###..#..",
    ".###..#...#..",
    "..#...#...#..",
    "..#...#...#..",
    "..#...#...#..",
    "..#...#...#..",
    ".............",
  ]),
  record: icon([
    ".............",
    ".....###.....",
    "....#####....",
    "...#######...",
    "...#######...",
    "...#######...",
    "....#####....",
    ".....###.....",
    ".............",
  ]),
  play: icon([
    "....#........",
    "....##.......",
    "....###......",
    "....####.....",
    "....#####....",
    "....####.....",
    "....###......",
    "....##.......",
    "....#........",
  ]),
  stop: icon([
    ".............",
    "...#######...",
    "...#######...",
    "...#######...",
    "...#######...",
    "...#######...",
    "...#######...",
    "...#######...",
    ".............",
  ]),
  reverse: icon([
    "........#....",
    ".......##....",
    "......###....",
    ".....####....",
    "....#####....",
    ".....####....",
    "......###....",
    ".......##....",
    "........#....",
  ]),
  down: icon([
    ".............",
    ".............",
    ".............",
    ".............",
    "...#######...",
    ".............",
    ".............",
    ".............",
    ".............",
  ]),
  up: icon([
    ".............",
    "......#......",
    "......#......",
    "......#......",
    "...#######...",
    "......#......",
    "......#......",
    "......#......",
    ".............",
  ]),
} as const;

export type IconName = keyof typeof ICONS;

export const BUTTON_W = 28;
export const BUTTON_H = 22;

/** A square faceplate key with a picture or a digit on it. Lit (inverted) keys are on. */
export function FaceButton(props: {
  name: string;
  icon?: IconName;
  label?: string;
  lit?: boolean;
  disabled?: boolean;
  onPress(): void;
}): JSX.Element {
  const [down, setDown] = createSignal(false);
  const inverted = () => !props.disabled && (props.lit ?? false) !== down();
  const pixels = new Uint8Array(ICON_W * ICON_H);
  return (
    <box
      width={BUTTON_W}
      height={BUTTON_H}
      borderWidth={1}
      borderColor={1}
      borderRadius={3}
      background={inverted() ? 1 : 0}
      alignItems="center"
      justifyContent="center"
      semantic={{ name: props.name, role: "button", value: props.disabled ? "disabled" : props.lit ? "on" : "off" }}
      onMouseDown={() => !props.disabled && setDown(true)}
      onMouseUp={() => setDown(false)}
      onClick={() => !props.disabled && props.onPress()}
    >
      {props.icon ? (
        <raster
          width={ICON_W}
          height={ICON_H}
          revision={(inverted() ? 1 : 0) + (props.disabled ? 2 : 0)}
          onPaint={(surface) => {
            const art = ICONS[props.icon!].pixels;
            for (let i = 0; i < art.length; i++) {
              const ink = props.disabled ? art[i]! && (i + Math.floor(i / ICON_W)) % 2 : art[i]!;
              pixels[i] = inverted() ? (ink ? 0 : 1) : ink ? 1 : 0;
            }
            surface.blitPixels(pixels, ICON_W, ICON_H);
          }}
        />
      ) : (
        <text font="menu" color={inverted() ? 0 : 1} align="center" nowrap>
          {props.disabled ? "" : props.label ?? ""}
        </text>
      )}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export interface KeyboardProps {
  width: number;
  height: number;
  /** Whether a key is sounding; read at paint time. */
  isLit(key: number): boolean;
  /** Keys the computer keyboard reaches, marked with a dot. */
  reach: number;
  revision: number;
  onKeyDown(key: number): void;
  onKeyUp(key: number): void;
}

interface KeyGeometry {
  unit: number;
  x0: number;
  size: number;
  rowH: number;
}

function keyGeometry(width: number, height: number): KeyGeometry {
  const unit = Math.floor(width / WHITE_KEYS);
  const rowH = Math.floor(height / 2);
  return { unit, x0: Math.floor((width - unit * WHITE_KEYS) / 2), size: unit - 3, rowH };
}

function keyRect(g: KeyGeometry, key: number): { x: number; y: number; w: number; h: number } {
  const slot = KEY_SLOTS[key]!;
  return { x: g.x0 + Math.round(slot.x * g.unit) + 1, y: slot.black ? 0 : g.rowH + 1, w: g.size, h: g.rowH - 2 };
}

function keyAt(g: KeyGeometry, x: number, y: number): number | null {
  for (let key = 0; key < KEY_COUNT; key++) {
    const r = keyRect(g, key);
    if (x >= r.x - 1 && x < r.x + r.w + 2 && y >= r.y - 1 && y < r.y + r.h + 2) return key;
  }
  return null;
}

function roundRect(frame: Frame, x: number, y: number, w: number, h: number, fill: 0 | 1 | ((x: number, y: number) => 0 | 1)): void {
  rect(frame, x + 1, y + 1, w - 2, h - 2, fill);
  line(frame, x + 2, y, x + w - 3, y, 1);
  line(frame, x + 2, y + h - 1, x + w - 3, y + h - 1, 1);
  line(frame, x, y + 2, x, y + h - 3, 1);
  line(frame, x + w - 1, y + 2, x + w - 1, y + h - 3, 1);
  plot(frame, x + 1, y + 1, 1);
  plot(frame, x + w - 2, y + 1, 1);
  plot(frame, x + 1, y + h - 2, 1);
  plot(frame, x + w - 2, y + h - 2, 1);
}

const INVERTED_GRAY = (x: number, y: number): 0 | 1 => (GRAY(x, y) ? 0 : 1);

function drawKeyboard(frame: Frame, props: KeyboardProps, g: KeyGeometry): void {
  frame.pixels.fill(0);
  for (let key = 0; key < KEY_COUNT; key++) {
    const slot = KEY_SLOTS[key]!;
    const r = keyRect(g, key);
    const lit = props.isLit(key);
    roundRect(frame, r.x, r.y, r.w, r.h, slot.black ? (lit ? INVERTED_GRAY : 1) : lit ? GRAY : 0);
    if (key < props.reach) {
      const cx = r.x + (r.w >> 1);
      const cy = r.y + r.h - 5;
      rect(frame, cx - 1, cy, 2, 2, slot.black ? 0 : 1);
    }
  }
}

/** The OP-1's keys: press one to play it, drag across them for a run. */
export function Keyboard(props: KeyboardProps): JSX.Element {
  let frame: Frame | null = null;
  let held: number | null = null;
  const geometry = () => keyGeometry(props.width, props.height);
  const press = (x: number, y: number) => {
    const key = keyAt(geometry(), x, y);
    if (key === held) return;
    if (held !== null) props.onKeyUp(held);
    held = key;
    if (key !== null) props.onKeyDown(key);
  };
  const lift = () => {
    if (held !== null) props.onKeyUp(held);
    held = null;
  };
  return (
    <raster
      width={props.width}
      height={props.height}
      revision={props.revision}
      semantic={{ name: "keyboard", role: "keyboard", value: `${KEY_COUNT} keys` }}
      onPaint={(surface) => {
        frame = ensureFrame(frame, props.width, props.height);
        drawKeyboard(frame, props, geometry());
        surface.blitPixels(frame.pixels, frame.width, frame.height);
      }}
      onMouseDown={press}
      onDrag={press}
      onMouseUp={lift}
      onDragEnd={lift}
    />
  );
}

/** Where a key sits in the keyboard raster, for tests that click it. */
export function keyCenter(width: number, height: number, key: number): { x: number; y: number } {
  const r = keyRect(keyGeometry(width, height), key);
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

// ---------------------------------------------------------------------------
// Speaker
// ---------------------------------------------------------------------------

/** The round speaker grille, holes on a hex grid. */
export function Speaker(props: { size: number }): JSX.Element {
  const frame = createFrame(props.size, props.size);
  const c = (props.size - 1) / 2;
  const radius = props.size / 2 - 1;
  for (let y = 1; y < props.size - 1; y += 3) {
    const offset = Math.floor(y / 3) % 2 === 0 ? 0 : 1.5;
    for (let x = 1 + offset; x < props.size - 1; x += 3) {
      if (Math.hypot(x - c, y - c) <= radius - 1.5) rect(frame, Math.round(x), y, 2, 2, 1);
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
