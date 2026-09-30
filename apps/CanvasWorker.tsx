/**
 * Canvas Webworker — the Canvas app running in a Web Worker instead of on the
 * main thread, to compare the two. A prototype for running apps in workers
 * (docs/browsix-research.md §2); Canvas itself stays as it is.
 */
import { alternateFileTypes, MIME } from "@mockintosh/sdk";
import { sprites } from "./canvas/icons";
import { defineWorkerApp } from "./workerapp/host";

export default defineWorkerApp({
  id: "canvas-worker",
  title: "Canvas Webworker",
  icon: "canvas/icon",
  about: {
    version: "0.1",
    description: "Canvas running in a Web Worker. The Worker menu shows frame and input timings.",
  },
  defaultSize: { width: 480, height: 276 },
  minSize: { width: 280, height: 140 },
  resizable: true,
  scrollable: false,
  fileTypes: alternateFileTypes([MIME.canvas]),
  sprites,
  position: { x: 32, y: 48 },
  titleSuffix: " (Worker)",
  createWorker: () => new Worker(new URL("./workerapp/canvas.worker.ts", import.meta.url), { type: "module" }),
});
