/**
 * The OP-1's displays, drawn into 1-bit frames: the main screen, a picture
 * of what the page does, and the strip under the encoders, their four values
 * each marked with its encoder's fill and set under its knob. The OP-1 tells
 * its encoders apart by colour; these displays tell them apart by pattern —
 * solid, half-tone, hollow, dotted.
 *
 * Everything is drawn black on white and inverted at the end, so the
 * Synthesizer's pixel routines and scope work unchanged on a black screen.
 */
import { TAU } from "../synth/dsp";
import { DELAY_DIVISIONS, toTravel, type ParamDef } from "../synth/params";
import { GRAY, LIGHT, ensureFrame, frameRect, line, plot, rect, type Frame, type Ink } from "../synth/pixels";
import { drawWave, type ScopeSource } from "../synth/Scope";
import { PAD_COUNT } from "./drums";
import { FxKind } from "./fx";
import { KEY_COUNT, KEY_SLOTS } from "./keys";
import type { EncoderIndex, Quad, QuadDefs } from "./params";
import { MAX_HOLD, MAX_STEPS, PAGE_STEPS, type Pattern } from "./sequencer";
import { PEAK_BLOCK, TAPE_TRACKS } from "./tape";

export const SCREEN_W = 216;
export const SCREEN_H = 80;
/** The title line, drawn as text over the frame. */
export const TITLE_H = 13;
export const ART_Y = 15;
export const ART_H = 62;

/** The strip under the encoders: a column per encoder, each centred under its knob. */
export const STRIP_W = 220;
export const STRIP_H = 38;
export const COLUMN_W = STRIP_W / 4;
/** Where an encoder's caption goes: beside its swatch, on the strip's first line. */
export const LABEL_X = 13;
export const LABEL_Y = 6;

/** The fill that identifies an encoder: 0 blue, 1 green, 2 white, 3 orange. */
export function encoderInk(index: EncoderIndex): Ink | ((x: number, y: number) => Ink) {
  return index === 0 ? 1 : index === 1 ? GRAY : index === 3 ? LIGHT : 0;
}

export function drawSwatch(frame: Frame, x: number, y: number, size: number, index: EncoderIndex): void {
  rect(frame, x, y, size, size, encoderInk(index));
  frameRect(frame, x, y, size, size, 1);
}

export interface StripView {
  defs: QuadDefs;
  values: Quad;
  /** The encoder last turned, drawn underlined. */
  active: EncoderIndex | null;
}

export interface TapeView {
  /** The head as heard, in frames. */
  head: number;
  capacity: number;
  /** Loop length in frames; 0 when off. */
  loop: number;
  sampleRate: number;
  peaks: readonly Float32Array[];
  track: number;
  mutes: readonly boolean[];
  recording: boolean;
  /** Half-second blink, for the record light. */
  blink: boolean;
}

/** A pattern as the sequencer page shows it. */
export interface PatternView {
  drum: boolean;
  pattern: Pattern;
  /** Step being edited. */
  cursor: number;
  /** Step being heard, or −1 while stopped. */
  playhead: number;
  /** The pad whose lane the drum page draws large. */
  pad: number;
}

/** A take being recorded: what's in so far, out of how much room. */
export interface TakeView {
  data: Float32Array;
  length: number;
  armed: boolean;
  blink: boolean;
}

export interface SampleView {
  /** `SAMPLE_COLUMNS` peaks of the whole sample. */
  peaks: Float32Array;
  start: number;
  end: number;
  loop: boolean;
  /** Where the newest voice is playing, 0…1, or −1. */
  head: number;
  take: TakeView | null;
}

export type ScreenArt =
  | { kind: "wave"; source: ScopeSource }
  | { kind: "pattern"; view: PatternView }
  | { kind: "sample"; view: SampleView }
  | { kind: "envelope"; env: Quad; level: number }
  | { kind: "fx"; fx: number; values: Quad }
  | { kind: "lfo"; values: Quad; value: number }
  | { kind: "pads"; selected: number; lit(pad: number): boolean }
  | { kind: "tape"; tape: TapeView }
  | { kind: "mixer"; levels: Quad; mutes: readonly boolean[]; meters: ArrayLike<number> }
  | { kind: "pan"; pans: Quad; mutes: readonly boolean[] };

const ART_BOTTOM = ART_Y + ART_H - 1;
const ART_MID = ART_Y + Math.floor(ART_H / 2);

let scratch: Frame | null = null;

function dottedH(frame: Frame, x0: number, x1: number, y: number, every = 2): void {
  for (let x = x0; x <= x1; x += every) plot(frame, x, y, 1);
}

function dottedV(frame: Frame, x: number, y0: number, y1: number, every = 2): void {
  for (let y = y0; y <= y1; y += every) plot(frame, x, y, 1);
}

function circle(frame: Frame, cx: number, cy: number, r: number, ink: Ink | ((x: number, y: number) => Ink), filled: boolean): void {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (filled ? d <= r : Math.abs(d - r) < 0.55) plot(frame, x, y, typeof ink === "function" ? ink(x, y) : ink);
    }
  }
}

/** Plot `y(x)` for every column from `x0` to `x1` as a joined line, clipped to the art. */
function curve(frame: Frame, x0: number, x1: number, y: (x: number) => number): void {
  let prev = y(x0);
  for (let x = x0 + 1; x <= x1; x++) {
    const next = y(x);
    line(frame, x - 1, Math.max(ART_Y, Math.min(ART_BOTTOM, prev)), x, Math.max(ART_Y, Math.min(ART_BOTTOM, next)), 1);
    prev = next;
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function drawEnvelope(frame: Frame, env: Quad, level: number): void {
  const [a, d, s, r] = env;
  const span = (t: number) => 6 + 40 * Math.max(0, Math.min(1, Math.log(t / 0.001) / Math.log(8000)));
  const x0 = 8;
  const xa = x0 + span(a);
  const xd = xa + span(d);
  const xs = xd + 30;
  const xr = xs + span(r);
  const top = ART_Y + 3;
  const bottom = ART_BOTTOM - 2;
  const height = bottom - top;
  const sy = bottom - s * height;
  dottedH(frame, x0, SCREEN_W - 14, bottom + 1);
  line(frame, x0, bottom, xa, top, 1);
  curve(frame, Math.round(xa), Math.round(xd), (x) => sy - (1 - s) * height * Math.exp((-5 * (x - xa)) / Math.max(1, xd - xa)));
  line(frame, xd, sy, xs, sy, 1);
  curve(frame, Math.round(xs), Math.round(xr), (x) => bottom - s * height * Math.exp((-5 * (x - xs)) / Math.max(1, xr - xs)));
  for (const x of [xa, xd, xs]) dottedV(frame, Math.round(x), top, bottom, 3);
  const meter = Math.round(level * height);
  frameRect(frame, SCREEN_W - 9, top, 5, height + 1, 1);
  rect(frame, SCREEN_W - 8, bottom + 1 - meter, 3, meter, 1);
}

/** Magnitude of a state-variable filter's output at `hz`, for drawing its response. */
function response(hz: number, cutoff: number, resonance: number, mode: "low" | "band" | "high"): number {
  const w = hz / cutoff;
  const k = 2 - 1.97 * resonance;
  const denominator = Math.hypot(1 - w * w, k * w);
  if (mode === "low") return 1 / denominator;
  if (mode === "band") return (k * w) / denominator;
  return (w * w) / denominator;
}

const freqAt = (x: number) => 20 * Math.pow(1000, (x - 4) / (SCREEN_W - 8));
const dbToY = (db: number) => ART_Y + 12 - db * 1.1;

function drawFx(frame: Frame, fx: number, p: Quad): void {
  if (fx === FxKind.Delay) {
    const steps = DELAY_DIVISIONS[Math.round(p[0])]?.steps ?? 4;
    const spacing = 5 + steps * 4;
    let height = ART_H - 6;
    for (let k = 0, x = 8; x < SCREEN_W - 4 && height >= 1; k++, x += spacing) {
      const jitter = Math.round(Math.sin(k * 2.3) * p[3] * 3);
      rect(frame, x + jitter, ART_BOTTOM - height, 3, height, k === 0 ? 1 : GRAY);
      frameRect(frame, x + jitter, ART_BOTTOM - height, 3, height, 1);
      height = Math.round((k === 0 ? p[2] : p[1]) * height);
    }
    return;
  }
  if (fx === FxKind.Spring) {
    const turns = 5 + Math.round(p[0] * 9);
    const amplitude = 6 + p[0] * 16;
    const decay = 0.2 + p[1] * 2.5;
    let px = 10;
    let py = ART_MID;
    for (let i = 1; i <= 600; i++) {
      const t = i / 600;
      const theta = t * turns * TAU;
      const a = amplitude * (0.35 + 0.65 * Math.exp(-decay * t));
      const x = 10 + t * (SCREEN_W - 26) + Math.cos(theta) * 4;
      const y = ART_MID + Math.sin(theta) * a;
      line(frame, px, py, x, y, 1);
      px = x;
      py = y;
    }
    const mix = Math.round(p[2] * (ART_H - 4));
    frameRect(frame, SCREEN_W - 9, ART_Y + 2, 5, ART_H - 3, 1);
    rect(frame, SCREEN_W - 8, ART_BOTTOM - mix, 3, mix, 1);
    return;
  }
  if (fx === FxKind.Nitro) {
    const mode = (["low", "band", "high"] as const)[Math.round(p[3])] ?? "low";
    const resonance = p[1] * 0.95;
    dottedH(frame, 4, SCREEN_W - 4, dbToY(0), 3);
    curve(frame, 4, SCREEN_W - 4, (x) => dbToY(20 * Math.log10(response(freqAt(x), p[0], resonance, mode) + 1e-6)));
    const swept = Math.min(20000, p[0] * Math.pow(2, p[2] * 6));
    const sx = 4 + (Math.log(swept / 20) / Math.log(1000)) * (SCREEN_W - 8);
    dottedV(frame, Math.round(sx), ART_Y + 2, ART_BOTTOM, 2);
    return;
  }
  // Phone: the band that gets through, in steps as coarse as the crush.
  const stepPx = 1 + Math.round(p[2] * 6);
  dottedH(frame, 4, SCREEN_W - 4, dbToY(0), 3);
  curve(frame, 4, SCREEN_W - 4, (x) => {
    const hz = freqAt(x);
    const mag = response(hz, p[0], 0.3, "high") * response(hz, Math.max(p[0] * 1.2, p[1]), 0.3, "low");
    const y = dbToY(20 * Math.log10(mag + 1e-6) + p[3] * 6);
    return Math.round(y / stepPx) * stepPx;
  });
}

/** The LFO's shape at phase `t` (0…1); the random shape is a fixed staircase. */
function lfoShape(shape: number, t: number, step: number): number {
  switch (shape) {
    case 1:
      return 1 - 4 * Math.abs(t - 0.5);
    case 2:
      return t < 0.5 ? 1 : -1;
    case 3:
      return Math.sin(step * 12.9898) * 43758.5453 % 1;
    case 4:
      return 1 - 2 * t;
    default:
      return Math.sin(TAU * t);
  }
}

function drawLfo(frame: Frame, p: Quad, value: number): void {
  const [, depth, shape] = p;
  const width = SCREEN_W - 24;
  const amplitude = (ART_H / 2 - 4) * (0.12 + 0.88 * depth);
  dottedH(frame, 6, SCREEN_W - 6, ART_MID, 3);
  const cycles = 2;
  curve(frame, 6, 6 + width, (x) => {
    const u = ((x - 6) / width) * cycles;
    return ART_MID - lfoShape(shape, u % 1, Math.floor(u * 4)) * amplitude;
  });
  const y = Math.round(ART_MID - value * amplitude);
  rect(frame, SCREEN_W - 10, y - 2, 5, 5, 1);
  dottedH(frame, 6 + width + 2, SCREEN_W - 11, y, 2);
}

function drawPads(frame: Frame, selected: number, lit: (pad: number) => boolean): void {
  const unit = 14;
  const x0 = Math.floor((SCREEN_W - unit * 14) / 2);
  const size = 12;
  for (let pad = 0; pad < KEY_COUNT; pad++) {
    const slot = KEY_SLOTS[pad]!;
    const x = x0 + Math.round(slot.x * unit) + 1;
    const y = slot.black ? ART_Y + 12 : ART_Y + 30;
    if (lit(pad)) rect(frame, x, y, size, size, 1);
    else if (slot.black) rect(frame, x, y, size, size, GRAY);
    frameRect(frame, x, y, size, size, 1);
    if (pad === selected) frameRect(frame, x - 2, y - 2, size + 4, size + 4, 1);
  }
}

const REEL_R = 15;

function drawReel(frame: Frame, cx: number, cy: number, pack: number, angle: number): void {
  circle(frame, cx, cy, 4 + pack * (REEL_R - 6), LIGHT, true);
  circle(frame, cx, cy, REEL_R, 1, false);
  circle(frame, cx, cy, 3, 1, true);
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * TAU) / 3;
    line(frame, cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, cx + Math.cos(a) * (REEL_R - 2), cy + Math.sin(a) * (REEL_R - 2), 1);
  }
}

/** Seconds of tape each lane column shows. */
const LANE_SECONDS_PER_PX = 0.04;

function drawTape(frame: Frame, tape: TapeView): void {
  const used = tape.capacity > 0 ? tape.head / tape.capacity : 0;
  const angle = (tape.head / tape.sampleRate) * 2.2;
  const cy = ART_Y + REEL_R + 1;
  const left = SCREEN_W / 2 - 48;
  const right = SCREEN_W / 2 + 48;
  drawReel(frame, left, cy, 1 - used, angle);
  drawReel(frame, right, cy, used, angle);
  line(frame, left, cy + REEL_R, right, cy + REEL_R, 1);
  rect(frame, SCREEN_W / 2 - 3, cy + REEL_R - 3, 7, 3, 1);

  const laneTop = ART_Y + 2 * REEL_R + 5;
  const laneH = 6;
  const x0 = 10;
  const center = Math.round((x0 + SCREEN_W - 2) / 2);
  const perPx = tape.sampleRate * LANE_SECONDS_PER_PX;
  const blocks = Math.max(1, Math.round(perPx / PEAK_BLOCK));
  for (let t = 0; t < TAPE_TRACKS; t++) {
    const y = laneTop + t * (laneH + 1);
    if (t === tape.track && !(tape.recording && tape.blink)) rect(frame, 2, y, 5, laneH, 1);
    else frameRect(frame, 2, y, 5, laneH, 1);
    const peaks = tape.peaks[t];
    if (!peaks) continue;
    for (let x = x0; x < SCREEN_W - 2; x++) {
      let at = tape.head + (x - center) * perPx;
      if (tape.loop > 0) at = ((at % tape.loop) + tape.loop) % tape.loop;
      if (at < 0 || at >= tape.capacity) continue;
      const b = Math.floor(at / PEAK_BLOCK);
      let peak = 0;
      for (let k = 0; k < blocks && b + k < peaks.length; k++) peak = Math.max(peak, peaks[b + k]!);
      if (peak < 0.004) {
        if (x % 4 === 0) plot(frame, x, y + laneH / 2, 1);
        continue;
      }
      const h = Math.max(1, Math.min(laneH, Math.round(Math.sqrt(Math.min(1, peak)) * laneH)));
      rect(frame, x, y + Math.floor((laneH - h) / 2), 1, h, tape.mutes[t] ? GRAY : 1);
    }
  }
  if (tape.loop > 0) {
    for (let x = x0; x < SCREEN_W - 2; x++) {
      const at = tape.head + (x - center) * perPx;
      const next = at + perPx;
      if (Math.floor(at / tape.loop) !== Math.floor(next / tape.loop)) dottedV(frame, x, laneTop - 2, laneTop + 4 * (laneH + 1), 2);
    }
  }
  rect(frame, center, laneTop - 3, 1, 4 * (laneH + 1) + 3, 1);
}

const TRACK_W = SCREEN_W / 4;

function drawMixer(frame: Frame, levels: Quad, mutes: readonly boolean[], meters: ArrayLike<number>): void {
  const top = ART_Y + 4;
  const bottom = ART_BOTTOM - 3;
  const range = bottom - top;
  for (let t = 0; t < 4; t++) {
    const cx = Math.round(t * TRACK_W + TRACK_W / 2) - 4;
    dottedV(frame, cx, top, bottom, 2);
    const y = Math.round(bottom - levels[t]! * range);
    if (mutes[t]) frameRect(frame, cx - 7, y - 2, 15, 5, 1);
    else rect(frame, cx - 7, y - 2, 15, 5, 1);
    const meter = Math.round(Math.min(1, Math.sqrt(meters[t] ?? 0)) * range);
    frameRect(frame, cx + 11, top, 4, range + 1, 1);
    rect(frame, cx + 12, bottom + 1 - meter, 2, meter, 1);
  }
}

/** Each track's place in the stereo field: a slider across its column, the middle marked. */
function drawPans(frame: Frame, pans: Quad, mutes: readonly boolean[]): void {
  const top = ART_Y + 6;
  const rowH = Math.floor((ART_BOTTOM - top) / 4);
  const left = 16;
  const right = SCREEN_W - 16;
  const middle = Math.round((left + right) / 2);
  for (let t = 0; t < 4; t++) {
    const y = top + t * rowH + Math.floor(rowH / 2);
    for (let x = left; x <= right; x += 2) plot(frame, x, y, 1);
    rect(frame, middle, y - 3, 1, 7, 1);
    rect(frame, left, y - 2, 1, 5, 1);
    rect(frame, right, y - 2, 1, 5, 1);
    const x = Math.round(middle + Math.max(-1, Math.min(1, pans[t]!)) * (middle - left));
    if (mutes[t]) frameRect(frame, x - 3, y - 4, 7, 9, 1);
    else rect(frame, x - 3, y - 4, 7, 9, 1);
  }
}

// ---------------------------------------------------------------------------
// The sequencer: one bar of steps at a time
// ---------------------------------------------------------------------------

export const SEQ_X0 = 4;
export const SEQ_COL = 13;
const PAGE_MARK_Y = ART_Y;
const SYNTH_GRID_TOP = ART_Y + 4;
const DRUM_LANE_Y = ART_Y + 3;
const DRUM_LANE_H = 8;
const DRUM_ROWS_Y = ART_Y + 13;
const DRUM_ROW_H = 2;

/** The page of steps the display shows: the playhead's while playing, else the cursor's. */
export function patternPage(view: Pick<PatternView, "cursor" | "playhead">): number {
  return Math.floor((view.playhead >= 0 ? view.playhead : view.cursor) / PAGE_STEPS);
}

/** What a click on the sequencer page lands on: a step of the page shown, and for drums, a pad row or the lane. */
export function patternHit(x: number, y: number, drum: boolean): { step: number; pad: number | null } | null {
  const step = Math.floor((x - SEQ_X0) / SEQ_COL);
  if (step < 0 || step >= PAGE_STEPS || y < ART_Y || y > ART_BOTTOM) return null;
  if (!drum || y < DRUM_ROWS_Y - 1) return { step, pad: null };
  return { step, pad: Math.max(0, Math.min(PAD_COUNT - 1, Math.floor((y - DRUM_ROWS_Y) / DRUM_ROW_H))) };
}

function drawPageMarks(frame: Frame, page: number, length: number): void {
  const pages = MAX_STEPS / PAGE_STEPS;
  for (let p = 0; p < pages; p++) {
    const x = SCREEN_W - 4 - (pages - p) * 9;
    if (p === page) rect(frame, x, PAGE_MARK_Y, 7, 2, 1);
    else if (p * PAGE_STEPS < length) frameRect(frame, x, PAGE_MARK_Y, 7, 2, 1);
    else plot(frame, x + 3, PAGE_MARK_Y + 1, 1);
  }
}

/** Fill a column: the dotted field past the pattern's end, or the playhead's light wash. */
function columnWash(frame: Frame, x: number, top: number, bottom: number, ink: (x: number, y: number) => Ink): void {
  rect(frame, x, top, SEQ_COL - 1, bottom - top + 1, ink);
}

const SPARSE = (x: number, y: number): Ink => (x % 4 === 0 && y % 4 === 0 ? 1 : 0);

function drawPattern(frame: Frame, view: PatternView): void {
  const { pattern } = view;
  const page = patternPage(view);
  drawPageMarks(frame, page, pattern.length);
  const top = view.drum ? DRUM_LANE_Y - 1 : SYNTH_GRID_TOP;
  const bottom = ART_BOTTOM;

  let lo = Infinity;
  let hi = -Infinity;
  if (!view.drum) {
    for (let i = 0; i < pattern.length; i++) {
      for (const note of pattern.steps[i] ?? []) {
        lo = Math.min(lo, note);
        hi = Math.max(hi, note);
      }
    }
    if (lo === Infinity) {
      lo = 60;
      hi = 72;
    } else if (hi - lo < 12) {
      const pad = Math.floor((12 - (hi - lo)) / 2);
      lo -= pad;
      hi = lo + 12;
    }
  }
  const span = Math.max(1, hi - lo);
  const noteY = (note: number) => bottom - 2 - Math.round(((note - lo) / span) * (bottom - top - 5));

  const first = page * PAGE_STEPS;
  for (let s = 0; s < PAGE_STEPS; s++) {
    const step = first + s;
    const x = SEQ_X0 + s * SEQ_COL;
    if (s > 0 && s % 4 === 0) dottedV(frame, x - 1, top, bottom, 2);
    if (step >= pattern.length) {
      columnWash(frame, x, top, bottom, SPARSE);
      continue;
    }
    if (step === view.playhead) columnWash(frame, x, top, bottom, LIGHT);
    if (!view.drum) continue;
    const values = pattern.steps[step] ?? [];
    const accent = pattern.accents[step] === true;
    if (values.includes(view.pad)) rect(frame, x + 1, DRUM_LANE_Y, SEQ_COL - 3, DRUM_LANE_H, 1);
    else {
      frameRect(frame, x + 1, DRUM_LANE_Y, SEQ_COL - 3, DRUM_LANE_H, 1);
      if (values.length > 0) rect(frame, x + 5, DRUM_LANE_Y + 3, 2, 2, 1);
    }
    // An accented hit is drawn wider and twice as tall.
    for (const pad of values) rect(frame, accent ? x : x + 2, DRUM_ROWS_Y + pad * DRUM_ROW_H, accent ? SEQ_COL - 1 : SEQ_COL - 5, accent ? 2 : 1, 1);
  }

  if (!view.drum) {
    // Notes held over from the page before reach into this one.
    const pageEnd = SEQ_X0 + PAGE_STEPS * SEQ_COL - 1;
    for (let step = Math.max(0, first - MAX_HOLD + 1); step < Math.min(pattern.length, first + PAGE_STEPS); step++) {
      const values = pattern.steps[step] ?? [];
      if (values.length === 0) continue;
      const held = (pattern.holds[step] ?? 1) - 1 + pattern.gate;
      const x0 = SEQ_X0 + (step - first) * SEQ_COL + 1;
      const x1 = Math.min(pageEnd, x0 + Math.max(2, Math.round(held * SEQ_COL - 1)));
      const from = Math.max(SEQ_X0, x0);
      if (x1 <= from) continue;
      const thick = pattern.accents[step] ? 5 : 3;
      for (const note of values) rect(frame, from, noteY(note) - (thick >> 1), x1 - from, thick, 1);
    }
  }

  const c = view.cursor - first;
  if (c >= 0 && c < PAGE_STEPS && view.cursor < pattern.length) {
    frameRect(frame, SEQ_X0 + c * SEQ_COL - 1, top - 1, SEQ_COL + 1, bottom - top + 2, 1);
  }
  if (view.drum) rect(frame, 1, DRUM_ROWS_Y + view.pad * DRUM_ROW_H, 2, 1, 1);
}

// ---------------------------------------------------------------------------
// The sampler: the recording, and the stretch of it that plays
// ---------------------------------------------------------------------------

export const SAMPLE_X0 = 4;
export const SAMPLE_COLUMNS = SCREEN_W - 2 * SAMPLE_X0;

function drawWaveColumns(frame: Frame, peaks: ArrayLike<number>, columns: number, ink: (column: number) => Ink | ((x: number, y: number) => Ink)): void {
  const half = ART_H / 2 - 4;
  for (let c = 0; c < columns; c++) {
    const h = Math.max(0, Math.round(Math.sqrt(Math.min(1, peaks[c] ?? 0)) * half));
    const x = SAMPLE_X0 + c;
    if (h === 0) {
      if (c % 3 === 0) plot(frame, x, ART_MID, 1);
      continue;
    }
    rect(frame, x, ART_MID - h, 1, 2 * h + 1, ink(c));
  }
}

function drawTake(frame: Frame, take: TakeView): void {
  const capacity = take.data.length;
  const filled = capacity > 0 ? Math.floor((take.length / capacity) * SAMPLE_COLUMNS) : 0;
  const peaks = new Float32Array(filled);
  const per = capacity / SAMPLE_COLUMNS;
  for (let c = 0; c < filled; c++) {
    let peak = 0;
    const end = Math.min(take.length, Math.ceil((c + 1) * per));
    for (let i = Math.floor(c * per); i < end; i++) peak = Math.max(peak, Math.abs(take.data[i]!));
    peaks[c] = peak;
  }
  dottedH(frame, SAMPLE_X0, SAMPLE_X0 + SAMPLE_COLUMNS - 1, ART_MID, 4);
  drawWaveColumns(frame, peaks, filled, () => 1);
  const x = SAMPLE_X0 + filled;
  if (!take.armed || take.blink) rect(frame, x, ART_Y + 2, 1, ART_H - 4, 1);
  frameRect(frame, SAMPLE_X0, ART_BOTTOM - 3, SAMPLE_COLUMNS, 3, 1);
  rect(frame, SAMPLE_X0, ART_BOTTOM - 3, filled, 3, 1);
}

function drawSample(frame: Frame, view: SampleView): void {
  if (view.take) {
    drawTake(frame, view.take);
    return;
  }
  const from = Math.round(Math.min(view.start, view.end) * (SAMPLE_COLUMNS - 1));
  const to = Math.round(Math.max(view.start, view.end) * (SAMPLE_COLUMNS - 1));
  drawWaveColumns(frame, view.peaks, SAMPLE_COLUMNS, (c) => (c >= from && c <= to ? 1 : LIGHT));
  const top = ART_Y + 1;
  for (const [x, dir] of [[SAMPLE_X0 + from, 1], [SAMPLE_X0 + to, -1]] as const) {
    rect(frame, x, top, 1, ART_H - 2, 1);
    for (let k = 0; k < 4; k++) {
      const w = 4 - k;
      rect(frame, dir > 0 ? x + 1 : x - w, top + k, w, 1, 1);
    }
  }
  if (view.loop) {
    dottedH(frame, SAMPLE_X0 + from + 5, SAMPLE_X0 + to - 5, ART_BOTTOM - 1, 2);
    line(frame, SAMPLE_X0 + from + 5, ART_BOTTOM - 1, SAMPLE_X0 + from + 8, ART_BOTTOM - 4, 1);
  }
  if (view.head >= 0) dottedV(frame, SAMPLE_X0 + Math.round(view.head * (SAMPLE_COLUMNS - 1)), top, ART_BOTTOM, 2);
}

/** Paint the encoder strip into `frame` (which must be `STRIP_W` × `STRIP_H`), inverted for the black screen. */
export function drawStrip(frame: Frame, strip: StripView): void {
  frame.pixels.fill(0);
  for (let i = 0; i < 4; i++) {
    const index = i as EncoderIndex;
    const x = Math.round(i * COLUMN_W);
    const def: ParamDef = strip.defs[index];
    drawSwatch(frame, x + 3, LABEL_Y + 2, 7, index);
    const barX = x + 3;
    const barW = Math.round(COLUMN_W) - 7;
    const barY = LABEL_Y + 16;
    frameRect(frame, barX, barY, barW, 6, 1);
    const travel = Math.max(0, Math.min(1, toTravel(def, strip.values[index])));
    const inner = barW - 2;
    const bipolar = def.kind === "number" && def.bipolar === true;
    const from = bipolar ? Math.round(inner / 2) : 0;
    const to = Math.round(travel * inner);
    rect(frame, barX + 1 + Math.min(from, to), barY + 1, Math.max(1, Math.abs(to - from)), 4, encoderInk(index) === 0 ? 1 : encoderInk(index));
    if (bipolar) rect(frame, barX + 1 + from, barY - 1, 1, 8, 1);
    if (strip.active === index) rect(frame, barX, barY + 8, barW, 1, 1);
  }
  invert(frame);
}

function invert(frame: Frame): void {
  for (let i = 0; i < frame.pixels.length; i++) frame.pixels[i] = frame.pixels[i] ? 0 : 1;
}

/** Paint the main display into `frame` (which must be `SCREEN_W` × `SCREEN_H`), inverted for the black screen. */
export function drawScreen(frame: Frame, art: ScreenArt): void {
  frame.pixels.fill(0);
  dottedH(frame, 0, SCREEN_W - 1, TITLE_H, 2);
  switch (art.kind) {
    case "wave": {
      scratch = ensureFrame(scratch, SCREEN_W, ART_H);
      scratch.pixels.fill(0);
      drawWave(scratch, art.source);
      frame.pixels.set(scratch.pixels, ART_Y * SCREEN_W);
      break;
    }
    case "pattern":
      drawPattern(frame, art.view);
      break;
    case "sample":
      drawSample(frame, art.view);
      break;
    case "envelope":
      drawEnvelope(frame, art.env, art.level);
      break;
    case "fx":
      drawFx(frame, art.fx, art.values);
      break;
    case "lfo":
      drawLfo(frame, art.values, art.value);
      break;
    case "pads":
      drawPads(frame, art.selected, art.lit);
      break;
    case "tape":
      drawTape(frame, art.tape);
      break;
    case "mixer":
      drawMixer(frame, art.levels, art.mutes, art.meters);
      break;
    case "pan":
      drawPans(frame, art.pans, art.mutes);
      break;
  }
  invert(frame);
}
