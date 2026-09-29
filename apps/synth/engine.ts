/**
 * The synthesizer engine: voice allocation, the clock that drives the step
 * sequencer and arpeggiator, the effects chain, and what the display needs
 * to draw in time with the sound.
 *
 * All timing is in stream frames. The UI calls `noteOn` and friends between
 * renders; they take effect at `position`, the next frame to be rendered,
 * which the speaker plays `latency` later. The sequencer runs on the sample
 * clock inside `render`, so its timing never depends on the display.
 */
import type { AudioRenderBlock } from "@mockintosh/sdk";
import { Lfo, Noise, softClip } from "./dsp";
import { Chorus, Lofi, PingPongDelay, Reverb } from "./effects";
import { DELAY_DIVISIONS, defaultPatch, defaultPerformance, type Patch, type Performance } from "./params";
import { ArpMode, arpSequence, emptyPattern, patternBase, type Pattern } from "./sequencer";
import { NoteLog, Timeline } from "./timeline";
import { pickVoice, Voice, type NoteSource, type VoiceContext } from "./voice";

const POLY_VOICES = 8;
const UNISON_VOICES = 6;
/** Control period: LFO, glide and filter coefficients update this often. */
const CONTROL = 16;
const VOICE_GAIN = 0.4;
const SLIDE_TIME = 0.055;
const MAX_RECORDING_SECONDS = 600;
export const SCOPE_SIZE = 1 << 15;
const SCOPE_MASK = SCOPE_SIZE - 1;

export const VoiceMode = { Poly: 0, Mono: 1, Unison: 2 } as const;

interface HeldNote {
  note: number;
  velocity: number;
  accent: boolean;
  source: NoteSource;
}

interface PendingOff {
  frame: number;
  note: number;
  source: NoteSource;
}

export class SynthEngine {
  sampleRate: number;
  /** Next frame to be rendered — "now" for everything the UI asks. */
  position = 0;
  private patchValue: Patch = defaultPatch();
  private patchVersion = 0;
  performance: Performance = defaultPerformance();
  pattern: Pattern = emptyPattern();

  private readonly voices: Voice[];
  private readonly random = new Noise(0x5eed);
  private stack: HeldNote[] = [];
  private lastNote = 60;

  private clockRunning = false;
  private tick = 0;
  private gridFrame = 0;
  private nextTick = 0;
  private seqPlaying = false;
  private seqStartTick = 0;
  private seqHeld: number | null = null;
  private seqSlide = false;
  private arpHeld: number[] = [];
  private arpIndex = 0;
  private arpSounding: number | null = null;
  private pendingOffs: PendingOff[] = [];

  private readonly lfo = new Lfo(this.random);

  private lofi = new Lofi();
  private chorus: Chorus;
  private delay: PingPongDelay;
  private reverb: Reverb;
  private mixL = new Float32Array(1024);
  private mixR = new Float32Array(1024);
  private readonly context: VoiceContext;

  /** The last `SCOPE_SIZE` frames of output, indexed by `frame & (SCOPE_SIZE - 1)`. */
  readonly scopeL = new Float32Array(SCOPE_SIZE);
  readonly scopeR = new Float32Array(SCOPE_SIZE);
  /** Last frame whose output was audible. */
  lastSoundFrame = -Infinity;
  /** Sequencer step playing at a frame; −1 while stopped. */
  readonly steps = new Timeline(64, -1);
  readonly notes = new NoteLog(256);

  private recording: { left: Float32Array[]; right: Float32Array[]; frames: number } | null = null;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.voices = Array.from({ length: POLY_VOICES }, (_, i) => new Voice(0x1234567 + i * 7919));
    this.chorus = new Chorus(sampleRate);
    this.delay = new PingPongDelay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.context = { patch: this.patchValue, patchVersion: 0, sampleRate, lfo: 0 };
  }

  get patch(): Patch {
    return this.patchValue;
  }

  set patch(next: Patch) {
    const previous = this.patchValue;
    this.patchValue = next;
    this.patchVersion++;
    if (previous.voiceMode !== next.voiceMode) this.releaseVoices();
  }

  get playing(): boolean {
    return this.seqPlaying;
  }

  /** Frames in one sixteenth note at the current tempo. */
  stepFrames(): number {
    return (this.sampleRate * 60) / Math.max(1, this.performance.tempo) / 4;
  }

  // -------------------------------------------------------------------------
  // Performance: keys, sequencer, arpeggiator
  // -------------------------------------------------------------------------

  noteOn(note: number, velocity = 0.8): void {
    if (this.performance.arpMode !== ArpMode.Off) {
      if (!this.arpHeld.includes(note)) this.arpHeld.push(note);
      if (!this.clockRunning) this.startClock();
      return;
    }
    this.trigger(note, velocity, false, "keys", this.position);
  }

  noteOff(note: number): void {
    const held = this.arpHeld.indexOf(note);
    if (held >= 0) {
      this.arpHeld.splice(held, 1);
      if (this.arpHeld.length === 0) this.stopArp();
      return;
    }
    this.release(note, "keys", this.position);
  }

  /** Let go of everything the keys are holding (the window lost focus, the arpeggiator changed). */
  releaseKeys(): void {
    this.arpHeld = [];
    this.stopArp();
    this.stack = this.stack.filter((h) => h.source !== "keys");
    for (const v of this.voices) if (v.gateOn && v.source === "keys") v.release();
    this.notes.snapshot(this.position, this.voices);
  }

  /** Silence now: every voice, the sequencer, and the effect tails' inputs. */
  panic(): void {
    this.setPlaying(false);
    this.releaseKeys();
    for (const v of this.voices) v.kill();
    this.stack = [];
    this.notes.snapshot(this.position, this.voices);
  }

  setPlaying(on: boolean): void {
    if (on === this.seqPlaying) return;
    if (on) {
      this.seqPlaying = true;
      if (!this.clockRunning) this.startClock();
      this.seqStartTick = this.tick + (this.tick % 2);
      return;
    }
    this.seqPlaying = false;
    if (this.seqHeld !== null) this.release(this.seqHeld, "seq", this.position);
    this.seqHeld = null;
    this.seqSlide = false;
    this.pendingOffs = this.pendingOffs.filter((o) => o.source !== "seq");
    this.steps.push(this.position, -1);
    if (this.arpHeld.length === 0) this.clockRunning = false;
  }

  private startClock(): void {
    this.clockRunning = true;
    this.tick = 0;
    this.arpIndex = 0;
    this.gridFrame = this.position;
    this.nextTick = this.position;
  }

  private stopArp(): void {
    this.arpIndex = 0;
    if (this.arpSounding !== null) this.release(this.arpSounding, "arp", this.position);
    this.arpSounding = null;
    this.pendingOffs = this.pendingOffs.filter((o) => o.source !== "arp");
    if (!this.seqPlaying) this.clockRunning = false;
  }

  private fireTick(frame: number): void {
    const spS = this.stepFrames();
    if (this.seqPlaying && this.tick >= this.seqStartTick) {
      const length = Math.max(1, Math.min(this.pattern.steps.length, Math.round(this.performance.length)));
      this.fireStep((this.tick - this.seqStartTick) % length, frame, spS);
    }
    if (this.arpHeld.length > 0) this.fireArp(frame, spS);
    this.tick++;
    this.gridFrame += spS;
    this.nextTick = this.gridFrame + (this.tick % 2 === 1 ? this.performance.swing * spS : 0);
  }

  private fireStep(index: number, frame: number, spS: number): void {
    this.steps.push(frame, index);
    const step = this.pattern.steps[index]!;
    if (!step.on) {
      if (this.seqHeld !== null) this.release(this.seqHeld, "seq", frame);
      this.seqHeld = null;
      this.seqSlide = false;
      return;
    }
    const note = patternBase(this.performance) + step.offset;
    if (this.seqHeld !== null && this.seqSlide) {
      this.slide(this.seqHeld, note, "seq", frame);
    } else {
      if (this.seqHeld !== null) this.release(this.seqHeld, "seq", frame);
      this.trigger(note, step.accent ? 1 : 0.72, step.accent, "seq", frame);
    }
    this.seqHeld = note;
    this.seqSlide = step.slide;
    this.pendingOffs = this.pendingOffs.filter((o) => o.source !== "seq");
    if (!step.slide) this.pendingOffs.push({ frame: frame + spS * this.performance.gate, note, source: "seq" });
  }

  private fireArp(frame: number, spS: number): void {
    const order = arpSequence(this.arpHeld, this.performance.arpMode, Math.round(this.performance.arpOctaves));
    if (order.length === 0) return;
    const note =
      this.performance.arpMode === ArpMode.Random
        ? order[Math.floor(this.random.unit() * order.length) % order.length]!
        : order[this.arpIndex % order.length]!;
    this.arpIndex++;
    if (this.arpSounding !== null) this.release(this.arpSounding, "arp", frame);
    this.trigger(note, 0.8, false, "arp", frame);
    this.arpSounding = note;
    this.pendingOffs = this.pendingOffs.filter((o) => o.source !== "arp");
    this.pendingOffs.push({ frame: frame + spS * this.performance.gate, note, source: "arp" });
  }

  private firePendingOff(off: PendingOff, frame: number): void {
    if (off.source === "seq" && this.seqHeld === off.note) {
      this.release(off.note, "seq", frame);
      this.seqHeld = null;
      this.seqSlide = false;
    } else if (off.source === "arp" && this.arpSounding === off.note) {
      this.release(off.note, "arp", frame);
      this.arpSounding = null;
    }
  }

  // -------------------------------------------------------------------------
  // Voice allocation
  // -------------------------------------------------------------------------

  private unisonCount(): number {
    return this.patchValue.voiceMode === VoiceMode.Unison ? UNISON_VOICES : 1;
  }

  private glideFrom(): number | undefined {
    return this.patchValue.glide > 0 ? this.lastNote : undefined;
  }

  private trigger(note: number, velocity: number, accent: boolean, source: NoteSource, frame: number): void {
    const p = this.patchValue;
    if (p.voiceMode === VoiceMode.Poly) {
      const voice =
        this.voices.find((v) => v.gateOn && v.target === note && v.source === source) ?? pickVoice(this.voices);
      const index = this.voices.indexOf(voice);
      voice.detune = (this.random.next() * 4 + (index % 2 ? 2 : -2)) * p.spread;
      voice.pan = ((index / (POLY_VOICES - 1)) * 2 - 1) * p.spread * 0.7;
      voice.gain = 1;
      voice.start(note, velocity, accent, source, frame, this.glideFrom());
    } else {
      const sounding = this.stack.length > 0 && this.voices[0]!.gateOn;
      this.stack = this.stack.filter((h) => !(h.note === note && h.source === source));
      this.stack.push({ note, velocity, accent, source });
      if (sounding) this.forMono((v) => {
        v.legato(note);
        v.source = source;
      });
      else this.startMono(note, velocity, accent, source, frame);
    }
    this.lastNote = note;
    this.notes.snapshot(frame, this.voices);
  }

  private release(note: number, source: NoteSource, frame: number): void {
    if (this.patchValue.voiceMode === VoiceMode.Poly) {
      for (const v of this.voices) if (v.gateOn && v.target === note && v.source === source) v.release();
    } else {
      const top = this.stack[this.stack.length - 1];
      this.stack = this.stack.filter((h) => !(h.note === note && h.source === source));
      const next = this.stack[this.stack.length - 1];
      if (!next) this.forMono((v) => v.release());
      else if (top && top.note === note && top.source === source) {
        this.forMono((v) => {
          v.legato(next.note);
          v.source = next.source;
        });
        this.lastNote = next.note;
      }
    }
    this.notes.snapshot(frame, this.voices);
  }

  private slide(from: number, to: number, source: NoteSource, frame: number): void {
    if (this.patchValue.voiceMode === VoiceMode.Poly) {
      const voice = this.voices.find((v) => v.gateOn && v.target === from && v.source === source);
      if (voice) voice.legato(to, SLIDE_TIME);
      else this.trigger(to, 0.72, false, source, frame);
    } else {
      const held = this.stack.find((h) => h.note === from && h.source === source);
      if (held) held.note = to;
      if (this.stack[this.stack.length - 1] === held) this.forMono((v) => v.legato(to, SLIDE_TIME));
    }
    this.lastNote = to;
    this.notes.snapshot(frame, this.voices);
  }

  private startMono(note: number, velocity: number, accent: boolean, source: NoteSource, frame: number): void {
    const count = this.unisonCount();
    const spread = this.patchValue.spread;
    const glideFrom = this.glideFrom();
    for (let k = 0; k < this.voices.length; k++) {
      const v = this.voices[k]!;
      if (k >= count) {
        if (v.gateOn) v.release();
        continue;
      }
      const side = count > 1 ? (k / (count - 1)) * 2 - 1 : 0;
      v.detune = side * spread * 30;
      v.pan = side * spread;
      v.gain = count > 1 ? 1.5 / Math.sqrt(count) : 1;
      v.start(note, velocity, accent, source, frame, glideFrom);
    }
  }

  private forMono(apply: (voice: Voice) => void): void {
    const count = this.unisonCount();
    for (let k = 0; k < count; k++) apply(this.voices[k]!);
  }

  private releaseVoices(): void {
    for (const v of this.voices) if (v.gateOn) v.release();
    this.stack = [];
    this.seqHeld = null;
    this.seqSlide = false;
    this.arpSounding = null;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private configure(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.chorus = new Chorus(sampleRate);
    this.delay = new PingPongDelay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.lofi = new Lofi();
    this.context.sampleRate = sampleRate;
    this.patchVersion++;
  }

  /** Follow the stream's clock when it restarts (a new stream begins at frame 0). */
  private rebase(position: number): void {
    const delta = position - this.position;
    this.position = position;
    this.gridFrame += delta;
    this.nextTick += delta;
    for (const off of this.pendingOffs) off.frame += delta;
    this.steps.clear();
    this.notes.clear();
    this.lastSoundFrame = -Infinity;
  }

  private nextEventFrame(): number {
    let next = this.clockRunning ? this.nextTick : Infinity;
    for (const off of this.pendingOffs) if (off.frame < next) next = off.frame;
    return next;
  }

  private runEvents(frame: number): void {
    // An event belongs to the sample it falls in.
    const horizon = frame + 1;
    if (this.pendingOffs.length > 0) {
      const due = this.pendingOffs.filter((o) => o.frame < horizon);
      if (due.length > 0) {
        this.pendingOffs = this.pendingOffs.filter((o) => o.frame >= horizon);
        for (const off of due) this.firePendingOff(off, frame);
      }
    }
    let guard = 0;
    while (this.clockRunning && this.nextTick < horizon && guard++ < 8) this.fireTick(frame);
  }

  render(block: AudioRenderBlock): void {
    if (block.sampleRate !== this.sampleRate) this.configure(block.sampleRate);
    if (block.position !== this.position) this.rebase(block.position);
    const frames = block.frames;
    if (this.mixL.length < frames) {
      this.mixL = new Float32Array(frames);
      this.mixR = new Float32Array(frames);
    }
    const left = this.mixL.subarray(0, frames);
    const right = this.mixR.subarray(0, frames);
    left.fill(0);
    right.fill(0);

    const p = this.patchValue;
    const ctx = this.context;
    ctx.patch = p;
    ctx.patchVersion = this.patchVersion;

    let i = 0;
    while (i < frames) {
      const frame = this.position + i;
      this.runEvents(frame);
      let n = Math.min(CONTROL, frames - i);
      const next = this.nextEventFrame();
      if (next < frame + n) n = Math.max(1, Math.floor(next - frame));
      ctx.lfo = this.lfo.advance(p.lfoRate, p.lfoWave, n, this.sampleRate);
      for (const v of this.voices) if (v.active) v.render(left, right, i, n, ctx);
      i += n;
    }

    for (let k = 0; k < frames; k++) {
      left[k] = left[k]! * VOICE_GAIN;
      right[k] = right[k]! * VOICE_GAIN;
    }
    this.chorus.process(left, right, frames, p.chorus);
    const delayFrames = (DELAY_DIVISIONS[p.delayTime]?.steps ?? 4) * this.stepFrames();
    this.delay.process(left, right, frames, delayFrames, p.delayFeedback, p.delayMix);
    this.reverb.process(left, right, frames, p.reverb);
    const master = p.volume * p.volume * 2;
    for (let k = 0; k < frames; k++) {
      left[k] = left[k]! * master;
      right[k] = right[k]! * master;
    }
    this.lofi.process(left, right, frames, p.lofi, this.sampleRate);

    const outL = block.channels[0]!;
    const outR = block.channels[1];
    for (let k = 0; k < frames; k++) {
      const l = softClip(left[k]!);
      const r = softClip(right[k]!);
      if (outR) {
        outL[k] = l;
        outR[k] = r;
      } else {
        outL[k] = (l + r) * 0.5;
      }
      const index = (this.position + k) & SCOPE_MASK;
      this.scopeL[index] = l;
      this.scopeR[index] = r;
      if (l > 1e-4 || l < -1e-4 || r > 1e-4 || r < -1e-4) this.lastSoundFrame = this.position + k;
    }

    if (this.recording) {
      this.recording.left.push(outL.slice());
      this.recording.right.push((outR ?? outL).slice());
      this.recording.frames += frames;
      if (this.recording.frames > MAX_RECORDING_SECONDS * this.sampleRate) this.recording = null;
    }

    this.position += frames;
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  get recordingActive(): boolean {
    return this.recording !== null;
  }

  /** Length of the take so far, in seconds (0 when not recording). */
  get recordedSeconds(): number {
    return this.recording ? this.recording.frames / this.sampleRate : 0;
  }

  startRecording(): void {
    this.recording = { left: [], right: [], frames: 0 };
  }

  /** Everything played since `startRecording`, or null if not recording. */
  stopRecording(): Float32Array[] | null {
    const take = this.recording;
    this.recording = null;
    if (!take) return null;
    const join = (chunks: Float32Array[]) => {
      const out = new Float32Array(take.frames);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk.subarray(0, Math.min(chunk.length, take.frames - offset)), offset);
        offset += chunk.length;
      }
      return out;
    };
    return [join(take.left), join(take.right)];
  }
}
