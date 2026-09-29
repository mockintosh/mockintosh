import { describe, expect, it } from "vitest";
import type { AudioService, AudioStream, AudioStreamOptions, AudioStreamState } from "@mockintosh/sdk";
import { NO_ASSETS, type ReelDefinition } from "../reels";
import { ReelSound, type ReelSoundState } from "./reelSound";

const SR = 1000;

/** A speaker in a test: the test renders blocks and moves the playback position by hand. */
class FakeStream implements AudioStream {
  readonly sampleRate = SR;
  readonly channels = 2;
  readonly latency = 0.02;
  position = 0;
  status: AudioStreamState = "suspended";
  private listeners: ((state: AudioStreamState) => void)[] = [];
  constructor(readonly options: AudioStreamOptions) {}
  playbackPosition(): number {
    return this.position;
  }
  state(): AudioStreamState {
    return this.status;
  }
  onStateChange(listener: (state: AudioStreamState) => void): () => void {
    this.listeners.push(listener);
    return () => {};
  }
  setState(state: AudioStreamState): void {
    this.status = state;
    for (const l of this.listeners) l(state);
  }
  close(): void {
    this.setState("closed");
  }
  /** Render `frames` from the current position; returns the left channel. */
  pull(at: number, frames = 100): Float32Array {
    const channels = [new Float32Array(frames), new Float32Array(frames)];
    this.options.render({ sampleRate: SR, frames, channels, position: at });
    return channels[0]!;
  }
}

function fakeAudio(): { audio: AudioService; stream: () => FakeStream } {
  let last: FakeStream | null = null;
  return {
    audio: { open: async (options) => (last = new FakeStream(options)) },
    stream: () => last!,
  };
}

function reel(duration: number): ReelDefinition {
  return {
    id: "test",
    title: "Test",
    duration,
    fps: 10,
    chapters: [{ number: 1, title: "All", start: 0, end: duration }],
    createPlayer: () => ({ render: () => {} }),
    createSoundtrack: () => ({
      render(out, offset, frames) {
        for (const ch of out) for (let i = 0; i < frames; i++) ch[offset + i] = 0.25;
      },
    }),
  };
}

describe("ReelSound", () => {
  it("is unavailable without a speaker and never takes over the clock", async () => {
    const states: ReelSoundState[] = [];
    const sound = new ReelSound(reel(5), NO_ASSETS, (s) => states.push(s));
    await sound.open(undefined);
    expect(states).toEqual(["unavailable"]);
    expect(sound.heard()).toBeNull();
  });

  it("applies cues given before the stream opened, and hands the clock over once running", async () => {
    const { audio, stream } = fakeAudio();
    const states: ReelSoundState[] = [];
    const sound = new ReelSound(reel(5), NO_ASSETS, (s) => states.push(s));
    sound.cue(2, true);
    await sound.open(audio);
    expect(states).toEqual(["opening", "suspended"]);
    expect(sound.heard()).toBeNull();

    stream().setState("running");
    expect(states.at(-1)).toBe("running");
    expect(stream().pull(0)[0]).not.toBe(0);
    stream().position = 50;
    expect(sound.heard()?.time).toBeCloseTo(2.05);
  });

  it("goes quiet when muted and plays the new reel's soundtrack after a switch", async () => {
    const { audio, stream } = fakeAudio();
    const sound = new ReelSound(reel(5), NO_ASSETS, () => {});
    await sound.open(audio);
    stream().setState("running");
    sound.cue(0, true);
    sound.setMuted(true);
    expect(
      stream()
        .pull(0)
        .every((v) => v === 0),
    ).toBe(true);
    sound.setMuted(false);
    sound.setReel(reel(1), NO_ASSETS);
    sound.setLooping(false);
    sound.cue(0.95, true);
    const left = stream().pull(100);
    expect(left[0]).not.toBe(0);
    expect(left[60]).toBe(0);
  });

  it("closes a stream that opens after the player has gone", async () => {
    const { audio, stream } = fakeAudio();
    const sound = new ReelSound(reel(5), NO_ASSETS, () => {});
    const opening = sound.open(audio);
    sound.close();
    await opening;
    expect(stream().state()).toBe("closed");
    expect(sound.heard()).toBeNull();
  });
});
