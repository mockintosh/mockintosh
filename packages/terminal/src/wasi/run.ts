/**
 * Running a WebAssembly (WASI) program: its own worker, whose system calls
 * this side answers from the file system and the terminal. As a TtyProgram
 * it runs attached to the terminal on its own line, or on bytes inside a
 * pipeline (`echo 'print(1)' | lua`).
 */
import type { IFileSystem } from "just-bash/browser";
import type { ProgramContext, TtyProgram } from "../bash/runner";
import { ProgramOwner, preopensFor, type ProgramStdio } from "./owner";
import { answer, createChannelBuffer } from "./channel";
import { BufferStdio, TtyStdio } from "./stdio";
import type { ProgramMessage, ProgramStart } from "./program";
import type { WasmModule } from "./platform";

// Module-local: the bundler needs this exact `new Worker(new URL(…))` shape to build the worker.
declare const Worker: new (url: unknown, options: { type: "module"; name: string }) => unknown;
declare const URL: new (url: string, base: string) => unknown;

/** A worker for one program run. */
export interface ProgramWorker {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: ProgramMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

export type SpawnProgramWorker = () => ProgramWorker;

/** A worker running `programWorker.ts`; the bundler builds it beside this module. */
export const spawnBrowserWorker: SpawnProgramWorker = () =>
  new Worker(new URL("./programWorker.ts", import.meta.url), { type: "module", name: "wasi-program" }) as unknown as ProgramWorker;

export interface RunOptions {
  module: WasmModule;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  fs: IFileSystem;
  stdio: ProgramStdio;
  signal?: AbortSignal;
  spawn?: SpawnProgramWorker;
}

/** Run to the end; resolves with the exit status (130 when stopped by a signal). */
export async function runWasi(options: RunOptions): Promise<number> {
  const owner = new ProgramOwner(options.fs, options.stdio, options.cwd, await preopensFor(options.fs));
  const buffer = createChannelBuffer();
  const worker = (options.spawn ?? spawnBrowserWorker)();
  return new Promise<number>((resolve) => {
    let done = false;
    const finish = async (code: number) => {
      if (done) return;
      done = true;
      worker.terminate();
      options.signal?.removeEventListener("abort", onAbort);
      await owner.closeAll();
      resolve(code);
    };
    const onAbort = () => void finish(130);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      void finish(130);
      return;
    }
    // One request at a time: the program waits for each answer.
    let queue = Promise.resolve();
    worker.onmessage = ({ data }) => {
      if (done) return;
      if (data.t === "syscall") {
        queue = queue.then(async () => {
          const response = await owner.handle(data.request);
          if (!done) answer(buffer, response);
        });
      } else if (data.t === "error") {
        options.stdio.write(2, new TextEncoder().encode(`${options.argv[0]}: ${data.message}\n`));
      } else if (data.t === "exit") {
        void queue.then(() => finish(data.code));
      }
    };
    worker.onerror = (event) => {
      options.stdio.write(2, new TextEncoder().encode(`${options.argv[0]}: ${event.message ?? "the program's worker failed"}\n`));
      void finish(1);
    };
    const start: ProgramStart = {
      t: "start",
      module: options.module,
      args: options.argv,
      env: options.env,
      preopens: owner.preopens,
      buffer,
    };
    worker.postMessage(start);
  });
}

export interface WasiProgramSpec {
  name: string;
  description?: string;
  /** The compiled module; cached by the caller as it likes. */
  load(): Promise<WasmModule>;
  /** Variables the program needs (PYTHONHOME). */
  env?: Record<string, string>;
  /** Put what the program needs into its file system first (a standard library mount). */
  prepare?(fs: IFileSystem): Promise<void>;
  /** argv[0] as the program sees it, when not its name. */
  argv0?: string;
  /** Adjust the arguments for the working directory (make a script's path absolute). */
  arguments?(argv: string[], cwd: string): string[];
  spawn?: SpawnProgramWorker;
}

/** A WebAssembly program as a command Terminal can run. */
export function wasiProgram(spec: WasiProgramSpec): TtyProgram {
  const argvFor = (argv: string[], cwd: string) => {
    const named = [spec.argv0 ?? argv[0]!, ...argv.slice(1)];
    return spec.arguments ? spec.arguments(named, cwd) : named;
  };
  return {
    name: spec.name,
    description: spec.description,
    async attached({ argv, cwd, env, job, fs }: ProgramContext) {
      const [module] = await Promise.all([spec.load(), spec.prepare?.(fs)]);
      const stdio = new TtyStdio(job.tty, job.signal);
      try {
        return await runWasi({ module, argv: argvFor(argv, cwd), env: { ...env, PWD: cwd, ...spec.env }, cwd, fs, stdio, signal: job.signal, spawn: spec.spawn });
      } finally {
        stdio.restore();
      }
    },
    async batch({ argv, cwd, env, stdin, signal, fs }) {
      const [module] = await Promise.all([spec.load(), spec.prepare?.(fs)]);
      const stdio = new BufferStdio(stdin);
      const exitCode = await runWasi({ module, argv: argvFor(argv, cwd), env: { ...env, PWD: cwd, ...spec.env }, cwd, fs, stdio, signal, spawn: spec.spawn });
      return { stdout: stdio.stdout, stderr: stdio.stderr, exitCode };
    },
  };
}
