/**
 * A speaker with no hardware: streams render only when the caller advances
 * the clock, and every sample is kept for inspection. A board's audio driver
 * has the same shape — its DMA interrupt is `advance`.
 */
import type {
  AudioMonitor,
  AudioService,
  AudioStream,
  AudioStreamOptions,
  AudioStreamState,
} from "@mockintosh/sdk";

export interface CapturedAudioStream {
  readonly stream: AudioStream;
  /** Everything the stream has rendered so far, one array per channel. */
  samples(): Float32Array[];
}

export interface HeadlessAudio extends AudioService {
  /** Render `frames` from every open stream, as an output interrupt would. */
  advance(frames: number): void;
  /** Every stream opened so far, including closed ones, oldest first. */
  readonly streams: readonly CapturedAudioStream[];
  monitor(): Promise<AudioMonitor>;
}

/** How much of the mix monitors can read back. */
const MONITOR_CAPACITY = 4096;

/** The last `MONITOR_CAPACITY` frames of the stereo mix, as the speaker played them. */
class MixHistory {
  private readonly sides = [new Float32Array(MONITOR_CAPACITY), new Float32Array(MONITOR_CAPACITY)];
  /** Frames written so far; the next frame lands at `written % capacity`. */
  private written = 0;

  write(left: Float32Array, right: Float32Array): void {
    const frames = left.length;
    const skip = Math.max(0, frames - MONITOR_CAPACITY);
    for (let i = skip; i < frames; i++) {
      const at = (this.written + i) % MONITOR_CAPACITY;
      this.sides[0]![at] = left[i]!;
      this.sides[1]![at] = right[i]!;
    }
    this.written += frames;
  }

  read(left: Float32Array, right: Float32Array): void {
    const outputs = [left, right];
    const n = Math.min(MONITOR_CAPACITY, left.length, right.length, this.written);
    outputs.forEach((out, c) => {
      const side = this.sides[c]!;
      out.fill(0, 0, out.length - n);
      for (let i = 0; i < n; i++) out[out.length - n + i] = side[(this.written - n + i) % MONITOR_CAPACITY]!;
    });
  }
}

export function createHeadlessAudio(sampleRate = 48000): HeadlessAudio {
  const streams: CapturedAudioStream[] = [];
  const live = new Set<(frames: number) => Float32Array[]>();
  const history = new MixHistory();

  return {
    streams,
    advance(frames) {
      if (frames <= 0) return;
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      for (const pull of [...live]) {
        const block = pull(frames);
        const l = block[0]!;
        const r = block[1] ?? l;
        for (let i = 0; i < frames; i++) {
          left[i] += l[i]!;
          right[i] += r[i]!;
        }
      }
      history.write(left, right);
    },
    async monitor(): Promise<AudioMonitor> {
      let closed = false;
      return {
        sampleRate,
        capacity: MONITOR_CAPACITY,
        read(left, right) {
          if (closed) {
            left.fill(0);
            right.fill(0);
            return;
          }
          history.read(left, right);
        },
        close() {
          closed = true;
        },
      };
    },
    async open(options: AudioStreamOptions): Promise<AudioStream> {
      const channels = options.channels ?? 2;
      const chunks: Float32Array[][] = [];
      const listeners = new Set<(state: AudioStreamState) => void>();
      let position = 0;
      let state: AudioStreamState = "running";

      const close = () => {
        if (state === "closed") return;
        state = "closed";
        live.delete(pull);
        listeners.forEach((listener) => listener("closed"));
      };

      function pull(frames: number): Float32Array[] {
        const block = Array.from({ length: channels }, () => new Float32Array(frames));
        try {
          options.render({ sampleRate, frames, channels: block, position });
        } catch (error) {
          close();
          throw error;
        }
        chunks.push(block);
        position += frames;
        return block;
      }

      const stream: AudioStream = {
        sampleRate,
        channels,
        latency: 0,
        playbackPosition: () => position,
        state: () => state,
        onStateChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
      live.add(pull);
      streams.push({
        stream,
        samples() {
          return Array.from({ length: channels }, (_, c) => {
            const out = new Float32Array(position);
            let offset = 0;
            for (const chunk of chunks) {
              out.set(chunk[c]!, offset);
              offset += chunk[c]!.length;
            }
            return out;
          });
        },
      });
      return stream;
    },
  };
}
