/**
 * Video as a worker-hosted app sees it. Decoding needs a `<video>` element, so
 * `excerpt` runs on the host; the worker keeps its own copy of the excerpt,
 * which the host fills in place picture by picture as it decodes, so the app
 * gets the same `onPartial` / `onProgress` behaviour as on the main thread.
 * `open` (live playback) isn't proxied.
 */
import type { VideoExcerpt, VideoExcerptClip, VideoPicture, VideoService } from "@mockintosh/sdk";
import type { VideoEvent } from "./protocol";

type Call = (method: string, args: unknown[]) => Promise<unknown>;

interface Pending {
  excerpt: VideoExcerpt | null;
  onPartial?(excerpt: VideoExcerpt): void;
  onProgress?(fraction: number): void;
}

export interface WorkerVideo {
  service: VideoService;
  event(event: VideoEvent): void;
}

export function createWorkerVideo(call: Call, notify: (method: string, ...args: unknown[]) => void): WorkerVideo {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const service: VideoService = {
    open: () => Promise.reject(new Error("Live video isn't available to worker apps yet")),
    async excerpt(url, request) {
      const id = nextId++;
      const { onPartial, onProgress, signal, ...plain } = request;
      pending.set(id, { excerpt: null, onPartial, onProgress });
      signal?.addEventListener("abort", () => notify("video.abort", id), { once: true });
      try {
        await call("video.excerpt", [id, url, plain]);
        const excerpt = pending.get(id)?.excerpt;
        if (!excerpt) throw new Error("The host finished decoding without an excerpt");
        return excerpt;
      } finally {
        pending.delete(id);
      }
    },
  };

  return {
    service,
    event(event) {
      const p = pending.get(event.id);
      if (!p) return;
      if (event.kind === "partial") {
        p.excerpt = event.excerpt;
        p.onPartial?.(event.excerpt);
        return;
      }
      const clips = p.excerpt?.clips as VideoExcerptClip[] | undefined;
      for (const { clip, picture } of event.pictures) (clips?.[clip]?.pictures as VideoPicture[] | undefined)?.push(picture);
      p.onProgress?.(event.fraction);
    },
  };
}
