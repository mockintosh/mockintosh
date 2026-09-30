/**
 * Live video and the camera as a worker-hosted app sees them. The `<video>`
 * element or camera stays on the host; `frame()` here answers with the latest
 * picture the host sent and asks for the next, which the host sends as its
 * own frame starts. A source nobody reads frames from sends none.
 */
import type { CameraService, CameraSource, ImageFrame, VideoService, VideoSource } from "@mockintosh/sdk";

type Call = (method: string, args: unknown[]) => Promise<unknown>;
type Notify = (method: string, ...args: unknown[]) => void;

export interface MediaFrameMessage {
  id: number;
  frame: ImageFrame;
  currentTime: number;
  duration: number;
}

interface Opened {
  id: number;
  width: number;
  height: number;
  duration: number;
  /** The picture the source had when it opened. */
  first: ImageFrame | null;
}

export interface WorkerMedia {
  video: Pick<VideoService, "open">;
  camera: CameraService;
  frame(message: MediaFrameMessage): void;
}

export function createWorkerMedia(call: Call, notify: Notify): WorkerMedia {
  const sources = new Map<number, { latest: ImageFrame | null; currentTime: number; duration: number; wanted: boolean }>();

  function source(opened: Opened): VideoSource {
    const state = { latest: opened.first, currentTime: 0, duration: opened.duration, wanted: false };
    sources.set(opened.id, state);
    return {
      width: opened.width,
      height: opened.height,
      get currentTime() {
        return state.currentTime;
      },
      get duration() {
        return state.duration;
      },
      frame() {
        if (!state.wanted) {
          state.wanted = true;
          notify("media.want", opened.id);
        }
        return state.latest;
      },
      play: () => call("media.play", [opened.id]) as Promise<void>,
      pause: () => notify("media.pause", opened.id),
      seek: (time) => {
        state.currentTime = time;
        notify("media.seek", opened.id, time);
      },
      close: () => {
        if (!sources.delete(opened.id)) return;
        notify("media.close", opened.id);
      },
    };
  }

  return {
    video: {
      open: async (url, options) => source((await call("video.open", [url, options])) as Opened),
    },
    camera: {
      open: async (options) => source((await call("camera.open", [options])) as Opened) as CameraSource,
    },
    frame(message) {
      const state = sources.get(message.id);
      if (!state) return;
      state.latest = message.frame;
      state.currentTime = message.currentTime;
      state.duration = message.duration;
      state.wanted = false;
    },
  };
}
