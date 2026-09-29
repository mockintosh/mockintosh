import type { VideoExcerpt, VideoExcerptClip, VideoExcerptRequest, VideoPicture, VideoSound } from "@mockintosh/sdk";

/** Decoded sound is resampled to this; consumers resample again to their stream. */
const SOUND_RATE = 48000;

function aborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function once(target: EventTarget, ok: string, fail = "error"): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      target.removeEventListener(ok, onOk);
      target.removeEventListener(fail, onFail);
      if (error) reject(error);
      else resolve();
    };
    const onOk = () => done();
    const onFail = () => done(new Error("Could not decode video"));
    target.addEventListener(ok, onOk);
    target.addEventListener(fail, onFail);
  });
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1e-6 && !video.seeking) return;
  const seeked = once(video, "seeked");
  video.currentTime = time;
  await seeked;
}

/** RGBA → planar Y′CbCr, BT.601 full range, chroma averaged over 2×2 blocks. */
function toPicture(rgba: Uint8ClampedArray, width: number, height: number, chroma: boolean): VideoPicture {
  const y = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < y.length; i++, j += 4) y[i] = Math.round(0.299 * rgba[j]! + 0.587 * rgba[j + 1]! + 0.114 * rgba[j + 2]!);
  if (!chroma) return { y };
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const cb = new Uint8Array(cw * ch);
  const cr = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let b = 0;
      let r = 0;
      let n = 0;
      for (let dy = 0; dy < 2; dy++) {
        const py = cy * 2 + dy;
        if (py >= height) continue;
        for (let dx = 0; dx < 2; dx++) {
          const px = cx * 2 + dx;
          if (px >= width) continue;
          const i = py * width + px;
          const l = y[i]!;
          b += rgba[i * 4 + 2]! - l;
          r += rgba[i * 4]! - l;
          n++;
        }
      }
      cb[cy * cw + cx] = Math.max(0, Math.min(255, Math.round(128 + (0.564 * b) / n)));
      cr[cy * cw + cx] = Math.max(0, Math.min(255, Math.round(128 + (0.713 * r) / n)));
    }
  }
  return { y, cb, cr };
}

async function decodeSound(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
  try {
    return await new OfflineAudioContext(1, 1, SOUND_RATE).decodeAudioData(bytes);
  } catch {
    return null;
  }
}

function soundOver(buffer: AudioBuffer, from: number, to: number): VideoSound {
  const a = Math.max(0, Math.round(from * buffer.sampleRate));
  const b = Math.max(a, Math.min(buffer.length, Math.round(to * buffer.sampleRate)));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(a, b));
  return { sampleRate: buffer.sampleRate, channels };
}

/** Seek a hidden video picture by picture: slower than playback, but every picture lands where it's asked for. */
export async function excerptVideo(url: string, request: VideoExcerptRequest): Promise<VideoExcerpt> {
  const { ranges, fps, width, height, signal } = request;
  if (!(fps > 0) || !(width >= 1) || !(height >= 1)) throw new Error("excerpt needs a positive fps and size");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load video (${response.status})`);
  const bytes = await response.arrayBuffer();
  aborted(signal);
  const audio = request.sound ? await decodeSound(bytes.slice(0)) : null;

  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get("content-type") ?? "video/mp4" }));
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  const loaded = once(video, "loadeddata");
  video.src = objectUrl;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    if (!ctx) throw new Error("Could not decode video");
    await loaded;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cover = Math.max(width / vw, height / vh);
    const sw = width / cover;
    const sh = height / cover;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    const end = Number.isFinite(video.duration) ? video.duration : Infinity;
    const counts = ranges.map((r) => Math.max(0, Math.ceil((r.to - r.from) * fps - 1e-6)));
    const total = counts.reduce((a, b) => a + b, 0);
    let done = 0;
    const filling = ranges.map((range) => ({
      range: { from: range.from, to: range.to },
      pictures: [] as VideoPicture[],
      sound: audio ? soundOver(audio, range.from, range.to) : null,
    }));
    const excerpt: VideoExcerpt = { width, height, fps, clips: filling satisfies VideoExcerptClip[] };
    request.onPartial?.(excerpt);
    for (let k = 0; k < ranges.length; k++) {
      const { range, pictures } = filling[k]!;
      for (let i = 0; i < counts[k]!; i++) {
        aborted(signal);
        // A hair past the picture's time, so the seek never lands on the one before.
        await seekTo(video, Math.min(Math.max(0, end - 1e-3), range.from + i / fps + 1e-3));
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
        pictures.push(toPicture(ctx.getImageData(0, 0, width, height).data, width, height, request.chroma ?? false));
        request.onProgress?.(++done / Math.max(1, total));
      }
    }
    return excerpt;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
