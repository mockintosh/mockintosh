import type {
  AudioLatency,
  AudioMonitor,
  AudioRenderBlock,
  AudioService,
  AudioStream,
  AudioStreamOptions,
  AudioStreamState,
} from "@mockintosh/sdk";

const PROCESSOR = "mockintosh-pcm-stream";

/** Web Audio renders in quanta of 128 frames; chunks are whole quanta. */
const QUANTUM = 128;
const MAX_CHUNK = 1024;
/** How often (in frames) the worklet tells the page how much it has played. */
const REPORT_FRAMES = 256;
/** Frames buffered ahead of the worklet, at 48 kHz. */
const TARGET_FRAMES: Record<AudioLatency, number> = { interactive: 2048, playback: 8192 };
/**
 * The analyser window behind a monitor. It is longer than a read so the read
 * can skip the newest frames, which the audio thread has made but the
 * listener won't hear until the output latency has passed.
 */
const MONITOR_WINDOW = 8192;
const MONITOR_CAPACITY = 4096;

/**
 * The audio-thread half. It only plays what the page has already rendered:
 * app code never runs on the audio thread, so a stalled page underruns into
 * silence instead of blocking the output. Plain JS, loaded from a Blob URL.
 */
const WORKLET_SOURCE = `
class PcmStream extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions.channels;
    this.report = options.processorOptions.report;
    this.queue = [];
    this.offset = 0;
    this.played = 0;
    this.sinceReport = 0;
    this.open = true;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === "chunk") this.queue.push(message.data);
      else if (message.type === "close") { this.open = false; this.queue.length = 0; }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    const channels = this.channels;
    let i = 0;
    while (i < frames && this.queue.length > 0) {
      const chunk = this.queue[0];
      const n = Math.min(frames - i, chunk.length / channels - this.offset);
      for (let c = 0; c < channels; c++) {
        const dst = out[c];
        let src = this.offset * channels + c;
        for (let k = 0; k < n; k++, src += channels) dst[i + k] = chunk[src];
      }
      i += n;
      this.offset += n;
      if (this.offset * channels >= chunk.length) { this.queue.shift(); this.offset = 0; }
    }
    this.played += i;
    this.sinceReport += frames;
    if (this.sinceReport >= this.report) {
      this.sinceReport = 0;
      this.port.postMessage({ played: this.played });
    }
    return this.open;
  }
}
registerProcessor(${JSON.stringify(PROCESSOR)}, PcmStream);
`;

interface PlayedReport {
  played: number;
}

function streamState(context: AudioContext): AudioStreamState {
  return context.state === "running" ? "running" : context.state === "closed" ? "closed" : "suspended";
}

/** The shared output: every stream plays into `bus`, which monitors tap. */
interface Speaker {
  ctx: AudioContext;
  bus: GainNode;
}

function outputLatencyFrames(ctx: AudioContext): number {
  return Math.round((ctx.outputLatency || ctx.baseLatency || 0) * ctx.sampleRate);
}

/** A splitter and one analyser per side on the mix bus. */
function openMonitor({ ctx, bus }: Speaker): AudioMonitor {
  const splitter = ctx.createChannelSplitter(2);
  const sides = [0, 1].map((channel) => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = MONITOR_WINDOW;
    analyser.smoothingTimeConstant = 0;
    splitter.connect(analyser, channel);
    return analyser;
  });
  bus.connect(splitter);
  const recent = new Float32Array(MONITOR_WINDOW);
  let closed = false;

  return {
    sampleRate: ctx.sampleRate,
    capacity: MONITOR_CAPACITY,
    read(left, right) {
      const outputs = [left, right];
      if (closed || ctx.state !== "running") {
        for (const out of outputs) out.fill(0);
        return;
      }
      const n = Math.min(MONITOR_CAPACITY, left.length, right.length);
      const end = MONITOR_WINDOW - Math.min(MONITOR_WINDOW - n, outputLatencyFrames(ctx));
      sides.forEach((analyser, c) => {
        const out = outputs[c]!;
        analyser.getFloatTimeDomainData(recent);
        out.fill(0, 0, out.length - n);
        out.set(recent.subarray(end - n, end), out.length - n);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      bus.disconnect(splitter);
      splitter.disconnect();
    },
  };
}

/**
 * The speaker on the web: one shared `AudioContext`, one `AudioWorkletNode`
 * per stream, all mixed on one bus. Absent where there is no AudioWorklet
 * (insecure origins, old engines).
 */
export function createWebAudioService(): AudioService | undefined {
  if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") return undefined;

  let shared: Promise<Speaker> | null = null;
  let openStreams = 0;

  function speaker(): Promise<Speaker> {
    shared ??= (async () => {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      // Stereo whatever plays into it, so a mono stream reaches both sides of a monitor.
      const bus = ctx.createGain();
      bus.channelCount = 2;
      bus.channelCountMode = "explicit";
      bus.channelInterpretation = "speakers";
      bus.connect(ctx.destination);
      // Browsers start audio only after a user gesture. The shell's input
      // listeners are ordinary bubbling ones, so resuming in the capture
      // phase means the key that plays the first note also unlocks sound.
      const resume = () => {
        if (openStreams > 0 && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume();
      };
      for (const type of ["pointerdown", "keydown", "touchend"] as const) {
        window.addEventListener(type, resume, { capture: true });
      }
      return { ctx, bus };
    })().catch((error: unknown) => {
      shared = null;
      throw error;
    });
    return shared;
  }

  return {
    async monitor(): Promise<AudioMonitor> {
      return openMonitor(await speaker());
    },
    async open(options: AudioStreamOptions): Promise<AudioStream> {
      const { ctx, bus } = await speaker();
      const channels = options.channels ?? 2;
      const sampleRate = ctx.sampleRate;
      const target =
        Math.ceil((TARGET_FRAMES[options.latency ?? "interactive"] * sampleRate) / 48000 / QUANTUM) * QUANTUM;

      const node = new AudioWorkletNode(ctx, PROCESSOR, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        processorOptions: { channels, report: REPORT_FRAMES },
      });
      node.connect(bus);
      openStreams++;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});

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
          try {
            options.render(block);
          } catch (error) {
            console.error("Audio stream render failed; closing the stream.", error);
            close();
            return;
          }
          const interleaved = new Float32Array(frames * channels);
          for (let c = 0; c < channels; c++) {
            const src = views[c]!;
            for (let i = 0, j = c; i < frames; i++, j += channels) interleaved[j] = src[i]!;
          }
          node.port.postMessage({ type: "chunk", data: interleaved }, [interleaved.buffer]);
          rendered += frames;
          want -= frames;
        }
      }

      const onState = () => {
        const state = closed ? "closed" : streamState(ctx);
        listeners.forEach((listener) => listener(state));
      };
      ctx.addEventListener("statechange", onState);

      function close(): void {
        if (closed) return;
        closed = true;
        node.port.postMessage({ type: "close" });
        node.port.onmessage = null;
        node.disconnect();
        ctx.removeEventListener("statechange", onState);
        openStreams--;
        if (openStreams === 0 && ctx.state === "running") void ctx.suspend();
        listeners.forEach((listener) => listener("closed"));
        listeners.clear();
      }

      node.port.onmessage = (event: MessageEvent<PlayedReport>) => {
        played = event.data.played;
        pump();
      };
      pump();

      return {
        sampleRate,
        channels,
        get latency() {
          return (target + outputLatencyFrames(ctx)) / sampleRate;
        },
        playbackPosition: () => Math.max(0, played - outputLatencyFrames(ctx)),
        state: () => (closed ? "closed" : streamState(ctx)),
        onStateChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
    },
  };
}
