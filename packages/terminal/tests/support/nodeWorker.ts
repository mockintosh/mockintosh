import { Worker } from "node:worker_threads";
import type { ProgramWorker } from "../../src/wasi/run";

/** A program worker on Node's worker_threads, shaped like a browser Worker. */
export function spawnNodeWorker(): ProgramWorker {
  const worker = new Worker(new URL("./programWorker.node.ts", import.meta.url), { execArgv: ["--import", "tsx"] });
  const adapter: ProgramWorker = {
    postMessage: (message) => worker.postMessage(message),
    onmessage: null,
    onerror: null,
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => adapter.onmessage?.({ data }));
  worker.on("error", (error) => adapter.onerror?.({ message: error.message }));
  return adapter;
}
