/**
 * A player's sound: one output stream, the transport that keeps it on reel
 * time, and the current reel's soundtrack. The player tells it what the
 * picture is doing (cue, reel, loop, mute) and, while sound is running, asks
 * it which moment is being heard so the picture follows the speaker.
 */
import type { AudioService, AudioStream, AudioStreamState } from "@mockintosh/sdk";
import type { ReelAssets, ReelDefinition, ReelSoundtrack } from "../reels";
import { Transport, type TransportTime } from "./transport";

/** `unavailable` when the machine has no speaker or the stream couldn't open. */
export type ReelSoundState = AudioStreamState | "opening" | "unavailable";

export class ReelSound {
  private stream: AudioStream | null = null;
  private transport: Transport | null = null;
  private soundtrack: ReelSoundtrack;
  private duration: number;
  private looping = true;
  private muted = false;
  private cued = { time: 0, playing: false };
  private disposed = false;

  constructor(
    reel: ReelDefinition,
    assets: ReelAssets,
    private readonly onState: (state: ReelSoundState) => void,
  ) {
    this.soundtrack = reel.createSoundtrack(assets);
    this.duration = reel.duration;
  }

  async open(audio: AudioService | undefined): Promise<void> {
    if (!audio) return this.onState("unavailable");
    this.onState("opening");
    let stream: AudioStream;
    try {
      stream = await audio.open({
        channels: 2,
        latency: "interactive",
        render: (block) => this.transport?.render(block, this.soundtrack),
      });
    } catch (err: unknown) {
      console.error("Showreel: couldn't open sound output", err);
      if (!this.disposed) this.onState("unavailable");
      return;
    }
    if (this.disposed) return stream.close();
    this.stream = stream;
    this.transport = new Transport(stream.sampleRate, this.duration, this.looping);
    this.transport.muted = this.muted;
    this.transport.cue(this.cued.time, this.cued.playing);
    stream.onStateChange((state) => this.onState(state));
    this.onState(stream.state());
  }

  /** From the next rendered block, play (or hold) from `time`. */
  cue(time: number, playing: boolean): void {
    this.cued = { time, playing };
    this.transport?.cue(time, playing);
  }

  /** Jump to `time`, still playing or holding as last cued. */
  seek(time: number): void {
    this.cue(time, this.cued.playing);
  }

  /** Switch soundtracks (or rebuild one when its footage arrives); the caller cues where to play. */
  setReel(reel: ReelDefinition, assets: ReelAssets): void {
    this.soundtrack = reel.createSoundtrack(assets);
    this.duration = reel.duration;
    if (this.transport) this.transport.duration = reel.duration;
  }

  setLooping(on: boolean): void {
    this.looping = on;
    if (this.transport) this.transport.looping = on;
  }

  setMuted(on: boolean): void {
    this.muted = on;
    if (this.transport) this.transport.muted = on;
  }

  /**
   * The reel time reaching the speaker (muted or not), or `null` while the
   * stream isn't running and the picture should keep its own clock.
   */
  heard(): TransportTime | null {
    const { stream, transport } = this;
    if (!stream || !transport || stream.state() !== "running") return null;
    return transport.timeAt(stream.playbackPosition());
  }

  close(): void {
    this.disposed = true;
    this.stream?.close();
    this.stream = null;
    this.transport = null;
  }
}
