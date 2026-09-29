/**
 * What the player needs to know about a reel: how long it runs, its frame
 * rate, its chapters, and how to paint a frame. Each reel owns its whole
 * look; the player only ever asks for "the frame at t".
 */
import type { Sprite, VideoExcerpt, VideoExcerptRequest } from "@mockintosh/sdk";
import type { Frame } from "./painter";

export interface ReelChapter {
  number: number;
  title: string;
  start: number;
  end: number;
}

/**
 * What the machine lends a reel: its registered sprites (app icons, system
 * icons) and, for a reel that cuts from footage, the decoded excerpt — absent
 * until it has loaded, or where the machine can't decode video.
 */
export interface ReelAssets {
  sprite(name: string): Sprite | undefined;
  footage?: VideoExcerpt;
}

/** Footage a reel cuts from: decoded once, the first time the reel is shown. */
export interface ReelFootage extends Omit<VideoExcerptRequest, "onProgress" | "signal"> {
  url: string;
}

/** A machine with nothing registered; reels must still paint every frame. */
export const NO_ASSETS: ReelAssets = { sprite: () => undefined };

/** Paints frames of one reel; may keep scratch buffers or a frame cache. */
export interface ReelPlayer {
  render(frame: Frame, t: number): void;
}

/**
 * A reel's sound, as a pure function of reel time like its pictures. Mixes
 * the sound at reel times `t0 + i / sampleRate` (i < frames) into
 * `out[channel][offset + i]`, adding to what is there.
 */
export interface ReelSoundtrack {
  render(out: readonly Float32Array[], offset: number, frames: number, t0: number, sampleRate: number): void;
}

export interface ReelDefinition {
  id: string;
  title: string;
  /** Seconds. */
  duration: number;
  /** Frames per second for timecode and frame stepping. */
  fps: number;
  chapters: readonly ReelChapter[];
  footage?: ReelFootage;
  createPlayer(assets: ReelAssets): ReelPlayer;
  createSoundtrack(assets: ReelAssets): ReelSoundtrack;
}

export function chapterAt(reel: ReelDefinition, t: number): ReelChapter {
  return reel.chapters.find((c) => t < c.end) ?? reel.chapters[reel.chapters.length - 1]!;
}

/** `SS:FF` at the reel's frame rate. */
export function timecode(t: number, fps: number): string {
  const frames = Math.floor(t * fps + 1e-6);
  const s = Math.floor(frames / fps);
  const f = frames % fps;
  return `${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
