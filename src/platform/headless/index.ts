/**
 * The headless platform: no screen, no hardware, no host APIs at all.
 *
 * The OS boots against an in-memory display whose frames can be read back,
 * synthetic pointer/keyboard injection, and a clock the caller advances by
 * hand. This is how the shell is tested end to end (see `boot.test.ts`), and
 * the natural starting point for any new host — replace `present()` and the
 * input injectors with real drivers.
 */
import { InMemoryBackend } from "@mockintosh/fs";
import type { AgentRuntime } from "@mockintosh/sdk";
import type { BitMap } from "@mockintosh/quickdraw";
import { pixelsFromBitMap } from "@mockintosh/quickdraw/bits";
import type {
  HostCapability,
  Platform,
  PlatformDropEvent,
  PlatformKeyEvent,
  PlatformPointerEvent,
  PlatformScheduler,
  SignInRelay,
} from "../types";
import { createHeadlessAudio, type HeadlessAudio } from "./audio";
import { createHeadlessMicrophone, type HeadlessMicrophone } from "./microphone";

export interface HeadlessPlatformOptions {
  width: number;
  height: number;
  /** Give the machine a speaker at this sample rate; `tick` then renders audio too. */
  audioSampleRate?: number;
  /** Give the machine a microphone at this sample rate; `tick` then delivers what it hears. */
  microphoneSampleRate?: number;
  /** A sign-in relay to hand apps; tests supply a scripted one. */
  signInRelay?: SignInRelay;
  /** An agent runtime to hand apps; tests supply a scripted one. */
  agentRuntime?: AgentRuntime;
}

export interface HeadlessPlatform extends Platform {
  audio?: HeadlessAudio;
  microphone?: HeadlessMicrophone;
  /** Number of frames presented so far. */
  readonly frameCount: number;
  /** Framebuffer as presented most recently, one byte per pixel (1 = black); `null` before the first frame. */
  lastFrame(): Uint8Array | null;
  /** Inject a pointer event as if the mouse/touch driver produced it. */
  pointer(event: PlatformPointerEvent): void;
  /** Inject a key event as if the keyboard driver produced it. */
  key(event: PlatformKeyEvent): void;
  /** Inject a host file drop as if the user dragged onto the screen. */
  drop(event: PlatformDropEvent): void;
  /** Press and release at (x, y). */
  click(x: number, y: number): void;
  /** Advance the clock by `ms`, render that much audio, and run every pending frame callback once. */
  tick(ms?: number): void;
}

export function createHeadlessPlatform(options: HeadlessPlatformOptions): HeadlessPlatform {
  const { width, height, audioSampleRate, microphoneSampleRate } = options;
  const audio = audioSampleRate ? createHeadlessAudio(audioSampleRate) : undefined;
  let audioFrames = 0;
  const microphone = microphoneSampleRate ? createHeadlessMicrophone(microphoneSampleRate) : undefined;
  let microphoneFrames = 0;

  let presented: BitMap | null = null;
  let frameCount = 0;

  const pointerHandlers = new Set<(e: PlatformPointerEvent) => void>();
  const keyHandlers = new Set<(e: PlatformKeyEvent) => void>();
  const dropHandlers = new Set<(e: PlatformDropEvent) => void>();

  let clock = 0;
  let frameCallbacks: Array<(timeMs: number) => void> = [];

  const scheduler: PlatformScheduler = {
    requestFrame(cb) {
      frameCallbacks.push(cb);
      return () => {
        frameCallbacks = frameCallbacks.filter((pending) => pending !== cb);
      };
    },
    now: () => clock,
  };

  return {
    display: {
      width,
      height,
      present(screen) {
        presented = screen;
        frameCount++;
      },
    },
    input: {
      onPointer(handler) {
        pointerHandlers.add(handler);
        return () => pointerHandlers.delete(handler);
      },
      onKey(handler) {
        keyHandlers.add(handler);
        return () => keyHandlers.delete(handler);
      },
      onDrop(handler) {
        dropHandlers.add(handler);
        return () => dropHandlers.delete(handler);
      },
    },
    scheduler,
    storage: new InMemoryBackend(),
    ...(audio ? { audio } : {}),
    ...(microphone ? { microphone } : {}),
    ...(options.signInRelay ? { signInRelay: options.signInRelay } : {}),
    ...(options.agentRuntime ? { agentRuntime: options.agentRuntime } : {}),
    env: { origin: "", config: {} },
    hostCapabilities: [] as HostCapability[],
    crypto: {
      randomBytes(n) { return new Uint8Array(n); },
      async sha256(bytes) { return bytes.slice(); },
    },

    get frameCount() {
      return frameCount;
    },
    lastFrame() {
      return presented ? pixelsFromBitMap(presented) : null;
    },
    pointer(event) {
      pointerHandlers.forEach((h) => h(event));
    },
    key(event) {
      keyHandlers.forEach((h) => h(event));
    },
    drop(event) {
      dropHandlers.forEach((h) => h(event));
    },
    click(x, y) {
      this.pointer({ type: "down", x, y, button: 0 });
      this.pointer({ type: "up", x, y, button: 0 });
    },
    tick(ms = 16) {
      clock += ms;
      if (audio && audioSampleRate) {
        const due = Math.floor((clock * audioSampleRate) / 1000) - audioFrames;
        audioFrames += due;
        audio.advance(due);
      }
      if (microphone && microphoneSampleRate) {
        const due = Math.floor((clock * microphoneSampleRate) / 1000) - microphoneFrames;
        microphoneFrames += due;
        microphone.advance(due);
      }
      const due = frameCallbacks;
      frameCallbacks = [];
      for (const cb of due) cb(clock);
    },
  };
}
