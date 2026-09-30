/**
 * OP-1 Webworker — the OP-1 running in a Web Worker instead of on the main
 * thread, to compare the two. Its engine renders sound in the worker and feeds
 * the speaker through a port (`AudioService.openPort`), so no sample passes
 * through the main thread. A prototype (docs/browsix-research.md §2).
 */
import { sprites } from "./op1/icons";
import { defineWorkerApp } from "./workerapp/host";

export default defineWorkerApp({
  id: "op1-worker",
  title: "OP-1 Webworker",
  icon: "op1/icon",
  requires: ["audio"],
  about: {
    version: "0.1",
    description: "The OP-1 running in a Web Worker, sound included. The Worker menu shows frame, input and audio timings.",
  },
  // OP1.tsx: W × (2·PAD + SCREEN_H + BUTTON_H + KEYS_H + 2·GAP).
  defaultSize: { width: 496, height: 178 },
  resizable: false,
  scrollable: false,
  sprites,
  titleSuffix: " (Worker)",
  createWorker: () => new Worker(new URL("./workerapp/op1.worker.ts", import.meta.url), { type: "module" }),
});
