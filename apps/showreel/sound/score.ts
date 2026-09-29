/**
 * A score: notes placed on the reel's timeline, each played by a stateless
 * voice, plus continuous beds (surf, hum) and a room of echo taps. Rendering
 * any stretch of time only needs the notes that overlap it.
 */
import type { ReelSoundtrack } from "../reels";
import type { SampleClock } from "./synth";

/** One sound on the timeline. */
export interface Note {
  /** Reel seconds. */
  at: number;
  /** Seconds the note is held. */
  dur: number;
  /** Seconds it keeps sounding after `dur`. */
  tail: number;
  freq: number;
  gain: number;
  /** −1 left … 1 right. */
  pan: number;
  voice: Voice;
  /** How much of the note is sent to the room's echoes, 0…1. */
  wet?: number;
  /** A per-note number for voices that vary (noise seeds, brightness). */
  seed?: number;
}

/** A note's waveform `dt` seconds after it began. */
export type Voice = (dt: number, note: Note, clock: SampleClock) => number;

/** A continuous layer, e.g. surf or projector hum. */
export interface Bed {
  pan: number;
  sound(clock: SampleClock): number;
}

/** Echo taps standing in for a room. */
export interface EchoTap {
  delay: number;
  gain: number;
  /** Where the reflection comes from, −1…1. */
  pan: number;
}

export type Room = readonly EchoTap[];

/** Several soundtracks mixed: each adds into the same block. */
export function layered(...tracks: readonly ReelSoundtrack[]): ReelSoundtrack {
  return {
    render(out, offset, frames, t0, sampleRate) {
      for (const track of tracks) track.render(out, offset, frames, t0, sampleRate);
    },
  };
}

function panGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

export class Score implements ReelSoundtrack {
  private readonly notes: readonly Note[];
  private readonly reach: number;
  private readonly active: Note[] = [];
  private readonly clock: SampleClock = { t: 0, n: 0, sampleRate: 48000 };

  constructor(
    notes: readonly Note[],
    private readonly room: Room = [],
    private readonly beds: readonly Bed[] = [],
    /** Trims the whole mix so every reel reaches the transport at a similar loudness. */
    private readonly level = 1,
  ) {
    this.notes = [...notes].sort((a, b) => a.at - b.at);
    this.reach = room.reduce((m, tap) => Math.max(m, tap.delay), 0);
  }

  render(out: readonly Float32Array[], offset: number, frames: number, t0: number, sampleRate: number): void {
    const left = out[0]!;
    const right = out[1] ?? left;
    const stereo = right !== left;
    const clock = this.clock;
    clock.sampleRate = sampleRate;
    const t1 = t0 + frames / sampleRate;

    const active = this.active;
    active.length = 0;
    for (const note of this.notes) {
      if (note.at > t1) break;
      const reach = note.wet ? this.reach : 0;
      if (note.at + note.dur + note.tail + reach >= t0) active.push(note);
    }

    for (const note of active) {
      const [gl, gr] = panGains(note.pan);
      const life = note.dur + note.tail;
      const gain = note.gain * this.level;
      this.add(note, 0, gain, gl, gr, life, left, right, stereo, offset, frames, t0);
      if (!note.wet) continue;
      for (const tap of this.room) {
        const [tl, tr] = panGains(tap.pan);
        this.add(note, tap.delay, gain * note.wet * tap.gain, tl, tr, life, left, right, stereo, offset, frames, t0);
      }
    }

    for (const bed of this.beds) {
      const [gl, gr] = panGains(bed.pan);
      for (let i = 0; i < frames; i++) {
        clock.t = t0 + i / sampleRate;
        clock.n = Math.round(clock.t * sampleRate);
        const v = bed.sound(clock) * this.level;
        left[offset + i]! += v * (stereo ? gl : 0.7);
        if (stereo) right[offset + i]! += v * gr;
      }
    }
  }

  private add(
    note: Note,
    delay: number,
    gain: number,
    gl: number,
    gr: number,
    life: number,
    left: Float32Array,
    right: Float32Array,
    stereo: boolean,
    offset: number,
    frames: number,
    t0: number,
  ): void {
    const clock = this.clock;
    const sr = clock.sampleRate;
    const start = note.at + delay;
    const first = Math.max(0, Math.ceil((start - t0) * sr));
    const last = Math.min(frames, Math.ceil((start + life - t0) * sr));
    for (let i = first; i < last; i++) {
      const t = t0 + i / sr;
      clock.t = t;
      clock.n = Math.round(t * sr);
      const v = note.voice(t - start, note, clock) * gain;
      left[offset + i]! += v * (stereo ? gl : 0.7);
      if (stereo) right[offset + i]! += v * gr;
    }
  }
}
