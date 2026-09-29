/**
 * The pattern sequencer. A pattern is up to four bars of sixteenth-note
 * steps, each holding what is struck on it: MIDI notes for the synth, pad
 * numbers for the drums. A step can be held over the steps after it, so a
 * chord rings for a bar, and accented, so it's struck harder. It runs with
 * the tape's transport at the tape's tempo, so whatever it plays can be
 * recorded like anything played by hand.
 *
 * `Pattern` is plain data the UI edits and saves; `StepSequencer` is the
 * audio side, firing steps in stream frames between the engine's control
 * periods.
 */
import { numberParam, type ParamDef } from "../synth/params";
import { Timeline } from "../synth/timeline";
import { percent } from "./params";

export const MAX_STEPS = 64;
/** Steps the display shows at once: one bar. */
export const PAGE_STEPS = 16;
/** Most values one step holds — a chord, or pads struck together. */
export const STEP_VALUES = 6;
/** Longest a step's notes are held, in steps: a bar. */
export const MAX_HOLD = 16;

export interface Pattern {
  /** Steps that play before it repeats, 1…`MAX_STEPS`. */
  length: number;
  /** `MAX_STEPS` entries, each ascending: the notes or pads on that step. */
  steps: readonly (readonly number[])[];
  /** `MAX_STEPS` entries: how many steps each step's notes last, 1…`MAX_HOLD`. Drums ignore it. */
  holds: readonly number[];
  /** `MAX_STEPS` entries: whether the step is struck hard. */
  accents: readonly boolean[];
  /** 0…1: how late the off-beat sixteenths fall, from straight (50%) to 75%. */
  swing: number;
  /** How much of its last step a synth note is held, 0.05…1. Drums ignore it. */
  gate: number;
  /** Whether it plays when the transport runs. */
  running: boolean;
}

export const STEP_DEF: ParamDef = numberParam("step", "STEP", "STEP", 0, MAX_STEPS + 1, 1, (v) => String(Math.round(v)), { step: 1 });
export const LENGTH_DEF: ParamDef = numberParam("length", "LENGTH", "PATTERN LENGTH", 1, MAX_STEPS, 16, (v) => `${Math.round(v)} STEPS`, { step: 1 });
export const SWING_DEF: ParamDef = numberParam("swing", "SWING", "SWING", 0, 1, 0, (v) => `${Math.round(50 + 25 * v)}%`);
export const GATE_DEF: ParamDef = numberParam("gate", "GATE", "NOTE LENGTH", 0.05, 1, 0.5, percent);

export function emptyPattern(): Pattern {
  return {
    length: 16,
    steps: Array.from({ length: MAX_STEPS }, () => []),
    holds: Array.from({ length: MAX_STEPS }, () => 1),
    accents: Array.from({ length: MAX_STEPS }, () => false),
    swing: 0,
    gate: 0.5,
    running: true,
  };
}

/** Wrap a step index into the pattern. */
export const wrapStep = (pattern: Pattern, step: number): number => ((step % pattern.length) + pattern.length) % pattern.length;

const replace = <T>(list: readonly T[], index: number, value: T): T[] => list.map((item, i) => (i === index ? value : item));

/** A step's values replaced; a step left empty forgets its hold and accent. */
function withStep(pattern: Pattern, step: number, values: readonly number[]): Pattern {
  const next = { ...pattern, steps: replace(pattern.steps, step, values) };
  return values.length > 0 ? next : { ...next, holds: replace(pattern.holds, step, 1), accents: replace(pattern.accents, step, false) };
}

/** Add `value` to a step, or take it off if it's there. A full step drops its lowest value to make room. */
export function toggleStep(pattern: Pattern, step: number, value: number): Pattern {
  const current = pattern.steps[step] ?? [];
  if (current.includes(value)) return withStep(pattern, step, current.filter((v) => v !== value));
  const next = [...current, value].sort((a, b) => a - b);
  return withStep(pattern, step, next.length > STEP_VALUES ? next.slice(next.length - STEP_VALUES) : next);
}

/** Hold a step's notes for `hold` steps, 1…`MAX_HOLD`. */
export function setHold(pattern: Pattern, step: number, hold: number): Pattern {
  return { ...pattern, holds: replace(pattern.holds, step, Math.max(1, Math.min(MAX_HOLD, Math.round(hold)))) };
}

export function setAccent(pattern: Pattern, step: number, accent: boolean): Pattern {
  return { ...pattern, accents: replace(pattern.accents, step, accent) };
}

export function clearStep(pattern: Pattern, step: number): Pattern {
  return withStep(pattern, step, []);
}

/** Every step emptied; length, swing and gate kept. */
export function clearPattern(pattern: Pattern): Pattern {
  const empty = emptyPattern();
  return { ...pattern, steps: empty.steps, holds: empty.holds, accents: empty.accents };
}

/** Twice as long, the second half a copy of the first — for building a variation. */
export function doublePattern(pattern: Pattern): Pattern {
  const length = Math.min(MAX_STEPS, pattern.length * 2);
  const copy = <T>(list: readonly T[]) => list.map((s, i) => (i < pattern.length ? s : i < length ? list[i - pattern.length]! : s));
  return { ...pattern, length, steps: copy(pattern.steps), holds: copy(pattern.holds), accents: copy(pattern.accents) };
}

/** Whether any step within the length has something on it. */
export function hasSteps(pattern: Pattern): boolean {
  for (let i = 0; i < pattern.length; i++) if ((pattern.steps[i]?.length ?? 0) > 0) return true;
  return false;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A pattern from untrusted JSON. Values must be whole numbers below `limit`. */
export function sanitizePattern(value: unknown, limit: number): Pattern {
  const fallback = emptyPattern();
  if (!value || typeof value !== "object") return fallback;
  const r = value as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
  const steps = list(r.steps);
  const holds = list(r.holds);
  const accents = list(r.accents);
  return {
    length: finite(r.length) ? clamp(Math.round(r.length), 1, MAX_STEPS) : fallback.length,
    steps: fallback.steps.map((_, i) => {
      const step = steps[i];
      if (!Array.isArray(step)) return [];
      const values = (step as unknown[]).filter((v): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < limit);
      return [...new Set(values)].sort((a, b) => a - b).slice(-STEP_VALUES);
    }),
    holds: fallback.holds.map((one, i) => {
      const hold = holds[i];
      return finite(hold) ? clamp(Math.round(hold), 1, MAX_HOLD) : one;
    }),
    accents: fallback.accents.map((_, i) => accents[i] === true),
    swing: finite(r.swing) ? clamp(r.swing, 0, 1) : fallback.swing,
    gate: finite(r.gate) ? clamp(r.gate, 0.05, 1) : fallback.gate,
    running: typeof r.running === "boolean" ? r.running : fallback.running,
  };
}

/** Where step `n` falls, in steps: off-beats are pushed late by the swing. */
export function stepTime(n: number, swing: number): number {
  return n % 2 === 1 ? n + swing * 0.5 : n;
}

/** What a sequencer plays: the synth's voices or the drum pads. */
export interface SequencerTarget {
  noteOn(value: number, velocity: number, frame: number): void;
  noteOff(value: number, frame: number): void;
}

/** How hard steps are struck: an accent is a good deal harder. */
export const VELOCITY = 0.7;
export const ACCENT_VELOCITY = 1;
const CLOCK_EPSILON = 1e-9;

interface HeldNote {
  value: number;
  /** When it lets go, in steps. */
  off: number;
}

export class StepSequencer {
  pattern: Pattern = emptyPattern();
  /** The step struck at each frame (−1 while stopped), for the display's playhead. */
  readonly played = new Timeline(256, -1);

  private running = false;
  /** Position in steps. */
  private clock = 0;
  /** The next step to strike, counted from the start (not wrapped). */
  private next = 0;
  private held: HeldNote[] = [];

  get playing(): boolean {
    return this.running;
  }

  /** Start at `step` (fractional); a step exactly there strikes at once. */
  start(step: number, frame: number): void {
    this.running = true;
    this.clock = step;
    this.next = Math.ceil(step - 1e-9);
    this.held = [];
    this.played.push(frame, -1);
  }

  stop(target: SequencerTarget, frame: number): void {
    for (const note of this.held) target.noteOff(note.value, frame);
    this.held = [];
    this.running = false;
    this.played.push(frame, -1);
  }

  /**
   * Move on `steps` (fractional), which take `frames` stream frames starting
   * at `frame`, striking and releasing whatever falls inside.
   */
  advance(steps: number, frame: number, frames: number, target: SequencerTarget): void {
    if (!this.running || steps <= 0) return;
    const from = this.clock;
    // The clock is a running sum of fractions; an event right on the boundary belongs to the next period.
    const end = from + steps - CLOCK_EPSILON;
    const at = (t: number) => frame + Math.min(frames - 1, Math.max(0, Math.floor(((t - from) / steps) * frames + 1e-6)));
    const pattern = this.pattern;
    for (;;) {
      const onTime = stepTime(this.next, pattern.swing);
      let first: HeldNote | null = null;
      for (const note of this.held) if (note.off < end && (!first || note.off < first.off)) first = note;
      const strike = onTime < end;
      if (first && (!strike || first.off <= onTime)) {
        this.held.splice(this.held.indexOf(first), 1);
        target.noteOff(first.value, at(first.off));
        continue;
      }
      if (!strike) break;
      const index = wrapStep(pattern, this.next);
      const when = at(onTime);
      this.played.push(when, index);
      if (pattern.running) {
        for (const value of pattern.steps[index] ?? []) {
          const again = this.held.findIndex((note) => note.value === value);
          if (again >= 0) {
            this.held.splice(again, 1);
            target.noteOff(value, when);
          }
          target.noteOn(value, pattern.accents[index] ? ACCENT_VELOCITY : VELOCITY, when);
          this.held.push({ value, off: onTime + (pattern.holds[index] ?? 1) - 1 + pattern.gate });
        }
      }
      this.next++;
    }
    this.clock = from + steps;
  }
}
