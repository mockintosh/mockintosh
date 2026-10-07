/**
 * Process accounting: one table for what runs on this Macintosh, so `ps`
 * shows everything and `kill` can stop anything.
 *
 * - **Jobs** are registered by whoever runs them (a Terminal's shell, its
 *   commands, a WebAssembly program): `process_start` gives a pid,
 *   `process_exit` reports the status, and the owner holds a
 *   `process_signals` call open to hear `kill`. A job ends with its
 *   owner's kernel session (a closed window, a disconnected client).
 * - **Apps** are the running app instances, with pids handed out as they
 *   are first seen. Killing one quits it.
 *
 * Signals are names (SIGTERM, SIGINT, SIGKILL, SIGHUP, …). The kernel
 * doesn't interpret them for jobs; the owner does. Pids are never reused
 * within a boot.
 */
import { Kernel, ServiceError, defineOperation, type Execution, type KernelSession } from "./index";
import * as s from "./schema";

export const SIGNALS = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGKILL", "SIGTERM", "SIGTSTP", "SIGCONT", "SIGWINCH", "SIGUSR1", "SIGUSR2"] as const;
export type SignalName = (typeof SIGNALS)[number];

const SIGNAL_NUMBERS: Record<SignalName, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGUSR1: 10, SIGUSR2: 12, SIGTERM: 15, SIGCONT: 18, SIGTSTP: 20, SIGWINCH: 28,
};

/** Exited jobs kept for `wait` and `ps -a`. */
const RETAINED_EXITED = 64;

interface Job {
  pid: number;
  ppid: number;
  name: string;
  args: string[];
  tty?: string;
  owner: string;
  started: number;
  status: number | null;
  pending: SignalName[];
  /** The owner's open `process_signals` call. */
  listener: ((signal: SignalName | null) => void) | null;
  exitWaiters: Set<(status: number) => void>;
}

export interface AppInstanceView {
  id: string;
  app: string;
  windows: string[];
}

export interface ProcessHost {
  /** The running app instances. */
  apps(): AppInstanceView[];
  /** Quit an app instance. */
  stopApp(instanceId: string): void;
}

const processRow = s.object({
  pid: s.integer, ppid: s.integer, name: s.string, args: s.array(s.string), tty: s.string,
  kind: { type: "string", enum: ["job", "app"] }, state: { type: "string", enum: ["running", "exited"] },
  started: s.integer, status: s.integer, instance: s.string,
}, ["pid", "ppid", "name", "args", "kind", "state"]);

/** "9", "KILL", "SIGKILL", "-9" → "SIGKILL". */
export function parseSignal(value: string): SignalName {
  const v = value.replace(/^-/, "").toUpperCase();
  if (/^\d+$/.test(v)) {
    const found = (Object.keys(SIGNAL_NUMBERS) as SignalName[]).find((name) => SIGNAL_NUMBERS[name] === Number(v));
    if (found) return found;
  } else {
    const name = (v.startsWith("SIG") ? v : `SIG${v}`) as SignalName;
    if (name in SIGNAL_NUMBERS) return name;
  }
  throw new ServiceError("invalid-argument", `Unknown signal: ${value}`);
}

export class ProcessTable {
  private jobs = new Map<number, Job>();
  private appPids = new Map<string, number>();
  private exited: number[] = [];
  private nextPid = 1;
  private owners = new Map<string, () => void>();

  constructor(private kernel: Kernel, private host?: ProcessHost) {}

  private own(caller: KernelSession): void {
    if (this.owners.has(caller.id)) return;
    this.owners.set(caller.id, this.kernel.onSessionEnd(caller, () => {
      // The owner is gone: its jobs are hung up.
      for (const job of this.jobs.values()) if (job.owner === caller.id && job.status === null) this.finish(job, 128 + SIGNAL_NUMBERS.SIGHUP);
      this.owners.delete(caller.id);
    }));
  }

  start(caller: KernelSession, name: string, args: string[] = [], options: { tty?: string; parent?: number } = {}): { pid: number; tty?: string } {
    this.own(caller);
    const pid = this.nextPid++;
    // "new": the job opens a terminal of its own (a shell in a new window), named after it.
    const tty = options.tty === "new" ? `ttys${String(pid).padStart(3, "0")}` : options.tty;
    this.jobs.set(pid, {
      pid, ppid: options.parent ?? 0, name, args, tty, owner: caller.id,
      started: Date.now(), status: null, pending: [], listener: null, exitWaiters: new Set(),
    });
    return tty ? { pid, tty } : { pid };
  }

  private job(pid: number): Job {
    const job = this.jobs.get(pid);
    if (!job) throw new ServiceError("missing-resource", `No process ${pid}`);
    return job;
  }

  private owned(caller: KernelSession, pid: number): Job {
    const job = this.job(pid);
    if (job.owner !== caller.id) throw new ServiceError("permission", `Process ${pid} belongs to another caller`);
    return job;
  }

  exit(caller: KernelSession, pid: number, status: number): void {
    const job = this.owned(caller, pid);
    if (job.status === null) this.finish(job, status);
  }

  private finish(job: Job, status: number): void {
    job.status = status;
    job.listener?.(null);
    job.listener = null;
    for (const waiter of job.exitWaiters) waiter(status);
    job.exitWaiters.clear();
    this.exited.push(job.pid);
    while (this.exited.length > RETAINED_EXITED) this.jobs.delete(this.exited.shift()!);
  }

  /** The next signal for `pid`, or null once it has exited. */
  async signals(caller: KernelSession, pid: number, execution: Execution): Promise<SignalName | null> {
    const job = this.owned(caller, pid);
    if (job.status !== null) return null;
    if (job.pending.length) return job.pending.shift()!;
    if (job.listener) throw new ServiceError("conflict", `Process ${pid} already has a signal listener`);
    return new Promise((resolve, reject) => {
      const done = (signal: SignalName | null) => {
        release();
        job.listener = null;
        resolve(signal);
      };
      const release = execution.cancellation.subscribe(() => {
        if (job.listener === done) job.listener = null;
        reject(new ServiceError("cancellation", "Stopped listening"));
      });
      job.listener = done;
    });
  }

  kill(pid: number, signal: SignalName): void {
    const job = this.jobs.get(pid);
    if (job) {
      if (job.status !== null) throw new ServiceError("missing-resource", `Process ${pid} has exited`);
      if (job.listener) job.listener(signal);
      else job.pending.push(signal);
      return;
    }
    const instance = [...this.appPids].find(([, p]) => p === pid)?.[0];
    if (!instance || !this.host?.apps().some((a) => a.id === instance)) throw new ServiceError("missing-resource", `No process ${pid}`);
    // An app has one answer to every signal that ends things: quit.
    if (signal === "SIGWINCH" || signal === "SIGCONT" || signal === "SIGUSR1" || signal === "SIGUSR2" || signal === "SIGTSTP") return;
    this.host.stopApp(instance);
  }

  async wait(pid: number, execution: Execution): Promise<number> {
    const job = this.jobs.get(pid);
    if (!job) {
      const instance = [...this.appPids].find(([, p]) => p === pid)?.[0];
      if (!instance) throw new ServiceError("missing-resource", `No process ${pid}`);
      // An app has no exit status; wait until it's gone.
      while (this.host?.apps().some((a) => a.id === instance)) await execution.cancellation.delay(100);
      return 0;
    }
    if (job.status !== null) return job.status;
    return new Promise((resolve, reject) => {
      const waiter = (status: number) => {
        release();
        resolve(status);
      };
      const release = execution.cancellation.subscribe(() => {
        job.exitWaiters.delete(waiter);
        reject(new ServiceError("cancellation", "Stopped waiting"));
      });
      job.exitWaiters.add(waiter);
    });
  }

  list(all = false): s.Value<typeof processRow>[] {
    const rows: s.Value<typeof processRow>[] = [];
    for (const app of this.host?.apps() ?? []) {
      let pid = this.appPids.get(app.id);
      if (pid === undefined) {
        pid = this.nextPid++;
        this.appPids.set(app.id, pid);
      }
      rows.push({ pid, ppid: 0, name: app.app, args: [], kind: "app", state: "running", instance: app.id });
    }
    for (const job of this.jobs.values()) {
      if (job.status !== null && !all) continue;
      rows.push({
        pid: job.pid, ppid: job.ppid, name: job.name, args: job.args, kind: "job",
        state: job.status === null ? "running" : "exited", started: job.started,
        ...(job.tty ? { tty: job.tty } : {}), ...(job.status !== null ? { status: job.status } : {}),
      });
    }
    return rows.sort((a, b) => a.pid - b.pid);
  }
}

export function registerProcesses(kernel: Kernel, host?: ProcessHost): ProcessTable {
  const table = new ProcessTable(kernel, host);
  const add = (operation: ReturnType<typeof defineOperation>) => kernel.register(operation);
  const signal = { type: "string", enum: [...SIGNALS] } as const;
  add(defineOperation("process_start", "Register a job you run (a command, a program) and get its pid; tty \"new\" names a new terminal after it", {
    name: s.string, args: s.array(s.string), tty: s.string, parent: s.integer,
  }, ["name"], s.object({ pid: s.integer, tty: s.string }, ["pid"]), async (a, e) =>
    table.start(e.caller, a.name, [...(a.args ?? [])], { tty: a.tty, parent: a.parent })));
  add(defineOperation("process_exit", "Report that your job ended, with its exit status", {
    pid: s.integer, status: s.integer,
  }, ["pid", "status"], { type: "null" }, async (a, e) => {
    table.exit(e.caller, a.pid, a.status);
    return null;
  }));
  add(defineOperation("process_signals", "Wait for the next signal sent to your job; null once it has exited", {
    pid: s.integer,
  }, ["pid"], s.object({ signal: s.nullable(signal) }), async (a, e) => ({ signal: await table.signals(e.caller, a.pid, e) })));
  add(defineOperation("ps", "List processes: running jobs and apps (all=true includes recently exited jobs)", {
    all: s.boolean,
  }, [], s.array(processRow), async (a) => table.list(a.all === true)));
  add(defineOperation("kill", "Send a signal to a process (default SIGTERM); an app quits", {
    pid: s.integer, signal,
  }, ["pid"], { type: "null" }, async (a) => {
    table.kill(a.pid, (a.signal ?? "SIGTERM") as SignalName);
    return null;
  }));
  add(defineOperation("wait", "Wait for a process to end and return its exit status", {
    pid: s.integer,
  }, ["pid"], s.object({ status: s.integer }), async (a, e) => ({ status: await table.wait(a.pid, e) })));
  return table;
}
