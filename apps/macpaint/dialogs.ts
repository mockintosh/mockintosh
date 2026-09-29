/**
 * MacPaint's dialogs, and the slice of the Dialog and Control Managers they
 * need. Templates are the DLOG/DITL resources of MacPaint.rsrc; each dialog
 * is a `dBoxProc` window whose pixels MacPaint draws itself.
 * MacPaint.p `ChooseBrush`, `EditPat`, `Symmetry`, `ShowPage`,
 * `ShowPicture`, `ShouldSave`, `MyAlert`.
 */

import {
  CopyBits,
  DrawChar,
  DrawString,
  EraseRect,
  EraseRoundRect,
  FillRect,
  FrameRect,
  FrameRoundRect,
  GetFontInfo,
  GetPixel,
  GetPort,
  HidePen,
  InvertRoundRect,
  Line,
  Move,
  MoveTo,
  PaintRect,
  PenMode,
  PenNormal,
  PenPat,
  PenSize,
  SetOrigin,
  SetPort,
  SetPortBits,
  ShowPen,
  StringWidth,
  TextFace,
  TextFont,
  TextSize,
  ClipRect,
  bold,
  patXor,
  srcCopy,
  type BitMap,
  type FontInfo,
  type GrafPort,
  type Pattern,
  type Point,
  type Rect,
} from "@mockintosh/quickdraw";
import type { Sprite } from "@mockintosh/sdk";
import { BILL_ICON } from "./art";
import { mapSym } from "./asm";
import {
  acceptEdits,
  allocMask,
  altToScrn,
  constrain,
  cursorNormal,
  hvConstrain,
  initConstrain,
  killMask,
  killStuff,
  mainToAlt,
  maskToAlt,
  scrnToAlt,
} from "./buffers";
import { bufToBuf, copyRect, gray, insetRect, mapRect, offsetRect, pinWord, pt, ptInRect, rect, trunc8, white, div } from "./bits";
import { cycleWork, readWrite, setDocOrigin } from "./document";
import { drawPaintChar, drawPat, setToolCursor } from "./palette";
import { DOC_HEIGHT, DOC_WIDTH, newMacWindow, type Paint } from "./state";
import { awaitPromise, tick, type Co, type EventRecord, type MacWindow } from "./toolbox";
import { textBox } from "./textbox";

// ---------------------------------------------------------------------------
// Dialog Manager
// ---------------------------------------------------------------------------

export type DialogItem =
  | { kind: "button"; rect: Rect; title: string }
  | { kind: "statText"; rect: Rect; text: string }
  | { kind: "icon"; rect: Rect; icon: Sprite }
  | { kind: "user"; rect: Rect };

/** A DLOG and its DITL: the content rectangle in global coordinates and the items in window coordinates. */
export interface DialogTemplate {
  bounds: Rect;
  items: readonly DialogItem[];
}

export interface Dialog {
  win: MacWindow;
  items: readonly DialogItem[];
  handle: string;
}

/** DITL rectangles are written top, left, bottom, right. */
function tlbr(top: number, left: number, bottom: number, right: number): Rect {
  return rect(left, top, right, bottom);
}

function shouldSaveTemplate(question: string): DialogTemplate {
  return {
    bounds: tlbr(100, 150, 194, 394),
    items: [
      { kind: "button", rect: tlbr(38, 16, 56, 90), title: "Yes" },
      { kind: "button", rect: tlbr(62, 16, 80, 90), title: "No" },
      { kind: "button", rect: tlbr(62, 154, 80, 228), title: "Cancel" },
      { kind: "statText", rect: tlbr(12, 16, 28, 240), text: question },
    ],
  };
}

export const CLOSE_DLOG = shouldSaveTemplate("Save changes before closing?");
export const QUIT_DLOG = shouldSaveTemplate("Save changes before quitting?");

export const PAT_ED_DLOG: DialogTemplate = {
  bounds: tlbr(76, 116, 204, 292),
  items: [
    { kind: "button", rect: tlbr(94, 16, 112, 80), title: "OK" },
    { kind: "button", rect: tlbr(94, 96, 112, 160), title: "Cancel" },
    { kind: "user", rect: tlbr(16, 16, 80, 80) },
  ],
};

export const BRUSH_DLOG: DialogTemplate = {
  bounds: tlbr(74, 120, 234, 408),
  items: [{ kind: "user", rect: tlbr(16, 16, 144, 272) }],
};

export const SYM_DLOG: DialogTemplate = {
  bounds: tlbr(80, 116, 256, 292),
  items: [
    { kind: "button", rect: tlbr(144, 16, 160, 80), title: "OK" },
    { kind: "button", rect: tlbr(144, 96, 160, 160), title: "None" },
    { kind: "user", rect: tlbr(16, 32, 128, 144) },
  ],
};

export const PAINT_DLOG: DialogTemplate = {
  bounds: tlbr(84, 110, 178, 466),
  items: [
    { kind: "button", rect: tlbr(56, 274, 76, 345), title: "OK" },
    { kind: "statText", rect: tlbr(14, 6, 30, 340), text: "MacPaint version 1.3" },
    { kind: "statText", rect: tlbr(38, 6, 54, 340), text: "written by Bill Atkinson" },
    { kind: "statText", rect: tlbr(62, 6, 78, 340), text: "Copyright 1983, Apple Computer Inc." },
    { kind: "icon", rect: tlbr(16, 290, 48, 322), icon: BILL_ICON },
  ],
};

const BUTTON_CORNER = 16;

function useSystemFont(p: Paint): void {
  TextFont(p.host.systemFont());
  TextSize(0);
  TextFace(0);
}

/** A push button as the Control Manager draws it. */
export function drawButton(r: Rect, title: string): void {
  EraseRoundRect(r, BUTTON_CORNER, BUTTON_CORNER);
  FrameRoundRect(r, BUTTON_CORNER, BUTTON_CORNER);
  const info: FontInfo = { ascent: 0, descent: 0, widMax: 0, leading: 0 };
  GetFontInfo(info);
  const h = r.left + ((r.right - r.left - StringWidth(title)) >> 1);
  const v = r.top + ((r.bottom - r.top - info.ascent - info.descent) >> 1) + info.ascent;
  MoveTo(h, v);
  DrawString(title);
}

function invertButton(r: Rect): void {
  InvertRoundRect(insetRect(r, 1, 1), BUTTON_CORNER - 2, BUTTON_CORNER - 2);
}

function spriteBits(sprite: Sprite): BitMap {
  const rowBytes = ((sprite.width + 15) >> 4) << 1;
  const baseAddr = new Uint8Array(rowBytes * sprite.height);
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (sprite.data[y * sprite.width + x]) baseAddr[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { baseAddr, rowBytes, bounds: rect(0, 0, sprite.width, sprite.height) };
}

/** `DrawDialog`: the items of `items` into thePort; user items are the program's to draw. */
export function drawDialogItems(items: readonly DialogItem[]): void {
  for (const item of items) {
    if (item.kind === "button") drawButton(item.rect, item.title);
    else if (item.kind === "statText") textBox(item.text, item.rect, "left");
    else if (item.kind === "icon") {
      const port = GetPort();
      if (port) CopyBits(spriteBits(item.icon), port.portBits, rect(0, 0, 32, 32), item.rect, srcCopy, null);
    }
  }
}

/** The About box's contents, drawn into `port` — shown by the Apple menu's About item. */
export function drawAboutBox(port: GrafPort, systemFont: number): void {
  const savePort = GetPort();
  SetPort(port);
  TextFont(systemFont);
  TextSize(0);
  EraseRect(port.portRect);
  drawDialogItems(PAINT_DLOG.items);
  if (savePort) SetPort(savePort);
}

export function aboutButtonRect(): Rect {
  const item = PAINT_DLOG.items[0]!;
  return copyRect(item.rect);
}

/** `GetNewDialog`: open the window, erase it and draw its items; thePort becomes the dialog. */
export function getNewDialog(p: Paint, template: DialogTemplate, modal = true): Dialog {
  const b = template.bounds;
  const win = newMacWindow(pt(b.left, b.top), b.right - b.left, b.bottom - b.top);
  p.tb.addWindow(win);
  SetPort(win.port);
  useSystemFont(p);
  EraseRect(win.port.portRect);
  drawDialogItems(template.items);
  const handle = p.host.openDialog(win, { modal });
  p.dialogDepth++;
  return { win, items: template.items, handle };
}

export function disposDialog(p: Paint, dialog: Dialog): void {
  p.host.closeDialog(dialog.handle);
  p.tb.removeWindow(dialog.win);
  p.dialogDepth--;
  SetPort(p.myWind.port);
}

/** `TrackControl` for a push button: highlight while the mouse is over it; true if released inside. */
export function* trackButton(p: Paint, r: Rect): Co<boolean> {
  let inside = true;
  invertButton(r);
  while (p.tb.stillDown()) {
    const now = ptInRect(p.tb.getMouse(), r);
    if (now !== inside) {
      invertButton(r);
      inside = now;
    }
    yield* tick();
  }
  if (inside) invertButton(r);
  return inside;
}

export type DialogFilter = (event: EventRecord) => number | null;

function flashButton(r: Rect): void {
  invertButton(r);
  invertButton(r);
}

/** `ModalDialog`: wait for a hit on an enabled item and return its number. */
export function* modalDialog(p: Paint, dialog: Dialog, filter?: DialogFilter): Co<number> {
  for (;;) {
    const event = p.tb.getNextEvent();
    if (!event) {
      yield* tick();
      continue;
    }
    const filtered = filter?.(event) ?? null;
    if (filtered !== null) return filtered;
    SetPort(dialog.win.port);
    if (event.what === "mouseDown") {
      if (event.window !== dialog.win) {
        p.host.beep();
        continue;
      }
      const where = p.tb.globalToLocal(event.where);
      const index = dialog.items.findIndex((item) => item.kind !== "statText" && item.kind !== "icon" && ptInRect(where, item.rect));
      if (index < 0) continue;
      const item = dialog.items[index]!;
      if (item.kind === "button") {
        if (yield* trackButton(p, item.rect)) return index + 1;
      } else return index + 1;
    } else if ((event.what === "keyDown" || event.what === "autoKey") && (event.key === "\r" || event.key === "\x03")) {
      const first = dialog.items[0];
      if (first?.kind === "button") {
        flashButton(first.rect);
        return 1;
      }
    }
  }
}

/** Wait for the next mouse-down, ignoring every other event (`REPEAT UNTIL GetNextEvent … mouseDown`). */
function* nextMouseDown(p: Paint): Co<EventRecord> {
  for (;;) {
    const event = p.tb.getNextEvent();
    if (event?.what === "mouseDown") return event;
    if (!event) yield* tick();
  }
}

function* waitForRelease(p: Paint): Co {
  while (p.tb.stillDown()) yield* tick();
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertKind = "revert" | "rErr" | "wErr" | "wFull" | "wProt" | "notPntg" | "notRoom";

const ALERTS: Record<AlertKind, { text: string; buttons: readonly string[]; icon: "stop" | "note" | "caution" }> = {
  revert: { text: "Revert to the last version saved ?", buttons: ["OK", "Cancel"], icon: "caution" },
  rErr: { text: "MacPaint is having trouble reading your disk.", buttons: ["OK"], icon: "stop" },
  wErr: { text: "MacPaint is having trouble writing.  Try another disk.", buttons: ["OK"], icon: "stop" },
  wFull: { text: "The disk is full.  Try another disk.", buttons: ["OK"], icon: "stop" },
  wProt: { text: "The disk is locked.", buttons: ["OK"], icon: "stop" },
  notPntg: { text: "Existing file is not a MacPaint document.", buttons: ["Cancel"], icon: "stop" },
  notRoom: { text: "Not enough room to save, try another disk.", buttons: ["Cancel"], icon: "stop" },
};

/** `MyAlert` / `SaveAlert`: the 1-based item hit. */
export function* saveAlert(p: Paint, kind: AlertKind): Co<number> {
  cursorNormal(p);
  const { text, buttons, icon } = ALERTS[kind];
  p.dialogDepth++;
  try {
    return yield* awaitPromise(p.host.alertDialog(text, buttons, icon));
  } finally {
    p.dialogDepth--;
    p.cursorFlag = true;
    SetPort(p.myWind.port);
  }
}

/** `ShouldSave`: 1 = save, 2 = forget, 3 = cancel. */
export function* shouldSave(p: Paint, which: "close" | "quit"): Co<number> {
  acceptEdits(p);
  cursorNormal(p);
  const dialog = getNewDialog(p, which === "close" ? CLOSE_DLOG : QUIT_DLOG);
  const result = yield* modalDialog(p, dialog);
  disposDialog(p, dialog);
  p.cursorFlag = true;
  return result;
}

// ---------------------------------------------------------------------------
// Brush Shape
// ---------------------------------------------------------------------------

export function* chooseBrush(p: Paint): Co {
  const H_LEFT = 16;
  const V_TOP = 16;
  const SPACE = 32;
  acceptEdits(p);
  cursorNormal(p);
  const dialog = getNewDialog(p, BRUSH_DLOG);

  let brush = 120;
  let horiz = 24;
  for (let col = 0; col <= 7; col++) {
    let vert = 24;
    for (let row = 0; row <= 3; row++) {
      MoveTo(horiz, vert);
      drawPaintChar(brush);
      vert += SPACE;
      brush++;
    }
    horiz += SPACE;
  }
  useSystemFont(p);

  let col = p.theBrush >> 2;
  let row = p.theBrush & 3;
  const invBrush = (): void => {
    const left = H_LEFT + col * SPACE;
    const top = V_TOP + row * SPACE;
    PenSize(2, 2);
    PenMode(patXor);
    FrameRect(rect(left, top, left + SPACE, top + SPACE));
    PenNormal();
  };
  invBrush();

  yield* modalDialog(p, dialog);
  const where = p.tb.getMouse();
  invBrush();
  row = pinWord(div(where.v - V_TOP, SPACE), 0, 3);
  col = pinWord(div(where.h - H_LEFT, SPACE), 0, 7);
  invBrush();
  p.theBrush = row + col * 4;
  setToolCursor(p);
  yield* waitForRelease(p);

  disposDialog(p, dialog);
  p.killDouble = true;
}

// ---------------------------------------------------------------------------
// Edit Pattern
// ---------------------------------------------------------------------------

function patBit(pat: Pattern, bitNum: number): boolean {
  return ((pat[bitNum >> 3]! >> (7 - (bitNum & 7))) & 1) === 1;
}

function setPatBit(pat: Pattern, bitNum: number, on: boolean): void {
  const mask = 0x80 >> (bitNum & 7);
  pat[bitNum >> 3] = on ? pat[bitNum >> 3]! | mask : pat[bitNum >> 3]! & ~mask;
}

export function* editPat(p: Paint): Co {
  killStuff(p);
  acceptEdits(p);
  cursorNormal(p);
  const newPat = p.patterns[p.thePatIndex]!.slice();
  const dialog = getNewDialog(p, PAT_ED_DLOG, false);

  PenNormal();
  let editRect = rect(15, 15, 80, 80);
  FrameRect(editRect);
  editRect = insetRect(editRect, 1, 1);
  const plotDot = (ix: number, iy: number): void => {
    const left = editRect.left + ix * 8;
    const top = editRect.top + iy * 8;
    PaintRect(rect(left, top, left + 7, top + 7));
  };
  for (let bitNum = 0; bitNum < 64; bitNum++) if (patBit(newPat, bitNum)) plotDot(bitNum & 7, bitNum >> 3);

  let sampleRect = rect(95, 15, 160, 80);
  FrameRect(sampleRect);
  sampleRect = insetRect(sampleRect, 1, 1);
  FillRect(sampleRect, newPat);

  const getPoint = (): Point => {
    const m = p.tb.getMouse();
    return pt(pinWord(div(m.h - editRect.left, 8), 0, 7), pinWord(div(m.v - editRect.top, 8), 0, 7));
  };

  const filter: DialogFilter = (event) => {
    if (event.what === "mouseDown" && event.window !== dialog.win && ptInRect(event.where, p.docRect)) {
      p.patEdPt = { ...event.where };
      return 4;
    }
    return null;
  };

  let result = 0;
  do {
    result = yield* modalDialog(p, dialog, filter);
    SetPort(dialog.win.port);
    if (result === 1) {
      if (!newPat.every((b, i) => b === p.thePat[i])) {
        p.patterns[p.thePatIndex] = newPat;
        p.workDirty = true;
        p.docDirty = true;
        drawPat(p);
      }
    } else if (result === 3) {
      let oldPt = getPoint();
      let bitNum = 8 * oldPt.v + oldPt.h;
      const whiteFlg = patBit(newPat, bitNum);
      PenNormal();
      if (whiteFlg) PenPat(white);
      plotDot(oldPt.h, oldPt.v);
      setPatBit(newPat, bitNum, !whiteFlg);
      FillRect(sampleRect, newPat);
      while (p.tb.stillDown()) {
        const newPt = getPoint();
        if (newPt.h !== oldPt.h || newPt.v !== oldPt.v) {
          plotDot(newPt.h, newPt.v);
          bitNum = 8 * newPt.v + newPt.h;
          setPatBit(newPat, bitNum, !whiteFlg);
          FillRect(sampleRect, newPat);
          oldPt = newPt;
        }
        yield* tick();
      }
      PenNormal();
    } else if (result === 4) {
      PenNormal();
      newPat.fill(0);
      EraseRect(editRect);
      EraseRect(sampleRect);
      SetPort(p.myWind.port);
      const local = p.tb.globalToLocal(p.patEdPt);
      const h0 = trunc8(local.h + 4);
      const v0 = trunc8(local.v + 4);
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          if (GetPixel(h0 + i, v0 + j)) {
            setPatBit(newPat, j * 8 + i, true);
            SetPort(dialog.win.port);
            plotDot(i, j);
            SetPort(p.myWind.port);
          }
        }
      }
      SetPort(dialog.win.port);
      FillRect(sampleRect, newPat);
      yield* waitForRelease(p);
    }
  } while (result !== 1 && result !== 2);

  disposDialog(p, dialog);
  p.cursorFlag = true;
}

// ---------------------------------------------------------------------------
// Brush Mirrors
// ---------------------------------------------------------------------------

export function* symmetry(p: Paint): Co {
  const H_LEFT = 32;
  const V_TOP = 16;
  const H_RIGHT = 144;
  const V_BOTTOM = 128;
  const H_MID = 88;
  const V_MID = 72;
  acceptEdits(p);
  cursorNormal(p);
  const midPt = pt(H_MID, V_MID);
  const dialog = getNewDialog(p, SYM_DLOG);

  const axis = (flag: boolean, h: number, v: number, dh: number, dv: number): void => {
    PenNormal();
    MoveTo(h, v);
    if (flag) {
      PenSize(3, 3);
      Move(-1, -1);
    }
    Line(dh, dv);
  };
  const drawSym = (): void => {
    let symRect = rect(H_LEFT, V_TOP, H_RIGHT, V_BOTTOM);
    EraseRect(symRect);
    FrameRect(symRect);
    symRect = insetRect(symRect, 1, 1);
    ClipRect(symRect);
    axis(p.hSymFlag, H_MID, V_TOP, 0, 112);
    axis(p.vSymFlag, H_LEFT, V_MID, 112, 0);
    axis(p.hvSymFlag, H_LEFT, V_TOP, 112, 112);
    axis(p.vhSymFlag, H_LEFT, V_BOTTOM, 112, -112);
    ClipRect(dialog.win.port.portRect);
    PenNormal();
  };
  drawSym();

  let result = 0;
  do {
    result = yield* modalDialog(p, dialog);
    SetPort(dialog.win.port);
    if (result === 2) {
      p.hSymFlag = false;
      p.vSymFlag = false;
      p.hvSymFlag = false;
      p.vhSymFlag = false;
    } else if (result === 3) {
      const clickPt = constrain(midPt, p.tb.getMouse(), true);
      if (clickPt.h === midPt.h) p.hSymFlag = !p.hSymFlag;
      else if (clickPt.v === midPt.v) p.vSymFlag = !p.vSymFlag;
      else if (clickPt.h - midPt.h === clickPt.v - midPt.v) p.hvSymFlag = !p.hvSymFlag;
      else p.vhSymFlag = !p.vhSymFlag;
      drawSym();
      yield* waitForRelease(p);
    }
  } while (result !== 1 && result !== 2);

  p.symByte = mapSym(p.hSymFlag, p.vSymFlag, p.hvSymFlag, p.vhSymFlag);
  disposDialog(p, dialog);
  p.cursorFlag = true;
}

// ---------------------------------------------------------------------------
// Buttons in the document window
// ---------------------------------------------------------------------------

/** `ShowControl` on one of the document window's buttons, in window coordinates. */
function showControl(p: Paint, r: Rect, title: string): void {
  const saveOrigin = { h: p.myWind.port.portRect.left, v: p.myWind.port.portRect.top };
  SetOrigin(0, 0);
  const face = p.myWind.port.txFace;
  const font = p.myWind.port.txFont;
  const size = p.myWind.port.txSize;
  PenNormal();
  useSystemFont(p);
  drawButton(r, title);
  TextFont(font);
  TextSize(size);
  TextFace(face);
  SetOrigin(saveOrigin.h, saveOrigin.v);
}

/** `FindControl` + `TrackControl` in the document window: which button a mouse-down hit, if any. */
function* hitControl(p: Paint, event: EventRecord, controls: readonly Rect[]): Co<number> {
  const saveOrigin = { h: p.myWind.port.portRect.left, v: p.myWind.port.portRect.top };
  SetOrigin(0, 0);
  const where = p.tb.globalToLocal(event.where);
  let hit = -1;
  const index = controls.findIndex((r) => ptInRect(where, r));
  if (index < 0) p.host.beep();
  else if (yield* trackButton(p, controls[index]!)) hit = index;
  SetOrigin(saveOrigin.h, saveOrigin.v);
  return hit;
}

// ---------------------------------------------------------------------------
// Show Page
// ---------------------------------------------------------------------------

export function* showPage(p: Paint): Co {
  acceptEdits(p);
  p.fatFlag = false;
  yield* cycleWork(p, { toAlt: false, toShrink: true, toPrint: false });
  cursorNormal(p);
  p.dialogDepth++;

  const port = p.myWind.port;
  const smallPage = copyRect(port.portRect);
  smallPage.left = port.portRect.left + 208 - 96;
  smallPage.right = smallPage.left + 192;
  let windRect = mapRect(port.portRect, p.pageRect, smallPage);
  const oldWindRect = copyRect(windRect);

  allocMask(p);
  showControl(p, p.okButtonRect, "OK");
  showControl(p, p.cancelButtonRect, "Cancel");
  scrnToAlt(p);
  bufToBuf(p.altBits, p.maskBits!);

  PenMode(patXor);
  PenPat(gray);
  SetPortBits(p.altBits);
  FrameRect(windRect);
  altToScrn(p);

  let ok = false;
  let cancel = false;
  let shiftDh = 0;
  let shiftDv = 0;

  while (!ok && !cancel) {
    const event = yield* nextMouseDown(p);
    SetPort(port);
    p.shiftFlag = event.modifiers.shift;
    let oldPt = p.tb.globalToLocal(event.where);

    if (!ptInRect(oldPt, smallPage)) {
      const hit = yield* hitControl(p, event, [p.okButtonRect, p.cancelButtonRect]);
      if (hit === 0) ok = true;
      if (hit === 1) cancel = true;
      PenMode(patXor);
      PenPat(gray);
    }

    initConstrain(p, oldPt);
    let windLeft = windRect.left;
    let windTop = windRect.top;

    if (ptInRect(oldPt, windRect)) {
      while (p.tb.stillDown()) {
        const newPt = hvConstrain(p, p.tb.getMouse());
        if (newPt.h !== oldPt.h || newPt.v !== oldPt.v) {
          SetPortBits(p.altBits);
          FrameRect(windRect);
          windLeft += newPt.h - oldPt.h;
          windTop += newPt.v - oldPt.v;
          const left = pinWord(windLeft, smallPage.left, smallPage.right - 138);
          const top = pinWord(windTop, smallPage.top, smallPage.bottom - 80);
          windRect = rect(left, top, left + 138, top + 80);
          FrameRect(windRect);
          altToScrn(p);
          oldPt = newPt;
        }
        yield* tick();
      }
    } else if (ptInRect(oldPt, smallPage)) {
      ClipRect(smallPage);
      while (p.tb.stillDown()) {
        const newPt = hvConstrain(p, p.tb.getMouse());
        if (newPt.h !== oldPt.h || newPt.v !== oldPt.v) {
          shiftDh += newPt.h - oldPt.h;
          shiftDv += newPt.v - oldPt.v;
          const dstRect = offsetRect(smallPage, shiftDh, shiftDv);
          SetPortBits(p.altBits);
          EraseRect(smallPage);
          maskToAlt(p, smallPage, dstRect, srcCopy);
          FrameRect(windRect);
          altToScrn(p);
          oldPt = newPt;
        }
        yield* tick();
      }
      ClipRect(p.pageRect);
    }
  }

  HidePen();
  ShowPen();
  PenNormal();
  killMask(p);
  p.dialogDepth--;

  if (ok) {
    shiftDh = div(3 * shiftDh, 8) * 8;
    shiftDv = div(3 * shiftDv, 8) * 8;
    const shiftPage = shiftDh !== 0 || shiftDv !== 0;
    const scrollDh = 3 * (windRect.left - oldWindRect.left);
    const scrollDv = 3 * (windRect.top - oldWindRect.top);
    const scrollPage = scrollDh !== 0 || scrollDv !== 0;

    if (shiftPage || scrollPage) {
      const newOrigin = pt(port.portRect.left + scrollDh, port.portRect.top + scrollDv);
      if (newOrigin.h < 3) newOrigin.h = 0;
      if (newOrigin.v < 3) newOrigin.v = 0;
      if (newOrigin.h > DOC_WIDTH - 419) newOrigin.h = DOC_WIDTH - 416;
      if (newOrigin.v > DOC_HEIGHT - 243) newOrigin.v = DOC_HEIGHT - 240;
      setDocOrigin(p, newOrigin.h, newOrigin.v);
      p.mainBits.bounds = offsetRect(p.mainBits.bounds, 0, shiftDv);

      p.rwShftDh = shiftDh;
      p.rwShftDv = shiftDv;
      const out = yield* readWrite(p, { bits: p.work, patterns: null }, {
        fromMain: true,
        toAlt: true,
        toShrink: false,
        toPrint: false,
        newPat: false,
        write: shiftPage,
      });
      p.rwShftDh = 0;
      p.rwShftDv = 0;
      if (shiftPage && out) {
        p.work = out;
        p.docDirty = true;
      }
      p.mainBits.bounds = copyRect(p.altBits.bounds);
      p.fatCenter = pt(newOrigin.h + 208, newOrigin.v + 120);
      acceptEdits(p);
    }
  }

  mainToAlt(p);
  altToScrn(p);
  p.cursorFlag = true;
}

// ---------------------------------------------------------------------------
// Introduction and Short Cuts
// ---------------------------------------------------------------------------

export type HelpPicture = "intro" | "short";

const SHORT_CUTS: readonly (readonly [string, string])[] = [
  ["Double-click on:", ""],
  ["  pencil", "FatBits"],
  ["  eraser", "erase the window"],
  ["  grabber", "Show Page"],
  ["  brush", "Brush Shape"],
  ["  selection rectangle", "select the window"],
  ["  a pattern", "Edit Pattern"],
  ["Shift key:", "constrain lines, shapes and drags"],
  ["Option key:", "drag a copy; draw lines in the pattern"],
  ["Command key:", "stretch a selection; paint transparently"],
  ["Command-Option:", "drag a trail of copies"],
  ["Option in FatBits:", "the pencil scrolls"],
  ["Backspace:", "clear the selection"],
  ["` key:", "Undo"],
  ["Command , and .:", "smaller and bigger type"],
];

const INTRODUCTION: readonly string[] = [
  "MacPaint lets you paint on a page 8 by 10 inches.",
  "The window shows part of the page; the grabber moves it,",
  "and Show Page shows it all.",
  "",
  "Choose a tool on the left, a line width below it, and a",
  "pattern along the bottom, then paint in the window.",
  "",
  "The selection tools pick up part of the painting to move,",
  "copy, stretch, flip, rotate or trace. Undo takes back the",
  "last change.",
];

/** Stand-ins for PICT 2400 and 2401, which are not in the reference resources. */
function drawHelpPicture(p: Paint, which: HelpPicture, frame: Rect): void {
  EraseRect(frame);
  FrameRect(insetRect(frame, 4, 4));
  const saveFont = p.myWind.port.txFont;
  const saveSize = p.myWind.port.txSize;
  const saveFace = p.myWind.port.txFace;
  TextFont(p.host.fontNumber(p.host.applicationFont()));
  TextSize(12);
  TextFace(bold);
  MoveTo(frame.left + 16, frame.top + 24);
  DrawString(which === "short" ? "Short Cuts" : "Introduction");
  TextSize(9);
  TextFace(0);
  let v = frame.top + 44;
  if (which === "short") {
    for (const [left, right] of SHORT_CUTS) {
      MoveTo(frame.left + 16, v);
      DrawString(left);
      MoveTo(frame.left + 140, v);
      DrawString(right);
      v += 12;
    }
  } else {
    for (const line of INTRODUCTION) {
      MoveTo(frame.left + 16, v);
      DrawString(line);
      v += 14;
    }
  }
  DrawChar(" ");
  TextFont(saveFont);
  TextSize(saveSize);
  TextFace(saveFace);
}

export function* showPicture(p: Paint, which: HelpPicture): Co {
  killStuff(p);
  cursorNormal(p);
  SetPort(p.myWind.port);
  PenNormal();
  drawHelpPicture(p, which, p.myWind.port.portRect);
  showControl(p, p.cancelButtonRect, "Cancel");
  p.dialogDepth++;
  for (;;) {
    const event = yield* nextMouseDown(p);
    SetPort(p.myWind.port);
    if ((yield* hitControl(p, event, [p.cancelButtonRect])) === 0) break;
  }
  p.dialogDepth--;
  altToScrn(p);
  p.cursorFlag = true;
}
