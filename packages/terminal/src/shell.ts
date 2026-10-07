/**
 * An interactive shell on a tty: the read–run loop every shell has. It puts
 * the tty in raw mode and edits the line itself (`LineEditor`), then gives
 * the command the tty back in cooked mode as the foreground job, so ⌃C
 * interrupts the command rather than the shell, and a program that reads
 * the terminal gets what's typed.
 *
 * What a line *means* is the runner's business: Mockintosh's S1 commands,
 * bash, or anything else.
 */
import { LineEditor, type Completion } from "./lineEditor";
import { COOKED, RAW, SIGNAL_NUMBERS, type Signal, type Tty } from "./pty";
import type { ProcessRegistry, RegisteredProcess } from "./processes";

export interface Job {
  readonly tty: Tty;
  /** Aborted when the job is interrupted (⌃C), hung up or killed. */
  readonly signal: AbortSignal;
  /** The signal that stopped the job, once one has. */
  readonly stoppedBy: Signal | null;
  write(data: Uint8Array | string): void;
  /** Hear signals other than the ones that abort the job (SIGWINCH). */
  onSignal(handler: (signal: Signal) => void): () => void;
  /** Deliver a signal as if the terminal sent it (`kill` from elsewhere). */
  raise(signal: Signal): void;
  /** The job's pid in the process table, once registered. */
  pid?: number;
}

export interface ShellRunner {
  /** Printed once when the shell starts. */
  banner?(): string;
  /** Run once before the first prompt (a startup file). */
  startup?(job: Pick<Job, "write">): Promise<void>;
  prompt(): string;
  /** Run one line as the foreground job; resolve with its exit status. */
  run(line: string, job: Job): Promise<number>;
  complete?(line: string, cursor: number): Promise<Completion | null>;
  /** Lines remembered from earlier sessions, and a place to keep them. */
  loadHistory?(): Promise<string[]>;
  saveHistory?(lines: readonly string[]): Promise<void>;
  /** The shell is ending. */
  exit?(): void;
}

/** Signals that end a job unless it handles them. */
const ENDING: ReadonlySet<Signal> = new Set<Signal>(["SIGINT", "SIGQUIT", "SIGHUP", "SIGTERM", "SIGKILL"]);

/** Run `job` as the foreground job and wait for it. */
export async function runForeground(tty: Tty, work: (job: Job) => Promise<number>, setup?: (job: Job) => void): Promise<number> {
  const controller = new AbortController();
  const listeners = new Set<(signal: Signal) => void>();
  let stoppedBy: Signal | null = null;
  const job: Job = {
    tty,
    signal: controller.signal,
    get stoppedBy() {
      return stoppedBy;
    },
    write: (data) => tty.write(data),
    onSignal(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    raise: () => {},
  };
  const deliver = (signal: Signal) => {
    for (const listener of listeners) listener(signal);
    if (ENDING.has(signal) && !stoppedBy) {
      stoppedBy = signal;
      controller.abort();
    }
  };
  job.raise = deliver;
  const previous = tty.setForeground(deliver);
  setup?.(job);
  try {
    const code = await work(job);
    return stoppedBy ? 128 + SIGNAL_NUMBERS[stoppedBy] : code;
  } catch (error) {
    if (stoppedBy) return 128 + SIGNAL_NUMBERS[stoppedBy];
    tty.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    tty.setForeground(previous);
  }
}

/** The shell's loop. Resolves with the shell's exit status when input ends (⌃D, `exit`, hang-up). */
export interface RunShellOptions {
  exitCommand?: (line: string) => number | null;
  /** Register the shell and its jobs here, so `ps` lists them and `kill` reaches them. */
  processes?: ProcessRegistry;
  /** The shell's name in the process table. */
  name?: string;
  /** The shell itself was killed: end the session (close the terminal). */
  onKilled?(signal: string): void;
}

/** Signal names the tty knows, from the kernel's. */
function ttySignal(name: string): Signal | null {
  return name in SIGNAL_NUMBERS ? (name as Signal) : null;
}

export async function runShell(tty: Tty, runner: ShellRunner, options: RunShellOptions = {}): Promise<number> {
  const shell = await options.processes?.start(options.name ?? "sh", [], {
    tty: "new",
    onSignal: (signal) => {
      // A shell ignores SIGINT at the prompt; anything that ends a process ends it.
      if (signal === "SIGINT" || signal === "SIGWINCH" || signal === "SIGTSTP" || signal === "SIGCONT") return;
      options.onKilled?.(signal);
    },
  });
  const tty0 = shell?.tty;
  let current: Job | null = null;
  const history = (await runner.loadHistory?.().catch(() => [])) ?? [];
  const editor = new LineEditor({
    write: (text) => tty.write(text),
    cols: () => tty.size.cols,
    history,
    complete: runner.complete ? (line, cursor) => runner.complete!(line, cursor) : undefined,
  });
  const banner = runner.banner?.();
  if (banner) tty.write(banner);
  await runner.startup?.({ write: (data) => tty.write(data) });
  let status = 0;
  try {
    for (;;) {
      if (tty.closed) return status;
      tty.setAttr(RAW);
      const pumpDone = new AbortController();
      const resizeOff = tty.setForeground((signal) => {
        if (signal === "SIGWINCH") editor.redraw();
        if (signal === "SIGHUP") pumpDone.abort();
      });
      const reading = editor.read(runner.prompt());
      // Feed the editor until it has a line. Bytes after the line stay queued in the editor.
      void (async () => {
        while (!pumpDone.signal.aborted) {
          const data = await tty.read(pumpDone.signal);
          if (data === null) {
            if (!pumpDone.signal.aborted) editor.feed("\x04");
            return;
          }
          editor.feed(data);
        }
      })();
      const result = await Promise.race([
        reading,
        new Promise<null>((resolve) => pumpDone.signal.addEventListener("abort", () => resolve(null), { once: true })),
      ]);
      pumpDone.abort();
      tty.setForeground(resizeOff);
      tty.setAttr(COOKED);
      if (!result) return status;
      if (result.kind === "eof") {
        tty.write("exit\n");
        return status;
      }
      if (result.kind === "interrupt") {
        status = 130;
        continue;
      }
      void runner.saveHistory?.(editor.historyEntries).catch(() => {});
      const line = result.line;
      if (!line.trim()) continue;
      const exit = options.exitCommand?.(line);
      if (exit !== null && exit !== undefined) return exit;
      const words = line.trim().split(/\s+/);
      const registered: { process: RegisteredProcess | null } = { process: null };
      status = await runForeground(
        tty,
        async (job) => {
          registered.process = (await options.processes?.start(words[0]!, words.slice(1), {
            tty: tty0,
            parent: shell?.pid,
            onSignal: (signal) => {
              const s = ttySignal(signal);
              if (s) current?.raise(s);
            },
          })) ?? null;
          if (registered.process) job.pid = registered.process.pid;
          return runner.run(line, job);
        },
        (job) => (current = job),
      );
      current = null;
      registered.process?.exit(status);
      // After ⌃C, what was typed meanwhile goes with the interrupted command, as in bash.
      if (status > 128 && status - 128 === SIGNAL_NUMBERS.SIGINT) {
        tty.write("\n");
        tty.flushInput();
      }
    }
  } finally {
    shell?.exit(status);
    runner.exit?.();
  }
}

/** `exit` and `exit N`, as every shell understands them. */
export function exitBuiltin(line: string): number | null {
  const m = /^\s*(?:exit|logout)(?:\s+(\d+))?\s*$/.exec(line);
  return m ? Number(m[1] ?? 0) : null;
}
