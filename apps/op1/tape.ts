/**
 * The four-track tape. Whatever the instruments play can be recorded onto
 * the selected track at the head; recording adds to what is already there,
 * so a loop builds up pass by pass. The tape can loop a number of bars at the
 * tempo, run at half to double speed (recording too, so a slow take plays
 * back high), and run backwards.
 *
 * Tracks are mono and allocated on first recording; the mixer sets each
 * one's level and place in the stereo field. A coarse peak summary
 * is kept as audio is written, so the display draws the lanes without
 * scanning samples.
 */
import { TAU, softClip } from "../synth/dsp";
import { choiceParam, numberParam } from "../synth/params";
import { Timeline } from "../synth/timeline";
import { defaultQuad, percent, type Quad, type QuadDefs } from "./params";

export const TAPE_TRACKS = 4;
export const TAPE_SECONDS = 32;
/** Frames summarised by one peak. */
export const PEAK_BLOCK = 256;
export const BEATS_PER_BAR = 4;

export const LOOP_BARS = [0, 1, 2, 4, 8] as const;
const LOOP_OPTIONS = ["OFF", "1 BAR", "2 BARS", "4 BARS", "8 BARS"] as const;

export const TapeParam = { Tempo: 0, Loop: 1, Speed: 2, Click: 3 } as const;

export const TAPE_DEFS: QuadDefs = [
  numberParam("tempo", "TEMPO", "TEMPO", 40, 240, 120, (v) => `${Math.round(v)} BPM`, { step: 1 }),
  choiceParam("loop", "LOOP", "LOOP LENGTH", LOOP_OPTIONS, 3),
  numberParam("speed", "SPEED", "TAPE SPEED", 0.5, 2, 1, (v) => `x${v.toFixed(2)}`, { curve: "exp", bipolar: true }),
  numberParam("click", "CLICK", "METRONOME", 0, 1, 0, percent),
];

const level = (track: number) =>
  numberParam(`level${track}`, `TRACK ${track}`, `TRACK ${track} LEVEL`, 0, 1, 0.8, percent);

export const MIXER_DEFS: QuadDefs = [level(1), level(2), level(3), level(4)];

/** −1 (left) … 1 (right), as the display reads it: `L40`, `C`, `R25`. */
export function formatPan(v: number): string {
  const amount = Math.round(Math.abs(v) * 100);
  return amount === 0 ? "C" : `${v < 0 ? "L" : "R"}${amount}`;
}

const pan = (track: number) =>
  numberParam(`pan${track}`, `PAN ${track}`, `TRACK ${track} PAN`, -1, 1, 0, formatPan, { bipolar: true });

export const PAN_DEFS: QuadDefs = [pan(1), pan(2), pan(3), pan(4)];

/** Most crossed samples one step of the head fills when recording fast. */
const MAX_FILL = 4;
const CLICK_SECONDS = 0.012;
const METER_FALL = 0.92;

export class TapeMachine {
  sampleRate = 0;
  /** Frames per track. */
  capacity = 0;
  /** Fractional frame under the head. */
  head = 0;
  playing = false;
  recording = false;
  /** Track that recording writes to. */
  track = 0;
  reverse = false;
  settings: Quad = defaultQuad(TAPE_DEFS);
  levels: Quad = defaultQuad(MIXER_DEFS);
  pans: Quad = defaultQuad(PAN_DEFS);
  mutes: [boolean, boolean, boolean, boolean] = [false, false, false, false];

  /** Per track: `ceil(capacity / PEAK_BLOCK)` peak levels. */
  peaks: Float32Array[] = [];
  /** Per track: one past the last frame ever written. */
  readonly extent = [0, 0, 0, 0];
  /** Each track's recent output level, for the mixer's meters. */
  readonly meters = new Float32Array(TAPE_TRACKS);
  /** The head (whole frames) at the start of each rendered block. */
  readonly heads = new Timeline(128, 0);

  private tracks: (Float32Array | null)[] = [null, null, null, null];
  private readonly gainL = new Float32Array(TAPE_TRACKS);
  private readonly gainR = new Float32Array(TAPE_TRACKS);
  private readL = 0;
  private readR = 0;
  private lastWritten = -1;
  private lastBeat = -1;
  private clickAmp = 0;
  private clickPhase = 0;
  private clickHz = 0;
  private clickCoef = 0;

  constructor(sampleRate = 48000) {
    this.configure(sampleRate);
  }

  /** Size the tape for a sample rate. The tape is wiped. */
  configure(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.capacity = Math.round(sampleRate * TAPE_SECONDS);
    this.tracks = [null, null, null, null];
    this.peaks = Array.from({ length: TAPE_TRACKS }, () => new Float32Array(Math.ceil(this.capacity / PEAK_BLOCK)));
    this.extent.fill(0);
    this.head = 0;
    this.lastWritten = -1;
    this.heads.clear();
    this.clickCoef = Math.exp(-1 / (CLICK_SECONDS * sampleRate));
  }

  get tempo(): number {
    return this.settings[TapeParam.Tempo];
  }

  beatFrames(): number {
    return (this.sampleRate * 60) / Math.max(1, this.tempo);
  }

  barFrames(): number {
    return this.beatFrames() * BEATS_PER_BAR;
  }

  /** Frames in the loop, or 0 when the tape runs straight through. */
  loopLength(): number {
    const bars = LOOP_BARS[Math.round(this.settings[TapeParam.Loop])] ?? 0;
    return bars === 0 ? 0 : Math.min(this.capacity, Math.round(bars * this.barFrames()));
  }

  hasAudio(track: number): boolean {
    return (this.extent[track] ?? 0) > 0;
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastWritten = -1;
    const beat = this.beatFrames();
    const at = this.head / beat;
    // Starting on a beat clicks it; starting between beats waits for the next.
    this.lastBeat = at - Math.floor(at) < 1 / beat ? Math.floor(at) - 1 : Math.floor(at);
  }

  stop(): void {
    this.playing = false;
    this.recording = false;
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.lastWritten = -1;
  }

  /** Back to the start of the tape. */
  rewind(): void {
    this.head = 0;
    this.lastWritten = -1;
    this.lastBeat = -1;
  }

  clearTrack(track: number): void {
    this.tracks[track]?.fill(0);
    this.peaks[track]?.fill(0);
    this.extent[track] = 0;
  }

  clearAll(): void {
    for (let t = 0; t < TAPE_TRACKS; t++) this.clearTrack(t);
  }

  /** A track's audio, `capacity` frames long, or null if nothing was ever recorded on it. */
  trackData(track: number): Float32Array | null {
    return this.tracks[track] ?? null;
  }

  /** What has been recorded on a track: from the start of the tape to the last frame written, or null if nothing has. */
  recorded(track: number): Float32Array | null {
    const extent = this.extent[track] ?? 0;
    return extent > 0 ? (this.tracks[track]?.subarray(0, extent) ?? null) : null;
  }

  /** Replace a track with `data` from the start of the tape, as if it had been recorded there. */
  load(track: number, data: Float32Array): void {
    const target = this.ensureTrack(track);
    const length = Math.min(data.length, this.capacity);
    target.fill(0);
    target.set(data.subarray(0, length));
    const peaks = this.peaks[track]!;
    peaks.fill(0);
    let extent = 0;
    for (let i = 0; i < length; i++) {
      const m = Math.abs(target[i]!);
      if (m === 0) continue;
      extent = i + 1;
      const b = Math.floor(i / PEAK_BLOCK);
      if (m > peaks[b]!) peaks[b] = m;
    }
    this.extent[track] = extent;
  }

  /** The four tracks at their levels and pans, in stereo: the loop if one is set, else everything recorded. */
  mixdown(): [Float32Array, Float32Array] {
    const length = this.loopLength() || Math.max(...this.extent);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    this.updateGains();
    for (let t = 0; t < TAPE_TRACKS; t++) {
      const track = this.tracks[t];
      if (!track || this.mutes[t]) continue;
      const gl = this.gainL[t]!;
      const gr = this.gainR[t]!;
      for (let i = 0; i < length; i++) {
        left[i] = left[i]! + track[i]! * gl;
        right[i] = right[i]! + track[i]! * gr;
      }
    }
    for (let i = 0; i < length; i++) {
      left[i] = softClip(left[i]!);
      right[i] = softClip(right[i]!);
    }
    return [left, right];
  }

  /** Each track's gain into each side: its level, panned with equal power so the middle is unchanged. */
  private updateGains(): void {
    for (let t = 0; t < TAPE_TRACKS; t++) {
      const angle = ((Math.max(-1, Math.min(1, this.pans[t]!)) + 1) * Math.PI) / 4;
      this.gainL[t] = Math.cos(angle) * Math.SQRT2 * this.levels[t]!;
      this.gainR[t] = Math.sin(angle) * Math.SQRT2 * this.levels[t]!;
    }
  }

  /**
   * One block: add the tape's playback and the click to `outL` / `outR`, and
   * record the mono sum of `inL` / `inR` onto the selected track.
   */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, position: number): void {
    this.heads.push(position, Math.floor(this.head));
    for (let t = 0; t < TAPE_TRACKS; t++) this.meters[t] = this.meters[t]! * METER_FALL;
    const loop = this.loopLength();
    const end = loop || this.capacity;
    const step = this.settings[TapeParam.Speed] * (this.reverse ? -1 : 1);
    const clickLevel = this.settings[TapeParam.Click];
    const beat = this.beatFrames();
    const target = this.recording ? this.ensureTrack(this.track) : null;
    this.updateGains();

    for (let i = 0; i < frames; i++) {
      if (this.playing) {
        this.read(this.head, end);
        outL[i] = outL[i]! + this.readL;
        outR[i] = outR[i]! + this.readR;
        if (target) this.write(target, (inL[i]! + inR[i]!) * 0.5, end, step > 0 ? 1 : -1);

        this.head += step;
        if (this.head >= end) {
          if (loop) this.head -= end;
          else this.runOut(end - 1);
        } else if (this.head < 0) {
          if (loop) this.head += end;
          else this.runOut(0);
        }

        const now = Math.floor(this.head / beat);
        if (now !== this.lastBeat && clickLevel > 0) {
          this.clickAmp = clickLevel;
          this.clickHz = now % BEATS_PER_BAR === 0 ? 1760 : 1320;
        }
        this.lastBeat = now;
      }
      if (this.clickAmp > 1e-4) {
        const c = Math.sin(TAU * this.clickPhase) * this.clickAmp * 0.3;
        this.clickPhase += this.clickHz / this.sampleRate;
        if (this.clickPhase >= 1) this.clickPhase -= 1;
        this.clickAmp *= this.clickCoef;
        outL[i] = outL[i]! + c;
        outR[i] = outR[i]! + c;
      }
    }
  }

  private runOut(at: number): void {
    this.head = at;
    this.stop();
  }

  private ensureTrack(track: number): Float32Array {
    let data = this.tracks[track];
    if (!data) {
      data = new Float32Array(this.capacity);
      this.tracks[track] = data;
    }
    return data;
  }

  /** The tracks at the head, into `readL` / `readR`. */
  private read(position: number, end: number): void {
    const i = Math.floor(position);
    const frac = position - i;
    const next = i + 1 < end ? i + 1 : 0;
    let left = 0;
    let right = 0;
    for (let t = 0; t < TAPE_TRACKS; t++) {
      const data = this.tracks[t];
      if (!data || this.mutes[t]) continue;
      const a = data[i]!;
      const v = a + (data[next]! - a) * frac;
      left += v * this.gainL[t]!;
      right += v * this.gainR[t]!;
      const m = Math.abs(v * this.levels[t]!);
      if (m > this.meters[t]!) this.meters[t] = m;
    }
    this.readL = left;
    this.readR = right;
  }


  /** Add `x` at every whole frame the head has crossed since the last write. */
  private write(data: Float32Array, x: number, end: number, dir: 1 | -1): void {
    const index = Math.floor(this.head);
    if (this.lastWritten < 0) {
      this.put(data, index, x);
      this.lastWritten = index;
      return;
    }
    let crossed = dir > 0 ? index - this.lastWritten : this.lastWritten - index;
    if (crossed < 0) crossed += end;
    if (crossed === 0) return;
    const n = Math.min(crossed, MAX_FILL);
    for (let k = 1; k <= n; k++) {
      let j = this.lastWritten + k * dir;
      if (j >= end) j -= end;
      else if (j < 0) j += end;
      this.put(data, j, x);
    }
    this.lastWritten = index;
  }

  private put(data: Float32Array, index: number, x: number): void {
    const v = Math.max(-2, Math.min(2, data[index]! + x));
    data[index] = v;
    const peaks = this.peaks[this.track]!;
    const b = Math.floor(index / PEAK_BLOCK);
    const m = Math.abs(v);
    if (m > peaks[b]!) peaks[b] = m;
    if (index + 1 > this.extent[this.track]!) this.extent[this.track] = index + 1;
  }
}
