import { describe, expect, it } from "vitest";
import { createTerminalScreen, LineEditor, type Completion, type TerminalScreen } from "../src/index";

function rig(cols = 20, complete?: (line: string, cursor: number) => Completion | null) {
  const screen = createTerminalScreen({ size: { cols, rows: 6 } });
  const pending: Promise<void>[] = [];
  const editor = new LineEditor({
    write: (text) => void pending.push(screen.write(text)),
    cols: () => screen.size.cols,
    complete,
  });
  const settle = async () => {
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(pending);
  };
  return { screen, editor, settle };
}

function visible(screen: TerminalScreen): string[] {
  return screen.frame().rows.map((r) => r.cells.map((c) => c.text || " ").join("").trimEnd());
}

describe("LineEditor", () => {
  it("echoes, edits in the middle and returns the line", async () => {
    const { screen, editor, settle } = rig();
    const read = editor.read("$ ");
    editor.feed("helo");
    editor.feed("\x1b[D");
    editor.feed("l");
    editor.feed("\x05!\r");
    expect(await read).toEqual({ kind: "line", line: "hello!" });
    await settle();
    expect(visible(screen)[0]).toBe("$ hello!");
    expect(screen.frame().cursor).toMatchObject({ x: 0, y: 1 });
  });

  it("kills and yanks words and lines", async () => {
    const { editor } = rig();
    const read = editor.read("> ");
    editor.feed("one two three\x17\x17x\x19\x01\x0b\x19\r");
    expect(await read).toEqual({ kind: "line", line: "one xtwo " });
  });

  it("walks history and keeps the draft", async () => {
    const { editor } = rig();
    let r = editor.read("$ ");
    editor.feed("first\r");
    await r;
    r = editor.read("$ ");
    editor.feed("second\r");
    await r;
    r = editor.read("$ ");
    editor.feed("dra\x1b[A\x1b[A\x1b[B\x1b[B\r");
    expect(await r).toEqual({ kind: "line", line: "dra" });
    r = editor.read("$ ");
    editor.feed("\x10\x10\r");
    expect(await r).toEqual({ kind: "line", line: "second" });
  });

  it("reports ⌃C and ⌃D", async () => {
    const { editor } = rig();
    let r = editor.read("$ ");
    editor.feed("abc\x03");
    expect(await r).toEqual({ kind: "interrupt" });
    r = editor.read("$ ");
    editor.feed("\x04");
    expect(await r).toEqual({ kind: "eof" });
  });

  it("keeps typed-ahead keys for the next read", async () => {
    const { editor } = rig();
    editor.feed("later\r");
    expect(await editor.read("$ ")).toEqual({ kind: "line", line: "later" });
  });

  it("runs pasted lines one by one", async () => {
    const { editor } = rig();
    editor.feed("\x1b[200~one\ntwo\x1b[201~\r");
    expect(await editor.read("$ ")).toEqual({ kind: "line", line: "one" });
    expect(await editor.read("$ ")).toEqual({ kind: "line", line: "two" });
  });

  it("edits a line that wraps past the right edge", async () => {
    const { screen, editor, settle } = rig(10);
    const read = editor.read("$ ");
    editor.feed("abcdefghijkl");
    editor.feed("\x01X");
    await settle();
    expect(visible(screen).slice(0, 2)).toEqual(["$ Xabcdefg", "hijkl"]);
    expect(screen.frame().cursor).toMatchObject({ x: 3, y: 0 });
    editor.feed("\x05");
    await settle();
    expect(screen.frame().cursor).toMatchObject({ x: 5, y: 1 });
    editor.feed("\r");
    expect(await read).toEqual({ kind: "line", line: "Xabcdefghijkl" });
  });

  it("wraps exactly at the edge", async () => {
    const { screen, editor, settle } = rig(10);
    void editor.read("$ ");
    editor.feed("abcdefgh");
    editor.feed("\x1b[D\x1b[C");
    await settle();
    expect(screen.frame().cursor).toMatchObject({ x: 0, y: 1 });
  });

  it("completes the common prefix and lists candidates on a second Tab", async () => {
    const { screen, editor, settle } = rig(30, (line, cursor) => {
      const start = line.lastIndexOf(" ", cursor - 1) + 1;
      return { start, candidates: ["Applications/", "Apple Menu Items/"] };
    });
    const read = editor.read("$ ");
    editor.feed("ls A");
    editor.feed("\t");
    await settle();
    expect(visible(screen)[0]).toBe("$ ls Appl");
    editor.feed("\t");
    await settle();
    expect(visible(screen).slice(0, 4)).toEqual(["$ ls Appl", "Applications/", "Apple Menu Items/", "$ ls Appl"]);
    editor.feed("\r");
    expect(await read).toEqual({ kind: "line", line: "ls Appl" });
  });

  it("searches history backwards with ⌃R", async () => {
    const { editor } = rig(40);
    for (const line of ["make build", "ls", "make test"]) {
      const r = editor.read("$ ");
      editor.feed(line + "\r");
      await r;
    }
    const r = editor.read("$ ");
    editor.feed("\x12mak\x12");
    editor.feed("\r");
    expect(await r).toEqual({ kind: "line", line: "make build" });
  });
});
