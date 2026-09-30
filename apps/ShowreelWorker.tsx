/**
 * Showreel Webworker — the Showreel running in a Web Worker instead of on the
 * main thread, to compare the two. The reels draw and score in the worker;
 * video footage is still decoded on the main thread (it needs a `<video>`
 * element) and copied over picture by picture. A prototype
 * (docs/browsix-research.md §2).
 */
import { sprites } from "./showreel/icons";
import { defineWorkerApp } from "./workerapp/host";

export default defineWorkerApp({
  id: "showreel-worker",
  title: "Showreel Webworker",
  icon: "showreel/icon",
  about: {
    version: "0.1",
    description: "The Showreel running in a Web Worker, sound included. The Worker menu shows frame, input and audio timings.",
  },
  defaultSize: { width: 400, height: 248 },
  minSize: { width: 224, height: 150 },
  scrollable: false,
  resizable: true,
  sprites,
  titleSuffix: " (Worker)",
  // What the reels look up that isn't the Showreel's own: showreel/hello/cast.ts and hammer/overlays.ts.
  spriteNames: [
    "icon/happy", "icon/hd", "icon/trash", "icon/stop",
    "macpaint/icon", "synth/icon", "showreel/icon", "icon/photobooth-smr-32", "dither/icon", "surface/icon",
    "trace/icon", "canvas/icon", "icon/safari", "icon/chat", "icon/appstore-smr-32x32", "icon/spotify",
    "icon/MacFlim", "icon-gallery/icon", "icon/computer",
  ],
  createWorker: () => new Worker(new URL("./workerapp/showreel.worker.ts", import.meta.url), { type: "module" }),
});
