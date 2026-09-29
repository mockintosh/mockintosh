/**
 * The cassette's engine. Four keys play chords (and a bass note under each);
 * a hummed pitch sings the melody, and each beat of it becomes the triad that
 * best covers those notes. Drums sit on their own keys. The tape is a
 * loop of sixteenths. Arming it and playing a note starts the loop on that
 * note, and everything recorded comes back on the next pass.
 *
 * Timing is in stream frames, as in the Synthesizer: notes asked for between
 * renders sound at `position`, and the steps of the loop are scheduled inside
 * `render`.
 */
import type { AudioRenderBlock } from "@mockintosh/sdk";
import { DrumKit, type DrumPart } from "../chord/drums";
import { softClip } from "../synth/dsp";
import { defaultPatch, type Patch } from "../synth/params";
import { Timeline } from "../synth/timeline";
import { pickVoice, Voice, type VoiceContext } from "../synth/voice";
import { createLoop, stepsIn, withBars, type Bars, type DrumLane, type Loop } from "./loop";
import { chordForBeat, triadForPad, voiceChord, type Scale, SCALES } from "./theory";

const CHORD_VOICES = 6;
/** A beat is a quarter note: four sixteenths, and one chord. */
const STEPS_PER_BEAT = 4;
const MASTER = 0.85;
const DRUM_LEVEL = 0.7;
/** How far the reels turn per beat. */
const REEL_PER_BEAT = 0.22;

const PART: Record<DrumLane, DrumPart> = { kick: "kick", snare: "snare", hat: "hat", open: "openHat" };
const LANES: readonly DrumLane[] = ["kick", "snare", "hat", "open"];

const patch = (changes: Partial<Patch>): Patch => ({ ...defaultPatch(), ...changes });
const pitchClassOf = (midi: number, key: number) => ((Math.round(midi) - key) % 12 + 12) % 12;

const CHORD_PATCH = patch({
  osc1Wave: 2, osc2Wave: 2, osc2Semi: 12, osc2Level: 0.3, cutoff: 2400, resonance: 0.05,
  filterEnv: 0.25, fDecay: 0.4, fSustain: 0.3, attack: 0.012, decay: 0.35, sustain: 0.65, release: 0.18,
});
const LEAD_PATCH = patch({
  osc1Wave: 1, osc2Level: 0, pulseWidth: 0.4, cutoff: 1600, resonance: 0.2, filterEnv: 0.45,
  fDecay: 0.2, fSustain: 0.4, attack: 0.03, decay: 0.15, sustain: 0.75, release: 0.08, glide: 0.06,
});
const BASS_PATCH = patch({
  osc1Wave: 3, osc2Wave: 1, osc2Semi: -12, osc2Level: 0.35, subLevel: 0.45, cutoff: 380,
  attack: 0.005, decay: 0.25, sustain: 0.55, release: 0.1,
});

export class CassetteEngine {
  sampleRate: number;
  /** Next frame to be rendered — "now" for everything the faceplate asks. */
  position = 0;
  tempo = 100;
  loop: Loop = createLoop(1);
  playing = false;
  /** Armed: the next notes print onto the tape, and a stopped tape rolls on the first one. */
  recording = false;
  /** The step the playhead is on, or −1 before the tape has ever rolled. */
  step = -1;
  /** The hummed note being held, already snapped, or null. */
  hummed: number | null = null;
  /**
   * The chord the current phrase has settled on, or null before a beat has
   * been heard. A finger on a key plays instead of this.
   */
  humDegree: number | null = null;
  /** The triad the voices are holding, or null during a rest. */
  soundingDegree: number | null = null;
  /** Bumped whenever the tape's contents change, so the window can redraw. */
  generation = 0;

  /** Step playing at a frame; −1 before the first one. The display reads this at the speaker. */
  readonly steps = new Timeline(128, -1);

  key = 0;
  scale: Scale = SCALES[0]!;

  private readonly chordVoices: Voice[];
  private readonly lead: Voice;
  private readonly bass: Voice;
  private readonly drums = new DrumKit();
  private readonly chordCtx: VoiceContext;
  private readonly leadCtx: VoiceContext;
  private readonly bassCtx: VoiceContext;
  private patchVersion = 1;

  /** Chord keys held, newest last. */
  private pressed: number[] = [];
  private liveChord: number | null = null;
  private liveLead: number | null = null;
  /** What the tape last told the voices. −2 means "look again". */
  private loopChord = -2;
  private loopLead = -2;

  /** Step where the open beat begins, or −1 before the tape has one. */
  private beatStart = -1;
  private beatDown: number | null = null;
  private beatRest: number[] = [];
  /** A key was held during this beat, so the hum doesn't overwrite it. */
  private beatFinger = false;
  /** Triad written for the beat that just closed. The next one prefers it. */
  private lastBeatChord: number | null = null;
  /** Notes gathered while the tape is stopped, so a hum still sounds a chord. */
  private previewDown: number | null = null;
  private previewRest: number[] = [];

  /** The next step the clock will enter. */
  private pending = 0;
  private nextTick = 0;
  /** Frames left in the current step when the tape was paused. */
  private remaining = 0;

  private parked = 0;
  private anchorFrame = 0;

  private mixL = new Float32Array(1024);
  private mixR = new Float32Array(1024);
  private drumL = new Float32Array(1024);
  private drumR = new Float32Array(1024);

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.chordVoices = Array.from({ length: CHORD_VOICES }, (_, i) => new Voice(0x51a0 + i * 7919));
    this.lead = new Voice(0x1ead);
    this.bass = new Voice(0xba55);
    this.chordCtx = { patch: CHORD_PATCH, patchVersion: 1, sampleRate, lfo: 0 };
    this.leadCtx = { patch: LEAD_PATCH, patchVersion: 1, sampleRate, lfo: 0 };
    this.bassCtx = { patch: BASS_PATCH, patchVersion: 1, sampleRate, lfo: 0 };
    this.configure(sampleRate);
  }

  setHarmony(key: number, scale: Scale): void {
    this.key = key;
    this.scale = scale;
    this.lastBeatChord = null;
    const pad = this.pressed[this.pressed.length - 1];
    if (pad !== undefined) {
      this.liveChord = triadForPad(scale, pad);
      this.strikeChord(this.liveChord, this.position);
      return;
    }
    if (this.hummed !== null && !this.playing) {
      this.previewDown = null;
      this.previewRest = [];
      this.preview(this.hummed);
    }
  }

  setBars(bars: Bars): void {
    if (bars !== this.loop.bars) this.loop = withBars(this.loop, bars);
    const n = stepsIn(this.loop.bars);
    if (this.step >= n) this.step = this.step % n;
    this.pending = this.pending % n;
  }

  /** Forget the recording. A note still under a finger keeps sounding. */
  clear(): void {
    this.loop = createLoop(this.loop.bars);
    this.loopChord = -2;
    this.loopLead = -2;
    this.resetBeat();
    this.previewDown = null;
    this.previewRest = [];
    this.humDegree = null;
    this.generation++;
    if (this.liveChord === null && this.humDegree === null) this.releaseChords();
    if (this.liveLead === null) this.releaseLead();
  }

  setRecording(on: boolean): void {
    this.recording = on;
    if (!on) return;
    // A note already sounding is the downbeat — the loop starts on it.
    if (!this.playing && (this.liveLead !== null || this.liveChord !== null)) this.ensureRolling();
    if (this.liveLead !== null && this.step >= 0) this.capture(this.step, this.liveLead, this.position);
    this.commit(this.step);
  }

  togglePlay(): void {
    if (this.playing) {
      this.pause();
      return;
    }
    if (this.step < 0) {
      this.startAt(0);
      this.playLoop(0, this.position);
    } else {
      this.resume();
    }
  }

  pressChord(pad: number): void {
    if (pad < 0 || pad > 3 || this.pressed.includes(pad)) return;
    const degree = triadForPad(this.scale, pad);
    this.pressed = [...this.pressed.filter((held) => held !== pad), pad];
    this.liveChord = degree;
    this.beatFinger = true;
    if (this.recording) {
      this.ensureRolling();
      this.writeChord(this.step, degree);
    }
    this.strikeChord(degree, this.position);
  }

  releaseChord(pad: number): void {
    if (!this.pressed.includes(pad)) return;
    this.pressed = this.pressed.filter((held) => held !== pad);
    const next = this.pressed[this.pressed.length - 1];
    if (next !== undefined) {
      this.liveChord = triadForPad(this.scale, next);
      this.beatFinger = true;
      if (this.recording) this.writeChord(this.step, this.liveChord);
      this.strikeChord(this.liveChord, this.position);
      return;
    }
    this.liveChord = null;
    if (this.humDegree !== null && !this.playing) {
      this.strikeChord(this.humDegree, this.position);
      return;
    }
    this.handOffChord();
  }

  tapDrum(lane: DrumLane): void {
    this.drums.hit(PART[lane], 0.95);
    if (!this.recording) return;
    this.ensureRolling();
    this.loop[lane][this.step] = 0.95;
    this.generation++;
  }

  /**
   * The hummed note, already snapped to the scale, or null when the voice
   * rests. While the tape rolls, the note joins the current beat and the
   * chord is chosen when that beat ends. While it is stopped, the notes so
   * far pick a chord immediately. A finger on a key plays its own chord.
   */
  hear(note: number | null): void {
    if (note === this.hummed) return;
    this.hummed = note;
    if (note === null) {
      this.liveLead = null;
      this.previewDown = null;
      this.previewRest = [];
      this.handOffLead();
      if (this.liveChord === null && !this.playing) {
        this.humDegree = null;
        this.handOffChord();
      }
      return;
    }
    const legato = this.liveLead !== null;
    this.liveLead = note;
    this.strikeLead(note, this.position, legato);
    if (this.recording) {
      this.ensureRolling();
      this.writeLead(this.step, note);
      this.capture(this.step, note, this.position);
      return;
    }
    if (this.playing && this.step >= 0) {
      this.capture(this.step, note, this.position);
      return;
    }
    this.preview(note);
  }

  /** Radians the reels have turned at `frame` — frozen while the tape is stopped. */
  reelAngle(frame: number): number {
    if (!this.playing) return this.parked;
    const beats = ((frame - this.anchorFrame) / this.sampleRate) * (this.tempo / 60);
    return this.parked + beats * REEL_PER_BEAT * Math.PI * 2;
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

    let i = 0;
    while (i < frames) {
      const frame = this.position + i;
      if (this.playing) {
        let guard = 0;
        while (this.nextTick <= frame && guard++ < 8) this.advance(frame);
      }
      let n = Math.min(64, frames - i);
      if (this.playing && this.nextTick < frame + n) n = Math.max(1, Math.floor(this.nextTick - frame));
      for (const voice of this.chordVoices) if (voice.active) voice.render(left, right, i, n, this.chordCtx);
      if (this.lead.active) this.lead.render(left, right, i, n, this.leadCtx);
      if (this.bass.active) this.bass.render(left, right, i, n, this.bassCtx);
      this.drums.render(drumL, drumR, i, n, DRUM_LEVEL);
      i += n;
    }

    const outL = block.channels[0]!;
    const outR = block.channels[1];
    for (let k = 0; k < frames; k++) {
      const l = softClip((left[k]! + drumL[k]!) * MASTER);
      const r = softClip((right[k]! + drumR[k]!) * MASTER);
      if (outR) {
        outL[k] = l;
        outR[k] = r;
      } else {
        outL[k] = (l + r) * 0.5;
      }
    }
    this.position += frames;
  }

  // -------------------------------------------------------------------------
  // Tape
  // -------------------------------------------------------------------------

  private stepFrames(): number {
    return Math.max(1, ((60 / this.tempo) * this.sampleRate) / 4);
  }

  /** A stopped tape rolls. The first time, the note that woke it lands on step 0. */
  private ensureRolling(): void {
    if (this.playing) return;
    if (this.step < 0) this.startAt(0);
    else this.resume();
  }

  private startAt(step: number): void {
    const n = stepsIn(this.loop.bars);
    this.playing = true;
    this.step = ((step % n) + n) % n;
    this.pending = (this.step + 1) % n;
    this.nextTick = this.position + this.stepFrames();
    this.anchorFrame = this.position;
    this.remaining = 0;
    this.steps.push(this.position, this.step);
  }

  private resume(): void {
    this.playing = true;
    this.anchorFrame = this.position;
    this.nextTick = this.position + (this.remaining > 0 ? this.remaining : this.stepFrames());
  }

  private pause(): void {
    this.remaining = Math.max(0, this.nextTick - this.position);
    this.parked = this.reelAngle(this.position);
    this.playing = false;
  }

  private advance(frame: number): void {
    const n = stepsIn(this.loop.bars);
    const step = this.pending % n;
    this.step = step;
    this.pending = (step + 1) % n;
    this.nextTick = frame + this.stepFrames();
    this.steps.push(frame, step);
    this.playLoop(step, frame);
    if (step % STEPS_PER_BEAT === 0) this.finishBeat(step);
    if (this.liveLead !== null) this.capture(step, this.liveLead, frame);
    this.commit(step);
  }

  /** Print whatever a finger is holding, and a melody that is still sounding. */
  private commit(step: number): void {
    if (!this.recording || step < 0) return;
    if (this.liveChord !== null) this.writeChord(step, this.liveChord);
    if (this.liveLead !== null) this.writeLead(step, this.liveLead);
  }

  private writeChord(step: number, degree: number): void {
    if (step < 0 || this.loop.chords[step] === degree) return;
    this.loop.chords[step] = degree;
    this.generation++;
  }

  private writeLead(step: number, note: number): void {
    if (step < 0 || this.loop.lead[step] === note) return;
    this.loop.lead[step] = note;
    this.generation++;
  }

  /** Play what the tape has at `step`. A finger down wins over the recording. */
  private playLoop(step: number, frame: number): void {
    for (const lane of LANES) {
      const velocity = this.loop[lane][step] ?? 0;
      if (velocity > 0) this.drums.hit(PART[lane], velocity);
    }
    if (this.liveChord === null) {
      const degree = this.loop.chords[step] ?? -1;
      const downbeat = step % STEPS_PER_BEAT === 0;
      if (degree >= 0 && degree !== this.loopChord) {
        this.loopChord = degree;
        this.strikeChord(degree, frame);
      } else if (degree < 0 && downbeat && this.loopChord !== -1 && (this.liveLead === null || !this.recording)) {
        // A hum's chord holds through the beat. It lifts on the next downbeat
        // when the tape has a rest and nobody is still singing a new one.
        this.loopChord = -1;
        this.releaseChords();
      }
    }
    if (this.liveLead === null) {
      const note = this.loop.lead[step] ?? -1;
      if (note !== this.loopLead) {
        const previous = this.loopLead;
        this.loopLead = note;
        if (note < 0) this.releaseLead();
        else this.strikeLead(note, frame, previous >= 0);
      }
    }
  }

  /**
   * The finger lifted. While recording, the lift is the end of the note, so
   * the tape waits until the next pass to play it. While auditioning over a
   * loop, that loop's chord comes back at once.
   */
  private handOffChord(): void {
    this.releaseChords();
    if (!this.playing || this.step < 0) {
      this.loopChord = -1;
      return;
    }
    const degree = this.loop.chords[this.step] ?? -1;
    this.loopChord = degree;
    if (!this.recording && degree >= 0) this.strikeChord(degree, this.position);
  }

  private resetBeat(): void {
    this.beatStart = -1;
    this.beatDown = null;
    this.beatRest = [];
    this.beatFinger = false;
    this.lastBeatChord = null;
  }

  /** A hum with the tape stopped: the notes since the last breath pick a chord now. */
  private preview(note: number): void {
    const pitchClass = pitchClassOf(note, this.key);
    if (this.previewDown === null) this.previewDown = pitchClass;
    else if (pitchClass !== this.previewDown && !this.previewRest.includes(pitchClass)) this.previewRest.push(pitchClass);
    const degree = chordForBeat(this.scale, { downbeat: this.previewDown, rest: this.previewRest }, this.humDegree);
    if (degree === null || degree === this.humDegree || this.liveChord !== null) return;
    this.humDegree = degree;
    this.strikeChord(degree, this.position);
  }

  /** Add `note` to the beat `step` belongs to, closing the previous beat first. */
  private capture(step: number, note: number, frame: number): void {
    if (step < 0) return;
    const start = step - (step % STEPS_PER_BEAT);
    if (this.beatStart !== start) this.finishBeat(start);
    const pitchClass = pitchClassOf(note, this.key);
    if (step % STEPS_PER_BEAT === 0) {
      this.beatDown = pitchClass;
      this.soundProvisional(step, pitchClass, frame);
    } else if (pitchClass !== this.beatDown && !this.beatRest.includes(pitchClass)) {
      this.beatRest.push(pitchClass);
    }
  }

  /**
   * The first pass has no chord on the tape yet, so the downbeat note picks
   * one to sing until the beat's real chord comes round.
   */
  private soundProvisional(step: number, pitchClass: number, frame: number): void {
    if (!this.recording || this.liveChord !== null || (this.loop.chords[step] ?? -1) >= 0) return;
    const degree = chordForBeat(this.scale, { downbeat: pitchClass, rest: [] }, this.lastBeatChord);
    if (degree === null || degree === this.soundingDegree) return;
    this.humDegree = degree;
    this.strikeChord(degree, frame);
  }

  /** Write one chord across the beat that just ended. */
  private finishBeat(nextStart: number): void {
    const start = this.beatStart;
    const melody = { downbeat: this.beatDown, rest: [...this.beatRest] };
    const finger = this.beatFinger;
    this.beatDown = null;
    this.beatRest = [];
    this.beatFinger = this.liveChord !== null;
    this.beatStart = nextStart;
    if (start < 0 || !this.recording || finger) return;
    const degree = chordForBeat(this.scale, melody, this.lastBeatChord);
    if (degree === null) return;
    const n = stepsIn(this.loop.bars);
    for (let i = 0; i < STEPS_PER_BEAT; i++) this.writeChord((start + i) % n, degree);
    this.lastBeatChord = degree;
    this.humDegree = degree;
  }

  private handOffLead(): void {
    this.releaseLead();
    if (!this.playing || this.step < 0) {
      this.loopLead = -1;
      return;
    }
    const note = this.loop.lead[this.step] ?? -1;
    this.loopLead = note;
    if (!this.recording && note >= 0) this.strikeLead(note, this.position, false);
  }

  // -------------------------------------------------------------------------
  // Voices
  // -------------------------------------------------------------------------

  private strikeChord(degree: number, frame: number): void {
    const chord = this.scale.triads[degree];
    if (!chord) return;
    const voiced = voiceChord(this.key, chord);
    for (const voice of this.chordVoices) if (voice.gateOn) voice.release();
    this.soundingDegree = degree;
    for (const note of voiced.notes) {
      const voice = pickVoice(this.chordVoices);
      voice.gain = 0.42;
      voice.start(note, 0.85, false, "keys", frame);
    }
    this.bass.gain = 0.7;
    this.bass.start(voiced.bass, 0.9, false, "seq", frame);
  }

  private releaseChords(): void {
    for (const voice of this.chordVoices) if (voice.gateOn) voice.release();
    if (this.bass.gateOn) this.bass.release();
    this.soundingDegree = null;
  }

  private strikeLead(note: number, frame: number, legato: boolean): void {
    this.lead.gain = 0.72;
    if (legato && this.lead.gateOn) this.lead.legato(note);
    else this.lead.start(note, 0.85, false, "arp", frame);
  }

  private releaseLead(): void {
    if (this.lead.gateOn) this.lead.release();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private configure(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.drums.configure(sampleRate);
    this.patchVersion++;
    this.chordCtx.sampleRate = sampleRate;
    this.leadCtx.sampleRate = sampleRate;
    this.bassCtx.sampleRate = sampleRate;
    this.chordCtx.patchVersion = this.patchVersion;
    this.leadCtx.patchVersion = this.patchVersion;
    this.bassCtx.patchVersion = this.patchVersion;
  }

  /** Follow the stream's clock when it restarts (a new stream begins at frame 0). */
  private rebase(position: number): void {
    const delta = position - this.position;
    this.position = position;
    this.nextTick += delta;
    this.anchorFrame += delta;
    this.steps.clear();
  }
}
