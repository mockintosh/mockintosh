import type {
  AudioCaptureBlock,
  AudioStreamState,
  MicrophoneInput,
  MicrophoneOptions,
  MicrophoneService,
} from "@mockintosh/sdk";

const PROCESSOR = "mockintosh-pcm-capture";
/** Frames per block posted to the page: a few render quanta, ~10 ms at 48 kHz. */
const CHUNK = 512;

/**
 * The audio-thread half: gather the input's render quanta into chunks and
 * post them to the page, interleaved. Mono inputs are averaged down or
 * copied up to the channel count asked for. Plain JS, loaded from a Blob URL.
 */
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions.channels;
    this.chunk = options.processorOptions.chunk;
    this.buffer = new Float32Array(this.chunk * this.channels);
    this.filled = 0;
    this.open = true;
    this.port.onmessage = (event) => { if (event.data === "close") this.open = false; };
  }
  process(inputs) {
    if (!this.open) return false;
    const input = inputs[0] || [];
    const frames = input.length > 0 ? input[0].length : 128;
    const channels = this.channels;
    for (let i = 0; i < frames; i++) {
      const at = this.filled * channels;
      if (channels === 1) {
        let sum = 0;
        for (let c = 0; c < input.length; c++) sum += input[c][i];
        this.buffer[at] = input.length > 0 ? sum / input.length : 0;
      } else {
        const left = input.length > 0 ? input[0][i] : 0;
        this.buffer[at] = left;
        this.buffer[at + 1] = input.length > 1 ? input[1][i] : left;
      }
      if (++this.filled === this.chunk) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.chunk * channels);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(PROCESSOR)}, PcmCapture);
`;

function inputState(context: AudioContext): AudioStreamState {
  return context.state === "running" ? "running" : context.state === "closed" ? "closed" : "suspended";
}

/**
 * The microphone on the web: `getUserMedia` into an `AudioWorkletNode` that
 * posts PCM to the page. One `AudioContext` serves every open input and is
 * suspended when none is. Absent without `getUserMedia` or AudioWorklet
 * (insecure origins, old engines).
 */
export function createWebMicrophoneService(): MicrophoneService | undefined {
  if (!navigator.mediaDevices?.getUserMedia) return undefined;
  if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") return undefined;

  let shared: Promise<AudioContext> | null = null;
  let openInputs = 0;

  function context(): Promise<AudioContext> {
    shared ??= (async () => {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      // Like the speaker, input runs only after a user gesture.
      const resume = () => {
        if (openInputs > 0 && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume();
      };
      for (const type of ["pointerdown", "keydown", "touchend"] as const) {
        window.addEventListener(type, resume, { capture: true });
      }
      return ctx;
    })().catch((error: unknown) => {
      shared = null;
      throw error;
    });
    return shared;
  }

  return {
    async open(options: MicrophoneOptions): Promise<MicrophoneInput> {
      const channels = options.channels ?? 1;
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: channels },
          // A recorder wants what the room sounds like, not a call's cleanup.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      let ctx: AudioContext;
      try {
        ctx = await context();
      } catch (error) {
        media.getTracks().forEach((track) => track.stop());
        throw error;
      }

      const source = ctx.createMediaStreamSource(media);
      const node = new AudioWorkletNode(ctx, PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { channels, chunk: CHUNK },
      });
      source.connect(node);
      // The node writes silence; reaching the destination is what keeps the graph pulling it.
      node.connect(ctx.destination);
      openInputs++;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});

      const listeners = new Set<(state: AudioStreamState) => void>();
      const planar = Array.from({ length: channels }, () => new Float32Array(CHUNK));
      let position = 0;
      let closed = false;

      const onState = () => {
        const state = closed ? "closed" : inputState(ctx);
        listeners.forEach((listener) => listener(state));
      };
      ctx.addEventListener("statechange", onState);

      function close(): void {
        if (closed) return;
        closed = true;
        node.port.postMessage("close");
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        media.getTracks().forEach((track) => track.stop());
        ctx.removeEventListener("statechange", onState);
        openInputs--;
        if (openInputs === 0 && ctx.state === "running") void ctx.suspend();
        listeners.forEach((listener) => listener("closed"));
        listeners.clear();
      }

      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const interleaved = event.data;
        const frames = interleaved.length / channels;
        const views = planar.map((buffer, c) => {
          const view = buffer.subarray(0, frames);
          for (let i = 0, j = c; i < frames; i++, j += channels) view[i] = interleaved[j]!;
          return view;
        });
        const block: AudioCaptureBlock = { sampleRate: ctx.sampleRate, frames, channels: views, position };
        position += frames;
        try {
          options.capture(block);
        } catch (error) {
          console.error("Microphone capture failed; closing the input.", error);
          close();
        }
      };
      for (const track of media.getAudioTracks()) track.addEventListener("ended", close);

      return {
        sampleRate: ctx.sampleRate,
        channels,
        state: () => (closed ? "closed" : inputState(ctx)),
        onStateChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
    },
  };
}
