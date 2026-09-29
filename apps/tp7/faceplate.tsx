/**
 * The TP-7's faceplate: the OLED, the motorised reel with its shuttle ring,
 * the three big transport keys down the side, the small keys under the
 * display, and the speaker grille.
 *
 * None of these take focus, so the recorder keeps the keyboard while you
 * click them.
 */
import { createMemo, createSignal, For } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { GRAY, createFrame, line, rect, type Frame } from "../synth/pixels";
import { LABEL_SLOTS, SCREEN_H, SCREEN_W, drawScreen, screenLabels, type ScreenView } from "./screen";

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export interface ScreenProps {
  /** Read at paint time and for the words over it. */
  view: ScreenView;
  revision: number;
  /** The display's words, for its semantic value. */
  summary: string;
}

export function Screen(props: ScreenProps): JSX.Element {
  const frame = createFrame(SCREEN_W, SCREEN_H);
  const labels = createMemo(() => screenLabels(props.view));
  const slots = Array.from({ length: LABEL_SLOTS }, (_, i) => i);
  return (
    <box width={SCREEN_W} height={SCREEN_H} semantic={{ name: "display", role: "status", value: props.summary }}>
      <raster
        width={SCREEN_W}
        height={SCREEN_H}
        revision={props.revision}
        onPaint={(surface) => {
          drawScreen(frame, props.view);
          surface.blitPixels(frame.pixels, SCREEN_W, SCREEN_H);
        }}
      />
      <For each={slots}>
        {(slot) => {
          const label = () => labels()[slot];
          return (
            <text
              position="absolute"
              left={label()?.left ?? 0}
              top={label()?.top ?? 0}
              width={label()?.width}
              align={label()?.align ?? "left"}
              font="body"
              color={label()?.color ?? 0}
              nowrap
            >
              {label()?.text ?? ""}
            </text>
          );
        }}
      </For>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Reel
// ---------------------------------------------------------------------------

export const REEL_SIZE = 176;
const C = (REEL_SIZE - 1) / 2;
const RING_OUTER = 87;
const RING_INNER = 79;
const PLATTER_R = 75;
const HUB_R = 13;
const WINDOW_INNER = 24;
const WINDOW_OUTER = 60;
/** Angular half-width of each of the platter's three windows. */
const WINDOW_HALF = 0.42;
/** How far the shuttle ring turns before it hits its stop. */
export const RING_TRAVEL = Math.PI / 3;

/** Signed difference between two angles, −π…π. */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function drawReel(frame: Frame, angle: number, ring: number, held: boolean, ringHeld: boolean): void {
  frame.pixels.fill(0);
  const ringAngle = ring * RING_TRAVEL;
  for (let y = 0; y < REEL_SIZE; y++) {
    for (let x = 0; x < REEL_SIZE; x++) {
      const dx = x - C;
      const dy = y - C;
      const d = Math.hypot(dx, dy);
      if (d > RING_OUTER + 0.5) continue;
      const i = y * REEL_SIZE + x;
      const a = Math.atan2(dy, dx);
      if (d > RING_INNER) {
        // The knurled shuttle ring: ridges every 10°, turning with it.
        const ridge = Math.floor(((a - ringAngle) / (2 * Math.PI)) * 36 + 360) % 2 === 0;
        const edge = d > RING_OUTER - 0.8 || d < RING_INNER + 0.8;
        frame.pixels[i] = edge || ridge || ringHeld ? 1 : 0;
      } else if (d > PLATTER_R + 1) {
        frame.pixels[i] = 0;
      } else if (d > PLATTER_R - 0.8) {
        frame.pixels[i] = 1;
      } else if (d <= HUB_R) {
        frame.pixels[i] = d > HUB_R - 1 || d < 2.5 ? 1 : 0;
      } else {
        // Three windows through the platter, turning with the tape.
        let inWindow = false;
        if (d > WINDOW_INNER && d < WINDOW_OUTER) {
          for (let k = 0; k < 3; k++) {
            if (Math.abs(angleDelta(a, angle + (k * 2 * Math.PI) / 3)) < WINDOW_HALF * (1 - (d - WINDOW_INNER) / (4 * WINDOW_OUTER))) {
              inWindow = true;
            }
          }
        }
        if (inWindow) {
          const rim = Math.abs(d - WINDOW_INNER) < 1 || Math.abs(d - WINDOW_OUTER) < 1;
          frame.pixels[i] = rim ? 1 : 0;
        } else {
          frame.pixels[i] = held ? 1 : GRAY(x, y);
        }
      }
    }
  }
  // Window edges, the strobe dot near the rim.
  for (let k = 0; k < 3; k++) {
    for (const side of [-1, 1]) {
      const edge = angle + (k * 2 * Math.PI) / 3 + side * WINDOW_HALF * 0.95;
      line(frame, C + Math.cos(edge) * WINDOW_INNER, C + Math.sin(edge) * WINDOW_INNER, C + Math.cos(edge) * (WINDOW_OUTER - 2), C + Math.sin(edge) * (WINDOW_OUTER - 2), 1);
    }
  }
  const sx = Math.round(C + Math.cos(angle + Math.PI / 3) * (PLATTER_R - 7));
  const sy = Math.round(C + Math.sin(angle + Math.PI / 3) * (PLATTER_R - 7));
  rect(frame, sx - 3, sy - 3, 7, 7, 1);
  rect(frame, sx - 2, sy - 2, 5, 5, 0);
}

export interface ReelProps {
  /** The platter's rotation, in radians. */
  angle: number;
  /** Something about the reel changed that `angle` doesn't show. */
  revision: number;
  /** A finger on the platter. */
  onGrab(): void;
  /** The platter turned by `radians` under the finger. */
  onTurn(radians: number): void;
  onRelease(): void;
  /** The shuttle ring turned to −1…1; 0 when it springs back. */
  onShuttle(deflection: number): void;
  /** A scroll-wheel notch over the reel. */
  onNudge(ticks: number): void;
}

/**
 * The motorised reel. The platter turns with the tape; hold it to stop the
 * tape, turn it to scrub. The ring around it is a spring-loaded shuttle:
 * turn it and the tape winds that way until you let go.
 */
export function Reel(props: ReelProps): JSX.Element {
  const [held, setHeld] = createSignal<"platter" | "ring" | null>(null);
  const [ring, setRing] = createSignal(0);
  const frame = createFrame(REEL_SIZE, REEL_SIZE);
  let paints = 0;
  const revision = createMemo(() => {
    props.revision;
    Math.round(props.angle * 200);
    held();
    ring();
    return ++paints;
  });

  let lastAngle = 0;
  let startAngle = 0;
  const pointerAngle = (x: number, y: number) => Math.atan2(y - C, x - C);

  const press = (x: number, y: number) => {
    const d = Math.hypot(x - C, y - C);
    if (d > RING_OUTER + 2) return;
    if (d > PLATTER_R + 1) {
      setHeld("ring");
      startAngle = pointerAngle(x, y);
    } else {
      setHeld("platter");
      lastAngle = pointerAngle(x, y);
      props.onGrab();
    }
  };
  const drag = (x: number, y: number) => {
    const grip = held();
    if (grip === "platter") {
      const a = pointerAngle(x, y);
      const turned = angleDelta(a, lastAngle);
      lastAngle = a;
      if (turned !== 0) props.onTurn(turned);
    } else if (grip === "ring") {
      const deflection = Math.max(-1, Math.min(1, angleDelta(pointerAngle(x, y), startAngle) / RING_TRAVEL));
      setRing(deflection);
      props.onShuttle(deflection);
    }
  };
  const lift = () => {
    const grip = held();
    setHeld(null);
    if (grip === "platter") props.onRelease();
    if (grip === "ring") {
      setRing(0);
      props.onShuttle(0);
    }
  };

  return (
    <raster
      width={REEL_SIZE}
      height={REEL_SIZE}
      revision={revision()}
      cursor="grab"
      semantic={{ name: "reel", role: "slider", value: held() ?? "free" }}
      onPaint={(surface) => {
        drawReel(frame, props.angle, ring(), held() === "platter", held() === "ring");
        surface.blitPixels(frame.pixels, REEL_SIZE, REEL_SIZE);
      }}
      onMouseDown={press}
      onDrag={drag}
      onMouseUp={lift}
      onDragEnd={lift}
      onScroll={(deltaY) => props.onNudge(deltaY > 0 ? 1 : -1)}
    />
  );
}

/** Where on the reel to press for the platter or the ring, for tests. */
export function reelPoint(part: "platter" | "ring", angle = 0): { x: number; y: number } {
  const r = part === "platter" ? (WINDOW_OUTER + PLATTER_R) / 2 : (RING_INNER + RING_OUTER) / 2;
  return { x: Math.round(C + Math.cos(angle) * r), y: Math.round(C + Math.sin(angle) * r) };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Parse a key picture: `#` is ink. */
function picture(rows: readonly string[]): Frame {
  const frame = createFrame(rows[0]!.length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") frame.pixels[y * frame.width + x] = 1;
  });
  return frame;
}

const BIG_ICONS = {
  record: picture([
    "....#####....",
    "..#########..",
    ".###########.",
    ".###########.",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    ".###########.",
    ".###########.",
    "..#########..",
    "....#####....",
  ]),
  play: picture([
    "##...........",
    "####.........",
    "######.......",
    "########.....",
    "##########...",
    "############.",
    "#############",
    "############.",
    "##########...",
    "########.....",
    "######.......",
    "####.........",
    "##...........",
  ]),
  stop: picture([
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
    "#############",
  ]),
} as const;

const SMALL_ICONS = {
  list: picture([
    "#.#########",
    "...........",
    "#.#########",
    "...........",
    "#.#########",
    "...........",
    "#.#########",
  ]),
  mark: picture([
    ".....#.....",
    "....###....",
    "...#####...",
    "..#######..",
    "...#####...",
    "....###....",
    ".....#.....",
  ]),
  previous: picture([
    "#.....#...#",
    "#....##..##",
    "#...###.###",
    "#..########",
    "#...###.###",
    "#....##..##",
    "#.....#...#",
  ]),
  next: picture([
    "#...#.....#",
    "##..##....#",
    "###.###...#",
    "########..#",
    "###.###...#",
    "##..##....#",
    "#...#.....#",
  ]),
} as const;

export type BigIconName = keyof typeof BIG_ICONS;
export type SmallIconName = keyof typeof SMALL_ICONS;

function Pictogram(props: { art: Frame; inverted: boolean }): JSX.Element {
  const pixels = new Uint8Array(props.art.pixels.length);
  return (
    <raster
      width={props.art.width}
      height={props.art.height}
      revision={props.inverted ? 1 : 0}
      onPaint={(surface) => {
        const art = props.art.pixels;
        for (let i = 0; i < art.length; i++) pixels[i] = props.inverted ? (art[i] ? 0 : 1) : art[i]!;
        surface.blitPixels(pixels, props.art.width, props.art.height);
      }}
    />
  );
}

interface KeyProps {
  name: string;
  lit?: boolean;
  onPress(): void;
}

/** A press that inverts while the mouse is down, and stays inverted while `lit`. */
function useKey(props: KeyProps) {
  const [down, setDown] = createSignal(false);
  const inverted = () => (props.lit ?? false) !== down();
  return {
    inverted,
    handlers: {
      onMouseDown: () => setDown(true),
      onMouseUp: () => setDown(false),
      onClick: () => props.onPress(),
    },
  };
}

export const SIDE_KEY_W = 38;

/** One of the three big transport keys down the TP-7's side. */
export function SideKey(props: KeyProps & { icon: BigIconName; height: number }): JSX.Element {
  const key = useKey(props);
  return (
    <box
      width={SIDE_KEY_W}
      height={props.height}
      borderWidth={1}
      borderColor={1}
      borderRadius={9}
      shadow
      background={key.inverted() ? 1 : 0}
      alignItems="center"
      justifyContent="center"
      semantic={{ name: props.name, role: "button", value: props.lit ? "on" : "off" }}
      onMouseDown={key.handlers.onMouseDown}
      onMouseUp={key.handlers.onMouseUp}
      onClick={key.handlers.onClick}
    >
      <Pictogram art={BIG_ICONS[props.icon]} inverted={key.inverted()} />
    </box>
  );
}

export const SMALL_KEY_W = 44;
export const SMALL_KEY_H = 20;

/** A small key under the display. */
export function SmallKey(props: KeyProps & { icon: SmallIconName }): JSX.Element {
  const key = useKey(props);
  return (
    <box
      width={SMALL_KEY_W}
      height={SMALL_KEY_H}
      borderWidth={1}
      borderColor={1}
      borderRadius={4}
      background={key.inverted() ? 1 : 0}
      alignItems="center"
      justifyContent="center"
      semantic={{ name: props.name, role: "button", value: props.lit ? "on" : "off" }}
      onMouseDown={key.handlers.onMouseDown}
      onMouseUp={key.handlers.onMouseUp}
      onClick={key.handlers.onClick}
    >
      <Pictogram art={SMALL_ICONS[props.icon]} inverted={key.inverted()} />
    </box>
  );
}

// ---------------------------------------------------------------------------
// Grille and microphone
// ---------------------------------------------------------------------------

/** The speaker: holes drilled on a hex grid, filling a rounded rectangle. */
export function Grille(props: { width: number; height: number }): JSX.Element {
  const frame = createFrame(props.width, props.height);
  const pitch = 4;
  for (let row = 0; row * pitch + 2 <= props.height - 2; row++) {
    const y = 1 + row * pitch;
    const offset = row % 2 === 0 ? 0 : pitch / 2;
    for (let x = 1 + offset; x + 2 <= props.width - 1; x += pitch) rect(frame, Math.round(x), y, 2, 2, 1);
  }
  return (
    <raster
      width={props.width}
      height={props.height}
      revision={0}
      onPaint={(surface) => surface.blitPixels(frame.pixels, frame.width, frame.height)}
    />
  );
}

/** The microphone's pinhole, with a light that shows while it listens. */
export function MicHole(props: { listening: boolean }): JSX.Element {
  const size = 9;
  const frame = createFrame(size, size);
  return (
    <raster
      width={size}
      height={size}
      revision={props.listening ? 1 : 0}
      semantic={{ name: "microphone", role: "status", value: props.listening ? "listening" : "off" }}
      onPaint={(surface) => {
        const c = (size - 1) / 2;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const d = Math.hypot(x - c, y - c);
            frame.pixels[y * size + x] = d <= 4.2 && (d > 3.2 || props.listening || d < 1.2) ? 1 : 0;
          }
        }
        surface.blitPixels(frame.pixels, size, size);
      }}
    />
  );
}
