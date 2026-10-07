import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BashRunner } from "../src/bash/index";
import { createTerminalScreen, Pty, runShell, exitBuiltin, type TerminalScreen } from "../src/index";
import { bundledPrograms, mountPython, pythonArguments, wasiProgram, ZipArchive } from "../src/wasi/index";
import { kernelRig } from "./support/kernelRig";
import { spawnNodeWorker } from "./support/nodeWorker";

const PUBLIC = new URL("../../../public/wasi/", import.meta.url);
const modules = new Map<string, Promise<WebAssembly.Module>>();
function load(file: string): () => Promise<WebAssembly.Module> {
  return () => {
    if (!modules.has(file)) modules.set(file, WebAssembly.compile(readFileSync(new URL(file, PUBLIC))));
    return modules.get(file)!;
  };
}

let python: { archive: ZipArchive; module: Promise<WebAssembly.Module> } | null = null;
function pythonBundle() {
  if (!python) {
    const archive = new ZipArchive(new Uint8Array(readFileSync(new URL("python-3.14.zip", PUBLIC))));
    python = { archive, module: archive.read("python.wasm").then((bytes) => WebAssembly.compile(bytes)) };
  }
  return python;
}

const programs = [
  wasiProgram({ name: "lua", load: load("lua.wasm"), spawn: spawnNodeWorker }),
  wasiProgram({ name: "kilo", load: load("kilo.wasm"), spawn: spawnNodeWorker }),
  wasiProgram({ name: "sqlite3", load: load("sqlite3.wasm"), spawn: spawnNodeWorker }),
  bundledPrograms({ baseUrl: "unused/", spawn: spawnNodeWorker }).find((p) => p.name === "wasm")!,
  wasiProgram({
    name: "python3",
    load: () => pythonBundle().module,
    env: { PYTHONHOME: "/usr/local", PYTHONDONTWRITEBYTECODE: "1" },
    prepare: (fs) => mountPython(fs, pythonBundle().archive),
    arguments: pythonArguments,
    spawn: spawnNodeWorker,
  }),
];

function visible(screen: TerminalScreen): string[] {
  return screen.frame().rows.map((r) => r.cells.map((c) => c.text || " ").join("").trimEnd());
}

async function rig() {
  const kernel = await kernelRig();
  const screen = createTerminalScreen({ size: { cols: 60, rows: 12 } });
  const pty = new Pty();
  pty.master.onOutput((data) => void screen.write(data));
  screen.onInput((data) => pty.master.write(data));
  pty.master.resize(screen.size);
  const runner = new BashRunner({ kernel: kernel.client, programs });
  const done = runShell(pty.slave, runner, { exitCommand: exitBuiltin });
  const until = async (predicate: (lines: string[]) => boolean, ms = 20000) => {
    const start = Date.now();
    while (!predicate(visible(screen))) {
      if (Date.now() - start > ms) throw new Error(`Timed out; the screen shows:\n${visible(screen).join("\n")}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { ...kernel, screen, runner, done, until, type: (s: string) => screen.input(s) };
}

describe("WebAssembly programs", () => {
  it("runs Lua in a pipeline and on the terminal", async () => {
    const { runner, until, type, screen } = await rig();
    const piped = await runner.session.exec("echo 'print(6*7)' | lua -");
    expect(piped).toMatchObject({ stdout: "42\n", exitCode: 0 });
    await until((l) => l[0] === "~ $");
    type("lua\r");
    await until((l) => l.some((x) => x === ">"));
    type("print(string.rep('ab', 3))\r");
    await until((l) => l.includes("ababab"));
    type("\x04");
    await until((l) => l[l.findLastIndex((x) => x !== "")] === "~ $");
    expect(visible(screen)[0]).toBe("~ $ lua");
  }, 30000);

  it("lets Lua read and write files on the disk", async () => {
    const { runner, fs } = await rig();
    const script = "local f = io.open('notes.txt', 'w'); f:write('from lua\\n'); f:close(); for l in io.lines('notes.txt') do print(l:upper()) end";
    expect(await runner.session.exec(`lua -e "${script}"`)).toMatchObject({ stdout: "FROM LUA\n", exitCode: 0 });
    const volume = fs.locate("volume")!;
    expect(await fs.readText(fs.child(volume.id, "notes.txt")!.id)).toBe("from lua\n");
  }, 30000);

  it("interrupts a program with ⌃C", async () => {
    const { until, type, screen } = await rig();
    await until((l) => l[0] === "~ $");
    type("lua -e 'while true do end'\r");
    await new Promise((r) => setTimeout(r, 300));
    type("\x03");
    await until((l) => l.includes("~ $"));
    type("echo $?\r");
    await until((l) => l.includes("130"));
    expect(visible(screen).slice(0, 2)).toEqual(["~ $ lua -e 'while true do end'", "^C"]);
  }, 30000);

  it("edits a file full-screen with kilo in raw mode", async () => {
    const { until, type, fs, screen } = await rig();
    await until((l) => l[0] === "~ $");
    type("kilo hello.txt\r");
    await until((l) => l.some((x) => x.includes("HELP: Ctrl-S = save")));
    type("Hello, Macintosh");
    await until((l) => l[0]!.startsWith("Hello, Macintosh"));
    type("\x13");
    await until((l) => l.some((x) => x.includes("bytes written on disk")));
    type("\x11");
    // kilo leaves its last screen up, as it does anywhere; the prompt follows the cursor.
    await until((l) => l[0]!.endsWith("~ $"));
    const volume = fs.locate("volume")!;
    expect(await fs.readText(fs.child(volume.id, "hello.txt")!.id)).toBe("Hello, Macintosh\n");
    expect(screen.frame().alternate).toBe(false);
  }, 30000);

  it("keeps a SQLite database on the disk", async () => {
    const { runner } = await rig();
    expect(await runner.session.exec("sqlite3 shop.db 'create table fruit(name, price); insert into fruit values (\"apple\", 3), (\"pear\", 4);'")).toMatchObject({ exitCode: 0 });
    expect(await runner.session.exec("echo 'select sum(price) from fruit;' | sqlite3 shop.db")).toMatchObject({ stdout: "7\n", exitCode: 0 });
  }, 30000);

  it("runs Python with its standard library", async () => {
    const { runner } = await rig();
    const result = await runner.session.exec("echo 'import json, textwrap; print(json.dumps({\"n\": 2**10}))' | python3");
    expect(result, result.stderr).toMatchObject({ stdout: '{"n": 1024}\n', exitCode: 0 });
  }, 60000);

  it("runs Python scripts by relative path from the shell's directory", async () => {
    const { runner } = await rig();
    await runner.session.exec("mkdir -p work && cd work");
    await runner.session.exec("echo hello > data.txt; echo 'import os; print(open(\"data.txt\").read().strip().upper(), os.getcwd())' > shout.py");
    const run = await runner.session.exec("python3 shout.py");
    expect(run, run.stderr).toMatchObject({ stdout: "HELLO /disk/work\n", exitCode: 0 });
  }, 60000);

  it("runs any WASI program from the disk with wasm", async () => {
    const { runner, client } = await rig();
    await client.invoke("write_bytes", { path: "/disk/my-lua.wasm", bytes: Array.from(readFileSync(new URL("lua.wasm", PUBLIC))) });
    expect(await runner.session.exec("wasm my-lua.wasm -e 'print(math.max(3, 9))'")).toMatchObject({ stdout: "9\n", exitCode: 0 });
    expect(await runner.session.exec("wasm missing.wasm")).toMatchObject({ exitCode: 1 });
  }, 30000);
});
