import { describe, expect, it } from "vitest";
import {
  createTerminalScreen, encodeKey, encodePaste, encodeMouse, monochromeStyle, paletteRgb, SelectionModel,
  proceduralGlyph, CELL_WIDTH, CELL_HEIGHT, stringWidth, columns,
} from "../src/index";

const none = { shift: false, ctrl: false, alt: false, meta: false };
const normal = { applicationCursorKeys: false };

function art(p: Uint8Array): string[] {
  const rows: string[] = [];
  for (let y = 0; y < CELL_HEIGHT; y++) {
    let row = "";
    for (let x = 0; x < CELL_WIDTH; x++) row += p[y * CELL_WIDTH + x] ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

describe("encodeKey", () => {
  it.each([
    ["Enter", none, "\r"],
    ["Backspace", none, "\x7f"],
    ["Tab", none, "\t"],
    ["Tab", { ...none, shift: true }, "\x1b[Z"],
    ["Escape", none, "\x1b"],
    ["ArrowUp", none, "\x1b[A"],
    ["ArrowLeft", { ...none, ctrl: true }, "\x1b[1;5D"],
    ["ArrowRight", { ...none, alt: true }, "\x1b[1;3C"],
    ["Home", none, "\x1b[H"],
    ["Delete", none, "\x1b[3~"],
    ["PageDown", { ...none, shift: true }, "\x1b[6;2~"],
    ["F1", none, "\x1bOP"],
    ["F5", none, "\x1b[15~"],
    ["F12", { ...none, ctrl: true }, "\x1b[24;5~"],
    ["c", { ...none, ctrl: true }, "\x03"],
    ["C", { ...none, ctrl: true, shift: true }, "\x03"],
    ["[", { ...none, ctrl: true }, "\x1b"],
    [" ", { ...none, ctrl: true }, "\x00"],
    ["c", { ...none, ctrl: true, alt: true }, "\x1b\x03"],
  ] as const)("%s %o → %j", (key, mods, bytes) => {
    expect(encodeKey(key, mods, normal)).toBe(bytes);
  });

  it("uses SS3 for cursor keys in application mode", () => {
    expect(encodeKey("ArrowDown", none, { applicationCursorKeys: true })).toBe("\x1bOB");
  });

  it("sends nothing for plain characters, ⌘-keys and modifiers", () => {
    expect(encodeKey("a", none, normal)).toBeNull();
    expect(encodeKey("c", { ...none, meta: true }, normal)).toBeNull();
    expect(encodeKey("Shift", none, normal)).toBeNull();
  });
});

describe("paste and mouse", () => {
  it("brackets a paste when asked and turns newlines into returns", () => {
    expect(encodePaste("a\nb", false)).toBe("a\rb");
    expect(encodePaste("a\nb", true)).toBe("\x1b[200~a\rb\x1b[201~");
    expect(encodePaste("x\x1b[201~y", true)).toBe("\x1b[200~xy\x1b[201~");
  });

  it("encodes SGR and X10 mouse reports", () => {
    expect(encodeMouse("press", 0, 4, 2, none)).toBe("\x1b[<0;5;3M");
    expect(encodeMouse("release", 0, 4, 2, none)).toBe("\x1b[<0;5;3m");
    expect(encodeMouse("wheel-up", 0, 0, 0, none)).toBe("\x1b[<64;1;1M");
    expect(encodeMouse("press", 0, 4, 2, none, false)).toBe("\x1b[M %#");
    expect(encodeMouse("release", 0, 4, 2, none, false)).toBe("\x1b[M#%#");
  });
});

describe("monochromeStyle", () => {
  const d = { mode: "default" } as const;
  const p = (index: number) => ({ mode: "palette", index }) as const;
  const rgb = (value: number) => ({ mode: "rgb", value }) as const;

  it.each([
    ["default", d, d, {}, { ink: "black", paper: "white", dim: false }],
    ["red text", p(1), d, {}, { ink: "black", paper: "white", dim: false }],
    ["grey 240 text", p(240), d, {}, { ink: "black", paper: "white", dim: true }],
    ["grey 245 text", p(245), d, {}, { ink: "black", paper: "white", dim: true }],
    ["bright black text", p(8), d, {}, { dim: true }],
    ["near-white text", p(255), d, {}, { dim: false }],
    ["faint", d, d, { dim: true }, { dim: true }],
    ["dark tint behind a row", d, p(236), {}, { paper: "light", ink: "black" }],
    ["black background", d, rgb(0x000000), {}, { paper: "white" }],
    ["white status bar", p(0), p(7), {}, { paper: "black", ink: "white" }],
    ["blue status bar", d, p(4), {}, { paper: "black", ink: "white" }],
    ["inverse", d, d, { inverse: true }, { paper: "black", ink: "white" }],
    ["inverse status bar", d, p(7), { inverse: true }, { paper: "white", ink: "black" }],
  ] as const)("%s", (_, fg, bg, attrs, expected) => {
    expect(monochromeStyle(fg, bg, attrs)).toMatchObject(expected);
  });

  it("knows the 256-colour palette", () => {
    expect(paletteRgb(1)).toBe(0xcd0000);
    expect(paletteRgb(16)).toBe(0x000000);
    expect(paletteRgb(231)).toBe(0xffffff);
    expect(paletteRgb(232)).toBe(0x080808);
    expect(paletteRgb(255)).toBe(0xeeeeee);
  });
});

describe("TerminalScreen", () => {
  it("draws text and moves the cursor", async () => {
    const screen = createTerminalScreen({ size: { cols: 20, rows: 4 } });
    await screen.write("hello\r\n\x1b[1mbold\x1b[0m");
    const frame = screen.frame();
    expect(frame.rows[0]!.cells.map((c) => c.text || " ").join("").trimEnd()).toBe("hello");
    expect(frame.rows[1]!.cells[0]!.style.bold).toBe(true);
    expect(frame.cursor).toEqual({ x: 4, y: 1, visible: true });
    screen.dispose();
  });

  it("answers a cursor position query on its input", async () => {
    const screen = createTerminalScreen({ size: { cols: 20, rows: 4 } });
    const replies: string[] = [];
    screen.onInput((data) => replies.push(data));
    await screen.write("ab\x1b[6n");
    expect(replies.join("")).toBe("\x1b[1;3R");
    screen.dispose();
  });

  it("tracks modes and the hidden cursor", async () => {
    const screen = createTerminalScreen({ size: { cols: 20, rows: 4 } });
    await screen.write("\x1b[?2004h\x1b[?1h\x1b[?25l\x1b[?1002h\x1b[?1006h");
    expect(screen.modes).toMatchObject({
      bracketedPaste: true, applicationCursorKeys: true, cursorVisible: false, mouseTracking: "drag", sgrMouse: true,
    });
    await screen.write("\x1b[?25h");
    expect(screen.frame().cursor?.visible).toBe(true);
    screen.dispose();
  });

  it("reports titles and keeps scrollback", async () => {
    const screen = createTerminalScreen({ size: { cols: 10, rows: 2 } });
    const titles: string[] = [];
    screen.onTitle((t) => titles.push(t));
    await screen.write("\x1b]2;Hello\x07a\r\nb\r\nc\r\nd");
    expect(titles).toEqual(["Hello"]);
    const frame = screen.frame();
    expect(frame.length).toBe(4);
    expect(frame.bottom).toBe(2);
    screen.scrollBy(-2);
    expect(screen.frame().viewportTop).toBe(0);
    expect(screen.text({ line: 0, col: 0 }, { line: 1, col: 10 })).toBe("a\nb");
    screen.dispose();
  });

  it("joins soft-wrapped lines when copying", async () => {
    const screen = createTerminalScreen({ size: { cols: 4, rows: 3 } });
    await screen.write("abcdef");
    expect(screen.text({ line: 0, col: 0 }, { line: 1, col: 4 })).toBe("abcdef");
    screen.dispose();
  });
});

describe("SelectionModel", () => {
  const lines = ["ls -la /disk/Applications", "second line"];
  const model = () => new SelectionModel((i) => lines[i] ?? "", () => 30);

  it("selects by cell, word and line", () => {
    const m = model();
    m.start({ line: 0, col: 3 });
    m.extend({ line: 0, col: 6 });
    expect(m.range()).toEqual({ from: { line: 0, col: 3 }, to: { line: 0, col: 6 } });
    m.start({ line: 0, col: 10 }, "word");
    expect(m.range()).toEqual({ from: { line: 0, col: 7 }, to: { line: 0, col: 25 } });
    m.start({ line: 1, col: 2 }, "line");
    expect(m.range()).toEqual({ from: { line: 1, col: 0 }, to: { line: 1, col: 30 } });
  });

  it("extends backwards from a word", () => {
    const m = model();
    m.start({ line: 1, col: 8 }, "word");
    m.extend({ line: 0, col: 1 });
    expect(m.range()).toEqual({ from: { line: 0, col: 0 }, to: { line: 1, col: 11 } });
    expect(m.contains(0, 5)).toBe(true);
    expect(m.contains(1, 11)).toBe(false);
  });
});

describe("procedural glyphs", () => {
  it("joins box drawing at the cell edges", () => {
    expect(art(proceduralGlyph(0x250c)!)).toEqual([
      "......", "......", "......", "......", "......", "..####", "..#...", "..#...", "..#...", "..#...", "..#...",
    ]);
    expect(art(proceduralGlyph(0x2554)!)).toEqual([
      "......", "......", "......", "......", ".#####", ".#....", ".#.###", ".#.#..", ".#.#..", ".#.#..", ".#.#..",
    ]);
    expect(art(proceduralGlyph(0x2503)!)[0]).toBe("..##..");
  });

  it("draws Braille dots and leaves the font its letters", () => {
    expect(proceduralGlyph(0x28ff)!.reduce((a, b) => a + b, 0)).toBe(8);
    expect(proceduralGlyph(0x41)).toBeNull();
  });

  it("tiles shades by screen position", () => {
    const a = proceduralGlyph(0x2592, 0, 0)!, b = proceduralGlyph(0x2592, 0, 11)!;
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("widths", () => {
  it("counts wide and zero-width characters and skips escapes", () => {
    expect(stringWidth("abc")).toBe(3);
    expect(stringWidth("日本")).toBe(4);
    expect(stringWidth("é")).toBe(1);
    expect(stringWidth("\x1b[1mhi\x1b[0m")).toBe(2);
  });

  it("lays names out in columns", () => {
    expect(columns(["a", "bb", "ccc", "d"], 12)).toBe("a    ccc\r\nbb   d\r\n");
  });
});
