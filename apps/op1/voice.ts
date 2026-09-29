/**
 * One synth voice: the sound's engine, shaped by the envelope, moved by the
 * LFO, and placed in the stereo field. Every voice holds an instance of every
 * engine, so changing engine never allocates on the audio path.
 */
import { Envelope, noteHz } from "../synth/dsp";
import type { GatedVoice } from "../synth/timeline";
import type { StealableVoice } from "../synth/voice";
import type { Quad } from "./params";
import type { Sample } from "./sampler";
import type { SynthSound } from "./sounds";
import { SYNTHS, type SynthOsc } from "./synths";

/** What every voice shares for one control period. */
export interface VoiceContext {
  sound: SynthSound;
  /** Bumped whenever `sound` is replaced; voices reconfigure their envelope on change. */
  version: number;
  sampleRate: number;
  /** Semitones of vibrato. */
  pitch: number;
  /** Multiplier for tremolo, 0…1. */
  volume: number;
  /** The engine's values after the LFO. */
  params: Quad;
  /** The slot's recording, for the sampler. */
  sample: Sample | null;
}

/** Longest control period a voice renders in one go. */
export const MAX_CONTROL = 64;

export class Op1Voice implements StealableVoice, GatedVoice {
  target = 60;
  velocity = 0.8;
  gateOn = false;
  startedAt = 0;
  /** −1 (left) … 1 (right). */
  pan = 0;
  /** Cents of drift. */
  detune = 0;

  private readonly oscs: SynthOsc[];
  private synth = 0;
  private readonly amp = new Envelope();
  private configured = -1;
  private readonly scratch = new Float32Array(MAX_CONTROL);

  constructor(seed: number) {
    this.oscs = SYNTHS.map((def, i) => def.create(seed + i * 104729));
  }

  get active(): boolean {
    return this.amp.active;
  }

  get level(): number {
    return this.amp.value;
  }

  /** Where the sampler is in its sample, 0…1, or −1 when this voice isn't playing one. */
  get samplePosition(): number {
    return this.amp.active ? (this.oscs[this.synth]!.position ?? -1) : -1;
  }

  start(note: number, velocity: number, synth: number, frame: number, sampleRate: number): void {
    const fresh = !this.amp.active || synth !== this.synth;
    if (synth !== this.synth) this.amp.reset();
    this.synth = synth;
    this.target = note;
    this.velocity = velocity;
    this.startedAt = frame;
    this.gateOn = true;
    this.oscs[synth]!.start(noteHz(note), velocity, fresh, sampleRate);
    this.amp.gate(true);
  }

  release(): void {
    this.gateOn = false;
    this.amp.gate(false);
  }

  kill(): void {
    this.gateOn = false;
    this.amp.reset();
  }

  /** Add up to `MAX_CONTROL` samples into `left` / `right` from `offset`. */
  render(left: Float32Array, right: Float32Array, offset: number, frames: number, ctx: VoiceContext): void {
    const sr = ctx.sampleRate;
    if (this.configured !== ctx.version) {
      const [attack, decay, sustain, release] = ctx.sound.env;
      this.amp.configure(attack, decay, sustain, release, sr);
      this.configured = ctx.version;
    }
    const hz = noteHz(this.target + this.detune / 100 + ctx.pitch);
    const out = this.scratch;
    this.oscs[this.synth]!.render(out, frames, hz, ctx.params, sr, ctx.sample);
    const level = (0.4 + 0.6 * this.velocity) * ctx.volume;
    const angle = ((this.pan + 1) * Math.PI) / 4;
    const gainL = Math.cos(angle) * level;
    const gainR = Math.sin(angle) * level;
    for (let i = 0; i < frames; i++) {
      const y = out[i]! * this.amp.next();
      left[offset + i] = left[offset + i]! + y * gainL;
      right[offset + i] = right[offset + i]! + y * gainR;
    }
    if (!this.amp.active) this.gateOn = false;
  }
}
