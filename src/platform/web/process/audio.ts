/**
 * The speaker as a worker-hosted app sees it. `open` asks the host for a port
 * straight to the audio thread (`AudioService.openPort`) and renders into it
 * here, pulled by the speaker's played reports exactly as the main-thread
 * stream is: the app's `render` never runs on the main thread, and no sample
 * passes through it.
 */
import type { AudioMonitor, AudioRenderBlock, AudioService, AudioStream, AudioStreamState } from "@mockintosh/sdk";

const QUANTUM = 128;
const MAX_CHUNK = 1024;

/** What the host returns for `audio.openPort`; `port` arrives transferred. */
export interface RemoteAudioStream {
  streamId: number;
  sampleRate: number;
  channels: 1 | 2;
  target: number;
  latencyFrames: number;
  state: AudioStreamState;
  port: MessagePort;
}

export interface WorkerAudio {
  service: AudioService;
  /** The host saw a stream's state or output latency change. */
  update(streamId: number, state: AudioStreamState, latencyFrames: number): void;
  /** The speaker's latest mix for a monitor, sent as the OS's frame started. */
  monitorSnapshot(monitorId: number, left: Float32Array, right: Float32Array): void;
  /** Worst `render` time per chunk, for the Worker menu. */
  readonly renderMs: number[];
}

type Call = (method: string, args: unknown[]) => Promise<unknown>;

export function createWorkerAudio(
  call: Call,
  notify: (method: string, ...args: unknown[]) => void,
  options: { monitor: boolean },
): WorkerAudio {
  const streams = new Map<number, { setState(state: AudioStreamState, latencyFrames: number): void }>();
  const monitors = new Map<number, { left: Float32Array; right: Float32Array }>();
  const renderMs: number[] = [];

  const service: AudioService = {
    async open(options): Promise<AudioStream> {
      const remote = (await call("audio.openPort", [{ channels: options.channels ?? 2, latency: options.latency ?? "interactive" }])) as RemoteAudioStream;
      const { port, sampleRate, channels, target, streamId } = remote;
      let state = remote.state;
      let latencyFrames = remote.latencyFrames;
      const listeners = new Set<(state: AudioStreamState) => void>();
      const planar = Array.from({ length: channels }, () => new Float32Array(MAX_CHUNK));
      let rendered = 0;
      let played = 0;
      let closed = false;

      function pump(): void {
        let want = target - (rendered - played);
        while (!closed && want >= QUANTUM) {
          const frames = Math.min(MAX_CHUNK, want - (want % QUANTUM));
          const views = planar.map((buffer) => {
            const view = buffer.subarray(0, frames);
            view.fill(0);
            return view;
          });
          const block: AudioRenderBlock = { sampleRate, frames, channels: views, position: rendered };
          const start = performance.now();
          try {
            options.render(block);
          } catch (error) {
            console.error("Audio stream render failed; closing the stream.", error);
            close();
            return;
          }
          renderMs.push(performance.now() - start);
          if (renderMs.length > 1000) renderMs.shift();
          const interleaved = new Float32Array(frames * channels);
          for (let c = 0; c < channels; c++) {
            const src = views[c]!;
            for (let i = 0, j = c; i < frames; i++, j += channels) interleaved[j] = src[i]!;
          }
          port.postMessage({ type: "chunk", data: interleaved }, [interleaved.buffer]);
          rendered += frames;
          want -= frames;
        }
      }

      function close(): void {
        if (closed) return;
        closed = true;
        port.onmessage = null;
        port.close();
        streams.delete(streamId);
        notify("audio.close", streamId);
        state = "closed";
        listeners.forEach((listener) => listener("closed"));
        listeners.clear();
      }

      streams.set(streamId, {
        setState(next, latency) {
          latencyFrames = latency;
          if (next === state) return;
          state = next;
          listeners.forEach((listener) => listener(next));
          if (next === "closed") close();
        },
      });

      port.onmessage = (event: MessageEvent<{ played: number }>) => {
        played = event.data.played;
        pump();
      };
      pump();

      return {
        sampleRate,
        channels,
        get latency() {
          return (target + latencyFrames) / sampleRate;
        },
        playbackPosition: () => Math.max(0, played - latencyFrames),
        state: () => state,
        onStateChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
    },
  };

  if (options.monitor) {
    /**
     * The mix as of the OS's last frame. A main-thread app reads the live mix;
     * this one can be up to a frame older, which a meter can't see.
     */
    service.monitor = async (): Promise<AudioMonitor> => {
      const { monitorId, sampleRate, capacity } = (await call("audio.monitor", [])) as { monitorId: number; sampleRate: number; capacity: number };
      const latest = { left: new Float32Array(capacity), right: new Float32Array(capacity) };
      monitors.set(monitorId, latest);
      return {
        sampleRate,
        capacity,
        read(left, right) {
          const now = monitors.get(monitorId) ?? latest;
          const n = Math.min(capacity, left.length, right.length);
          left.fill(0, 0, left.length - n);
          right.fill(0, 0, right.length - n);
          left.set(now.left.subarray(capacity - n), left.length - n);
          right.set(now.right.subarray(capacity - n), right.length - n);
        },
        close() {
          if (!monitors.delete(monitorId)) return;
          notify("audio.monitorClose", monitorId);
        },
      };
    };
  }

  return {
    service,
    monitorSnapshot(monitorId, left, right) {
      if (monitors.has(monitorId)) monitors.set(monitorId, { left, right });
    },
    update(streamId, state, latencyFrames) {
      streams.get(streamId)?.setState(state, latencyFrames);
    },
    renderMs,
  };
}
