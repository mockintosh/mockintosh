/**
 * A microphone with no hardware: it hears what the caller `speak`s into it,
 * then silence, and delivers it only when the clock advances. A board's
 * input driver has the same shape — its DMA interrupt is `advance`.
 */
import type { AudioStreamState, MicrophoneInput, MicrophoneOptions, MicrophoneService } from "@mockintosh/sdk";

export interface HeadlessMicrophone extends MicrophoneService {
  /** Queue sound for every open input to hear, after anything already queued. */
  speak(samples: Float32Array): void;
  /** Deliver `frames` to every open input, in blocks the size real hardware uses. */
  advance(frames: number): void;
  /** Every input opened so far, including closed ones, oldest first. */
  readonly inputs: readonly MicrophoneInput[];
}

/** Frames per delivered block. */
const BLOCK = 512;

export function createHeadlessMicrophone(sampleRate = 48000): HeadlessMicrophone {
  const inputs: MicrophoneInput[] = [];
  const live = new Set<(heard: Float32Array) => void>();
  const queue: Float32Array[] = [];
  let queueOffset = 0;
  const heard = new Float32Array(BLOCK);

  /** Fill `out` from the queue, silence after it runs dry. */
  function hear(out: Float32Array): void {
    out.fill(0);
    let i = 0;
    while (i < out.length && queue.length > 0) {
      const head = queue[0]!;
      const n = Math.min(out.length - i, head.length - queueOffset);
      out.set(head.subarray(queueOffset, queueOffset + n), i);
      i += n;
      queueOffset += n;
      if (queueOffset >= head.length) {
        queue.shift();
        queueOffset = 0;
      }
    }
  }

  return {
    inputs,
    speak(samples) {
      if (samples.length > 0) queue.push(samples.slice());
    },
    advance(frames) {
      for (let done = 0; done < frames; done += BLOCK) {
        const view = heard.subarray(0, Math.min(BLOCK, frames - done));
        hear(view);
        for (const deliver of [...live]) deliver(view);
      }
    },
    async open(options: MicrophoneOptions): Promise<MicrophoneInput> {
      const channels = options.channels ?? 1;
      const planar = Array.from({ length: channels }, () => new Float32Array(BLOCK));
      const listeners = new Set<(state: AudioStreamState) => void>();
      let state: AudioStreamState = "running";
      let position = 0;

      const close = () => {
        if (state === "closed") return;
        state = "closed";
        live.delete(deliver);
        listeners.forEach((listener) => listener("closed"));
        listeners.clear();
      };

      function deliver(samples: Float32Array): void {
        const frames = samples.length;
        const views = planar.map((buffer) => {
          const view = buffer.subarray(0, frames);
          view.set(samples);
          return view;
        });
        try {
          options.capture({ sampleRate, frames, channels: views, position });
        } catch (error) {
          close();
          throw error;
        }
        position += frames;
      }

      const input: MicrophoneInput = {
        sampleRate,
        channels,
        state: () => state,
        onStateChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
      live.add(deliver);
      inputs.push(input);
      return input;
    },
  };
}
