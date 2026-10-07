import {jobSchema} from "../projects";
import {parse} from "../kernel/schema";
import { formatters, formatProcesses, type ProcessRow } from "./format";
import { parseSignal } from "../kernel/processes";
import type { Cancellation } from "../kernel/cancellation";
export class UsageError extends Error { }
interface CommandContext {
  invoke(name: string, args?: Record<string, unknown>): Promise<unknown>;
  path(value: string): string;
  target(value: string, window?: string): Record<string, unknown>;
  stdout: {
    append(text: string): void;
    write(bytes: Uint8Array): void;
  };
  token: Cancellation;
  cwd(): string;
  setCwd(value: string): void;
}
interface Command {
  operands: string;
  json: boolean;
  run(args: string[], context: CommandContext, usage: (min: number, max?: number) => void): Promise<unknown>;
  format?(result: unknown, args: string[]): string;
}
/** The sole S1 catalog: syntax, execution, and presentation live together. */
export const commands: Readonly<Record<string, Command>> = {
  desktop_pattern: {
    operands: "[checker|white|black|ppat:<id>]", json: true,
    format: result => (result as {pattern: string}).pattern + "\n",
    async run(args, {invoke}, usage) {
      usage(0, 1);
      return invoke("desktop_pattern", args[0] ? {value: args[0]} : {});
    },
  },
  project: {
    operands: "path app-id title [counter|blank|canvas]", json: true,
    async run(args, {invoke, path}, usage) {
      usage(3, 4);
      if (args[3] !== undefined && !["counter", "blank", "canvas"].includes(args[3])) throw new UsageError(commandHelp.project);
      return invoke("project_create", {path: path(args[0]), id: args[1], title: args[2], ...(args[3] ? {template: args[3]} : {})});
    },
  },
  edit: {
    operands: "project-path", json: true,
    async run(args, {invoke, path}, usage) { usage(1); return invoke("source_open", {path: path(args[0])}); },
  },
  build: {
    operands: "[--run] project-path", json: true,
    format: result => (result as {id: string}).id + "\n",
    async run(args, {invoke, path, token}, usage) {
      usage(1, 2);
      const run = args[0] === "--run";
      if (args.length !== (run ? 2 : 1)) throw new UsageError(commandHelp.build);
      const project = path(args[run ? 1 : 0]);
      let job = parse(jobSchema, await invoke("build_submit", {path: project}));
      while (job.state === "building") { await token.delay(25); job = parse(jobSchema, await invoke("build_status", {id: job.id})); }
      if (job.state !== "succeeded") throw new Error(job.diagnostics.map(d => `${d.file ?? "build"}:${d.line ?? ""} ${d.message}`).join("\n") || job.state);
      if (run) await invoke("app_install", {path: project, build: job.id});
      return job;
    },
  },
  check: {
    operands: "project-path", json: true,
    format: result => {
      const diagnostics = (result as {diagnostics: {message: string; file?: string; line?: number; column?: number}[]}).diagnostics;
      return diagnostics.length ? diagnostics.map(d => `${d.file ?? "project"}:${d.line ?? 0}:${d.column ?? 0}: ${d.message}\n`).join("") : "No problems.\n";
    },
    async run(args, {invoke, path}, usage) { usage(1); return invoke("project_check", {path: path(args[0])}); },
  },
  logs: {
    operands: "[instance-id]", json: true,
    format: result => (result as {instance: string; at: number; message: string; source: string}[])
      .map(e => `${new Date(e.at).toISOString()}  ${e.instance}  ${e.source}: ${e.message}\n`).join(""),
    async run(args, {invoke}, usage) { usage(0, 1); return invoke("logs", args[0] ? {instance: args[0]} : {}); },
  },
  install: {
    operands: "project-path build-id", json: true,
    async run(args, {invoke, path}, usage) { usage(2); return invoke("app_install", {path: path(args[0]), build: args[1]}); },
  },
  restart: {
    operands: "app-id", json: true,
    async run(args, {invoke}, usage) { usage(1); return invoke("app_restart", {app: args[0]}); },
  },
  restore: {
    operands: "app-id", json: true,
    async run(args, {invoke}, usage) { usage(1); return invoke("app_restore", {app: args[0]}); },
  },
  instances: {
    operands: "", json: true,
    format: result => (result as {id: string; app: string; build?: string}[]).map(i => `${i.id}  ${i.app}  ${i.build ?? "bundled"}\n`).join(""),
    async run(args, {invoke}, usage) { usage(0); return invoke("instances"); },
  },
  ps: {
    operands: "[-a]", json: true,
    format: result => formatProcesses(result as ProcessRow[]),
    async run(args, {invoke}, usage) {
      usage(0, 1);
      if (args[0] !== undefined && args[0] !== "-a") throw new UsageError(commandHelp.ps);
      return invoke("ps", args[0] === "-a" ? {all: true} : {});
    },
  },
  kill: {
    operands: "[-SIGNAL] pid...", json: false,
    async run(args, {invoke}, usage) {
      usage(1, 32);
      const signal = args[0]!.startsWith("-") ? parseSignal(args.shift()!) : "SIGTERM";
      if (!args.length) throw new UsageError(commandHelp.kill);
      for (const pid of args) {
        if (!/^\d+$/.test(pid)) throw new UsageError(commandHelp.kill);
        await invoke("kill", {pid: Number(pid), signal});
      }
    },
  },
  help: {
    operands: "[command]", json: false,
    async run(args, { stdout }, usage) {
      usage(0, 1);
      if (args[0] && !Object.hasOwn(commandHelp, args[0])) throw new UsageError("Unknown help topic");
      stdout.append((args[0] ? commandHelp[args[0]] : Object.values(commandHelp).join("\n")) + "\n");
    },
  },
  ls: {
    operands: "[path]", json: true,
    format: formatters.ls,
    async run(args, { invoke, path, cwd }, usage) {
      usage(0, 1);
      return await invoke("list", {
        path: args[0] ? path(args[0]) : cwd()
      });
    },
  },
  cat: {
    operands: "path", json: false,
    async run(args, { invoke, path, stdout }, usage) {
      usage(1);
      stdout.write(new Uint8Array((await invoke("read_bytes", { path: path(args[0]) }) as { bytes: number[] }).bytes));
    },
  },
  stat: {
    operands: "path", json: true,
    format: formatters.stat,
    async run(args, { invoke, path }, usage) {
      usage(1);
      return await invoke("stat", {
        path: path(args[0])
      });
    },
  },
  pwd: {
    operands: "", json: false,
    async run(args, { stdout, cwd }, usage) {
      usage(0);
      stdout.append(cwd() + "\n");
    },
  },
  cd: {
    operands: "path", json: false,
    async run(args, { invoke, path, setCwd }, usage) {
      usage(1);
      const next = path(args[0]);
      const info = (await invoke("stat", {
        path: next
      })) as {
        kind: string;
      };
      if (info.kind !== "directory") throw new UsageError("Not a directory");
      setCwd(next);
    },
  },
  echo: {
    operands: "[text ...]", json: false,
    async run(args, { stdout }, usage) {
      stdout.append(args.join(" ") + "\n");
    },
  },
  write: {
    operands: "path text", json: true,
    async run(args, { invoke, path }, usage) {
      usage(2);
      return await invoke("write", {
        path: path(args[0]),
        body: args[1]
      });
    },
  },
  mkdir: {
    operands: "path", json: true,
    async run(args, { invoke, path }, usage) {
      usage(1);
      return await invoke("mkdir", {
        path: path(args[0])
      });
    },
  },
  rm: {
    operands: "[-r] path", json: true,
    async run(args, { invoke, path }, usage) {
      usage(1, 2);
      if ((args[0] === "-r" && args.length !== 2) || (args.length === 2 && args[0] !== "-r")) throw new UsageError(commandHelp.rm);
      return await invoke("remove", {
        path: path(args[args.length - 1]),
        recursive: args[0] === "-r" && args.length === 2
      });
    },
  },
  mv: {
    operands: "source destination", json: true,
    async run(args, { invoke, path }, usage) {
      usage(2);
      return await invoke("move", {
        source: path(args[0]),
        destination: path(args[1])
      });
    },
  },
  cp: {
    operands: "source destination", json: true,
    async run(args, { invoke, path }, usage) {
      usage(2);
      return await invoke("copy", {
        source: path(args[0]),
        destination: path(args[1])
      });
    },
  },
  open: {
    operands: "app-id", json: true,
    async run(args, { invoke }, usage) {
      usage(1);
      return await invoke("open", {
        app: args[0]
      });
    },
  },
  apps: {
    operands: "", json: true,
    format: formatters.apps,
    async run(args, { invoke }, usage) {
      usage(0);
      return invoke("apps");
    },
  },
  windows: {
    operands: "", json: true,
    format: formatters.windows,
    async run(args, { invoke }, usage) {
      usage(0);
      return invoke("windows");
    },
  },
  inspect: {
    operands: "[window-id]", json: true,
    format: formatters.inspect,
    async run(args, { invoke }, usage) {
      usage(0, 1);
      return await invoke("inspect", args[0] ? {
        window: args[0]
      } : {});
    },
  },
  activate: {
    operands: "window-id", json: true,
    async run(args, { invoke }, usage) {
      usage(1);
      return await invoke("activate", {
        window: args[0]
      });
    },
  },
  click: {
    operands: "name-or-id [window-id]", json: true,
    async run(args, { invoke, target }, usage) {
      usage(1, 2);
      return await invoke("click", target(args[0], args[1]));
    },
  },
  dblclick: {
    operands: "name-or-id [window-id]", json: true,
    async run(args, { invoke, target }, usage) {
      usage(1, 2);
      return await invoke("dblclick", target(args[0], args[1]));
    },
  },
  drag: {
    operands: "name-or-id x y [window-id]", json: true,
    async run(args, { invoke, target }, usage) {
      usage(3, 4);
      if (!Number.isFinite(Number(args[1])) || !Number.isFinite(Number(args[2]))) throw new UsageError(commandHelp.drag);
      return await invoke("drag", {
        ...target(args[0], args[3]),
        x: Number(args[1]),
        y: Number(args[2])
      });
    },
  },
  type: {
    operands: "name-or-id text [window-id]", json: true,
    async run(args, { invoke, target }, usage) {
      usage(2, 3);
      return await invoke("type", {
        ...target(args[0], args[2]),
        text: args[1]
      });
    },
  },
  key: {
    operands: "key-name [meta|ctrl|shift|alt ...]", json: true,
    async run(args, { invoke }, usage) {
      usage(1, 5);
      if (args.slice(1).some(a => !["meta", "ctrl", "shift", "alt"].includes(a))) throw new UsageError(commandHelp.key);
      return await invoke("key", {
        key: args[0],
        ...Object.fromEntries(args.slice(1).map(a => [a, true]))
      });
    },
  },
  menu: {
    operands: "[menu-label item-label]", json: true,
    format: formatters.menu,
    async run(args, { invoke }, usage) {
      if (args.length !== 0 && args.length !== 2) throw new UsageError(commandHelp.menu);
      return await invoke("menu", args.length ? {
        menu: args[0],
        item: args[1]
      } : {});
    },
  },
  render: {
    operands: "", json: true,
    async run(args, { invoke }, usage) {
      usage(0);
      return invoke("render");
    },
  },
  screenshot: {
    operands: "path.pbm", json: true,
    format: formatters.screenshot,
    async run(args, { invoke, path }, usage) {
      usage(1);
      return await invoke("screenshot_save", {
        path: path(args[0])
      });
    },
  },
  sleep: {
    operands: "seconds", json: false,
    async run(args, { token }, usage) {
      usage(1);
      if (!Number.isFinite(Number(args[0])) || Number(args[0]) < 0 || Number(args[0]) > 86400) throw new UsageError("Expected seconds between 0 and 86400");
      await token.delay(Number(args[0]) * 1000);
    },
  },
};
/** Help is derived from this table; it is not a separate inventory. */
export const commandHelp: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  Object.entries(commands).map(([name, command]) => [name, [name, ...(command.json ? ["[--json]"] : []), ...(command.operands ? [command.operands] : [])].join(" ")]),
));
export async function executeCommand(name: string, args: string[], context: CommandContext): Promise<void> {
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) throw new UsageError("Unknown command");
  const json = command.json && args[0] === "--json";
  if (json) args = args.slice(1);
  if (command.json && args[0] === "--") args = args.slice(1);
  const usage = (min: number, max = min) => {
    if (args.length < min || args.length > max) throw new UsageError(commandHelp[name]);
  };
  const result = await command.run(args, context, usage);
  if (json) context.stdout.append(JSON.stringify(result ?? null) + "\n");
  else if (result !== undefined && command.format) context.stdout.append(command.format(result, args));
}
