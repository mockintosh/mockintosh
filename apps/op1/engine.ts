/**
 * The OP-1's sound: the synth and the drum kit, each through its own effect,
 * into the tape, which records them and plays back beside them. Each
 * instrument has a pattern sequencer that runs while the tape does.
 *
 * All timing is in stream frames, as in the Synthesizer: calls between
 * renders take effect at `position`, the next frame to be rendered. What the
 * display shows (notes, pad hits, the head, the scope) is stamped with the
 * frame it happened at, so the UI can follow `playbackPosition()`.
 */
import type { AudioRenderBlock } from "@mockintosh/sdk";
import { Lfo, Noise, softClip } from "../synth/dsp";
import { SCOPE_SIZE } from "../synth/engine";
import { NoteLog } from "../synth/timeline";
import { pickVoice } from "../synth/voice";
import { DrumVoice, PAD_COUNT, PADS } from "./drums";
import { FxRack } from "./fx";
import { defaultSample, type Sample, type SampleRecorder } from "./sampler";
import { StepSequencer, type SequencerTarget } from "./sequencer";
import { defaultKit, factorySound, LfoTarget, type DrumKit, type SynthSound } from "./sounds";
import { TapeMachine } from "./tape";
import { Op1Voice, type VoiceContext } from "./voice";

const VOICES = 8;
/** Control period: the LFO and engine coefficients update this often. */
const CONTROL = 16;
const VOICE_GAIN = 0.32;
const DRUM_GAIN = 0.75;
const SCOPE_MASK = SCOPE_SIZE - 1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Op1Engine {
  sampleRate: number;
  /** Next frame to be rendered — "now" for everything the UI asks. */
  position = 0;
  /** Master volume, 0…1. */
  volume = 0.7;
  kit: DrumKit = defaultKit();
  readonly tape: TapeMachine;

  /** The last `SCOPE_SIZE` frames of the instruments, indexed by `frame & (SCOPE_SIZE - 1)`. */
  readonly scopeL = new Float32Array(SCOPE_SIZE);
  readonly scopeR = new Float32Array(SCOPE_SIZE);
  /** Last frame the instruments were audible. */
  lastSoundFrame = -Infinity;
  /** Which synth notes were held when, for lighting keys as they are heard. */
  readonly notes = new NoteLog(256);
  /** The frame each pad was last struck. */
  readonly padFrames = new Float64Array(PAD_COUNT).fill(-Infinity);
  /** The newest voice's envelope level and the LFO's output, as of the last render. */
  envLevel = 0;
  lfoValue = 0;
  /** Where the newest sampler voice is in its sample, 0…1, or −1. */
  samplerHead = -1;
  /** The current slot's recording, which the SAMPLER engine plays. */
  sample: Sample | null = defaultSample();
  /** A take listening to the OP-1's own output, before the volume knob. */
  sampling: SampleRecorder | null = null;
  readonly synthSequencer = new StepSequencer();
  readonly drumSequencer = new StepSequencer();

  private soundValue: SynthSound = factorySound(0);
  private version = 0;
  private readonly voices: Op1Voice[];
  private readonly pads: DrumVoice[];
  private readonly random = new Noise(0x0b1e);
  private readonly lfo = new Lfo(this.random);
  private synthFx: FxRack;
  private drumFx: FxRack;
  private synthL = new Float32Array(1024);
  private synthR = new Float32Array(1024);
  private drumL = new Float32Array(1024);
  private drumR = new Float32Array(1024);
  private readonly params: [number, number, number, number] = [0, 0, 0, 0];
  private readonly context: VoiceContext;
  /** Whether the sequencers were running as of the last render: they follow the tape. */
  private sequencing = false;
  private readonly synthTarget: SequencerTarget = {
    noteOn: (note, velocity, frame) => this.noteOn(note, velocity, frame),
    noteOff: (note, frame) => this.noteOff(note, frame),
  };
  private readonly drumTarget: SequencerTarget = {
    noteOn: (pad, velocity, frame) => this.hitPad(pad, velocity, frame),
    noteOff: () => {},
  };

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.voices = Array.from({ length: VOICES }, (_, i) => new Op1Voice(0x1f2e3d + i * 7919));
    const noise = new Noise(0xd7a3);
    this.pads = Array.from({ length: PAD_COUNT }, () => new DrumVoice(noise));
    this.synthFx = new FxRack(sampleRate);
    this.drumFx = new FxRack(sampleRate);
    this.tape = new TapeMachine(sampleRate);
    this.context = { sound: this.soundValue, version: 0, sampleRate, pitch: 0, volume: 1, params: this.params, sample: null };
  }

  get sound(): SynthSound {
    return this.soundValue;
  }

  set sound(next: SynthSound) {
    this.soundValue = next;
    this.version++;
  }

  /** Frames in a sixteenth note at the tape's tempo. */
  stepFrames(): number {
    return this.tape.beatFrames() / 4;
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------

  noteOn(note: number, velocity = 0.8, frame = this.position): void {
    const voice = this.voices.find((v) => v.gateOn && v.target === note) ?? pickVoice(this.voices);
    voice.detune = this.random.next() * 4;
    voice.pan = Math.max(-1, Math.min(1, (note - 60) / 24)) * 0.5;
    voice.start(note, velocity, this.soundValue.synth, frame, this.sampleRate);
    this.notes.snapshot(frame, this.voices);
  }

  noteOff(note: number, frame = this.position): void {
    for (const v of this.voices) if (v.gateOn && v.target === note) v.release();
    this.notes.snapshot(frame, this.voices);
  }

  releaseAll(): void {
    for (const v of this.voices) if (v.gateOn) v.release();
    this.notes.snapshot(this.position, this.voices);
  }

  hitPad(pad: number, velocity = 0.9, frame = this.position): void {
    const sound = PADS[pad];
    if (!sound) return;
    if (sound.choke !== undefined) {
      this.pads.forEach((voice, i) => {
        if (i !== pad && PADS[i]!.choke === sound.choke) voice.stop();
      });
    }
    const [tune, , spread] = this.kit.kit;
    this.pads[pad]!.trigger(sound, this.kit.pads[pad]!, tune, spread, velocity, this.sampleRate);
    this.padFrames[pad] = frame;
  }

  /** Silence the instruments now, tails and all. The tape keeps playing. */
  panic(): void {
    for (const v of this.voices) v.kill();
    for (const p of this.pads) p.stop();
    this.notes.snapshot(this.position, this.voices);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Run at `sampleRate` from now on, as the stream will. A change of rate wipes the tape. */
  setSampleRate(sampleRate: number): void {
    if (sampleRate !== this.sampleRate) this.configure(sampleRate);
  }

  private configure(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.synthFx = new FxRack(sampleRate);
    this.drumFx = new FxRack(sampleRate);
    this.tape.configure(sampleRate);
    this.context.sampleRate = sampleRate;
    this.version++;
  }

  /** Follow the stream's clock when it restarts (a new stream begins at frame 0). */
  private rebase(position: number): void {
    if (this.sequencing) {
      this.synthSequencer.stop(this.synthTarget, this.position);
      this.drumSequencer.stop(this.drumTarget, this.position);
      this.sequencing = false;
    }
    this.synthSequencer.played.clear();
    this.drumSequencer.played.clear();
    this.position = position;
    this.notes.clear();
    this.padFrames.fill(-Infinity);
    this.tape.heads.clear();
    this.lastSoundFrame = -Infinity;
  }

  /** Start the sequencers where the tape is when it starts, and let go of their notes when it stops. */
  private followTransport(): void {
    const playing = this.tape.playing;
    if (playing === this.sequencing) return;
    this.sequencing = playing;
    if (playing) {
      const at = this.tape.head / this.stepFrames();
      this.synthSequencer.start(at, this.position);
      this.drumSequencer.start(at, this.position);
    } else {
      this.synthSequencer.stop(this.synthTarget, this.position);
      this.drumSequencer.stop(this.drumTarget, this.position);
    }
  }

  /** Point the voice context at this control period's LFO. */
  private modulate(frames: number): void {
    const sound = this.soundValue;
    const [speed, depth, shape, target] = sound.lfo;
    const l = this.lfo.advance(speed, shape, frames, this.sampleRate);
    this.lfoValue = l;
    const ctx = this.context;
    ctx.sound = sound;
    ctx.version = this.version;
    ctx.sample = this.sample;
    ctx.pitch = target === LfoTarget.Pitch ? l * depth * depth * 12 : 0;
    ctx.volume = target === LfoTarget.Volume ? 1 - depth * (0.5 - 0.5 * l) : 1;
    const values = sound.engines[sound.synth]!;
    const p = this.params;
    p[0] = values[0];
    p[1] = values[1];
    p[2] = values[2];
    p[3] = values[3];
    if (target === LfoTarget.Param1) p[0] = clamp01(p[0] + l * depth * 0.5);
    if (target === LfoTarget.Param2) p[1] = clamp01(p[1] + l * depth * 0.5);
  }

  render(block: AudioRenderBlock): void {
    if (block.sampleRate !== this.sampleRate) this.configure(block.sampleRate);
    if (block.position !== this.position) this.rebase(block.position);
    const frames = block.frames;
    if (this.synthL.length < frames) {
      this.synthL = new Float32Array(frames);
      this.synthR = new Float32Array(frames);
      this.drumL = new Float32Array(frames);
      this.drumR = new Float32Array(frames);
    }
    const synthL = this.synthL.subarray(0, frames);
    const synthR = this.synthR.subarray(0, frames);
    const drumL = this.drumL.subarray(0, frames);
    const drumR = this.drumR.subarray(0, frames);
    synthL.fill(0);
    synthR.fill(0);
    drumL.fill(0);
    drumR.fill(0);
    const sr = this.sampleRate;
    const step = this.stepFrames();

    this.followTransport();
    for (let i = 0; i < frames; i += CONTROL) {
      const n = Math.min(CONTROL, frames - i);
      if (this.sequencing) {
        const at = this.position + i;
        this.synthSequencer.advance(n / step, at, n, this.synthTarget);
        this.drumSequencer.advance(n / step, at, n, this.drumTarget);
      }
      this.modulate(n);
      for (const v of this.voices) if (v.active) v.render(synthL, synthR, i, n, this.context);
      for (const p of this.pads) if (p.active) p.render(drumL, drumR, i, n, sr);
    }

    let newest: Op1Voice | null = null;
    for (const v of this.voices) if (v.active && (!newest || v.startedAt > newest.startedAt)) newest = v;
    this.envLevel = newest ? newest.level : 0;
    this.samplerHead = newest ? newest.samplePosition : -1;

    const sound = this.soundValue;
    for (let k = 0; k < frames; k++) {
      synthL[k] = synthL[k]! * VOICE_GAIN;
      synthR[k] = synthR[k]! * VOICE_GAIN;
    }
    this.synthFx.process(sound.fx, sound.fxParams[sound.fx]!, synthL, synthR, frames, step);

    const kit = this.kit;
    const drive = kit.kit[1];
    const drumGain = kit.kit[3] * DRUM_GAIN;
    const driveGain = 1 + drive * 5;
    const makeup = drumGain / (1 + drive * 2);
    for (let k = 0; k < frames; k++) {
      drumL[k] = drive > 0.001 ? softClip(drumL[k]! * driveGain) * makeup : drumL[k]! * drumGain;
      drumR[k] = drive > 0.001 ? softClip(drumR[k]! * driveGain) * makeup : drumR[k]! * drumGain;
    }
    this.drumFx.process(kit.fx, kit.fxParams[kit.fx]!, drumL, drumR, frames, step);

    // The instruments, live: what the scope shows and the tape records.
    for (let k = 0; k < frames; k++) {
      const l = synthL[k]! + drumL[k]!;
      const r = synthR[k]! + drumR[k]!;
      synthL[k] = l;
      synthR[k] = r;
      const at = (this.position + k) & SCOPE_MASK;
      this.scopeL[at] = l;
      this.scopeR[at] = r;
      if (l > 1e-4 || l < -1e-4 || r > 1e-4 || r < -1e-4) this.lastSoundFrame = this.position + k;
    }

    const outL = block.channels[0]!;
    const outR = block.channels[1];
    outL.set(synthL);
    const right = outR ?? drumR;
    right.set(synthR);
    this.tape.process(synthL, synthR, outL, right, frames, this.position);
    if (this.sampling?.listening) this.sampling.write(outL, right, 0, frames);

    const master = this.volume * this.volume * 2;
    for (let k = 0; k < frames; k++) {
      const l = softClip(outL[k]! * master);
      const r = softClip(right[k]! * master);
      if (outR) {
        outL[k] = l;
        outR[k] = r;
      } else {
        outL[k] = (l + r) * 0.5;
      }
    }
    this.position += frames;
  }
}
