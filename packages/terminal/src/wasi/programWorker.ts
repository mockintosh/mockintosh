/** A WebAssembly program's own worker in the browser. */
import { runProgram, type ProgramStart } from "./program";

const scope = globalThis as unknown as { onmessage: ((event: { data: ProgramStart }) => void) | null; postMessage(message: unknown): void };
scope.onmessage = (event) => {
  if (event.data?.t === "start") runProgram(event.data, (message) => scope.postMessage(message));
};
