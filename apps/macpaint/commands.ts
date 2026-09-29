/**
 * Menus, keys and the main event loop. MacPaint.p `MenuCommand`,
 * `CheckMenus`, `CommandChar`, `ProcessTheEvent`, `InitOnce` and the main
 * program. The menubar itself is the host's: `menuModel` answers what
 * `CheckMenus` and `CheckItem` would have set, and a chosen item comes
 * back as a mouse-down in the menubar carrying `MenuSelect`'s result.
 */

import { FillRect, InsetRect, SetPort, TextFace, TextFont, TextSize, type Rect } from "@mockintosh/quickdraw";
import {
  acceptEdits,
  altToScrn,
  cursorNormal,
  invertCaret,
  killEdges,
  killMask,
  killStuff,
  setLineSize,
  setPinRect,
  setupText,
  undo,
  updateText,
} from "./buffers";
import { copyRect, gray, nearPt, pinPt, ptInRect, rect, sectRect, equalRect } from "./bits";
import { chooseBrush, editPat, showPage, showPicture, symmetry } from "./dialogs";
import {
  closeMyWind,
  finderOpen,
  newDoc,
  newDocInit,
  openDoc,
  openFirstDoc,
  printDoc,
  quitProgram,
  revertDoc,
  saveDoc,
  TITLE_STRING,
} from "./document";
import { clearSel, cutOrCopy, fillSel, hFlip, invertSel, paste, rotate, traceEdges, vFlip } from "./edits";
import { chooseLine, choosePat, chooseTool, drawDesk, setToolCursor } from "./palette";
import {
  AIDS_ITEM,
  AIDS_MENU,
  BRUSH_TOOL,
  EDIT_ITEM,
  EDIT_MENU,
  FILE_ITEM,
  FILE_MENU,
  FONT_MENU,
  FONT_SIZES,
  SIZE_MENU,
  STYLE_ITEM,
  STYLE_MENU,
  type Paint,
  type PaintFileRef,
} from "./state";
import { editDoc, textChar, trackCursor } from "./tools";
import { DOUBLE_TIME, tick, type Co } from "./toolbox";

// ---------------------------------------------------------------------------
// The menus
// ---------------------------------------------------------------------------

export interface PaintMenuItem {
  label: string;
  /** ⌘ key equivalent. */
  shortcut?: string;
  enabled: boolean;
  checked: boolean;
}

/** One menu: `null` items are the dimmed `(-` lines. */
export interface PaintMenu {
  id: number;
  title: string;
  items: (PaintMenuItem | null)[];
}

function item(label: string, enabled: boolean, checked = false, shortcut?: string): PaintMenuItem {
  return shortcut ? { label, shortcut, enabled, checked } : { label, enabled, checked };
}

function fontLabel(name: string): string {
  return name.replace(/(^|[\s-])\w/g, (c) => c.toUpperCase());
}

/** The menubar as `CheckMenus` and the `CheckItem` calls leave it. */
export function menuModel(p: Paint): PaintMenu[] {
  const live = p.dialogDepth === 0;
  const on = (enabled: boolean): boolean => live && enabled;
  const selOrMask = p.selFlag || p.maskFlag;
  const textOk = p.txScrap !== null || !selOrMask;
  const w = p.windOpen;
  const face = p.myWind.port.txFace;
  const allEdit = !p.active;

  return [
    {
      id: FILE_MENU,
      title: "File",
      items: [
        item("New", on(!w)),
        item("Open...", on(!w)),
        item("Close", on(w)),
        item("Save", on(w)),
        item("Save As...", on(w)),
        item("Revert", on(w)),
        item("Print Draft", on(w)),
        item("Print Final", on(w)),
        item("Print Catalog", on(true)),
        item("Quit", on(true)),
      ],
    },
    {
      id: EDIT_MENU,
      title: "Edit",
      items: [
        item("Undo", on(w || allEdit), false, "Z"),
        null,
        item("Cut", on(selOrMask || allEdit), false, "X"),
        item("Copy", on(selOrMask || allEdit), false, "C"),
        item("Paste", on(w || allEdit), false, "V"),
        item("Clear", on(selOrMask || allEdit)),
        null,
        item("Invert", on(selOrMask)),
        item("Fill", on(selOrMask)),
        item("Trace Edges", on(p.selFlag), false, "E"),
        item("Flip Horizontal", on(p.selFlag)),
        item("Flip Vertical", on(p.selFlag)),
        item("Rotate", on(p.selFlag)),
      ],
    },
    {
      id: AIDS_MENU,
      title: "Goodies",
      items: [
        item("Grid", on(true), p.gridOn),
        item("FatBits", on(true), p.fatFlag),
        item("Show Page", on(w)),
        item("Edit Pattern", on(true)),
        item("Brush Shape", on(true)),
        item("Brush Mirrors", on(true), p.symByte !== 0x80),
        item("Introduction", on(w)),
        item("Short Cuts", on(w)),
      ],
    },
    {
      id: FONT_MENU,
      title: "Font",
      items: p.fonts.map((name, i) => item(fontLabel(name), on(textOk), p.theFont === i + 1)),
    },
    {
      id: SIZE_MENU,
      title: "FontSize",
      items: FONT_SIZES.map((size, i) => item(i === 0 ? `${size} point` : String(size), on(textOk), p.theFontSize === i + 1)),
    },
    {
      id: STYLE_MENU,
      title: "Style",
      items: [
        item("Plain", on(textOk), face === 0, "P"),
        item("Bold", on(textOk), (face & 1) !== 0, "B"),
        item("Italic", on(textOk), (face & 2) !== 0, "I"),
        item("Underline", on(textOk), (face & 4) !== 0, "U"),
        item("Outline", on(textOk), (face & 8) !== 0, "O"),
        item("Shadow", on(textOk), (face & 16) !== 0, "S"),
        null,
        item("Align Left", on(textOk), p.txJustItem === STYLE_ITEM.left, "L"),
        item("Align Middle", on(textOk), p.txJustItem === STYLE_ITEM.center, "M"),
        item("Align Right", on(textOk), p.txJustItem === STYLE_ITEM.right, "R"),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// MenuCommand
// ---------------------------------------------------------------------------

function* fileCommand(p: Paint, theItem: number): Co {
  killStuff(p);
  acceptEdits(p);
  p.hiResFlag = theItem === FILE_ITEM.prFinal;
  switch (theItem) {
    case FILE_ITEM.new:
      yield* newDoc(p);
      break;
    case FILE_ITEM.open:
      yield* openDoc(p);
      break;
    case FILE_ITEM.close:
      yield* closeMyWind(p);
      break;
    case FILE_ITEM.save:
      yield* saveDoc(p, false);
      break;
    case FILE_ITEM.saveAs:
      yield* saveDoc(p, true);
      break;
    case FILE_ITEM.revert:
      yield* revertDoc(p);
      break;
    case FILE_ITEM.prDraft:
    case FILE_ITEM.prFinal:
      yield* printDoc(p);
      break;
    case FILE_ITEM.prCat:
      p.host.beep();
      break;
    case FILE_ITEM.quit:
      p.quitFlag = true;
      break;
  }
}

function* editCommand(p: Paint, theItem: number): Co {
  if (p.active && theItem !== EDIT_ITEM.copy) {
    p.workDirty = true;
    p.docDirty = true;
  }
  switch (theItem) {
    case EDIT_ITEM.undo:
      undo(p);
      break;
    case EDIT_ITEM.clear:
      clearSel(p);
      break;
    case EDIT_ITEM.copy:
      yield* cutOrCopy(p, false);
      break;
    case EDIT_ITEM.cut:
      yield* cutOrCopy(p, true);
      break;
    case EDIT_ITEM.paste:
      yield* paste(p);
      break;
    case EDIT_ITEM.invert:
      invertSel(p);
      break;
    case EDIT_ITEM.fill:
      fillSel(p);
      break;
    case EDIT_ITEM.edges:
      traceEdges(p);
      break;
    case EDIT_ITEM.hFlip:
      hFlip(p);
      break;
    case EDIT_ITEM.vFlip:
      vFlip(p);
      break;
    case EDIT_ITEM.rotate:
      rotate(p);
      break;
  }
}

function toggleFatBits(p: Paint): void {
  acceptEdits(p);
  p.fatFlag = !p.fatFlag;
  if (p.fatFlag) {
    if (p.maskFlag || p.selFlag) {
      p.fatCenter = { h: (p.selRect.left + p.selRect.right) >> 1, v: (p.selRect.top + p.selRect.bottom) >> 1 };
    }
    const r: Rect = copyRect(p.myWind.port.portRect);
    InsetRect(r, 26, 15);
    p.fatCenter = pinPt(p.fatCenter, r);
    const c = p.fatCenter;
    p.fatBits.bounds = rect(c.h - 26, c.v - 15, c.h + 26, c.v + 15);
    if (!equalRect(p.selRect, sectRect(p.selRect, p.fatBits.bounds))) {
      killStuff(p);
      p.oldSelFlag = false;
    }
  }
  altToScrn(p);
}

function* aidsCommand(p: Paint, theItem: number): Co {
  switch (theItem) {
    case AIDS_ITEM.grid:
      p.gridOn = !p.gridOn;
      updateText(p);
      break;
    case AIDS_ITEM.fat:
      toggleFatBits(p);
      break;
    case AIDS_ITEM.page:
      killStuff(p);
      yield* showPage(p);
      break;
    case AIDS_ITEM.brush:
      killStuff(p);
      yield* chooseBrush(p);
      break;
    case AIDS_ITEM.patEd:
      killStuff(p);
      yield* editPat(p);
      break;
    case AIDS_ITEM.sym:
      killStuff(p);
      yield* symmetry(p);
      break;
    case AIDS_ITEM.intro:
      yield* showPicture(p, "intro");
      break;
    case AIDS_ITEM.short:
      yield* showPicture(p, "short");
      break;
  }
}

function chooseFont(p: Paint, theItem: number): void {
  killMask(p);
  p.theFont = theItem;
  p.theFontID = p.host.fontNumber(p.fonts[theItem - 1] ?? p.host.applicationFont());
  TextFont(p.theFontID);
  TextSize(FONT_SIZES[p.theFontSize - 1]!);
  setupText(p);
  updateText(p);
}

function chooseSize(p: Paint, theItem: number): void {
  killMask(p);
  p.theFontSize = theItem;
  TextSize(FONT_SIZES[theItem - 1]!);
  setupText(p);
  updateText(p);
}

function chooseStyle(p: Paint, theItem: number): void {
  if (theItem < 7) {
    const face = theItem === STYLE_ITEM.plain ? 0 : p.myWind.port.txFace ^ (1 << (theItem - 2));
    TextFace(face);
    setupText(p);
    updateText(p);
  } else {
    p.txJustItem = theItem;
    p.textJust = theItem === STYLE_ITEM.center ? "center" : theItem === STYLE_ITEM.right ? "right" : "left";
    updateText(p);
  }
}

export function* menuCommand(p: Paint, theMenu: number, theItem: number): Co {
  if (theItem <= 0) return;
  SetPort(p.myWind.port);
  switch (theMenu) {
    case FILE_MENU:
      yield* fileCommand(p, theItem);
      break;
    case EDIT_MENU:
      yield* editCommand(p, theItem);
      break;
    case AIDS_MENU:
      yield* aidsCommand(p, theItem);
      break;
    case FONT_MENU:
      chooseFont(p, theItem);
      break;
    case SIZE_MENU:
      chooseSize(p, theItem);
      break;
    case STYLE_MENU:
      chooseStyle(p, theItem);
      break;
  }
}

// ---------------------------------------------------------------------------
// Keys and events
// ---------------------------------------------------------------------------

/** `CommandChar`: ⌘, and ⌘. step the type size (with Shift, the font); the menubar has the rest. */
function* commandChar(p: Paint): Co {
  const textOk = p.txScrap !== null || !(p.selFlag || p.maskFlag);
  if (!textOk) return;
  const key = p.theKey;
  if (key === p.prevSizeChar || key === "<") {
    if (p.shiftFlag) {
      if (p.theFont > 1) yield* menuCommand(p, FONT_MENU, p.theFont - 1);
    } else if (p.theFontSize > 1) yield* menuCommand(p, SIZE_MENU, p.theFontSize - 1);
  } else if (key === p.nextSizeChar || key === ">") {
    if (p.shiftFlag) {
      if (p.theFont < p.fonts.length) yield* menuCommand(p, FONT_MENU, p.theFont + 1);
    } else if (p.theFontSize < FONT_SIZES.length) yield* menuCommand(p, SIZE_MENU, p.theFontSize + 1);
  }
}

function* mouseDown(p: Paint): Co {
  const event = p.theEvent!;
  let code: typeof event.part | null = event.part;

  if (event.when < p.clickTime + DOUBLE_TIME && nearPt(event.where, p.clickLoc, 4)) p.clickCount++;
  else p.clickCount = 1;
  if (p.killDouble && p.clickCount > 1) code = null;
  p.killDouble = false;
  if (p.skipDouble) p.clickCount = 1;
  p.skipDouble = p.clickCount > 1;

  SetPort((event.window ?? p.myWind).port);
  setPinRect(p, p.lineSize);

  switch (code) {
    case "inMenuBar":
      cursorNormal(p);
      yield* menuCommand(p, event.menu, event.item);
      p.quitFlag = event.menu === FILE_MENU && event.item === FILE_ITEM.quit;
      if (p.quitFlag) return;
      p.clickTime = p.tb.tickCount();
      p.clickLoc = { ...p.tb.mouse };
      p.skipDouble = true;
      break;
    case "inContent":
      if (!p.active) break;
      if (event.window === p.myWind) {
        if (p.fatFlag && event.where.h <= 80 + 52 + 3 && event.where.v <= 48 + 30 + 1) {
          yield* menuCommand(p, AIDS_MENU, AIDS_ITEM.fat);
        } else yield* editDoc(p);
        p.skipDouble = true;
      } else if (event.window === p.deskWind) {
        if (ptInRect(event.where, p.toolRect)) yield* chooseTool(p, event.where);
        if (ptInRect(event.where, p.lineRect)) chooseLine(p, event.where);
        if (ptInRect(event.where, p.patRect)) yield* choosePat(p, event.where);
      }
      break;
    case "inGoAway":
      if (p.active) yield* menuCommand(p, FILE_MENU, FILE_ITEM.close);
      break;
    default:
      break;
  }
}

export function* processTheEvent(p: Paint): Co {
  const event = p.theEvent!;
  p.shiftFlag = event.modifiers.shift;
  p.featureFlag = event.modifiers.command;
  p.optionFlag = event.modifiers.option;

  if (event.what !== "mouseUp") {
    if (p.caretState) invertCaret(p);
    killEdges(p);
  }

  switch (event.what) {
    case "mouseUp":
      p.clickTime = event.when;
      p.clickLoc = { ...event.where };
      break;
    case "mouseDown":
      yield* mouseDown(p);
      break;
    case "keyDown":
    case "autoKey":
      if (!p.active) break;
      SetPort(p.myWind.port);
      p.theKey = event.key;
      if (p.featureFlag) {
        yield* commandChar(p);
        break;
      }
      if (p.theKey === "`" && !p.textFlag) {
        yield* menuCommand(p, EDIT_MENU, EDIT_ITEM.undo);
        break;
      }
      if (p.theKey === "\b" && !p.textFlag) {
        yield* menuCommand(p, EDIT_MENU, EDIT_ITEM.clear);
        break;
      }
      textChar(p);
      break;
    case "activateEvt":
      p.active = event.active;
      p.cursorFlag = true;
      if (!p.active) cursorNormal(p);
      break;
  }
}

// ---------------------------------------------------------------------------
// InitOnce and the main program
// ---------------------------------------------------------------------------

function* initOnce(p: Paint): Co {
  p.active = true;
  p.host.setDocTitle(TITLE_STRING);
  SetPort(p.deskWind.port);
  FillRect(p.deskWind.port.portRect, gray);
  p.theTool = BRUSH_TOOL;
  p.prevTool = p.theTool;
  p.toolGrid = false;
  p.theBrush = 7;
  p.borderFlag = true;
  setLineSize(p, 1);
  p.thePatIndex = 0;
  setToolCursor(p);
  drawDesk(p);

  p.fonts = p.host.fontNames();
  const appFont = p.host.applicationFont();
  p.theFont = Math.max(1, p.fonts.indexOf(appFont) + 1);
  p.theFontSize = 3;
  p.txJustItem = STYLE_ITEM.left;
  p.textJust = "left";
  yield* menuCommand(p, FONT_MENU, p.theFont);

  p.inWindow = false;
  p.inSel = false;
  p.fatScroll = false;
  p.cursorFlag = true;
  p.hiResFlag = true;
  p.rwShftDh = 0;
  p.rwShftDv = 0;
  cursorNormal(p);
}

/** The main program: `InitOnce`, the first document, then the event loop until Quit. */
export function* paintMain(p: Paint, firstFile: PaintFileRef | null): Co {
  yield* initOnce(p);
  newDocInit(p);
  yield* openFirstDoc(p, firstFile);
  if (!p.quitFlag) {
    for (;;) {
      if (p.active) trackCursor(p);
      if (p.pendingOpen) {
        const file = p.pendingOpen;
        p.pendingOpen = null;
        yield* finderOpen(p, file);
      }
      const event = p.tb.getNextEvent();
      if (event) {
        p.theEvent = event;
        yield* processTheEvent(p);
      } else yield* tick();
      if (p.quitFlag) {
        yield* quitProgram(p);
        if (p.quitFlag) break;
      }
    }
  }
  p.host.quit();
}
