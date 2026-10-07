/**
 * A bash session over the Mockintosh disk: just-bash's interpreter and
 * commands (pipes, redirection, loops, functions, globbing, grep, sed, awk,
 * jq, …), with `/disk` and `/system/source` mounted from the kernel and the
 * Macintosh's own commands added.
 *
 * just-bash runs each `exec` from a fresh copy of its state; a session is
 * one shell, so it carries the state across: variables, exports, aliases
 * and options come back in each result's environment, and function
 * definitions are kept as source and defined again before the next line.
 */
import { Bash, InMemoryFs, MountableFs, getCommandNames, type CustomCommand } from "just-bash/browser";
import { KernelFs, normalize, resolvePath, type KernelLike } from "./kernelFs";
import { osCommands } from "./osCommands";
import type { Completion } from "../lineEditor";

export interface BashSessionOptions {
  kernel: KernelLike;
  /** More commands: programs, process control. They win over built-ins of the same name. */
  commands?: CustomCommand[];
  cwd?: string;
  env?: Record<string, string>;
  /** Mount `/system/source` (the OS's own source, read-only). */
  source?: boolean;
  /** For tests: a fake clock for `sleep`. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const HOME = "/disk";

/** Variables that are the shell's own, not its environment. */
const SHELL_ONLY = new Set(["IFS", "PS1", "PS2", "PS3", "PS4", "OPTIND", "OPTARG", "SHELLOPTS", "HISTFILE", "HISTSIZE", "OLDPWD"]);

const DEFAULT_ENV: Record<string, string> = {
  HOME,
  USER: "mac",
  LOGNAME: "mac",
  HOSTNAME: "macintosh",
  SHELL: "/bin/bash",
  TERM: "xterm-256color",
  LANG: "en_US.UTF-8",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  PS1: "\\w \\$ ",
};

interface AstStatement {
  type: string;
  sourceText?: string;
  pipelines?: { commands?: { type: string; name?: unknown }[] }[];
}

export class BashSession {
  readonly bash: Bash;
  private env: Record<string, string>;
  private cwdPath: string;
  /** Function definitions so far, by name, as source. */
  private functions = new Map<string, string>();
  private customNames: string[];
  lastStatus = 0;

  constructor(private options: BashSessionOptions) {
    const base = new InMemoryFs();
    for (const dir of ["/tmp", "/bin", "/usr/bin", "/usr/local/bin", "/dev", "/home"]) base.mkdirSync(dir, { recursive: true });
    const fs = new MountableFs({ base });
    fs.mount("/disk", new KernelFs(options.kernel, "/disk"));
    if (options.source !== false) fs.mount("/system/source", new KernelFs(options.kernel, "/system/source", { readOnly: true }));
    const commands = [...osCommands(options.kernel), ...(options.commands ?? [])];
    this.customNames = commands.map((c) => c.name);
    this.bash = new Bash({
      fs,
      cwd: options.cwd ?? HOME,
      env: { ...DEFAULT_ENV, ...options.env },
      customCommands: commands,
      sleep: options.sleep,
      executionLimits: {
        // An interactive shell: a long-running loop is the user's to interrupt.
        maxExecutionTimeMs: 24 * 60 * 60 * 1000,
        maxOutputSize: 16 * 1024 * 1024,
      },
    });
    this.env = { ...DEFAULT_ENV, ...options.env };
    this.cwdPath = options.cwd ?? HOME;
  }

  get cwd(): string {
    return this.cwdPath;
  }

  variable(name: string): string | undefined {
    return this.env[name];
  }

  /**
   * What a program started from this shell inherits. just-bash doesn't mark
   * exports, so it's every variable but the shell's own machinery.
   */
  environment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || SHELL_ONLY.has(name) || name.startsWith("BASH")) continue;
      env[name] = value;
    }
    env.PWD = this.cwdPath;
    return env;
  }

  /** Run ~/.bashrc, as an interactive bash does when it starts. */
  async startup(): Promise<ExecResult | null> {
    const rc = `${this.env.HOME ?? HOME}/.bashrc`;
    if (!(await this.bash.fs.exists(rc))) return null;
    return this.exec(`source ${rc}`);
  }

  /** Run one line (or script) as this shell. */
  async exec(line: string, options: { signal?: AbortSignal; stdin?: string } = {}): Promise<ExecResult> {
    // The last line's status survives the prelude: `$?` is the previous command's.
    const prelude = ["shopt -s expand_aliases", ...this.functions.values(), `(exit ${this.lastStatus & 255})`].join("\n");
    const result = await this.bash.exec(`${prelude}\n${line}`, {
      cwd: this.cwdPath,
      env: { ...this.env, PWD: this.cwdPath },
      replaceEnv: true,
      signal: options.signal,
      stdin: options.stdin,
      rawScript: true,
    });
    if (result.env) {
      this.env = { ...result.env };
      delete this.env["?"];
      if (result.env.PWD) this.cwdPath = normalize(result.env.PWD);
    }
    this.remember(line);
    this.lastStatus = result.exitCode;
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  }

  /** Keep the line's function definitions (and forget `unset -f`'d ones). */
  private remember(line: string): void {
    let statements: AstStatement[];
    try {
      statements = (this.bash.transform(line).ast as { statements: AstStatement[] }).statements;
    } catch {
      return;
    }
    for (const statement of statements) {
      const commands = statement.pipelines?.length === 1 ? statement.pipelines[0]!.commands ?? [] : [];
      const def = commands.length === 1 && commands[0]!.type === "FunctionDef" ? commands[0]! : null;
      if (def && typeof def.name === "string" && statement.sourceText) this.functions.set(def.name, statement.sourceText);
    }
    for (const m of line.matchAll(/\bunset\s+-f\s+([\w-]+)/g)) this.functions.delete(m[1]!);
  }

  /** The prompt: `$PS1` with bash's \w \W \u \h \$ escapes. */
  prompt(): string {
    const ps1 = this.env.PS1 ?? DEFAULT_ENV.PS1!;
    const home = this.env.HOME ?? HOME;
    const tilde = this.cwdPath === home ? "~" : this.cwdPath.startsWith(home + "/") ? "~" + this.cwdPath.slice(home.length) : this.cwdPath;
    return ps1.replace(/\\([wWuh$n\\])/g, (_, c: string) => {
      switch (c) {
        case "w": return tilde;
        case "W": return tilde === "~" || tilde === "/" ? tilde : tilde.slice(tilde.lastIndexOf("/") + 1);
        case "u": return this.env.USER ?? "mac";
        case "h": return (this.env.HOSTNAME ?? "macintosh").split(".")[0]!;
        case "$": return "$";
        case "n": return "\n";
        default: return "\\";
      }
    });
  }

  commandNames(): string[] {
    const aliases = Object.keys(this.env).filter((k) => k.startsWith("BASH_ALIAS_")).map((k) => k.slice("BASH_ALIAS_".length));
    return [...new Set([...getCommandNames(), ...this.customNames, ...this.functions.keys(), ...aliases, "cd", "export", "exit", "source", "unset", "alias"])].sort();
  }

  /** Tab completion: command names for the first word, paths otherwise. */
  async complete(line: string, cursor: number): Promise<Completion | null> {
    const before = line.slice(0, cursor);
    const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\t"), before.lastIndexOf("|"), before.lastIndexOf(";"), before.lastIndexOf(">"), before.lastIndexOf("<")) + 1;
    const word = before.slice(start);
    const firstWord = before.slice(0, start).trim() === "" || /[|;&]\s*$/.test(before.slice(0, start));
    if (firstWord && !word.includes("/")) {
      const candidates = this.commandNames().filter((n) => n.startsWith(word)).map((n) => n + " ");
      return { start, candidates };
    }
    const expanded = word.startsWith("~") ? (this.env.HOME ?? HOME) + word.slice(1) : word;
    const slash = expanded.lastIndexOf("/");
    const dirPart = slash >= 0 ? expanded.slice(0, slash + 1) : "";
    const namePart = slash >= 0 ? expanded.slice(slash + 1) : expanded;
    const dir = resolvePath(this.cwdPath, dirPart || ".");
    let entries: { name: string; isDirectory: boolean }[];
    try {
      const fs = this.bash.fs;
      const names = await fs.readdir(dir);
      entries = await Promise.all(
        names.filter((n) => n.startsWith(namePart) && (namePart.startsWith(".") || !n.startsWith("."))).map(async (name) => {
          const stat = await fs.stat(resolvePath(dir, name)).catch(() => null);
          return { name, isDirectory: !!stat?.isDirectory };
        }),
      );
    } catch {
      return null;
    }
    const prefix = word.slice(0, word.length - namePart.length);
    const quote = (s: string) => s.replace(/([\s'"\\$`&|;<>()*?[\]#!])/g, "\\$1");
    return {
      start,
      candidates: entries.map((e) => prefix + quote(e.name) + (e.isDirectory ? "/" : " ")),
    };
  }
}
