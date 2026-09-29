/**
 * Demo songs, and how they get onto the tape. A song is written the way it
 * would be made on the device: each part is sequencer patterns and a sound,
 * and `SongBounce` plays them through an OP-1 engine of its own onto the
 * tape, one track per part. The tape loops while it records, so the tails of
 * the last bar ring over the first and the loop joins without a seam.
 *
 * The songs themselves are in `songs.ts`; this is the notation they are
 * written in and the machinery that plays them.
 */
import { Op1Engine } from "./engine";
import { KIT_DEFS, PAD_DEFS, PADS } from "./drums";
import { withValue, type EncoderIndex, type Quad } from "./params";
import { emptyPattern, MAX_HOLD, MAX_STEPS, type Pattern, type StepSequencer } from "./sequencer";
import { defaultKit, type DrumKit, type SynthSound } from "./sounds";
import { LOOP_BARS, TAPE_TRACKS } from "./tape";

interface SongPartBase {
  /** What the display calls the part while it bounces. */
  name: string;
  /** The track's mixer level, 0…1. */
  level: number;
  /** Where the track sits, −1 (left) … 1 (right). */
  pan: number;
  /** Played one after another, each for its own length, round and round until the loop is full. */
  patterns: readonly Pattern[];
}

export type SongPart = SongPartBase & ({ instrument: "synth"; sound: SynthSound } | { instrument: "drum"; kit: DrumKit });

export interface Song {
  name: string;
  tempo: number;
  bars: (typeof LOOP_BARS)[number];
  /** One per tape track, in track order. */
  parts: readonly SongPart[];
}

// ---------------------------------------------------------------------------
// Writing patterns down
// ---------------------------------------------------------------------------

const PITCH_CLASSES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `"C4"` → 60, `"F#2"` → 42, `"Bb3"` → 58. */
export function noteNumber(name: string): number {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Not a note: ${name}`);
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return 12 * (Number(match[3]) + 1) + PITCH_CLASSES[match[1]!]! + accidental;
}

/**
 * A bar of synth steps: step within the bar → what is struck there, as
 * space-separated words. Notes are named (`"A3 C4 E4"`); `~6` holds them for
 * six steps and `!` accents them.
 */
export type Bar = Readonly<Record<number, string>>;

export const STEPS_PER_BAR = 16;

interface StepWords {
  notes: number[];
  hold: number;
  accent: boolean;
}

function readStep(words: string): StepWords {
  const step: StepWords = { notes: [], hold: 1, accent: false };
  for (const word of words.trim().split(/\s+/)) {
    if (word === "!") step.accent = true;
    else if (word.startsWith("~")) {
      const hold = Number(word.slice(1));
      if (!Number.isInteger(hold) || hold < 1 || hold > MAX_HOLD) throw new Error(`Not a hold: ${word}`);
      step.hold = hold;
    } else step.notes.push(noteNumber(word));
  }
  return step;
}

export interface PhraseOptions {
  swing?: number;
  /** How much of its last step each note is held. */
  gate?: number;
}

/** A synth pattern, a bar every sixteen steps. */
export function phrase(bars: readonly Bar[], { swing = 0, gate = 0.9 }: PhraseOptions = {}): Pattern {
  if (bars.length * STEPS_PER_BAR > MAX_STEPS) throw new Error("A pattern is at most four bars");
  const empty = emptyPattern();
  const steps = empty.steps.map((s) => [...s]);
  const holds = [...empty.holds];
  const accents = [...empty.accents];
  bars.forEach((bar, b) => {
    for (const [at, words] of Object.entries(bar)) {
      const i = b * STEPS_PER_BAR + Number(at);
      const step = readStep(words);
      steps[i] = step.notes.sort((x, y) => x - y);
      holds[i] = step.hold;
      accents[i] = step.accent;
    }
  });
  return { ...empty, length: bars.length * STEPS_PER_BAR, steps, holds, accents, swing, gate };
}

/**
 * A drum pattern from a grid per pad: `x` strikes, `X` strikes with an
 * accent (which, as on the device, accents everything on that step), and
 * anything else rests; `|` between bars is for reading. The longest lane sets
 * the length.
 */
export function beat(lanes: Readonly<Record<string, string>>, swing = 0): Pattern {
  const empty = emptyPattern();
  const steps: number[][] = empty.steps.map(() => []);
  const accents = [...empty.accents];
  let length = 0;
  for (const [name, grid] of Object.entries(lanes)) {
    const pad = PADS.findIndex((p) => p.name === name);
    if (pad < 0) throw new Error(`No pad called ${name}`);
    const cells = grid.replaceAll("|", "");
    if (cells.length > MAX_STEPS) throw new Error(`The ${name} lane is longer than a pattern`);
    length = Math.max(length, cells.length);
    [...cells].forEach((cell, i) => {
      if (cell !== "x" && cell !== "X") return;
      steps[i]!.push(pad);
      if (cell === "X") accents[i] = true;
    });
  }
  return { ...empty, length, steps: steps.map((s) => s.sort((x, y) => x - y)), accents, swing, gate: 1 };
}

/** A pad's edits by name: its PITCH, DECAY, TONE and LEVEL. */
export type PadEdit = Partial<Record<"pitch" | "decay" | "tone" | "level", number>>;

export interface KitSpec {
  pads?: Readonly<Record<string, PadEdit>>;
  /** The kit's TUNE, DRIVE, SPREAD and LEVEL. */
  kit?: Partial<Record<"tune" | "drive" | "spread" | "level", number>>;
  fx?: number;
  fxValues?: Quad;
}

const editQuad = (quad: Quad, keys: readonly string[], edits: Readonly<Record<string, number | undefined>>): Quad =>
  keys.reduce((q, key, i) => (edits[key] === undefined ? q : withValue(q, i as EncoderIndex, edits[key]!)), quad);

/** A drum kit from the default one, with only what differs written down. */
export function drumKit(spec: KitSpec): DrumKit {
  const kit = defaultKit();
  const padKeys = PAD_DEFS.map((d) => d.key);
  for (const name of Object.keys(spec.pads ?? {})) {
    if (!PADS.some((p) => p.name === name)) throw new Error(`No pad called ${name}`);
  }
  const fx = spec.fx ?? kit.fx;
  return {
    pads: kit.pads.map((pad, i) => editQuad(pad, padKeys, spec.pads?.[PADS[i]!.name] ?? {})),
    kit: editQuad(kit.kit, KIT_DEFS.map((d) => d.key), spec.kit ?? {}),
    fx,
    fxParams: spec.fxValues ? kit.fxParams.map((values, i) => (i === fx ? spec.fxValues! : values)) : kit.fxParams,
  };
}

// ---------------------------------------------------------------------------
// The tape's settings for a song
// ---------------------------------------------------------------------------

/** The tape's settings for a song: its tempo, looping its length, at normal speed with no click. */
export function songTapeSettings(song: Song): Quad {
  return [song.tempo, LOOP_BARS.indexOf(song.bars), 1, 0];
}

const perTrack = (song: Song, read: (part: SongPart) => number, fallback: number): Quad => {
  const at = (t: number) => {
    const part = song.parts[t];
    return part ? read(part) : fallback;
  };
  return [at(0), at(1), at(2), at(3)];
};

/** The mixer's levels for a song's tracks. */
export const songLevels = (song: Song): Quad => perTrack(song, (p) => p.level, 0.8);

/** The mixer's pans for a song's tracks. */
export const songPans = (song: Song): Quad => perTrack(song, (p) => p.pan, 0);

// ---------------------------------------------------------------------------
// Bouncing
// ---------------------------------------------------------------------------

const BLOCK = 256;
/** How long the last notes ring on over the start of the loop. */
const TAIL_SECONDS = 3;

/**
 * Plays a song's parts onto the tape, a part at a time, a little at a time:
 * each `run` renders about the frames it is given, so a caller can spread
 * the work over display frames. Each finished part is handed to `onTrack`,
 * a loop's length of mono audio for its track.
 */
export class SongBounce {
  /** Parts bounced so far. */
  finished = 0;

  private engine: Op1Engine | null = null;
  private sequencer: StepSequencer | null = null;
  private rendered = 0;
  private loopFrames = 0;
  private readonly tailFrames: number;
  private patternIndex = 0;
  /** Steps played once the current pattern has run out. */
  private stepsThrough = 0;
  /** Frame at which the next pattern takes over. */
  private nextSwap = 0;
  private readonly left = new Float32Array(BLOCK);
  private readonly right = new Float32Array(BLOCK);

  constructor(
    readonly song: Song,
    readonly sampleRate: number,
    private readonly onTrack: (track: number, data: Float32Array) => void,
  ) {
    if (song.parts.length > TAPE_TRACKS) throw new Error(`A song has at most ${TAPE_TRACKS} parts`);
    this.tailFrames = Math.round(TAIL_SECONDS * sampleRate);
  }

  get done(): boolean {
    return this.finished >= this.song.parts.length;
  }

  /** 0…1 through the whole song. */
  get progress(): number {
    const parts = this.song.parts.length;
    if (this.done || parts === 0) return 1;
    const part = this.engine ? this.rendered / (this.loopFrames + this.tailFrames) : 0;
    return (this.finished + part) / parts;
  }

  /** The part being bounced, or null once they all are. */
  get part(): SongPart | null {
    return this.song.parts[this.finished] ?? null;
  }

  /**
   * Bounce about `frames` more frames. Blocks are never cut short to fit, so
   * the audio is the same however the work is split up.
   */
  run(frames: number): void {
    let budget = frames;
    while (budget > 0 && !this.done) {
      const engine = this.engine ?? this.startPart();
      const total = this.loopFrames + this.tailFrames;
      const n = Math.min(BLOCK, Math.min(this.nextSwap, total) - this.rendered);
      if (n > 0) {
        engine.render({
          sampleRate: this.sampleRate,
          frames: n,
          channels: [this.left.subarray(0, n), this.right.subarray(0, n)],
          position: engine.position,
        });
        this.rendered += n;
        budget -= n;
      }
      if (this.rendered >= total) this.finishPart();
      else if (this.rendered >= this.nextSwap) this.swapPattern();
    }
  }

  private startPart(): Op1Engine {
    const part = this.song.parts[this.finished]!;
    const engine = new Op1Engine(this.sampleRate);
    engine.tape.settings = songTapeSettings(this.song);
    if (part.instrument === "synth") engine.sound = part.sound;
    else engine.kit = part.kit;
    this.sequencer = part.instrument === "synth" ? engine.synthSequencer : engine.drumSequencer;
    this.patternIndex = 0;
    this.stepsThrough = 0;
    this.rendered = 0;
    this.loopFrames = engine.tape.loopLength();
    this.engine = engine;
    this.cue(part.patterns[0] ?? emptyPattern());
    engine.tape.track = 0;
    engine.tape.setRecording(true);
    engine.tape.play();
    return engine;
  }

  /** Put `pattern` in the sequencer, and note when it runs out — or, past the loop, go quiet. */
  private cue(pattern: Pattern): void {
    const steps = this.song.bars * STEPS_PER_BAR;
    if (this.stepsThrough >= steps) {
      this.sequencer!.pattern = { ...pattern, running: false };
      this.nextSwap = Infinity;
      return;
    }
    this.sequencer!.pattern = pattern;
    this.stepsThrough += pattern.length;
    this.nextSwap = Math.floor(this.stepsThrough * this.engine!.stepFrames());
  }

  private swapPattern(): void {
    const patterns = this.song.parts[this.finished]!.patterns;
    this.patternIndex = (this.patternIndex + 1) % Math.max(1, patterns.length);
    this.cue(patterns[this.patternIndex] ?? emptyPattern());
  }

  private finishPart(): void {
    const recorded = this.engine!.tape.trackData(0);
    const data = recorded ? recorded.slice(0, this.loopFrames) : new Float32Array(this.loopFrames);
    this.engine = null;
    this.sequencer = null;
    const track = this.finished;
    this.finished++;
    this.onTrack(track, data);
  }
}

/** Bounce a whole song at once: a loop's length of audio per track. */
export function bounceSong(song: Song, sampleRate: number): Float32Array[] {
  const tracks: Float32Array[] = [];
  const bounce = new SongBounce(song, sampleRate, (track, data) => {
    tracks[track] = data;
  });
  while (!bounce.done) bounce.run(sampleRate);
  return tracks;
}
