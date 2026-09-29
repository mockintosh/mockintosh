/**
 * The TP-7's OLED, drawn into a 1-bit frame: lit pixels are white on a
 * black glass. Words are set over the frame as text (see `screenLabels`);
 * everything else — the scrolling waveform, the head, the marks, the meter,
 * the dot-matrix counter — is drawn here.
 *
 * The tape view keeps the head still in the middle and moves the tape past
 * it, as the TP-7 does: what has played is to the left, what is coming to
 * the right.
 */
import { PEAK_BLOCK } from "./engine";
import { line, plot, rect, type Frame, type Ink } from "../synth/pixels";

export const SCREEN_W = 200;
export const SCREEN_H = 104;

/** A lit OLED pixel, and the glass. */
const LIT: Ink = 0;
const GLASS: Ink = 1;

const STRIP_X0 = 3;
const STRIP_X1 = 187;
const STRIP_Y = 16;
const STRIP_H = 44;
const STRIP_MID = STRIP_Y + STRIP_H / 2;
const HEAD_X = 95;
const PX_PER_SECOND = 36;
const METER_X = 191;
const METER_W = 6;
const COUNTER_Y = 66;
const OVERVIEW_Y = 91;
const OVERVIEW_H = 7;
/** The meter's floor, in dB. */
const METER_FLOOR_DB = -48;

const LIST_Y = 16;
const ROW_H = 14;
export const LIST_ROWS = 6;

/** What the transport is doing, as the status icon shows it. */
export type TransportStatus = "stop" | "play" | "record" | "arming" | "forward" | "rewind" | "scrub";

export interface TapeView {
  kind: "tape";
  status: TransportStatus;
  /** Peaks of the tape (or the take being recorded); null with nothing loaded. */
  peaks: Float32Array | null;
  /** Frames of tape. */
  length: number;
  sampleRate: number;
  /** The head, in frames. */
  head: number;
  /** Frames the progress bar spans: the tape's length, or a take's capacity. */
  span: number;
  markers: readonly number[];
  /** Peak level 0…1 for the meter: the input while recording, the output otherwise. */
  level: number;
  clip: boolean;
  /** Quarter-second blink, for the record light. */
  blink: boolean;
  /** Words for the title and around the counter. */
  statusText: string;
  title: string;
  total: string;
  detail: string;
  /** Shown across the waveform when there is nothing to draw. */
  empty: string;
}

export interface ListRow {
  name: string;
  duration: string;
  /** The memo under the head. */
  loaded: boolean;
}

export interface ListView {
  kind: "list";
  rows: readonly ListRow[];
  cursor: number;
  title: string;
}

export type ScreenView = TapeView | ListView;

/** Words set over the frame. */
export interface ScreenLabel {
  text: string;
  left: number;
  top: number;
  width?: number;
  align?: "left" | "right" | "center";
  /** 0 is lit (white), 1 dark — for words on a highlighted row. */
  color: Ink;
}

/** Most labels any view sets; the display keeps this many text slots. */
export const LABEL_SLOTS = 4 + LIST_ROWS * 2;

// ---------------------------------------------------------------------------
// Dot-matrix numerals for the counter
// ---------------------------------------------------------------------------

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "011", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ":": ["0", "1", "0", "1", "0"],
  ".": ["0", "0", "0", "0", "1"],
  "-": ["000", "000", "111", "000", "000"],
};
/** Pixels per cell of a numeral; each lit cell is a 2×2 dot. */
const DOT_PITCH = 3;

function drawNumerals(frame: Frame, x: number, y: number, text: string): void {
  let at = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) {
      at += 3 * DOT_PITCH + DOT_PITCH;
      continue;
    }
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] === "1") rect(frame, at + gx * DOT_PITCH, y + gy * DOT_PITCH, 2, 2, LIT);
      }
    });
    at += glyph[0]!.length * DOT_PITCH + DOT_PITCH;
  }
}

// ---------------------------------------------------------------------------
// Tape view
// ---------------------------------------------------------------------------

function drawStatusIcon(frame: Frame, status: TransportStatus, blink: boolean): void {
  const x = 4;
  const y = 4;
  switch (status) {
    case "record":
    case "arming":
      if (status === "record" ? blink : true) {
        for (let dy = 0; dy < 7; dy++) {
          for (let dx = 0; dx < 7; dx++) {
            const inside = Math.hypot(dx - 3, dy - 3) <= 3.3;
            if (inside && (status === "record" || (dx + dy) % 2 === 0)) plot(frame, x + dx, y + dy, LIT);
          }
        }
      }
      break;
    case "play":
      for (let dx = 0; dx < 6; dx++) line(frame, x + dx, y + Math.floor(dx / 2), x + dx, y + 6 - Math.floor(dx / 2), LIT);
      break;
    case "forward":
    case "rewind":
      for (let k = 0; k < 2; k++) {
        for (let dx = 0; dx < 4; dx++) {
          const px = status === "forward" ? x + k * 4 + dx : x + 7 - (k * 4 + dx);
          line(frame, px, y + dx, px, y + 6 - dx, LIT);
        }
      }
      break;
    case "scrub":
      for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const d = Math.hypot(dx - 3, dy - 3);
          if (Math.abs(d - 3) < 0.6 || d < 1) plot(frame, x + dx, y + dy, LIT);
        }
      }
      break;
    case "stop":
      rect(frame, x, y, 7, 7, LIT);
      break;
  }
}

function drawMeter(frame: Frame, level: number, clip: boolean): void {
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const fill = Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
  const segments = Math.floor((STRIP_H - 4) / 3);
  const lit = Math.round(fill * segments);
  for (let s = 0; s < segments; s++) {
    const y = STRIP_Y + STRIP_H - 3 - s * 3;
    if (s < lit) rect(frame, METER_X, y, METER_W, 2, LIT);
    else plot(frame, METER_X + (METER_W >> 1), y, LIT);
  }
  // The clip light sits above the scale.
  if (clip) rect(frame, METER_X, STRIP_Y, METER_W, 3, LIT);
  else rect(frame, METER_X, STRIP_Y + 2, METER_W, 1, LIT);
}

function drawWaveform(frame: Frame, view: TapeView): void {
  for (let x = STRIP_X0; x <= STRIP_X1; x += 2) plot(frame, x, STRIP_MID, LIT);
  const peaks = view.peaks;
  if (!peaks || view.length === 0) return;
  const headSeconds = view.head / view.sampleRate;
  const framesPerPx = view.sampleRate / PX_PER_SECOND;
  const lastPeak = Math.ceil(view.length / PEAK_BLOCK);
  const halfH = STRIP_H / 2 - 2;
  for (let x = STRIP_X0; x <= STRIP_X1; x++) {
    const from = (headSeconds + (x - HEAD_X) / PX_PER_SECOND) * view.sampleRate;
    const p0 = Math.max(0, Math.floor(from / PEAK_BLOCK));
    const p1 = Math.min(lastPeak, Math.ceil((from + framesPerPx) / PEAK_BLOCK));
    if (p1 <= p0) continue;
    let peak = 0;
    for (let p = p0; p < p1; p++) peak = Math.max(peak, peaks[p] ?? 0);
    const h = Math.max(1, Math.round(Math.pow(Math.min(1, peak), 0.6) * halfH));
    const ahead = x > HEAD_X;
    for (let y = STRIP_MID - h; y <= STRIP_MID + h; y++) {
      // Tape still to come is drawn in half-tone.
      if (!ahead || (x + y) % 2 === 0) plot(frame, x, y, LIT);
    }
  }
}

function drawMarkers(frame: Frame, view: TapeView): void {
  const headSeconds = view.head / view.sampleRate;
  for (const marker of view.markers) {
    const x = Math.round(HEAD_X + (marker / view.sampleRate - headSeconds) * PX_PER_SECOND);
    if (x < STRIP_X0 || x > STRIP_X1) continue;
    for (let y = STRIP_Y + 4; y < STRIP_Y + STRIP_H; y += 3) plot(frame, x, y, LIT);
    line(frame, x - 2, STRIP_Y, x + 2, STRIP_Y, LIT);
    line(frame, x - 1, STRIP_Y + 1, x + 1, STRIP_Y + 1, LIT);
    plot(frame, x, STRIP_Y + 2, LIT);
  }
}

function drawHead(frame: Frame): void {
  // A notch in the glass above and below, and the head line between.
  for (let y = STRIP_Y; y < STRIP_Y + STRIP_H; y++) plot(frame, HEAD_X, y, (y & 1) === 0 || y < STRIP_Y + 3 ? LIT : GLASS);
  line(frame, HEAD_X - 3, STRIP_Y - 2, HEAD_X + 3, STRIP_Y - 2, LIT);
  line(frame, HEAD_X - 3, STRIP_Y + STRIP_H + 1, HEAD_X + 3, STRIP_Y + STRIP_H + 1, LIT);
}

function drawOverview(frame: Frame, view: TapeView): void {
  const x0 = STRIP_X0;
  const w = METER_X + METER_W - x0;
  // Outline with rounded ends.
  line(frame, x0 + 1, OVERVIEW_Y, x0 + w - 2, OVERVIEW_Y, LIT);
  line(frame, x0 + 1, OVERVIEW_Y + OVERVIEW_H - 1, x0 + w - 2, OVERVIEW_Y + OVERVIEW_H - 1, LIT);
  line(frame, x0, OVERVIEW_Y + 1, x0, OVERVIEW_Y + OVERVIEW_H - 2, LIT);
  line(frame, x0 + w - 1, OVERVIEW_Y + 1, x0 + w - 1, OVERVIEW_Y + OVERVIEW_H - 2, LIT);
  if (view.span <= 0) return;
  const inner = w - 4;
  const filled = Math.round(Math.min(1, view.head / view.span) * inner);
  rect(frame, x0 + 2, OVERVIEW_Y + 2, filled, OVERVIEW_H - 4, LIT);
  for (const marker of view.markers) {
    const x = x0 + 2 + Math.round((marker / view.span) * inner);
    line(frame, x, OVERVIEW_Y - 3, x, OVERVIEW_Y - 1, LIT);
  }
}

/** "01:23.4" — minutes, seconds and tenths. */
export function formatCounter(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

/** "1:23" — for lists and totals. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function drawTape(frame: Frame, view: TapeView): void {
  drawStatusIcon(frame, view.status, view.blink);
  // The empty-state words sit where the strip would be; the glass stays clear for them.
  if (!view.empty) {
    drawWaveform(frame, view);
    drawMarkers(frame, view);
    drawHead(frame);
  }
  drawMeter(frame, view.level, view.clip);
  drawNumerals(frame, 4, COUNTER_Y, formatCounter(view.sampleRate > 0 ? view.head / view.sampleRate : 0));
  drawOverview(frame, view);
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

/** The first row shown, keeping the cursor on screen. */
export function listTop(cursor: number, count: number): number {
  return Math.max(0, Math.min(count - LIST_ROWS, cursor - Math.floor(LIST_ROWS / 2)));
}

function drawList(frame: Frame, view: ListView): void {
  line(frame, 2, LIST_Y - 2, SCREEN_W - 3, LIST_Y - 2, LIT);
  const top = listTop(view.cursor, view.rows.length);
  for (let r = 0; r < LIST_ROWS; r++) {
    const row = view.rows[top + r];
    if (!row) break;
    const y = LIST_Y + r * ROW_H;
    const selected = top + r === view.cursor;
    if (selected) rect(frame, 2, y, SCREEN_W - 4, ROW_H - 1, LIT);
    if (row.loaded) {
      const ink = selected ? GLASS : LIT;
      for (let dx = 0; dx < 3; dx++) line(frame, 5 + dx, y + 3 + dx, 5 + dx, y + 9 - dx, ink);
    }
  }
  // A scroll bar when the list runs past the screen.
  if (view.rows.length > LIST_ROWS) {
    const trackH = LIST_ROWS * ROW_H - 2;
    const thumbH = Math.max(4, Math.round((LIST_ROWS / view.rows.length) * trackH));
    const thumbY = LIST_Y + Math.round((top / (view.rows.length - LIST_ROWS)) * (trackH - thumbH));
    rect(frame, SCREEN_W - 2, thumbY, 1, thumbH, LIT);
  }
}

// ---------------------------------------------------------------------------

export function drawScreen(frame: Frame, view: ScreenView): void {
  frame.pixels.fill(GLASS);
  if (view.kind === "tape") drawTape(frame, view);
  else drawList(frame, view);
}

export function screenLabels(view: ScreenView): ScreenLabel[] {
  if (view.kind === "list") {
    const labels: ScreenLabel[] = [
      { text: "MEMOS", left: 4, top: 1, color: LIT },
      { text: view.title, left: 60, top: 1, width: SCREEN_W - 64, align: "right", color: LIT },
    ];
    if (view.rows.length === 0) {
      labels.push({ text: "NO MEMOS YET", left: 0, top: 40, width: SCREEN_W, align: "center", color: LIT });
      labels.push({ text: "PRESS RECORD TO MAKE ONE", left: 0, top: 54, width: SCREEN_W, align: "center", color: LIT });
    }
    const top = listTop(view.cursor, view.rows.length);
    for (let r = 0; r < LIST_ROWS; r++) {
      const row = view.rows[top + r];
      if (!row) break;
      const color: Ink = top + r === view.cursor ? GLASS : LIT;
      const y = LIST_Y + r * ROW_H + 1;
      labels.push({ text: row.name, left: 12, top: y, width: 130, color });
      labels.push({ text: row.duration, left: 140, top: y, width: SCREEN_W - 148, align: "right", color });
    }
    return labels;
  }
  const labels: ScreenLabel[] = [
    { text: view.statusText, left: 15, top: 1, color: LIT },
    { text: view.title, left: 70, top: 1, width: SCREEN_W - 74, align: "right", color: LIT },
    { text: view.total, left: 90, top: COUNTER_Y - 1, width: SCREEN_W - 94, align: "right", color: LIT },
    { text: view.detail, left: 90, top: COUNTER_Y + 10, width: SCREEN_W - 94, align: "right", color: LIT },
  ];
  if (view.empty) labels.push({ text: view.empty, left: 0, top: STRIP_MID - 6, width: STRIP_X1, align: "center", color: LIT });
  return labels;
}
