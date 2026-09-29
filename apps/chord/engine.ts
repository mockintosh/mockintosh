/**
 * The chord instrument's engine: plays a voicing the way the style asks —
 * all at once, strummed, arpeggiated or pulsed on the beat — over the rhythm
 * box, through the Synthesizer's voices and effects.
 *
 * All timing is in stream frames, as in the Synthesizer: calls between
 * renders take effect at `position`, and everything that happens later (the
 * strings of a strum, arpeggio steps, drum hits) is scheduled on the sample
 * clock inside `render`.
 */
import type { AudioRenderBlock } from "@mockintosh/sdk";
import { Lfo, Noise, softClip } from "../synth/dsp";
import { Chorus, PingPongDelay, Reverb } from "../synth/effects";
import { DELAY_DIVISIONS, defaultPatch, type Patch } from "../synth/params";
import { NoteLog, Timeline } from "../synth/timeline";
import { pickVoice, Voice, type NoteSource, type VoiceContext } from "../synth/voice";
import { DrumKit, RHYTHMS, STEPS_PER_BAR } from "./drums";
import { isClocked, Style } from "./settings";
import type { Voicing } from "./theory";

const VOICES = 12;
const CONTROL = 16;
const VOICE_GAIN = 0.3;
const DRUM_LEVEL = 0.55;
/** Time between strings of a strum. */
const STRUM_GAP = 0.03;
/** Arpeggio and pulse notes hold for this share of their step. */
const ARP_GATE = 0.7;
const PULSE_GATE = 0.55;
const BASS_VELOCITY = 0.8;
const CHORD_VELOCITY = 0.7;

interface NoteEvent {
  frame: number;
  note: number;
  source: NoteSource;
}

/** The chord voices play as `keys`, the clock's notes as `arp`. */
const HELD: NoteSource = "keys";
const CLOCKED: NoteSource = "arp";

/** The notes an arpeggio walks over a voicing: its chord tones across two octaves. */
export function arpOrder(notes: readonly number[], style: number): number[] {
  const up = [...notes, ...notes.map((n) => n + 12)];
  if (style === Style.ArpDown) return up.reverse();
  if (style === Style.ArpBounce) return up.length <= 2 ? up : [...up, ...up.slice(1, -1).reverse()];
  return up;
}

export class ChordEngine {
  sampleRate: number;
  /** Next frame to be rendered — "now" for everything the UI asks. */
  position = 0;
  tempo = 100;
  rhythm = 0;

  private patchValue: Patch = defaultPatch();
  private patchVersion = 0;
  private styleValue: number = Style.Chord;
  private voicing: Voicing | null = null;

  private readonly voices: Voice[];
  private readonly random = new Noise(0xc40d);
  private readonly lfo = new Lfo(this.random);
  private readonly drums = new DrumKit();
  private pendingOns: NoteEvent[] = [];
  private pendingOffs: NoteEvent[] = [];

  private clockRunning = false;
  private tick = 0;
  private nextTick = 0;
  private drumsPlaying = false;
  private drumStartTick = 0;
  private arpIndex = 0;

  private chorus: Chorus;
  private delay: PingPongDelay;
  private reverb: Reverb;
  private mixL = new Float32Array(1024);
  private mixR = new Float32Array(1024);
  private drumL = new Float32Array(1024);
  private drumR = new Float32Array(1024);
  private readonly context: VoiceContext;

  /** Rhythm step playing at a frame; −1 while the rhythm box is stopped. */
  readonly steps = new Timeline(64, -1);
  readonly notes = new NoteLog(256);
  /** Last frame whose output was audible. */
  lastSoundFrame = -Infinity;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.voices = Array.from({ length: VOICES }, (_, i) => new Voice(0x2468ace + i * 7919));
    this.chorus = new Chorus(sampleRate);
    this.delay = new PingPongDelay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.drums.configure(sampleRate);
    this.context = { patch: this.patchValue, patchVersion: 0, sampleRate, lfo: 0 };
  }

  get patch(): Patch {
    return this.patchValue;
  }

  set patch(next: Patch) {
    this.patchValue = next;
    this.patchVersion++;
  }

  get style(): number {
    return this.styleValue;
  }

  /** Change how chords are played; a held chord starts again in the new style. */
  set style(next: number) {
    if (next === this.styleValue) return;
    const held = this.voicing;
    this.release();
    this.styleValue = next;
    if (held) this.play(held, true);
  }

  get playingRhythm(): boolean {
    return this.drumsPlaying;
  }

  /** Frames in one sixteenth note at the current tempo. */
  stepFrames(): number {
    return (this.sampleRate * 60) / Math.max(1, this.tempo) / 4;
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------

  /**
   * Sound `voicing`. `retrigger` is a new press: the chord is articulated
   * afresh. Otherwise the held chord changed shape (the joystick moved), and
   * only the notes that changed move — common tones keep ringing.
   */
  play(voicing: Voicing, retrigger: boolean): void {
    const previous = this.voicing;
    this.voicing = voicing;
    const frame = this.position;
    const style = this.styleValue;

    if (retrigger || !previous) {
      this.releaseSource(HELD, frame);
      this.pendingOns = [];
      if (voicing.bass !== null) this.trigger(voicing.bass, BASS_VELOCITY, HELD, frame);
      if (style === Style.Chord) {
        for (const note of voicing.notes) this.trigger(note, CHORD_VELOCITY, HELD, frame);
      } else if (style === Style.Strum) {
        const gap = STRUM_GAP * this.sampleRate;
        voicing.notes.forEach((note, i) => this.pendingOns.push({ frame: frame + gap * (i + 1), note, source: HELD }));
      } else {
        this.arpIndex = 0;
        if (!this.clockRunning) this.startClock();
      }
      return;
    }

    const before = new Set([previous.bass, ...(isClocked(style) ? [] : previous.notes)]);
    const after = new Set([voicing.bass, ...(isClocked(style) ? [] : voicing.notes)]);
    for (const note of before) if (note !== null && !after.has(note)) this.releaseNote(note, HELD, frame);
    this.pendingOns = this.pendingOns.filter((e) => after.has(e.note));
    for (const note of after) {
      if (note === null || before.has(note)) continue;
      this.trigger(note, note === voicing.bass ? BASS_VELOCITY : CHORD_VELOCITY, HELD, frame);
    }
  }

  /** Let go of the chord. Notes ring out through their release. */
  release(): void {
    this.voicing = null;
    this.pendingOns = [];
    this.pendingOffs = [];
    this.releaseSource(HELD, this.position);
    this.releaseSource(CLOCKED, this.position);
    if (!this.drumsPlaying) this.clockRunning = false;
  }

  /** Start or stop the rhythm box. It starts on the next sixteenth of a running clock. */
  setRhythm(on: boolean): void {
    if (on === this.drumsPlaying) return;
    this.drumsPlaying = on;
    if (on) {
      if (!this.clockRunning) this.startClock();
      this.drumStartTick = this.tick;
      return;
    }
    this.steps.push(this.position, -1);
    if (!this.voicing || !isClocked(this.styleValue)) this.clockRunning = false;
  }

  /** Silence now: the chord, the rhythm and every tail. */
  panic(): void {
    this.setRhythm(false);
    this.release();
    for (const v of this.voices) v.kill();
    this.notes.snapshot(this.position, this.voices);
  }

  private startClock(): void {
    this.clockRunning = true;
    this.tick = 0;
    this.nextTick = this.position;
  }

  private fireTick(frame: number): void {
    const spS = this.stepFrames();
    if (this.drumsPlaying && this.tick >= this.drumStartTick) {
      const step = (this.tick - this.drumStartTick) % STEPS_PER_BAR;
      this.steps.push(frame, step);
      this.drums.playStep(RHYTHMS[this.rhythm] ?? RHYTHMS[0]!, step);
    }
    const voicing = this.voicing;
    const style = this.styleValue;
    if (voicing && voicing.notes.length > 0) {
      if (style === Style.Pulse) {
        if (this.arpIndex % 2 === 0) {
          this.releaseSource(CLOCKED, frame);
          for (const note of voicing.notes) {
            this.trigger(note, CHORD_VELOCITY, CLOCKED, frame);
            this.pendingOffs.push({ frame: frame + 2 * spS * PULSE_GATE, note, source: CLOCKED });
          }
        }
        this.arpIndex++;
      } else if (isClocked(style)) {
        const order = arpOrder(voicing.notes, style);
        const note = order[this.arpIndex % order.length]!;
        this.arpIndex++;
        this.releaseSource(CLOCKED, frame);
        this.trigger(note, CHORD_VELOCITY, CLOCKED, frame);
        this.pendingOffs.push({ frame: frame + spS * ARP_GATE, note, source: CLOCKED });
      }
    }
    this.tick++;
    this.nextTick += spS;
  }

  // -------------------------------------------------------------------------
  // Voices
  // -------------------------------------------------------------------------

  private trigger(note: number, velocity: number, source: NoteSource, frame: number): void {
    const voice = this.voices.find((v) => v.gateOn && v.target === note && v.source === source) ?? pickVoice(this.voices);
    const spread = this.patchValue.spread;
    voice.detune = this.random.next() * 5 * spread;
    voice.pan = Math.max(-1, Math.min(1, (note - 60) / 18)) * spread * 0.6;
    voice.gain = 1;
    voice.start(note, velocity, false, source, frame);
    this.notes.snapshot(frame, this.voices);
  }

  private releaseNote(note: number, source: NoteSource, frame: number): void {
    for (const v of this.voices) if (v.gateOn && v.target === note && v.source === source) v.release();
    this.notes.snapshot(frame, this.voices);
  }

  private releaseSource(source: NoteSource, frame: number): void {
    for (const v of this.voices) if (v.gateOn && v.source === source) v.release();
    this.pendingOffs = this.pendingOffs.filter((e) => e.source !== source);
    this.notes.snapshot(frame, this.voices);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private configure(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.chorus = new Chorus(sampleRate);
    this.delay = new PingPongDelay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.drums.configure(sampleRate);
    this.context.sampleRate = sampleRate;
    this.patchVersion++;
  }

  /** Follow the stream's clock when it restarts (a new stream begins at frame 0). */
  private rebase(position: number): void {
    const delta = position - this.position;
    this.position = position;
    this.nextTick += delta;
    for (const e of this.pendingOns) e.frame += delta;
    for (const e of this.pendingOffs) e.frame += delta;
    this.steps.clear();
    this.notes.clear();
    this.lastSoundFrame = -Infinity;
  }

  private nextEventFrame(): number {
    let next = this.clockRunning ? this.nextTick : Infinity;
    for (const e of this.pendingOns) if (e.frame < next) next = e.frame;
    for (const e of this.pendingOffs) if (e.frame < next) next = e.frame;
    return next;
  }

  private runEvents(frame: number): void {
    // An event belongs to the sample it falls in.
    const horizon = frame + 1;
    if (this.pendingOffs.some((e) => e.frame < horizon)) {
      const due = this.pendingOffs.filter((e) => e.frame < horizon);
      this.pendingOffs = this.pendingOffs.filter((e) => e.frame >= horizon);
      for (const off of due) this.releaseNote(off.note, off.source, frame);
    }
    if (this.pendingOns.some((e) => e.frame < horizon)) {
      const due = this.pendingOns.filter((e) => e.frame < horizon);
      this.pendingOns = this.pendingOns.filter((e) => e.frame >= horizon);
      for (const on of due) this.trigger(on.note, CHORD_VELOCITY, on.source, frame);
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
      this.drumL = new Float32Array(frames);
      this.drumR = new Float32Array(frames);
    }
    const left = this.mixL.subarray(0, frames);
    const right = this.mixR.subarray(0, frames);
    const drumL = this.drumL.subarray(0, frames);
    const drumR = this.drumR.subarray(0, frames);
    left.fill(0);
    right.fill(0);
    drumL.fill(0);
    drumR.fill(0);

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
      this.drums.render(drumL, drumR, i, n, DRUM_LEVEL);
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
    const outL = block.channels[0]!;
    const outR = block.channels[1];
    for (let k = 0; k < frames; k++) {
      const l = softClip((left[k]! + drumL[k]!) * master);
      const r = softClip((right[k]! + drumR[k]!) * master);
      if (outR) {
        outL[k] = l;
        outR[k] = r;
      } else {
        outL[k] = (l + r) * 0.5;
      }
      if (l > 1e-4 || l < -1e-4 || r > 1e-4 || r < -1e-4) this.lastSoundFrame = this.position + k;
    }
    this.position += frames;
  }
}
