/**
 * The tape: a loop of one, two or four bars. Each sixteenth holds a drum
 * hit, a chord, and a hummed note. Empty is a rest — the chord and the
 * melody stop there; a drum at zero doesn't play.
 */

export const STEPS_PER_BAR = 16;

export type Bars = 1 | 2 | 4;

export const DRUM_LANES = ["kick", "snare", "hat", "open"] as const;
export type DrumLane = (typeof DRUM_LANES)[number];

/** What the four keys say in drum mode, in lane order. */
export const DRUM_LABELS = ["KICK", "SNARE", "HAT", "OPEN"] as const;

export interface Loop {
  bars: Bars;
  kick: number[];
  snare: number[];
  hat: number[];
  open: number[];
  /** Triad index, or −1 for a rest. Seven-note scales have seven triads. */
  chords: number[];
  /** MIDI note, or −1 for a rest. */
  lead: number[];
}

export function stepsIn(bars: Bars): number {
  return bars * STEPS_PER_BAR;
}

export function isBars(value: number): value is Bars {
  return value === 1 || value === 2 || value === 4;
}

const zeros = (n: number) => Array<number>(n).fill(0);
const rests = (n: number) => Array<number>(n).fill(-1);

export function createLoop(bars: Bars = 1): Loop {
  const n = stepsIn(bars);
  return { bars, kick: zeros(n), snare: zeros(n), hat: zeros(n), open: zeros(n), chords: rests(n), lead: rests(n) };
}

/** A new length, keeping the steps the two loops share. */
export function withBars(loop: Loop, bars: Bars): Loop {
  if (bars === loop.bars) return loop;
  const next = createLoop(bars);
  const n = Math.min(stepsIn(loop.bars), stepsIn(bars));
  for (const lane of DRUM_LANES) next[lane].splice(0, n, ...loop[lane].slice(0, n));
  next.chords.splice(0, n, ...loop.chords.slice(0, n));
  next.lead.splice(0, n, ...loop.lead.slice(0, n));
  return next;
}

/** The bar a step belongs to, counting from 0. */
export function barOf(step: number, bars: Bars): number {
  if (step < 0) return 0;
  return Math.floor(step / STEPS_PER_BAR) % bars;
}

const MARK: Record<DrumLane, string> = { kick: "K", snare: "S", hat: "H", open: "O" };

/** One tracker row, the playhead marked: `>01 K.H. C E4`. */
export function describeStep(loop: Loop, step: number, current: number, chord: string, lead: string): string {
  const drums = DRUM_LANES.map((lane) => ((loop[lane][step] ?? 0) > 0 ? MARK[lane] : ".")).join("");
  const index = String(step + 1).padStart(2, "0");
  const mark = step === current ? ">" : " ";
  return `${mark}${index} ${drums} ${chord} ${lead}`.trimEnd();
}

function lane(value: unknown, length: number, empty: number, min: number, max: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.map((item) => (typeof item === "number" && item >= min && item <= max && Number.isFinite(item) ? item : empty));
}

/** A loop from untrusted JSON, or null when the shape isn't one. */
export function sanitizeLoop(value: unknown): Loop | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.bars !== "number" || !isBars(record.bars)) return null;
  const n = stepsIn(record.bars);
  const kick = lane(record.kick, n, 0, 0, 1);
  const snare = lane(record.snare, n, 0, 0, 1);
  const hat = lane(record.hat, n, 0, 0, 1);
  const open = lane(record.open, n, 0, 0, 1);
  const chords = lane(record.chords, n, -1, -1, 6);
  const lead = lane(record.lead, n, -1, -1, 127);
  if (!kick || !snare || !hat || !open || !chords || !lead) return null;
  return { bars: record.bars, kick, snare, hat, open, chords, lead };
}
