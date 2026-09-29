/**
 * Stand-in footage for tests, where nothing can decode video: soft moving
 * gradients, a red patch drifting across (for colour keys), and a stereo
 * tone under every clip. Pictures repeat, so a long excerpt stays small.
 */
import type { VideoExcerpt, VideoPicture } from "@mockintosh/sdk";
import type { ReelFootage } from "./reels";

const VARIANTS = 6;
const SOUND_RATE = 8000;

function picture(width: number, height: number, k: number, chroma: boolean): VideoPicture {
  const y = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) y[j * width + i] = Math.round(127.5 + 127.5 * Math.sin((i + k * 9) / 23 + j / 31));
  }
  if (!chroma) return { y };
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const cb = new Uint8Array(cw * ch).fill(128);
  const cr = new Uint8Array(cw * ch).fill(128);
  const px = Math.round(cw * (0.3 + 0.08 * k));
  const py = Math.round(ch * 0.6);
  for (let j = py; j < Math.min(ch, py + Math.round(ch / 8)); j++) {
    for (let i = px; i < Math.min(cw, px + Math.round(cw / 12)); i++) {
      cb[j * cw + i] = 100;
      cr[j * cw + i] = 200;
    }
  }
  return { y, cb, cr };
}

export function syntheticFootage(request: ReelFootage): VideoExcerpt {
  const { width, height, fps } = request;
  const variants = Array.from({ length: VARIANTS }, (_, k) => picture(width, height, k, request.chroma ?? false));
  return {
    width,
    height,
    fps,
    clips: request.ranges.map((range) => {
      const count = Math.max(0, Math.ceil((range.to - range.from) * fps - 1e-6));
      const frames = Math.round((range.to - range.from) * SOUND_RATE);
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const t = range.from + i / SOUND_RATE;
        left[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t);
        right[i] = 0.3 * Math.sin(2 * Math.PI * 330 * t);
      }
      return {
        range: { ...range },
        pictures: Array.from({ length: count }, (_, i) => variants[i % VARIANTS]!),
        sound: request.sound ? { sampleRate: SOUND_RATE, channels: [left, right] } : null,
      };
    }),
  };
}
