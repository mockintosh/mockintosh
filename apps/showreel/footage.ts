/**
 * Cutting from footage. An edit list maps reel time onto a decoded excerpt;
 * pictures are dithered onto the frame by error diffusion — Atkinson's, as
 * the Video Player shows film — at the frame's own resolution, so graphics
 * drawn over them stay crisp; and the excerpt's sound runs under the edit.
 */
import type { VideoExcerpt, VideoPicture, VideoRange } from "@mockintosh/sdk";
import { STAGE_H, STAGE_W, type Frame, type PixelRect, type Stage } from "./painter";
import type { ReelSoundtrack } from "./reels";

/** From reel time `at`, the source `range` plays through once. Cut `i` is excerpt clip `i`. */
export interface Cut {
  at: number;
  range: VideoRange;
}

export function cutEnd(cut: Cut): number {
  return cut.at + cut.range.to - cut.range.from;
}

/** Where the edit is at a reel time: which cut, and how far into it. */
export interface EditPoint {
  cut: number;
  /** Seconds since the cut began. */
  offset: number;
  /** Seconds on the source's own clock. */
  source: number;
}

export function editAt(cuts: readonly Cut[], t: number): EditPoint | null {
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i]!;
    if (t >= cut.at && t < cutEnd(cut)) return { cut: i, offset: t - cut.at, source: cut.range.from + t - cut.at };
  }
  return null;
}

/**
 * The picture showing at an edit point, or `step` pictures either side of
 * it (null past the clip's ends). With no step it holds the clip's last
 * picture to the end of the cut.
 */
export function pictureAt(excerpt: VideoExcerpt, point: EditPoint, step = 0): VideoPicture | null {
  const pictures = excerpt.clips[point.cut]?.pictures;
  if (!pictures?.length) return null;
  const i = Math.floor(point.offset * excerpt.fps + 1e-6) + step;
  if (step === 0) return pictures[Math.max(0, Math.min(pictures.length - 1, i))]!;
  return i >= 0 && i < pictures.length ? pictures[i]! : null;
}

// —— Pictures ————————————————————————————————————————————————————

/** How a picture's luma becomes darkness: levels, then gamma, then exposure. */
export interface Grade {
  /** Luma (0…1) that becomes black. */
  black: number;
  /** Luma (0…1) that becomes white. */
  white: number;
  gamma: number;
  /** Scales the graded light: 1 as graded, 0 black. Fades go here. */
  exposure?: number;
  /** Added light after exposure, −1…1: a flash, or a burn to white. */
  lift?: number;
}

/**
 * Dithers pictures onto frames. The error buffer is kept between frames, so
 * a playing reel doesn't allocate; the output is still a pure function of
 * the picture, grade, stage and clip.
 */
export class PictureDither {
  private light = new Float32Array(0);
  private readonly lut = new Float32Array(256);

  /**
   * Cover `clip` with `picture` (which fills the 320×180 stage), sampled
   * bilinearly at each device pixel and dithered by Atkinson diffusion.
   */
  draw(frame: Frame, stage: Stage, clip: PixelRect, excerpt: VideoExcerpt, picture: VideoPicture, grade: Grade): void {
    const w = clip.x1 - clip.x0;
    const h = clip.y1 - clip.y0;
    if (w <= 0 || h <= 0) return;
    if (this.light.length < w * (h + 2)) this.light = new Float32Array(w * (h + 2));
    const light = this.light;
    const lut = this.lut;
    const exposure = grade.exposure ?? 1;
    const lift = grade.lift ?? 0;
    const span = Math.max(1e-3, grade.white - grade.black);
    for (let i = 0; i < 256; i++) {
      const v = Math.max(0, Math.min(1, (i / 255 - grade.black) / span));
      lut[i] = v ** grade.gamma * exposure + lift;
    }

    const pw = excerpt.width;
    const ph = excerpt.height;
    const ku = pw / (STAGE_W * stage.scale);
    const kv = ph / (STAGE_H * stage.scale);
    const luma = picture.y;
    for (let row = 0; row < h; row++) {
      const v = Math.max(0, Math.min(ph - 1.001, (clip.y0 + row + 0.5 - stage.y) * kv - 0.5));
      const v0 = Math.floor(v);
      const fv = v - v0;
      const r0 = v0 * pw;
      const r1 = r0 + pw;
      const out = row * w;
      for (let col = 0; col < w; col++) {
        const u = Math.max(0, Math.min(pw - 1.001, (clip.x0 + col + 0.5 - stage.x) * ku - 0.5));
        const u0 = Math.floor(u);
        const fu = u - u0;
        const a = lut[luma[r0 + u0]!]! + (lut[luma[r0 + u0 + 1]!]! - lut[luma[r0 + u0]!]!) * fu;
        const b = lut[luma[r1 + u0]!]! + (lut[luma[r1 + u0 + 1]!]! - lut[luma[r1 + u0]!]!) * fu;
        light[out + col] = a + (b - a) * fv;
      }
    }
    light.fill(0, w * h, w * (h + 2));

    const px = frame.pixels;
    for (let row = 0; row < h; row++) {
      const out = row * w;
      const dst = (clip.y0 + row) * frame.width + clip.x0;
      for (let col = 0; col < w; col++) {
        const i = out + col;
        const old = light[i]!;
        const white = old >= 0.5;
        px[dst + col] = white ? 0 : 1;
        // Atkinson passes on six eighths of the error and drops the rest: clean whites, open blacks.
        const e = (old - (white ? 1 : 0)) / 8;
        if (col + 1 < w) light[i + 1]! += e;
        if (col + 2 < w) light[i + 2]! += e;
        if (col > 0) light[i + w - 1]! += e;
        light[i + w]! += e;
        if (col + 1 < w) light[i + w + 1]! += e;
        light[i + 2 * w]! += e;
      }
    }
  }
}

// —— Keys ——————————————————————————————————————————————————————————

/** Where a colour key found something, in stage units. */
export interface KeyBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Stage area covered, in square stage units. */
  area: number;
}

/**
 * The bounds of the pixels whose chroma passes `test`, or null when too few
 * do. Stray specks are ignored by trimming the outermost 2% on each side.
 */
export function keyBox(excerpt: VideoExcerpt, picture: VideoPicture, test: (cb: number, cr: number) => boolean, minArea = 2): KeyBox | null {
  const { cb, cr } = picture;
  if (!cb || !cr) return null;
  const cw = Math.ceil(excerpt.width / 2);
  const ch = Math.ceil(excerpt.height / 2);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (test(cb[i]!, cr[i]!)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  const su = STAGE_W / cw;
  const sv = STAGE_H / ch;
  const area = xs.length * su * sv;
  if (area < minArea) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const trim = Math.floor(xs.length * 0.02);
  return {
    x0: xs[trim]! * su,
    x1: (xs[xs.length - 1 - trim]! + 1) * su,
    y0: ys[trim]! * sv,
    y1: (ys[ys.length - 1 - trim]! + 1) * sv,
    area,
  };
}

// —— Sound ——————————————————————————————————————————————————————————

export interface FootageSoundOptions {
  gain: number;
  /** Seconds of fade at each cut, so an edit doesn't click. */
  fade?: number;
  /** Extra gain over reel time: dips, swells, a fade-out. */
  level?: (t: number) => number;
}

/** The excerpt's own sound, laid under the edit and resampled to the stream. */
export class FootageSound implements ReelSoundtrack {
  private readonly fade: number;

  constructor(
    private readonly cuts: readonly Cut[],
    private readonly excerpt: VideoExcerpt,
    private readonly options: FootageSoundOptions,
  ) {
    this.fade = options.fade ?? 0.03;
  }

  render(out: readonly Float32Array[], offset: number, frames: number, t0: number, sampleRate: number): void {
    const { cuts, excerpt, options, fade } = this;
    for (let c = 0; c < cuts.length; c++) {
      const cut = cuts[c]!;
      const sound = excerpt.clips[c]?.sound;
      if (!sound || sound.channels.length === 0) continue;
      const end = cutEnd(cut);
      const first = Math.max(0, Math.ceil((cut.at - t0) * sampleRate));
      const last = Math.min(frames, Math.ceil((end - t0) * sampleRate));
      const src = sound.channels;
      const length = src[0]!.length;
      for (let i = first; i < last; i++) {
        const t = t0 + i / sampleRate;
        const into = t - cut.at;
        const edge = Math.min(1, into / fade, (end - t) / fade);
        const g = options.gain * edge * (options.level ? options.level(t) : 1);
        if (g <= 0) continue;
        const pos = into * sound.sampleRate;
        const k = Math.floor(pos);
        if (k < 0 || k + 1 >= length) continue;
        const f = pos - k;
        for (let ch = 0; ch < out.length; ch++) {
          const s = src[Math.min(ch, src.length - 1)]!;
          out[ch]![offset + i]! += (s[k]! + (s[k + 1]! - s[k]!) * f) * g;
        }
      }
    }
  }
}
