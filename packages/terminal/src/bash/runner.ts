/**
 * Bash as the interactive shell on a tty. Lines run through a `BashSession`;
 * a line that is just one *tty program* (an interactive WebAssembly
 * program, fx) runs attached to the terminal instead, as the foreground job,
 * so it can read keys, switch to raw mode and draw full-screen.
 */
import { defineCommand, type Command, type IFileSystem } from "just-bash/browser";
import { BashSession, type BashSessionOptions } from "./session";
import type { Completion } from "../lineEditor";
import type { Job, ShellRunner } from "../shell";
import { SIGNAL_NUMBERS } from "../pty";

/** What a program sees when it runs attached to a terminal. */
export interface ProgramContext {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  job: Job;
  /** The shell's file system: the disk, /tmp, and whatever is mounted. */
  fs: IFileSystem;
}

/**
 * A program that can run attached to a tty (interactive) or, inside a
 * pipeline, on bytes (`stdin` in, output captured).
 */
export interface TtyProgram {
  name: string;
  /** One line for `help`. */
  description?: string;
  attached(context: ProgramContext): Promise<number>;
  batch?(context: { argv: string[]; cwd: string; env: Record<string, string>; stdin: string; signal?: AbortSignal; fs: IFileSystem }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

const ARGV_COMMAND = "__mac_argv";

export interface BashRunnerOptions extends BashSessionOptions {
  programs?: TtyProgram[];
  banner?: string;
  loadHistory?(): Promise<string[]>;
  saveHistory?(lines: readonly string[]): Promise<void>;
}

export class BashRunner implements ShellRunner {
  readonly session: BashSession;
  private programs = new Map<string, TtyProgram>();
  private captured: string[] | null = null;

  constructor(private options: BashRunnerOptions) {
    for (const program of options.programs ?? []) this.programs.set(program.name, program);
    const capture = defineCommand(ARGV_COMMAND, async (args) => {
      this.captured = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const programCommands: Command[] = [...this.programs.values()].map((program) =>
      defineCommand(program.name, async (args, ctx) => {
        if (!program.batch) {
          return { stdout: "", stderr: `${program.name}: needs a terminal; run it on its own line\n`, exitCode: 1 };
        }
        const env: Record<string, string> = {};
        for (const [k, v] of ctx.env) env[k] = v;
        return program.batch({ argv: [program.name, ...args], cwd: ctx.cwd, env, stdin: decodeLatin1(ctx.stdin as unknown as string), signal: ctx.signal, fs: ctx.fs });
      }),
    );
    this.session = new BashSession({ ...options, commands: [...(options.commands ?? []), ...programCommands, capture] });
  }

  banner(): string {
    return this.options.banner ?? "";
  }

  prompt(): string {
    return this.session.prompt();
  }

  complete(line: string, cursor: number): Promise<Completion | null> {
    return this.session.complete(line, cursor);
  }

  loadHistory(): Promise<string[]> {
    return this.options.loadHistory?.() ?? Promise.resolve([]);
  }

  saveHistory(lines: readonly string[]): Promise<void> {
    return this.options.saveHistory?.(lines) ?? Promise.resolve();
  }

  /** The program a line runs on its own, with the rest of the line still to expand. */
  private attachedProgram(line: string): { program: TtyProgram; rest: string } | null {
    let ast: { statements: AstNode[] };
    try {
      ast = this.session.bash.transform(line).ast as unknown as { statements: AstNode[] };
    } catch {
      return null;
    }
    if (ast.statements.length !== 1) return null;
    const pipelines = ast.statements[0]!.pipelines as AstNode[] | undefined;
    if (!pipelines || pipelines.length !== 1) return null;
    const commands = pipelines[0]!.commands as AstNode[];
    if (commands.length !== 1 || commands[0]!.type !== "SimpleCommand") return null;
    const command = commands[0]!;
    if ((command.redirections as unknown[]).length || (command.assignments as unknown[]).length) return null;
    const m = /^\s*(\S+)/.exec(line);
    const program = m ? this.programs.get(m[1]!) : undefined;
    if (!program) return null;
    return { program, rest: line.slice(m![0].length) };
  }

  async run(line: string, job: Job): Promise<number> {
    const attached = this.attachedProgram(line);
    if (attached) {
      // Let bash expand the arguments (globs, variables, quotes), then run the program on the tty.
      this.captured = null;
      const expanded = await this.session.exec(`${ARGV_COMMAND}${attached.rest}`, { signal: job.signal });
      if (expanded.exitCode !== 0 || !this.captured) {
        job.write(expanded.stderr);
        return expanded.exitCode || 1;
      }
      const argv = [attached.program.name, ...(this.captured as string[])];
      const env: Record<string, string> = {};
      for (const name of ["HOME", "USER", "PATH", "TERM", "LANG", "SHELL", "PWD"]) {
        const value = this.session.variable(name);
        if (value !== undefined) env[name] = value;
      }
      env.COLUMNS = String(job.tty.size.cols);
      env.LINES = String(job.tty.size.rows);
      const code = await attached.program.attached({ argv, cwd: this.session.cwd, env, job, fs: this.session.bash.fs }).catch((error: unknown) => {
        if (job.stoppedBy) return 0;
        job.write(`${attached.program.name}: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      });
      this.session.lastStatus = job.stoppedBy ? 128 + SIGNAL_NUMBERS[job.stoppedBy] : code;
      return code;
    }
    const result = await this.session.exec(line, { signal: job.signal });
    if (result.stdout) job.write(result.stdout);
    if (result.stderr) job.write(result.stderr);
    if (job.stoppedBy) this.session.lastStatus = 128 + SIGNAL_NUMBERS[job.stoppedBy];
    return result.exitCode;
  }
}

function decodeLatin1(bytes: string): string {
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i) & 0xff;
  return new TextDecoder().decode(array);
}
