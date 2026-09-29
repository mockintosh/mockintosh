/**
 * What the engine did, stamped with stream frames, so the display can show
 * what the speaker is playing now rather than what was rendered ahead.
 */
/** A voice as the note log sees it: whether its key is down, and which note it is heading for. */
export interface GatedVoice {
  readonly gateOn: boolean;
  readonly target: number;
}

/** Values stamped with the frame they took effect, newest last. */
export class Timeline {
  private readonly frames: Float64Array;
  private readonly values: Int32Array;
  private head = 0;
  private size = 0;

  constructor(capacity: number, private readonly initial: number) {
    this.frames = new Float64Array(capacity);
    this.values = new Int32Array(capacity);
  }

  push(frame: number, value: number): void {
    this.frames[this.head] = frame;
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.frames.length;
    this.size = Math.min(this.size + 1, this.frames.length);
  }

  /** The value in effect at `frame`. */
  at(frame: number): number {
    for (let n = 1; n <= this.size; n++) {
      const i = (this.head - n + this.frames.length) % this.frames.length;
      if (this.frames[i]! <= frame) return this.values[i]!;
    }
    return this.initial;
  }

  clear(): void {
    this.size = 0;
  }
}

const NOTES_PER_SNAPSHOT = 16;

/** Which notes were gated when, so the keyboard lights keys as they are heard. */
export class NoteLog {
  private readonly frames: Float64Array;
  private readonly notes: Int16Array;
  private readonly counts: Uint8Array;
  private head = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.frames = new Float64Array(capacity);
    this.notes = new Int16Array(capacity * NOTES_PER_SNAPSHOT);
    this.counts = new Uint8Array(capacity);
  }

  snapshot(frame: number, voices: readonly GatedVoice[]): void {
    const base = this.head * NOTES_PER_SNAPSHOT;
    let count = 0;
    for (const v of voices) {
      if (!v.gateOn || count >= NOTES_PER_SNAPSHOT) continue;
      let seen = false;
      for (let k = 0; k < count; k++) if (this.notes[base + k] === v.target) seen = true;
      if (!seen) this.notes[base + count++] = v.target;
    }
    this.frames[this.head] = frame;
    this.counts[this.head] = count;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  /** Notes gated at `frame`, written into `out` (cleared first). */
  at(frame: number, out: Set<number>): void {
    out.clear();
    for (let n = 1; n <= this.size; n++) {
      const i = (this.head - n + this.capacity) % this.capacity;
      if (this.frames[i]! > frame) continue;
      for (let k = 0; k < this.counts[i]!; k++) out.add(this.notes[i * NOTES_PER_SNAPSHOT + k]!);
      return;
    }
  }

  clear(): void {
    this.size = 0;
  }
}
