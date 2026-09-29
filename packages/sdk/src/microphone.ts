/**
 * Sound input, in the spirit of the Sound Input Manager: an app opens the
 * microphone and is handed blocks of PCM as they arrive.
 *
 * Like output (`./audio`), the contract is plain samples, so the same app
 * records from `getUserMedia` in the browser, an I2S microphone on a board,
 * or a scripted signal in tests.
 */
import type { AudioStreamState } from "./audio";

/**
 * One block the microphone heard. The arrays are lent for the duration of
 * `capture` and reused afterwards: copy out whatever you keep.
 */
export interface AudioCaptureBlock {
  readonly sampleRate: number;
  readonly frames: number;
  /** One array per channel (planar); samples are −1…1. */
  readonly channels: readonly Float32Array[];
  /**
   * The input's frame clock: the index of the block's first sample since the
   * microphone opened. It advances by `frames` every block, without gaps.
   */
  readonly position: number;
}

export interface MicrophoneOptions {
  /** 1 (the default) or 2. A mono microphone opened in stereo fills both channels alike. */
  channels?: 1 | 2;
  /**
   * Take `block`. Called as the input delivers samples — not on the display's
   * clock — so keep it allocation-free and quick. A throw closes the input.
   */
  capture(block: AudioCaptureBlock): void;
}

export interface MicrophoneInput {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  /** `suspended` until the host lets audio run (on the web, the user's first click or key press). */
  state(): AudioStreamState;
  /** Returns an unsubscribe function. */
  onStateChange(listener: (state: AudioStreamState) => void): () => void;
  /** Stop listening and release the microphone. The OS also closes inputs when their app quits. */
  close(): void;
}

export interface MicrophoneService {
  /**
   * Start listening. The host may ask the user first (a browser's permission
   * prompt); the promise rejects if they refuse or there is no input device.
   */
  open(options: MicrophoneOptions): Promise<MicrophoneInput>;
}
