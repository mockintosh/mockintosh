/**
 * The step pattern and the note orders the arpeggiator plays. Pure data and
 * functions; the engine clocks them.
 */
import { SCALES, type Performance } from "./params";

export const STEPS = 16;
/** Steps are semitones above the pattern's base note, over two octaves. */
export const STEP_RANGE = 24;

export interface Step {
  on: boolean;
  /** Semitones above the pattern base, 0…STEP_RANGE. */
  offset: number;
  /** Louder, brighter, as a TB-303's accent. */
  accent: boolean;
  /** Glide into the next step without retriggering. */
  slide: boolean;
}

export interface Pattern {
  steps: Step[];
}

export function emptyPattern(): Pattern {
  return { steps: Array.from({ length: STEPS }, () => ({ on: false, offset: 0, accent: false, slide: false })) };
}

export function clonePattern(pattern: Pattern): Pattern {
  return { steps: pattern.steps.map((s) => ({ ...s })) };
}

export function sanitizePattern(value: unknown): Pattern {
  const pattern = emptyPattern();
  const steps = value && typeof value === "object" ? (value as { steps?: unknown }).steps : undefined;
  if (!Array.isArray(steps)) return pattern;
  for (let i = 0; i < STEPS; i++) {
    const s = steps[i] as Partial<Record<keyof Step, unknown>> | undefined;
    if (!s || typeof s !== "object") continue;
    pattern.steps[i] = {
      on: s.on === true,
      offset: typeof s.offset === "number" ? Math.max(0, Math.min(STEP_RANGE, Math.round(s.offset))) : 0,
      accent: s.accent === true,
      slide: s.slide === true,
    };
  }
  return pattern;
}

/**
 * A pattern from a compact score: whitespace-separated steps, each `.` for a
 * rest or a semitone offset, suffixed `!` for accent and `~` for slide —
 * `"0 0! 12~ 10 . 3"`. Missing steps are rests.
 */
export function parsePattern(score: string): Pattern {
  const pattern = emptyPattern();
  const tokens = score.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < Math.min(STEPS, tokens.length); i++) {
    const token = tokens[i]!;
    if (token.startsWith(".")) continue;
    const offset = parseInt(token, 10);
    if (!Number.isFinite(offset)) continue;
    pattern.steps[i] = {
      on: true,
      offset: Math.max(0, Math.min(STEP_RANGE, offset)),
      accent: token.includes("!"),
      slide: token.includes("~"),
    };
  }
  return pattern;
}

/** The MIDI note a step offset of 0 plays. */
export function patternBase(performance: Pick<Performance, "root" | "seqOctave">): number {
  return 36 + performance.root + 12 * performance.seqOctave;
}

/** Every offset 0…STEP_RANGE that lies in the scale. */
export function scaleOffsets(scale: number): number[] {
  const steps = SCALES[scale]?.steps ?? SCALES[0].steps;
  const out: number[] = [];
  for (let octave = 0; octave * 12 <= STEP_RANGE; octave++) {
    for (const s of steps) {
      const offset = octave * 12 + s;
      if (offset <= STEP_RANGE) out.push(offset);
    }
  }
  return out;
}

/** The nearest in-scale offset. */
export function quantize(offset: number, scale: number): number {
  let best = 0;
  let distance = Infinity;
  for (const o of scaleOffsets(scale)) {
    const d = Math.abs(o - offset);
    if (d < distance) {
      best = o;
      distance = d;
    }
  }
  return best;
}

/** Seeded PRNG (mulberry32), so dice rolls are reproducible in tests. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Roll a new line: a random walk over the scale that starts on the root,
 * leans back towards it, and leaves room to breathe.
 */
export function rollPattern(random: () => number, scale: number): Pattern {
  const offsets = scaleOffsets(scale);
  const pattern = emptyPattern();
  let degree = 0;
  for (let i = 0; i < STEPS; i++) {
    const downbeat = i % 4 === 0;
    const on = i === 0 || random() < (downbeat ? 0.85 : 0.6);
    if (!on) continue;
    if (i > 0) {
      const leap = random() < 0.2 ? Math.floor(random() * 5) - 2 + (random() < 0.5 ? -4 : 4) : Math.floor(random() * 5) - 2;
      degree += leap;
      if (random() < 0.25) degree = Math.round(degree / 2);
      degree = Math.max(0, Math.min(offsets.length - 1, degree));
    }
    pattern.steps[i] = {
      on: true,
      offset: offsets[degree]!,
      accent: random() < (downbeat ? 0.35 : 0.15),
      slide: random() < 0.18,
    };
  }
  return pattern;
}

/** Change a few steps, staying in the scale. */
export function mutatePattern(pattern: Pattern, random: () => number, scale: number): Pattern {
  const next = clonePattern(pattern);
  const offsets = scaleOffsets(scale);
  const changes = 2 + Math.floor(random() * 3);
  for (let n = 0; n < changes; n++) {
    const step = next.steps[Math.floor(random() * STEPS)]!;
    const roll = random();
    if (roll < 0.25) step.on = !step.on;
    else if (roll < 0.7) {
      const i = Math.max(0, offsets.indexOf(quantize(step.offset, scale)));
      step.offset = offsets[Math.max(0, Math.min(offsets.length - 1, i + (random() < 0.5 ? -1 : 1)))]!;
      step.on = true;
    } else if (roll < 0.85) step.accent = !step.accent;
    else step.slide = !step.slide;
  }
  return next;
}

/** Rotate the pattern by `by` steps (positive is later). */
export function rotatePattern(pattern: Pattern, by: number): Pattern {
  const steps = pattern.steps.map((_, i) => ({ ...pattern.steps[(((i - by) % STEPS) + STEPS) % STEPS]! }));
  return { steps };
}

/** Move every note `degrees` scale steps, clamped to the range. */
export function transposePattern(pattern: Pattern, degrees: number, scale: number): Pattern {
  const offsets = scaleOffsets(scale);
  return {
    steps: pattern.steps.map((s) => {
      const i = Math.max(0, offsets.indexOf(quantize(s.offset, scale)));
      return { ...s, offset: offsets[Math.max(0, Math.min(offsets.length - 1, i + degrees))]! };
    }),
  };
}

export const ArpMode = { Off: 0, Up: 1, Down: 2, UpDown: 3, Random: 4, AsPlayed: 5 } as const;

/**
 * The notes the arpeggiator walks for `held` (in the order they were
 * pressed), over `octaves` octaves. `Random` returns the pool; the engine
 * picks from it.
 */
export function arpSequence(held: readonly number[], mode: number, octaves: number): number[] {
  if (held.length === 0 || mode === ArpMode.Off) return [];
  const base = mode === ArpMode.AsPlayed ? [...held] : [...new Set(held)].sort((a, b) => a - b);
  const span: number[] = [];
  for (let o = 0; o < Math.max(1, octaves); o++) for (const n of base) span.push(n + 12 * o);
  switch (mode) {
    case ArpMode.Down:
      return span.reverse();
    case ArpMode.UpDown:
      return span.length <= 2 ? span : [...span, ...span.slice(1, -1).reverse()];
    default:
      return span;
  }
}
