import type { ImageFrame } from "@mockintosh/ui";

export type { ImageFrame } from "@mockintosh/ui";

export interface ImageService {
  /** Decode PNG/JPEG/GIF bytes; `type` is the MIME hint. Rejects when undecodable. */
  decode(bytes: Uint8Array, type?: string, options?: { maxWidth?: number; maxHeight?: number }): Promise<ImageFrame>;
}

export interface VideoSource {
  play(): Promise<void>;
  pause(): void;
  /** Latest decoded frame, or null before the first one. Cheap to call every frame. */
  frame(): ImageFrame | null;
  /** Playhead position in seconds. */
  readonly currentTime: number;
  /** Length in seconds, or 0 until the duration is known. */
  readonly duration: number;
  /** Move the playhead. `frame()` catches up once the decoder has the new picture. */
  seek(time: number): void;
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** A stretch of a video's timeline in seconds, from `from` up to (not including) `to`. */
export interface VideoRange {
  from: number;
  to: number;
}

export interface VideoExcerptRequest {
  ranges: readonly VideoRange[];
  /** Pictures kept per second of each range. */
  fps: number;
  /** Picture size; the video is scaled to cover it and centre-cropped. */
  width: number;
  height: number;
  /** Also keep the colour-difference planes (`cb`, `cr`). */
  chroma?: boolean;
  /** Also decode the soundtrack under each range. */
  sound?: boolean;
  /** Called as pictures arrive, 0…1. */
  onProgress?(fraction: number): void;
  /**
   * Called once, as soon as the excerpt exists: the same object the promise
   * resolves with, its sound complete and each clip's `pictures` filling in
   * place, in order. Lets playback start before decoding ends.
   */
  onPartial?(excerpt: VideoExcerpt): void;
  signal?: AbortSignal;
}

/**
 * One picture as planar Y′CbCr (BT.601, full range, 0…255), rows top to
 * bottom. Chroma planes are half size each way — `ceil(width / 2) ×
 * ceil(height / 2)` — with 128 as neutral grey.
 */
export interface VideoPicture {
  y: Uint8Array;
  cb?: Uint8Array;
  cr?: Uint8Array;
}

/** Planar PCM, −1…1. */
export interface VideoSound {
  sampleRate: number;
  channels: readonly Float32Array[];
}

export interface VideoExcerptClip {
  range: VideoRange;
  /** Picture `i` shows the video at `range.from + i / fps`. */
  pictures: readonly VideoPicture[];
  /** The sound over the range, when asked for and the video has any. */
  sound: VideoSound | null;
}

/** Parts of a video decoded into memory, for frame-exact use rather than playback. */
export interface VideoExcerpt {
  width: number;
  height: number;
  fps: number;
  clips: readonly VideoExcerptClip[];
}

export interface VideoService {
  open(url: string, options?: { loop?: boolean; muted?: boolean }): Promise<VideoSource>;
  /**
   * Decode the requested ranges of a video into pictures (and sound) held in
   * memory. Takes a while — about a hundredth of a second per picture on the
   * web — so show progress. Absent where the platform can't decode offline.
   */
  excerpt?(url: string, request: VideoExcerptRequest): Promise<VideoExcerpt>;
}

export interface CameraSource extends Omit<VideoSource, "play" | "pause" | "currentTime" | "duration" | "seek"> {}

export interface CameraService {
  /** Prompts the user on the web; call from a click. */
  open(options?: { facing?: "user" | "environment"; width?: number; height?: number }): Promise<CameraSource>;
}

export interface AppScheduler {
  /** Run `callback` before the next display refresh; returns a cancel function. */
  requestFrame(callback: (timeMs: number) => void): () => void;
  /** Monotonic milliseconds. */
  now(): number;
}
