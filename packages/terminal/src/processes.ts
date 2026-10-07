/**
 * Jobs in the kernel's process table: a shell registers itself and each
 * command it runs, so `ps` lists them (in any Terminal, over MCP) and
 * `kill` reaches them.
 */
import type { Signal } from "./pty";

/** The part of a kernel client process accounting needs. */
export interface ProcessKernel {
  invoke(name: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface RegisteredProcess {
  readonly pid: number;
  /** The terminal it runs on, as the kernel named it. */
  readonly tty?: string;
  /** Report the exit status; stops listening for signals. */
  exit(status: number): void;
}

export interface ProcessRegistry {
  /** Register a job; `onSignal` hears `kill`. Resolves null when the kernel has no process table. */
  start(name: string, args: string[], options: { tty?: string; parent?: number; onSignal(signal: Signal | string): void }): Promise<RegisteredProcess | null>;
}

export function kernelProcesses(kernel: ProcessKernel): ProcessRegistry {
  return {
    async start(name, args, options) {
      let pid: number, tty: string | undefined;
      try {
        ({ pid, tty } = (await kernel.invoke("process_start", {
          name, args, ...(options.tty ? { tty: options.tty } : {}), ...(options.parent ? { parent: options.parent } : {}),
        })) as { pid: number; tty?: string });
      } catch {
        return null;
      }
      const listening = new AbortController();
      void (async () => {
        while (!listening.signal.aborted) {
          let signal: string | null;
          try {
            signal = ((await kernel.invoke("process_signals", { pid }, { signal: listening.signal })) as { signal: string | null }).signal;
          } catch {
            return;
          }
          if (signal === null) return;
          options.onSignal(signal);
        }
      })();
      let exited = false;
      return {
        pid,
        tty,
        exit(status) {
          if (exited) return;
          exited = true;
          listening.abort();
          void kernel.invoke("process_exit", { pid, status }).catch(() => {});
        },
      };
    },
  };
}
