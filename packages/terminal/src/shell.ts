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

export interface Job {
  readonly tty: Tty;
  /** Aborted when the job is interrupted (⌃C), hung up or killed. */
  readonly signal: AbortSignal;
  /** The signal that stopped the job, once one has. */
  readonly stoppedBy: Signal | null;
  write(data: Uint8Array | string): void;
  /** Hear signals other than the ones that abort the job (SIGWINCH). */
  onSignal(handler: (signal: Signal) => void): () => void;
}

export interface ShellRunner {
  /** Printed once when the shell starts. */
  banner?(): string;
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
export async function runForeground(tty: Tty, work: (job: Job) => Promise<number>): Promise<number> {
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
  };
  const previous = tty.setForeground((signal) => {
    for (const listener of listeners) listener(signal);
    if (ENDING.has(signal) && !stoppedBy) {
      stoppedBy = signal;
      controller.abort();
    }
  });
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
export async function runShell(tty: Tty, runner: ShellRunner, options: { exitCommand?: (line: string) => number | null } = {}): Promise<number> {
  const history = (await runner.loadHistory?.().catch(() => [])) ?? [];
  const editor = new LineEditor({
    write: (text) => tty.write(text),
    cols: () => tty.size.cols,
    history,
    complete: runner.complete ? (line, cursor) => runner.complete!(line, cursor) : undefined,
  });
  const banner = runner.banner?.();
  if (banner) tty.write(banner);
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
      status = await runForeground(tty, (job) => runner.run(line, job));
      // After ⌃C, what was typed meanwhile goes with the interrupted command, as in bash.
      if (status > 128 && status - 128 === SIGNAL_NUMBERS.SIGINT) {
        tty.write("\n");
        tty.flushInput();
      }
    }
  } finally {
    runner.exit?.();
  }
}

/** `exit` and `exit N`, as every shell understands them. */
export function exitBuiltin(line: string): number | null {
  const m = /^\s*(?:exit|logout)(?:\s+(\d+))?\s*$/.exec(line);
  return m ? Number(m[1] ?? 0) : null;
}
