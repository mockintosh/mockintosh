/**
 * The microphone as a worker-hosted app sees it. `open` asks the host for a
 * port straight from the capture worklet (`MicrophoneService.openPort`), so
 * captured audio reaches the app without passing through the main thread.
 */
import type { AudioCaptureBlock, AudioStreamState, MicrophoneInput, MicrophoneService } from "@mockintosh/sdk";

type Call = (method: string, args: unknown[]) => Promise<unknown>;

interface RemoteInput {
  inputId: number;
  sampleRate: number;
  channels: 1 | 2;
  state: AudioStreamState;
  port: MessagePort;
}

export interface WorkerMicrophone {
  service: MicrophoneService;
  update(inputId: number, state: AudioStreamState): void;
}

export function createWorkerMicrophone(call: Call, notify: (method: string, ...args: unknown[]) => void): WorkerMicrophone {
  const inputs = new Map<number, (state: AudioStreamState) => void>();

  const service: MicrophoneService = {
    async open(options): Promise<MicrophoneInput> {
      const remote = (await call("microphone.openPort", [{ channels: options.channels ?? 1 }])) as RemoteInput;
      const { port, sampleRate, channels, inputId } = remote;
      let state = remote.state;
      const listeners = new Set<(state: AudioStreamState) => void>();
      let position = 0;
      let closed = false;

      function close(): void {
        if (closed) return;
        closed = true;
        port.onmessage = null;
        port.close();
        inputs.delete(inputId);
        notify("microphone.close", inputId);
        state = "closed";
        listeners.forEach((listener) => listener("closed"));
        listeners.clear();
      }

      inputs.set(inputId, (next) => {
        if (next === state) return;
        state = next;
        listeners.forEach((listener) => listener(next));
        if (next === "closed") close();
      });

      port.onmessage = (event: MessageEvent<Float32Array>) => {
        const interleaved = event.data;
        const frames = interleaved.length / channels;
        const views = Array.from({ length: channels }, (_, c) => {
          const view = new Float32Array(frames);
          for (let i = 0, j = c; i < frames; i++, j += channels) view[i] = interleaved[j]!;
          return view;
        });
        const block: AudioCaptureBlock = { sampleRate, frames, channels: views, position };
        position += frames;
        try {
          options.capture(block);
        } catch (error) {
          console.error("Microphone capture failed; closing the input.", error);
          close();
        }
      };

      return {
        sampleRate,
        channels,
        state: () => state,
        onStateChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
    },
  };

  return {
    service,
    update(inputId, state) {
      inputs.get(inputId)?.(state);
    },
  };
}
