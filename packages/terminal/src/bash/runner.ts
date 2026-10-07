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
  private captured: { args: string[]; env: Record<string, string> } | null = null;

  constructor(private options: BashRunnerOptions) {
    for (const program of options.programs ?? []) this.programs.set(program.name, program);
    const capture = defineCommand(ARGV_COMMAND, async (args, ctx) => {
      // Variables set for this command only (FOO=bar fx) are in its environment.
      const env: Record<string, string> = {};
      for (const [name, value] of ctx.env) if (this.session.variable(name) !== value && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) env[name] = value;
      this.captured = { args, env };
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

  /** Source ~/.bashrc and show what it printed. */
  async startup(job: Pick<Job, "write">): Promise<void> {
    const result = await this.session.startup().catch((error: unknown) => ({
      stdout: "",
      stderr: `bash: ~/.bashrc: ${error instanceof Error ? error.message : String(error)}\n`,
      exitCode: 1,
    }));
    if (result?.stdout) job.write(result.stdout);
    if (result?.stderr) job.write(result.stderr);
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
  /**
   * The program a line runs on the terminal: the last command of the line
   * when it is a program on its own (no pipe or redirection), with what
   * comes before it (`cd proj && fx`) and the operator between them.
   */
  private attachedProgram(line: string): { program: TtyProgram; rest: string; before: string; operator: ";" | "&&" | "||" | null } | null {
    const { before, operator, last } = splitLastCommand(line);
    let ast: { statements: AstNode[] };
    try {
      ast = this.session.bash.transform(last).ast as unknown as { statements: AstNode[] };
      if (before) this.session.bash.transform(before);
    } catch {
      return null;
    }
    if (ast.statements.length !== 1) return null;
    const pipelines = ast.statements[0]!.pipelines as AstNode[] | undefined;
    if (!pipelines || pipelines.length !== 1) return null;
    const commands = pipelines[0]!.commands as AstNode[];
    if (commands.length !== 1 || commands[0]!.type !== "SimpleCommand") return null;
    const command = commands[0]!;
    if ((command.redirections as unknown[]).length) return null;
    // Leading assignments (FOO=bar fx) stay with the expansion below.
    const m = /^((?:\s*[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S)*)*)\s*(\S+)/.exec(last);
    const program = m ? this.programs.get(m[2]!) : undefined;
    if (!program) return null;
    return { program, rest: `${m![1]} ${ARGV_COMMAND}${last.slice(m![0].length)}`, before, operator };
  }

  async run(line: string, job: Job): Promise<number> {
    const attached = this.attachedProgram(line);
    if (attached) {
      if (attached.before) {
        // What comes first runs as bash; the operator decides whether the program follows.
        const first = await this.session.exec(attached.before, { signal: job.signal });
        if (first.stdout) job.write(first.stdout);
        if (first.stderr) job.write(first.stderr);
        if (job.stoppedBy) return first.exitCode;
        if ((attached.operator === "&&" && first.exitCode !== 0) || (attached.operator === "||" && first.exitCode === 0)) return first.exitCode;
      }
      // Let bash expand the arguments (globs, variables, quotes) and assignments, then run the program on the tty.
      this.captured = null;
      const expanded = await this.session.exec(attached.rest.trim(), { signal: job.signal });
      if (expanded.exitCode !== 0 || !this.captured) {
        job.write(expanded.stderr);
        return expanded.exitCode || 1;
      }
      const captured = this.captured as { args: string[]; env: Record<string, string> };
      const argv = [attached.program.name, ...captured.args];
      const env = { ...this.session.environment(), ...captured.env };
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

/**
 * Split a line at its last top-level `;`, `&&`, `||` or newline, outside
 * quotes, escapes and parentheses: what comes before, the operator, and the
 * last command.
 */
export function splitLastCommand(line: string): { before: string; operator: ";" | "&&" | "||" | null; last: string } {
  let quote: string | null = null;
  let depth = 0;
  let split = -1;
  let operator: ";" | "&&" | "||" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const two = line.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        split = i;
        operator = two;
        i++;
      } else if (c === ";" || c === "\n") {
        split = i;
        operator = ";";
      }
    }
  }
  if (split < 0) return { before: "", operator: null, last: line };
  return { before: line.slice(0, split), operator, last: line.slice(split + (operator === ";" ? 1 : 2)) };
}
