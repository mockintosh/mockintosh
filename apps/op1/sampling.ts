/**
 * Taking samples: which slot has which recording, recording a new take from
 * the chosen source, and keeping takes as WAVE files in the app's storage so
 * they are there next launch (and visible in the Finder).
 *
 * A take from the OP-1's own output is written by the engine as it renders;
 * a take from the speaker is pieced together from the monitor on every
 * display frame.
 */
import { createSignal, type AppStorage, type AudioMonitor, type AudioService } from "@mockintosh/sdk";
import type { Op1Engine } from "./engine";
import {
  MonitorTap,
  SampleRecorder,
  defaultSample,
  sampleFromWav,
  sampleToWav,
  type RecorderState,
  type Sample,
  type SampleSource,
} from "./sampler";
import { sampleKey } from "./session";
import { SLOT_COUNT } from "./sounds";

export interface SamplingOptions {
  storage: AppStorage;
  audio: AudioService | undefined;
  engine: Op1Engine;
  onError(message: string): void;
}

export interface Sampling {
  /** Each slot's own recording; `null` plays the factory sample. */
  samples(): readonly (Sample | null)[];
  /** What `slot` plays. */
  sampleFor(slot: number): Sample;
  state(): RecorderState;
  /** The slot a take is going into, while one is. */
  target(): number | null;
  /** The take in progress, for the display. */
  readonly recorder: SampleRecorder;
  source(): SampleSource;
  setSource(source: SampleSource): void;
  /** Whether this Macintosh lets apps listen to its speaker. */
  readonly canHearSpeaker: boolean;
  /** Arm a take for `slot`; it starts with the first sound. */
  start(slot: number): Promise<void>;
  /** End the take and keep it, if anything was recorded. */
  stop(): void;
  cancel(): void;
  erase(slot: number): void;
  /** Read the slots' samples from storage. */
  load(): Promise<void>;
  /** Once per display frame: gather the speaker, and finish a take that has filled up. */
  frame(nowMs: number): void;
}

export function useSampling(options: SamplingOptions): Sampling {
  const { storage, engine } = options;
  const recorder = new SampleRecorder();
  const [samples, setSamples] = createSignal<readonly (Sample | null)[]>(Array.from({ length: SLOT_COUNT }, () => null));
  const [state, setState] = createSignal<RecorderState>("idle");
  const [target, setTarget] = createSignal<number | null>(null);
  const [source, setSource] = createSignal<SampleSource>("op1");
  const canHearSpeaker = typeof options.audio?.monitor === "function";

  let monitor: AudioMonitor | null = null;
  let tap: MonitorTap | null = null;

  const release = () => {
    engine.sampling = null;
    monitor?.close();
    monitor = null;
    tap = null;
    setTarget(null);
    setState("idle");
  };

  const keep = (slot: number, sample: Sample | null) => {
    setSamples((list) => list.map((s, i) => (i === slot ? sample : s)));
  };

  const start = async (slot: number) => {
    if (recorder.state !== "idle") return;
    const listen = options.audio?.monitor;
    if (source() === "speaker" && listen) {
      try {
        monitor = await listen.call(options.audio);
      } catch (err) {
        options.onError(`Couldn't listen to the speaker: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      tap = new MonitorTap(monitor);
      recorder.arm(monitor.sampleRate);
    } else {
      recorder.arm(engine.sampleRate);
      engine.sampling = recorder;
    }
    setTarget(slot);
    setState(recorder.state);
  };

  const stop = () => {
    const slot = target();
    if (slot === null) return;
    const take = recorder.finish();
    release();
    if (!take) return;
    keep(slot, take);
    storage.writeBytes(sampleKey(slot), sampleToWav(take)).catch((err: unknown) => {
      options.onError(`Couldn't save the sample: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const cancel = () => {
    recorder.cancel();
    release();
  };

  const erase = (slot: number) => {
    keep(slot, null);
    void storage.remove(sampleKey(slot));
  };

  const load = async () => {
    const loaded = await Promise.all(
      Array.from({ length: SLOT_COUNT }, async (_, slot) => {
        const bytes = await storage.readBytes(sampleKey(slot));
        return bytes ? sampleFromWav(bytes) : null;
      }),
    );
    setSamples(loaded);
  };

  const frame = (nowMs: number) => {
    if (tap && recorder.listening) {
      const fresh = tap.pull(nowMs);
      const size = tap.left.length;
      recorder.write(tap.left, tap.right, size - fresh, size);
    }
    if (recorder.state === "full") stop();
    else if (recorder.state !== state()) setState(recorder.state);
  };

  return {
    samples,
    sampleFor: (slot) => samples()[slot] ?? defaultSample(),
    state,
    target,
    recorder,
    source,
    setSource,
    canHearSpeaker,
    start,
    stop,
    cancel,
    erase,
    load,
    frame,
  };
}
