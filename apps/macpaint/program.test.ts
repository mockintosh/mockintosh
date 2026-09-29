import { beforeEach, describe, expect, it } from "vitest";
import { installFontBridge } from "../../packages/ui/src/fonts/bridge";
import { fontFamilyId } from "../../packages/ui/src/fonts/strike";
import type { PaintDocument } from "@mockintosh/sdk";
import { pixelTrue, pt, rect } from "./bits";
import { PaintProgram } from "./program";
import {
  AIDS_ITEM,
  AIDS_MENU,
  EDIT_ITEM,
  EDIT_MENU,
  FILE_ITEM,
  FILE_MENU,
  PENCIL_TOOL,
  SELECT_TOOL,
  TEXT_TOOL,
  TOOL_LEFT,
  TOOL_SPACE,
  TOOL_TOP,
  type PaintFileRef,
  type PaintHost,
} from "./state";
import { NO_MODIFIERS, type MacWindow } from "./toolbox";
import type { Point } from "@mockintosh/quickdraw";

installFontBridge();

const FILLED_RECT_TOOL = 11;

interface Harness {
  program: PaintProgram;
  files: Map<string, PaintDocument>;
  opened: MacWindow[];
  advance(ms: number): void;
}

function boot(): Harness {
  let now = 10_000;
  const files = new Map<string, PaintDocument>();
  const opened: MacWindow[] = [];
  const dialogs = new Map<string, MacWindow>();
  let next = 0;
  const host: PaintHost = {
    openDialog(win) {
      const id = `d${next++}`;
      dialogs.set(id, win);
      opened.push(win);
      return id;
    },
    closeDialog(id) {
      const win = dialogs.get(id);
      dialogs.delete(id);
      if (win) opened.splice(opened.indexOf(win), 1);
    },
    showDocWindow() {},
    setDocTitle() {},
    beep() {},
    quit() {},
    alertDialog: async () => 1,
    systemFont: () => fontFamilyId("menu"),
    clipboardText: async () => null,
    heldModifiers: () => NO_MODIFIERS,
    getFile: async () => ({ id: "saved", name: "Saved" }),
    putFile: async () => "Saved",
    readDocument: async (file: PaintFileRef) => files.get(file.id) ?? null,
    async writeDocument(name, doc) {
      files.set("saved", doc);
      return { id: "saved", name };
    },
    printPage: async () => {},
    fontNames: () => ["chicago", "geneva", "newYork", "monaco", "venice", "london", "athens", "sanFrancisco", "toronto", "cairo", "losAngeles", "lisa", "pixel"],
    fontNumber: (name) => fontFamilyId(name),
    applicationFont: () => "geneva",
  };
  const program = new PaintProgram(host, () => now, rect(0, 0, 512, 342), null);
  return {
    program,
    files,
    opened,
    advance(ms) {
      now += ms;
    },
  };
}

async function settle(h: Harness, steps = 40): Promise<void> {
  for (let i = 0; i < steps; i++) {
    h.program.step();
    await Promise.resolve();
    h.advance(17);
  }
}

function toolCenter(tool: number): Point {
  const row = tool >> 1;
  return pt(tool & 1 ? TOOL_LEFT + 40 : TOOL_LEFT + 13, TOOL_TOP + row * TOOL_SPACE + 11);
}

function click(h: Harness, win: MacWindow, local: Point): void {
  h.program.mouseDown(win, local, NO_MODIFIERS);
  h.program.mouseUp(win, local, NO_MODIFIERS);
  h.advance(1000);
}

function drag(h: Harness, win: MacWindow, from: Point, to: Point, steps = 8): void {
  h.program.mouseDown(win, from, NO_MODIFIERS);
  for (let i = 1; i <= steps; i++) {
    h.advance(17);
    h.program.mouseMove(win, pt(from.h + ((to.h - from.h) * i) / steps, from.v + ((to.v - from.v) * i) / steps));
  }
  h.program.mouseUp(win, to, NO_MODIFIERS);
  h.advance(1000);
}

function chooseTool(h: Harness, tool: number): void {
  click(h, h.program.paint.deskWind, toolCenter(tool));
}

/** A pixel of the document window, in its local coordinates. */
function doc(h: Harness, x: number, y: number): boolean {
  return pixelTrue(x, y, h.program.paint.myWind.bits);
}

function blackIn(h: Harness, left: number, top: number, right: number, bottom: number): number {
  let n = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if (doc(h, x, y)) n++;
  return n;
}

describe("MacPaint", () => {
  let h: Harness;

  beforeEach(async () => {
    h = boot();
    await settle(h);
  });

  it("starts with the palettes on the desk and a blank untitled document", () => {
    const p = h.program.paint;
    expect(p.windOpen).toBe(true);
    expect(p.theTool).toBe(6);
    expect(blackIn(h, 0, 0, 416, 240)).toBe(0);
    let desk = 0;
    for (const byte of p.deskWind.bits.baseAddr) desk += byte;
    expect(desk).toBeGreaterThan(0);
    const titles = h.program.menus().map((m) => m.title);
    expect(titles).toEqual(["File", "Edit", "Goodies", "Font", "FontSize", "Style"]);
  });

  it("draws with the pencil and undoes it", async () => {
    chooseTool(h, PENCIL_TOOL);
    expect(h.program.paint.theTool).toBe(PENCIL_TOOL);
    drag(h, h.program.paint.myWind, pt(100, 100), pt(140, 100));
    await settle(h, 4);
    expect(doc(h, 120, 100)).toBe(true);
    h.program.menu(EDIT_MENU, EDIT_ITEM.undo);
    await settle(h, 4);
    expect(doc(h, 120, 100)).toBe(false);
  });

  it("paints a filled rectangle with its border", async () => {
    chooseTool(h, FILLED_RECT_TOOL);
    drag(h, h.program.paint.myWind, pt(50, 50), pt(90, 80));
    await settle(h, 4);
    expect(doc(h, 70, 65)).toBe(true);
    expect(doc(h, 50, 50)).toBe(true);
    expect(doc(h, 120, 120)).toBe(false);
  });

  it("cuts a selection and pastes it back", async () => {
    chooseTool(h, FILLED_RECT_TOOL);
    drag(h, h.program.paint.myWind, pt(50, 50), pt(90, 80));
    chooseTool(h, SELECT_TOOL);
    drag(h, h.program.paint.myWind, pt(40, 40), pt(100, 90));
    await settle(h, 4);
    expect(h.program.paint.selFlag).toBe(true);

    h.program.menu(EDIT_MENU, EDIT_ITEM.cut);
    await settle(h, 8);
    expect(blackIn(h, 45, 45, 95, 85)).toBe(0);
    expect(h.program.paint.scrap).not.toBeNull();

    h.program.menu(EDIT_MENU, EDIT_ITEM.paste);
    await settle(h, 8);
    expect(h.program.paint.selFlag).toBe(true);
    expect(blackIn(h, 0, 0, 416, 240)).toBeGreaterThan(40 * 30 * 0.9);
  });

  it("paints a whole patterned oval", async () => {
    const FILLED_OVAL_TOOL = 15;
    chooseTool(h, FILLED_OVAL_TOOL);
    click(h, h.program.paint.deskWind, pt(330, 308));
    expect(h.program.paint.thePatIndex).toBe(10);
    drag(h, h.program.paint.myWind, pt(250, 102), pt(380, 202), 16);
    await settle(h, 4);
    const quadrants = [
      blackIn(h, 260, 112, 315, 152),
      blackIn(h, 315, 112, 370, 152),
      blackIn(h, 260, 152, 315, 192),
      blackIn(h, 315, 152, 370, 192),
    ];
    for (const n of quadrants) expect(n).toBeGreaterThan(400);
    expect(blackIn(h, 240, 92, 250, 212)).toBe(0);
    expect(blackIn(h, 382, 92, 392, 212)).toBe(0);
  });

  it("types text on the baseline where the text tool clicks", async () => {
    chooseTool(h, TEXT_TOOL);
    click(h, h.program.paint.myWind, pt(30, 192));
    for (const ch of "Hello") h.program.keyDown(ch, NO_MODIFIERS);
    await settle(h, 6);
    const p = h.program.paint;
    expect(p.textFlag).toBe(true);
    expect(p.textLines).toEqual(["Hello"]);
    const top = 192 - p.info.ascent;
    const bottom = 192 + p.info.descent;
    expect(blackIn(h, 28, top, 100, bottom)).toBeGreaterThan(50);
    expect(blackIn(h, 0, 0, 416, top)).toBe(0);
    expect(blackIn(h, 0, bottom, 416, 240)).toBe(0);
  });

  it("toggles FatBits and checks it in the Goodies menu", async () => {
    chooseTool(h, PENCIL_TOOL);
    click(h, h.program.paint.myWind, pt(208, 120));
    h.program.menu(AIDS_MENU, AIDS_ITEM.fat);
    await settle(h, 4);
    expect(h.program.paint.fatFlag).toBe(true);
    const goodies = h.program.menus().find((m) => m.title === "Goodies")!;
    expect(goodies.items[1]?.checked).toBe(true);
    expect(blackIn(h, 0, 0, 416, 240)).toBeGreaterThan(16);
  });

  it("saves the page and opens it again", async () => {
    chooseTool(h, FILLED_RECT_TOOL);
    drag(h, h.program.paint.myWind, pt(10, 10), pt(30, 30));
    h.program.menu(FILE_MENU, FILE_ITEM.saveAs);
    await settle(h, 30);
    expect(h.files.has("saved")).toBe(true);
    expect(h.program.paint.docName).toBe("Saved");

    h.program.menu(FILE_MENU, FILE_ITEM.close);
    await settle(h, 10);
    expect(h.program.paint.windOpen).toBe(false);
    h.program.menu(FILE_MENU, FILE_ITEM.open);
    await settle(h, 30);
    expect(h.program.paint.windOpen).toBe(true);
    expect(doc(h, 20, 20)).toBe(true);
    expect(doc(h, 60, 60)).toBe(false);
  });

  it("shows the page in the window until OK", async () => {
    h.program.menu(AIDS_MENU, AIDS_ITEM.page);
    await settle(h, 30);
    expect(h.program.paint.dialogDepth).toBe(1);
    expect(h.program.menus().every((m) => m.items.every((item) => !item?.enabled))).toBe(true);
    expect(blackIn(h, 320, 172, 400, 190)).toBeGreaterThan(20);
    click(h, h.program.paint.myWind, pt(360, 181));
    await settle(h, 30);
    expect(h.program.paint.dialogDepth).toBe(0);
    expect(blackIn(h, 0, 0, 416, 240)).toBe(0);
  });

  it("opens Brush Shape as a dialog and closes it on a pick", async () => {
    h.program.menu(AIDS_MENU, AIDS_ITEM.brush);
    await settle(h, 10);
    expect(h.opened.length).toBe(1);
    const win = h.opened[0]!;
    click(h, win, pt(16 + 16, 16 + 16));
    await settle(h, 10);
    expect(h.opened.length).toBe(0);
    expect(h.program.paint.theBrush).toBe(0);
  });
});
