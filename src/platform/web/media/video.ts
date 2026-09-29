import type { ImageFrame, VideoService, VideoSource } from "@mockintosh/sdk";
import { excerptVideo } from "./videoExcerpt";

function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): ImageFrame | null {
  if (video.readyState < 2 || video.videoWidth <= 0) return null;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  ctx.drawImage(video, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, rgba: data.data };
}

function finiteSeconds(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Resolves once a frame can be read. Rejects if the file will not decode. */
function waitForFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error("Could not open video"));
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
  });
}

export function createWebVideoService(): VideoService {
  return {
    excerpt: excerptVideo,
    async open(url, options) {
      const video = document.createElement("video");
      video.src = url;
      video.muted = options?.muted ?? false;
      video.volume = 1;
      video.loop = options?.loop ?? false;
      video.playsInline = true;
      video.preload = "auto";
      // Off-screen, but in the document: a detached element is silent in some browsers.
      video.tabIndex = -1;
      video.setAttribute("aria-hidden", "true");
      video.style.position = "fixed";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.left = "0";
      video.style.top = "0";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      document.body.appendChild(video);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        video.remove();
        throw new Error("Could not open video");
      }
      try {
        await waitForFrame(video);
      } catch (error) {
        video.remove();
        throw error;
      }
      const source: VideoSource = {
        play: () => video.play(),
        pause: () => video.pause(),
        frame: () => grabFrame(video, canvas, ctx),
        get currentTime() {
          return finiteSeconds(video.currentTime);
        },
        get duration() {
          return finiteSeconds(video.duration);
        },
        seek(time: number) {
          const end = finiteSeconds(video.duration);
          const next = Math.min(Math.max(0, time), end > 0 ? end : 0);
          if (video.currentTime !== next) video.currentTime = next;
        },
        get width() {
          return video.videoWidth;
        },
        get height() {
          return video.videoHeight;
        },
        close() {
          video.pause();
          video.removeAttribute("src");
          video.load();
          video.remove();
        },
      };
      return source;
    },
  };
}
