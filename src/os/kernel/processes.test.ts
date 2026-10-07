import { describe, expect, it } from "vitest";
import { Kernel } from "./index";
import { Cancellation } from "./cancellation";
import { parseSignal, registerProcesses } from "./processes";
import { registerShell } from "../shell";

function setup(apps: { id: string; app: string; windows: string[] }[] = []) {
  const kernel = new Kernel();
  const stopped: string[] = [];
  registerProcesses(kernel, {
    apps: () => apps.filter((a) => !stopped.includes(a.id)),
    stopApp: (id) => stopped.push(id),
  });
  registerShell(kernel);
  const owner = kernel.createSession();
  const other = kernel.createSession();
  const as = (caller: typeof owner) => (name: string, args: Record<string, unknown> = {}, token?: Cancellation) =>
    kernel.invoke(caller, name, args, token) as Promise<any>;
  return { kernel, owner, other, mine: as(owner), theirs: as(other), stopped };
}

describe("process table", () => {
  it("lists jobs and apps, and delivers kill to the job's owner", async () => {
    const { mine, theirs } = setup([{ id: "instance-1", app: "terminal", windows: ["w1"] }]);
    const { pid: shell } = await mine("process_start", { name: "bash", tty: "ttys001" });
    const { pid } = await mine("process_start", { name: "sleep", args: ["100"], tty: "ttys001", parent: shell });
    const rows = await theirs("ps");
    expect(rows.map((r: any) => [r.name, r.kind, r.ppid])).toEqual([["bash", "job", 0], ["sleep", "job", shell], ["terminal", "app", 0]]);
    const heard = mine("process_signals", { pid });
    await theirs("kill", { pid, signal: "SIGINT" });
    expect(await heard).toEqual({ signal: "SIGINT" });
    // A signal sent while nobody listens waits for the listener.
    await theirs("kill", { pid });
    expect(await mine("process_signals", { pid })).toEqual({ signal: "SIGTERM" });
  });

  it("waits for a job's status and keeps it for a while", async () => {
    const { mine, theirs } = setup();
    const { pid } = await mine("process_start", { name: "make" });
    const waiting = theirs("wait", { pid });
    await mine("process_exit", { pid, status: 2 });
    expect(await waiting).toEqual({ status: 2 });
    expect(await theirs("wait", { pid })).toEqual({ status: 2 });
    expect((await theirs("ps")).some((r: any) => r.pid === pid)).toBe(false);
    expect((await theirs("ps", { all: true })).find((r: any) => r.pid === pid)).toMatchObject({ state: "exited", status: 2 });
    await expect(theirs("process_exit", { pid, status: 0 })).rejects.toMatchObject({ code: "permission" });
  });

  it("hangs up a job when its owner goes away", async () => {
    const { kernel, owner, mine, theirs } = setup();
    const { pid } = await mine("process_start", { name: "vi" });
    const waiting = theirs("wait", { pid });
    kernel.revokeSession(owner.id);
    expect(await waiting).toEqual({ status: 129 });
  });

  it("quits an app it is asked to kill", async () => {
    const { theirs, stopped } = setup([{ id: "instance-7", app: "macpaint", windows: ["w"] }]);
    const [app] = await theirs("ps");
    await theirs("kill", { pid: app.pid, signal: "SIGKILL" });
    expect(stopped).toEqual(["instance-7"]);
    await expect(theirs("kill", { pid: 999 })).rejects.toMatchObject({ code: "missing-resource" });
  });

  it("stops listening when the call is cancelled", async () => {
    const { mine } = setup();
    const { pid } = await mine("process_start", { name: "x" });
    const token = new Cancellation();
    const heard = mine("process_signals", { pid }, token);
    token.cancel();
    await expect(heard).rejects.toMatchObject({ code: "cancellation" });
    // A new listener can take over.
    const again = mine("process_signals", { pid });
    await mine("process_exit", { pid, status: 0 });
    expect(await again).toEqual({ signal: null });
  });

  it("reads signal names as kill does", () => {
    expect(parseSignal("-9")).toBe("SIGKILL");
    expect(parseSignal("INT")).toBe("SIGINT");
    expect(parseSignal("-SIGHUP")).toBe("SIGHUP");
    expect(() => parseSignal("-NOPE")).toThrow();
  });

  it("gives S1 ps and kill", async () => {
    const { mine, theirs } = setup();
    const { pid } = await mine("process_start", { name: "top", tty: "ttys002" });
    const listing = await theirs("run_shell", { command: "ps" });
    expect(listing.stdout).toContain("  PID  PPID TT       STAT COMMAND");
    expect(listing.stdout).toMatch(new RegExp(`\\s${pid}\\s+0 ttys002\\s+S\\s+top`));
    const heard = mine("process_signals", { pid });
    expect((await theirs("run_shell", { command: `kill -9 ${pid}` })).exitCode).toBe(0);
    expect(await heard).toEqual({ signal: "SIGKILL" });
  });
});
