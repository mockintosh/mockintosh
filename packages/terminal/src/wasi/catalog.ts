/**
 * The programs Terminal ships, built by `scripts/wasi/build.sh` and served
 * beside the OS (`/wasi/`): Lua, the kilo editor, SQLite's shell and
 * Python. Each loads on first use and stays compiled for the window's
 * lifetime. `wasm` runs any WASI program from the disk.
 */
import type { IFileSystem, MountableFs } from "just-bash/browser";
import type { TtyProgram } from "../bash/runner";
import { resolvePath } from "../bash/kernelFs";
import { runWasi, wasiProgram, type SpawnProgramWorker } from "./run";
import { BufferStdio, TtyStdio } from "./stdio";
import { ZipArchive, zipFileSystem } from "./zip";
import { compileWasm, fetchBytes, type WasmModule } from "./platform";

export interface CatalogOptions {
  /** Where the program files are served, ending in "/". */
  baseUrl: string;
  spawn?: SpawnProgramWorker;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

export function bundledPrograms(options: CatalogOptions): TtyProgram[] {
  const module = (file: string) => once(async () => compileWasm(await fetchBytes(options.baseUrl + file)));
  const python = once(async () => new ZipArchive(await fetchBytes(options.baseUrl + "python-3.14.zip")));
  const pythonModule = once(async () => compileWasm(await (await python()).read("python.wasm")));
  const pythonSpec = {
    load: pythonModule,
    env: { PYTHONHOME: "/usr/local", PYTHONDONTWRITEBYTECODE: "1" },
    async prepare(fs: IFileSystem) {
      await mountPython(fs, await python());
    },
    arguments: pythonArguments,
    spawn: options.spawn,
  };
  return [
    wasiProgram({ name: "lua", description: "Lua 5.4", load: module("lua.wasm"), spawn: options.spawn }),
    wasiProgram({ name: "kilo", description: "a small text editor", load: module("kilo.wasm"), spawn: options.spawn }),
    wasiProgram({ name: "sqlite3", description: "SQLite's shell", load: module("sqlite3.wasm"), spawn: options.spawn }),
    wasiProgram({ name: "python3", description: "Python 3.14", ...pythonSpec }),
    wasiProgram({ name: "python", description: "Python 3.14", argv0: "python3", ...pythonSpec }),
    wasmCommand(options.spawn),
  ];
}

/** Python's standard library at /usr/local/lib, from its zip, plus a sitecustomize that enters $PWD. */
export async function mountPython(fs: IFileSystem, archive: ZipArchive): Promise<void> {
  const mountable = fs as MountableFs;
  if (typeof mountable.mount !== "function" || mountable.isMountPoint("/usr/local/lib")) return;
  const lib = zipFileSystem(archive, "lib");
  // WASI programs start in "/"; a prebuilt Python can't be taught otherwise, but site can.
  lib.writeFileSync("/python3.14/site-packages/sitecustomize.py", "import os\nif os.environ.get('PWD', '').startswith('/'):\n    try:\n        os.chdir(os.environ['PWD'])\n    except OSError:\n        pass\n");
  mountable.mount("/usr/local/lib", lib);
}

/** Python resolves a script's path against its own cwd ("/") before site runs: make it absolute first. */
export function pythonArguments(argv: string[], cwd: string): string[] {
  const out = [...argv];
  for (let i = 1; i < out.length; i++) {
    const arg = out[i]!;
    if (arg === "-c" || arg === "-m" || arg === "-" || arg === "--") break;
    if (/^-[WX]$/.test(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    out[i] = resolvePath(cwd, arg);
    break;
  }
  return out;
}

/** `wasm program.wasm [args…]`: run a WASI program from the disk. */
function wasmCommand(spawn?: SpawnProgramWorker): TtyProgram {
  const compile = async (fs: IFileSystem, cwd: string, path: string | undefined) => {
    if (!path) throw new Error("usage: wasm program.wasm [arguments…]");
    return compileWasm(await fs.readFileBuffer(resolvePath(cwd, path)));
  };
  return {
    name: "wasm",
    description: "run a WebAssembly (WASI) program",
    async attached({ argv, cwd, env, job, fs }) {
      let module: WasmModule;
      try {
        module = await compile(fs, cwd, argv[1]);
      } catch (error) {
        job.write(`wasm: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
      const stdio = new TtyStdio(job.tty, job.signal);
      try {
        return await runWasi({ module, argv: argv.slice(1), env: { ...env, PWD: cwd }, cwd, fs, stdio, signal: job.signal, spawn });
      } finally {
        stdio.restore();
      }
    },
    async batch({ argv, cwd, env, stdin, signal, fs }) {
      const module = await compile(fs, cwd, argv[1]).catch((error: unknown) => error as Error);
      if (module instanceof Error) return { stdout: "", stderr: `wasm: ${module.message}\n`, exitCode: 1 };
      const stdio = new BufferStdio(stdin);
      const exitCode = await runWasi({ module, argv: argv.slice(1), env: { ...env, PWD: cwd }, cwd, fs, stdio, signal, spawn });
      return { stdout: stdio.stdout, stderr: stdio.stderr, exitCode };
    },
  };
}
