import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend, ROOT_ID } from "@mockintosh/fs";
import { Kernel } from "../../../src/os/kernel";
import { registerFileOperations } from "../../../src/os/kernel/files";
import { registerShell } from "../../../src/os/shell";
import { registerProcesses } from "../../../src/os/kernel/processes";
import { Cancellation } from "../../../src/os/kernel/cancellation";
import { BashRunner, BashSession, type KernelLike, type TtyProgram } from "../src/bash/index";
import { createTerminalScreen, Pty, runShell, exitBuiltin, kernelProcesses, type TerminalScreen } from "../src/index";

export async function kernelRig() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend() });
  fs.mkdir(ROOT_ID, "Disk", { role: "volume" });
  const kernel = new Kernel();
  registerFileOperations(kernel, fs);
  registerShell(kernel);
  registerProcesses(kernel);
  const caller = kernel.createSession();
  const client: KernelLike = {
    invoke(name, args = {}, options = {}) {
      const token = new Cancellation();
      options.signal?.addEventListener("abort", () => token.cancel(), { once: true });
      return kernel.invoke(caller, name, args, token, { stdout: options.stdout, stderr: options.stderr });
    },
  };
  return { fs, kernel, client, caller };
}

function visible(screen: TerminalScreen): string[] {
  return screen.frame().rows.map((r) => r.cells.map((c) => c.text || " ").join("").trimEnd());
}

describe("BashSession on the kernel's disk", () => {
  it("reads and writes the disk the Finder sees", async () => {
    const { fs, client } = await kernelRig();
    const bash = new BashSession({ kernel: client });
    expect(await bash.exec("mkdir -p notes/today && echo hello > notes/today/a.txt && cat notes/today/a.txt")).toMatchObject({ stdout: "hello\n", exitCode: 0 });
    const volume = fs.locate("volume")!;
    const notes = fs.child(volume.id, "notes")!;
    expect(fs.child(fs.child(notes.id, "today")!.id, "a.txt")).toBeTruthy();
    expect((await bash.exec("ls notes/today | wc -l")).stdout.trim()).toBe("1");
    expect((await bash.exec("ls -l notes/today")).stdout).toMatch(/6 .* a\.txt/);
    expect((await bash.exec("cat missing.txt")).stderr).toMatch(/No such file/);
  });

  it("keeps variables, the directory, aliases and functions between lines", async () => {
    const { client } = await kernelRig();
    const bash = new BashSession({ kernel: client });
    await bash.exec("mkdir work; cd work; X=42; export Y=7; alias hi='echo hi there'");
    await bash.exec("greet() { echo \"hello $1\"; }");
    expect(bash.cwd).toBe("/disk/work");
    expect((await bash.exec("pwd; echo $X $Y; hi; greet you")).stdout).toBe("/disk/work\n42 7\nhi there\nhello you\n");
    expect(bash.prompt()).toBe("~/work $ ");
  });

  it("globs, pipes and loops over the disk", async () => {
    const { client } = await kernelRig();
    const bash = new BashSession({ kernel: client });
    await bash.exec("for n in 1 2 3; do echo \"line $n\" > f$n.txt; done");
    expect((await bash.exec("cat f*.txt | grep -c line")).stdout.trim()).toBe("3");
    expect((await bash.exec("ls *.txt | sed 's/.txt//' | tr '\\n' ' '")).stdout).toBe("f1 f2 f3 ");
  });

  it("runs the Macintosh's own commands through S1", async () => {
    const { client } = await kernelRig();
    const bash = new BashSession({ kernel: client });
    await bash.exec("mkdir docs && cd docs");
    expect((await bash.exec("mac pwd")).stdout).toBe("/disk/docs\n");
    expect((await bash.exec("write note.txt 'it'\\''s here' && cat note.txt")).stdout).toBe("it's here");
  });

  it("completes commands and paths", async () => {
    const { client } = await kernelRig();
    const bash = new BashSession({ kernel: client });
    await bash.exec("mkdir Applications; touch Apple.txt");
    expect((await bash.complete("ech", 3))?.candidates).toContain("echo ");
    expect((await bash.complete("ls Ap", 5))?.candidates.sort()).toEqual(["Apple.txt ", "Applications/"]);
  });
});

describe("bash on a pseudo-terminal", () => {
  async function terminal(programs: TtyProgram[] = []) {
    const { client, kernel } = await kernelRig();
    const screen = createTerminalScreen({ size: { cols: 40, rows: 8 } });
    const pty = new Pty();
    pty.master.onOutput((data) => void screen.write(data));
    screen.onInput((data) => pty.master.write(data));
    pty.master.resize(screen.size);
    const runner = new BashRunner({ kernel: client, programs });
    const killed: string[] = [];
    const done = runShell(pty.slave, runner, { exitCommand: exitBuiltin, processes: kernelProcesses(client), name: "bash", onKilled: (signal) => killed.push(signal) });
    const settle = async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    };
    return { screen, pty, done, settle, kernel, killed, type: (s: string) => screen.input(s) };
  }

  it("runs a line typed at the prompt", async () => {
    const { screen, type, settle, done } = await terminal();
    await settle();
    type("echo $((6*7))\r");
    await settle();
    expect(visible(screen).slice(0, 3)).toEqual(["~ $ echo $((6*7))", "42", "~ $"]);
    type("exit 3\r");
    expect(await done).toBe(3);
  });

  it("gives an attached program the tty and ⌃C interrupts it", async () => {
    const reader: TtyProgram = {
      name: "upcase",
      async attached({ job }) {
        for (;;) {
          const line = await job.tty.read(job.signal);
          if (line === null) return 0;
          job.write(line.toUpperCase());
        }
      },
    };
    const { screen, type, settle } = await terminal([reader]);
    await settle();
    type("upcase\r");
    await settle();
    type("abc\r");
    await settle();
    expect(visible(screen).slice(0, 3)).toEqual(["~ $ upcase", "abc", "ABC"]);
    type("\x03");
    await settle();
    type("echo $?\r");
    await settle();
    expect(visible(screen).slice(3, 6)).toEqual(["^C", "~ $ echo $?", "130"]);
  });

  it("lists the shell and its job in ps, and kill from elsewhere stops the job", async () => {
    const forever: TtyProgram = {
      name: "forever",
      attached: ({ job }) => new Promise((resolve) => job.signal.addEventListener("abort", () => resolve(0))),
    };
    const { kernel, screen, type, settle, killed } = await terminal([forever]);
    await settle();
    type("forever --and-ever\r");
    await settle();
    const other = kernel.createSession();
    const rows = (await kernel.invoke(other, "ps", {})) as { pid: number; ppid: number; name: string; args: string[]; tty?: string }[];
    const shell = rows.find((r) => r.name === "bash")!;
    const job = rows.find((r) => r.name === "forever")!;
    expect(job).toMatchObject({ ppid: shell.pid, args: ["--and-ever"], tty: shell.tty });
    expect(shell.tty).toMatch(/^ttys\d{3}$/);
    await kernel.invoke(other, "kill", { pid: job.pid });
    await settle();
    type("echo $?\r");
    await settle();
    expect(visible(screen).slice(1, 3)).toEqual(["~ $ echo $?", "143"]);
    // The shell ignores an interrupt, but a kill ends it.
    await kernel.invoke(other, "kill", { pid: shell.pid, signal: "SIGINT" });
    await kernel.invoke(other, "kill", { pid: shell.pid, signal: "SIGTERM" });
    await settle();
    expect(killed).toEqual(["SIGTERM"]);
  });
});
