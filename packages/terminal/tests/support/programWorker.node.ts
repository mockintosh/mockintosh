/** The program worker in Node's worker_threads, for tests. */
import { parentPort } from "node:worker_threads";
import { runProgram, type ProgramStart } from "../../src/wasi/program";

parentPort!.on("message", (start: ProgramStart) => {
  if (start?.t === "start") runProgram(start, (message) => parentPort!.postMessage(message));
});
