/**
 * The inside of a program's worker: instantiate the module with the WASI
 * imports and run it to the end. Works on any message port, so the same
 * code runs in a browser Worker and in Node's worker_threads (for tests).
 */
import { createWasiImports, ProgramExit } from "./host";
import { SharedChannel } from "./channel";
import type { Syscall } from "./abi";
import { instantiateWasm, isWasmTrap, monotonicNow, randomFill, type WasmMemory, type WasmModule } from "./platform";

export interface ProgramStart {
  t: "start";
  module: WasmModule;
  args: string[];
  env: Record<string, string>;
  preopens: string[];
  buffer: SharedArrayBuffer;
}

export type ProgramMessage =
  | { t: "syscall"; request: Syscall }
  | { t: "exit"; code: number }
  | { t: "error"; message: string };

export function runProgram(start: ProgramStart, post: (message: ProgramMessage) => void): void {
  const channel = new SharedChannel(start.buffer, (request) => post({ t: "syscall", request }));
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let memory: WasmMemory | null = null;
  const imports = createWasiImports(() => memory!, {
    args: start.args,
    env: start.env,
    preopens: start.preopens,
    channel,
    now: monotonicNow,
    random: randomFill,
    sleep: (ms) => void Atomics.wait(nap, 0, 0, ms),
  });
  let code = 0;
  try {
    const instance = instantiateWasm(start.module, imports);
    memory = instance.exports.memory as WasmMemory;
    const entry = (instance.exports._start ?? instance.exports.main) as (() => void) | undefined;
    if (!entry) throw new Error("not a WASI program (it has no _start)");
    entry();
  } catch (error) {
    if (error instanceof ProgramExit) code = error.code;
    else {
      post({ t: "error", message: error instanceof Error ? error.message : String(error) });
      code = isWasmTrap(error) ? 134 : 1;
    }
  }
  post({ t: "exit", code });
}
