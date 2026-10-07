/**
 * The Macintosh's own commands in bash. Each runs as one S1 command line
 * through the kernel's `run_shell`, so S1 stays the single implementation:
 * `open terminal`, `windows`, `click "OK"`, `screenshot shot.pbm`.
 *
 * Bash keeps its own `ls`, `cat`, `cd` and the rest, which work on the same
 * disk through `KernelFs`. Where names collide (`type`, `help`), the S1
 * command is `mac <name>`; `mac` reaches every S1 command.
 */
import { defineCommand, type Command } from "just-bash/browser";
import type { KernelLike } from "./kernelFs";

/** S1 commands bash doesn't have, available under their own names. */
export const OS_COMMANDS = [
  "open", "apps", "windows", "inspect", "activate", "click", "dblclick", "drag", "key", "menu", "render",
  "screenshot", "desktop_pattern", "project", "edit", "build", "install", "restart", "restore", "instances", "write",
  "ps", "kill",
] as const;

/** Quote a word for the S1 parser: single quotes, with `'` spelled `'\''`. */
export function s1Quote(word: string): string {
  if (word !== "" && /^[A-Za-z0-9_./:@%+=,-]+$/.test(word)) return word;
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The S1 session's cwd for a bash cwd: S1 lives on the disk. */
function s1Cwd(cwd: string): string {
  return cwd === "/disk" || cwd.startsWith("/disk/") || cwd.startsWith("/system/source") ? cwd : "/disk";
}

interface ShellOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated?: { stdout: boolean; stderr: boolean };
}

export async function runS1(kernel: KernelLike, argv: string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = (await kernel.invoke("run_shell", { command: argv.map(s1Quote).join(" "), cwd: s1Cwd(cwd) }, { signal })) as ShellOutcome & { session?: string };
    // One command, one S1 session: don't leave it for the idle sweep.
    if (result.session) void kernel.invoke("shell_close", { session: result.session }).catch(() => {});
    const note = result.truncated?.stdout || result.truncated?.stderr ? "[output truncated]\n" : "";
    return { stdout: result.stdout, stderr: result.stderr + note, exitCode: result.exitCode };
  } catch (error) {
    if (signal?.aborted) return { stdout: "", stderr: "", exitCode: 130 };
    return { stdout: "", stderr: `${argv[0]}: ${error instanceof Error ? error.message : String(error)}\n`, exitCode: 1 };
  }
}

export function osCommands(kernel: KernelLike): Command[] {
  const commands = OS_COMMANDS.map((name) =>
    defineCommand(name, (args, ctx) => runS1(kernel, [name, ...args], ctx.cwd, ctx.signal)),
  );
  commands.push(
    defineCommand("mac", async (args, ctx) => {
      if (args.length === 0) return runS1(kernel, ["help"], ctx.cwd, ctx.signal);
      return runS1(kernel, args, ctx.cwd, ctx.signal);
    }),
  );
  return commands;
}
