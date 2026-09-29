/**
 * The window buffers: how edits move between mainBuf (accepted), altBuf
 * (in progress) and the screen, plus the mouse and pen helpers every tool
 * shares. MacPaint.p lines 497–1110 and 1520–1545, 2448–2468.
 */

import {
  ClipRect,
  CopyBits,
  DrawString,
  EraseRect,
  GetFontInfo,
  GetPort,
  LineTo,
  MoveTo,
  PaintRect,
  PenMode,
  PenNormal,
  PenPat,
  PenSize,
  ScrollRect,
  SetPort,
  SetPortBits,
  StringWidth,
  italic,
  patOr,
  patXor,
  srcBic,
  srcCopy,
  srcOr,
  type BitMap,
  type Point,
  type Rect,
} from "@mockintosh/quickdraw";
import { antsToScrn, BUF_HEIGHT, BUF_ROW, fatToScrn, getSelPat } from "./asm";
import { bufToBuf, copyRect, equalRect, insetRect, mapPt, offsetRect, pt, sectRect, swapBuf, trunc8 } from "./bits";
import { copyBits, ERASE_TOOL, type Paint } from "./state";
import { textBox } from "./textbox";

// ---------------------------------------------------------------------------
// Mouse
// ---------------------------------------------------------------------------

/** `KeyIsDown` for the modifier keys. */
export function keyIsDown(p: Paint, key: "shift" | "option" | "command"): boolean {
  return p.host.heldModifiers()[key];
}

/** `GetFatMouse`: the mouse in document coordinates, through FatBits when it is on. */
export function getFatMouse(p: Paint): Point {
  let m = p.tb.getMouse();
  if (p.fatFlag) {
    if (p.theTool !== ERASE_TOOL) m = pt(m.h - 4, m.v - 4);
    m = mapPt(m, p.myWind.port.portRect, p.fatBits.bounds);
  }
  return m;
}

export function gridPoint(p: Paint, point: Point): Point {
  if (p.gridOn && p.toolGrid) return pt(trunc8(point.h + 4), trunc8(point.v + 4));
  return point;
}

export function getGridMouse(p: Paint): Point {
  return gridPoint(p, getFatMouse(p));
}

export function pinGridMouse(p: Paint): Point {
  const m = getGridMouse(p);
  const r = p.myPinRect;
  return pt(Math.min(Math.max(m.h, r.left), r.right), Math.min(Math.max(m.v, r.top), r.bottom));
}

export function initConstrain(p: Paint, startPt: Point): void {
  p.hConstrain = true;
  p.vConstrain = true;
  p.ptConstrain = { ...startPt };
}

/** `HVConstrain`: with Shift, lock to whichever axis the drag starts along. */
export function hvConstrain(p: Paint, newPt: Point): Point {
  if (!p.shiftFlag) return newPt;
  const out = { ...newPt };
  if (p.hConstrain && p.vConstrain) {
    const dh = Math.abs(out.h - p.ptConstrain.h);
    const dv = Math.abs(out.v - p.ptConstrain.v);
    if (dh > dv && dh > 1) p.vConstrain = false;
    if (dv > dh && dv > 1) p.hConstrain = false;
  }
  if (p.hConstrain) out.v = p.ptConstrain.v;
  if (p.vConstrain) out.h = p.ptConstrain.h;
  return out;
}

/** `Constrain`: square up the drag from `startPt`; with `hvOk`, snap near-axis drags to the axis. */
export function constrain(startPt: Point, newPt: Point, hvOk: boolean): Point {
  const dh0 = newPt.h - startPt.h;
  const dv0 = newPt.v - startPt.v;
  const absDh = Math.abs(dh0);
  const absDv = Math.abs(dv0);
  const delta = Math.min(absDh, absDv);
  const out = pt(startPt.h + (dh0 < 0 ? -delta : delta), startPt.v + (dv0 < 0 ? -delta : delta));
  if (hvOk) {
    if (absDh > 2 * absDv) return pt(newPt.h, startPt.v);
    if (absDv > 2 * absDh) return pt(startPt.h, newPt.v);
  }
  return out;
}

export function cursorNormal(p: Paint): void {
  p.cursor = "arrow";
}

export function busyCursor(p: Paint): void {
  p.cursorFlag = true;
  p.cursor = "watch";
}

// ---------------------------------------------------------------------------
// Pen
// ---------------------------------------------------------------------------

export function setPinRect(p: Paint, size: number): void {
  const half = size >> 1;
  const r = copyRect(p.fatFlag ? p.fatBits.bounds : p.myWind.port.portRect);
  r.left += half;
  r.top += half;
  r.right = r.right - size + half;
  r.bottom = r.bottom - size + half;
  if (p.gridOn && p.toolGrid) {
    r.left = trunc8(r.left + 7);
    r.top = trunc8(r.top + 7);
    r.right = trunc8(r.right);
    r.bottom = trunc8(r.bottom);
  }
  p.myPinRect = r;
}

export function setLineSize(p: Paint, size: number): void {
  p.lineSize = size;
  p.halfLineSize = size >> 1;
  setPinRect(p, size);
}

export function jamLine(p: Paint): void {
  PenNormal();
  PenSize(p.lineSize, p.lineSize);
  if (p.optionFlag) PenPat(p.thePat);
  if (p.featureFlag) PenMode(patOr);
}

export function jamFill(p: Paint): void {
  PenNormal();
  PenPat(p.thePat);
  if (p.featureFlag) PenMode(patOr);
}

export function setSelRect(p: Paint, r: Rect, newPivot: boolean): void {
  const dstRect = p.fatFlag ? p.fatBits.bounds : p.myWind.port.portRect;
  p.selRect = sectRect(r, dstRect);
  const center = pt((p.selRect.left + p.selRect.right) >> 1, (p.selRect.top + p.selRect.bottom) >> 1);
  if (newPivot) p.pivot = center;
  if (!p.fatFlag) p.fatCenter = center;
}

// ---------------------------------------------------------------------------
// Buffers and the screen
// ---------------------------------------------------------------------------

/** `BufToScrn`: copy buffer rows `[top, bottom)` onto the window. */
function bufToScrn(src: BitMap, scrn: BitMap, top: number, bottom: number): void {
  scrn.baseAddr.set(src.baseAddr.subarray(top * BUF_ROW, bottom * BUF_ROW), top * BUF_ROW);
}

/** `BandToScrn`: show rows `top`..`bottom` (document coordinates) of `srcBits`. */
export function bandToScrn(p: Paint, srcBits: BitMap, top: number, bottom: number): void {
  if (!p.windOpen) return;
  if (p.fatFlag) {
    CopyBits(srcBits, p.fatBits, p.fatBits.bounds, p.fatBits.bounds, srcCopy, null);
    fatToScrn(p.fatBits, p.scrn);
    return;
  }
  const origin = p.myWind.port.portRect.top;
  bufToScrn(srcBits, p.scrn, Math.max(0, top - origin), Math.min(BUF_HEIGHT, bottom - origin));
}

export function bitsToScrn(p: Paint, srcBits: BitMap): void {
  bandToScrn(p, srcBits, p.myWind.port.portRect.top, p.myWind.port.portRect.bottom);
}

export function altToScrn(p: Paint): void {
  const savePort = GetPort();
  SetPort(p.myWind.port);
  SetPortBits(p.docBits);
  bitsToScrn(p, p.altBits);
  if (savePort) SetPort(savePort);
}

export function scrnToAlt(p: Paint): void {
  if (p.fatFlag) CopyBits(p.fatBits, p.altBits, p.fatBits.bounds, p.fatBits.bounds, srcCopy, null);
  else p.altBits.baseAddr.set(p.scrn.baseAddr);
}

export function requireMask(p: Paint): BitMap {
  if (!p.maskBits) throw new Error("MacPaint: no mask allocated");
  return p.maskBits;
}

export function maskToAlt(p: Paint, srcRect: Rect, dstRect: Rect, mode: number): void {
  CopyBits(requireMask(p), p.altBits, srcRect, dstRect, mode, null);
}

export function mainToAlt(p: Paint): void {
  bufToBuf(p.mainBits, p.altBits);
  p.scrnFlag = false;
  if (p.whiteFlag) {
    const port = GetPort();
    if (p.selFlag && port) {
      const saveBits = copyBits(port.portBits);
      SetPortBits(p.altBits);
      EraseRect(p.oldSelRect);
      SetPortBits(saveBits);
    }
    if (p.maskFlag && p.maskBits) maskToAlt(p, p.selRect, p.oldSelRect, srcBic);
  }
}

/** `BorrowAlt`: stash the screen image in alt. */
export function borrowAlt(p: Paint): void {
  p.altBits.baseAddr.set(p.scrn.baseAddr);
  p.scrnFlag = true;
}

export function invertCaret(p: Paint): void {
  const savePort = GetPort();
  SetPort(p.myWind.port);
  if (p.fatFlag) SetPortBits(p.fatBits);
  PenNormal();
  PenMode(patXor);
  MoveTo(p.caretLoc.h, p.caretLoc.v - p.info.ascent);
  LineTo(p.caretLoc.h, p.caretLoc.v + p.info.descent - 1);
  if (p.fatFlag) fatToScrn(p.fatBits, p.scrn);
  SetPortBits(p.docBits);
  if (savePort) SetPort(savePort);
  p.caretState = !p.caretState;
}

export function acceptEdits(p: Paint): void {
  bufToBuf(p.altBits, p.mainBits);
  p.oldAcceptFlag = p.acceptFlag;
  p.oldWhiteFlag = p.whiteFlag;
  p.oldMaskFlag = p.maskFlag;
  p.oldSelFlag = p.selFlag;
  p.oldSelRect = copyRect(p.selRect);
  p.oldPivot = { ...p.pivot };
  p.oldLassoBlack = p.lassoBlack;
  p.acceptFlag = false;
}

export function scrollMask(p: Paint, dh: number, dv: number): void {
  const mask = requireMask(p);
  SetPortBits(mask);
  ScrollRect(mask.bounds, dh, dv, p.myWind.port.clipRgn);
  ClipRect(p.pageRect);
  SetPortBits(p.docBits);
}

export function allocMask(p: Paint): boolean {
  p.maskBits = { baseAddr: new Uint8Array(BUF_ROW * BUF_HEIGHT), rowBytes: BUF_ROW, bounds: copyRect(p.altBits.bounds) };
  return true;
}

export function killMask(p: Paint): void {
  p.maskBits = null;
  p.maskFlag = false;
  p.oldMaskFlag = false;
}

/** `KillStuff`: drop typed text, the text scrap, the selection and the mask. */
export function killStuff(p: Paint): void {
  p.txScrap = null;
  p.textLines = [];
  p.textFlag = false;
  killMask(p);
  p.selFlag = false;
  altToScrn(p);
}

export function undo(p: Paint): void {
  if (p.textFlag || p.txScrap !== null) killStuff(p);
  swapBuf(p.mainBits, p.altBits);
  [p.acceptFlag, p.oldAcceptFlag] = [p.oldAcceptFlag, p.acceptFlag];
  [p.whiteFlag, p.oldWhiteFlag] = [p.oldWhiteFlag, p.whiteFlag];
  [p.maskFlag, p.oldMaskFlag] = [p.oldMaskFlag, p.maskFlag];
  [p.lassoBlack, p.oldLassoBlack] = [p.oldLassoBlack, p.lassoBlack];
  [p.selFlag, p.oldSelFlag] = [p.oldSelFlag, p.selFlag];
  [p.selRect, p.oldSelRect] = [p.oldSelRect, p.selRect];
  [p.pivot, p.oldPivot] = [p.oldPivot, p.pivot];
  if ((p.maskFlag || p.oldMaskFlag) && p.maskBits && !equalRect(p.selRect, p.oldSelRect)) {
    scrollMask(p, p.selRect.left - p.oldSelRect.left, p.selRect.top - p.oldSelRect.top);
  }
  altToScrn(p);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function setupText(p: Paint): void {
  GetFontInfo(p.info);
  p.txMinWidth = p.info.widMax + 7;
  p.txMinHeight = p.info.ascent + p.info.descent + p.info.leading;
}

export function drawTxScrap(p: Paint, dstRect: Rect): void {
  killMask(p);
  ClipRect(dstRect);
  EraseRect(dstRect);
  const box = insetRect(dstRect, 2, 0);
  box.right = Math.max(box.right, box.left + p.txMinWidth);
  box.bottom = Math.max(box.bottom, box.top + p.txMinHeight);
  textBox(p.txScrap ?? "", box, p.textJust);
  ClipRect(p.pageRect);
}

export function updateText(p: Paint): void {
  const savePort = GetPort();
  SetPort(p.myWind.port);
  if (p.txScrap !== null) {
    SetPortBits(p.altBits);
    drawTxScrap(p, p.selRect);
    altToScrn(p);
  } else if (p.textFlag && p.textLines.length >= 1) {
    killMask(p);
    SetPortBits(p.altBits);
    mainToAlt(p);
    let lineHeight = p.info.ascent + p.info.descent + p.info.leading;
    if (p.gridOn) lineHeight = trunc8(lineHeight + 7);
    let vert = p.textLoc.v;
    let horiz = p.textLeft;
    p.textLines.forEach((line, index) => {
      horiz = index === 0 ? p.textLoc.h : p.textLeft;
      if (line.length > 0) {
        let width = StringWidth(line);
        if (p.myWind.port.txFace & italic) width += 5;
        if (p.textJust === "right") horiz -= width;
        if (p.textJust === "center") horiz -= width >> 1;
        MoveTo(horiz, vert);
        const dstRect = { left: horiz - 1, right: horiz + width + 1, top: vert - p.info.ascent, bottom: vert + p.info.descent };
        horiz = dstRect.right - 1;
        EraseRect(dstRect);
        DrawString(line);
      }
      vert += lineHeight;
    });
    p.caretLoc = pt(horiz, vert - lineHeight);
    altToScrn(p);
  }
  if (savePort) SetPort(savePort);
  p.nextCaretTime = 0;
}

// ---------------------------------------------------------------------------
// Lasso edges
// ---------------------------------------------------------------------------

export function showEdges(p: Paint): void {
  if (!p.edgeFlag) return;
  if (p.fatFlag) {
    SetPortBits(p.fatBits);
    PenMode(patXor);
    PenPat(getSelPat(p.selIndex));
    PaintRect(p.selRect);
    CopyBits(p.altBits, p.myWind.port.portBits, p.selRect, p.selRect, srcBic, null);
    PaintRect(p.selRect);
    SetPortBits(p.docBits);
    fatToScrn(p.fatBits, p.scrn);
  } else {
    const r = offsetRect(p.selRect, -p.altBits.bounds.left, -p.altBits.bounds.top);
    antsToScrn(p.altBits, p.scrn, r, p.selIndex);
  }
}

/** `KillEdges`: discard the edge mask, restoring altBits to the latest edits. */
export function killEdges(p: Paint): void {
  if (!p.edgeFlag) return;
  const mode = p.lassoBlack ? srcBic : srcOr;
  const dstBits = p.fatFlag ? p.fatBits : p.docBits;
  CopyBits(p.altBits, dstBits, p.selRect, p.selRect, mode, null);
  if (p.fatFlag) mainToAlt(p);
  scrnToAlt(p);
  if (p.fatFlag) altToScrn(p);
  p.edgeFlag = false;
}
