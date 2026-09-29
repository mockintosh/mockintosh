/**
 * The Edit menu. MacPaint.p `CutOrCopy`, `Paste`, `TraceEdges`, `HFlip`,
 * `VFlip`, `Rotate`, `ClearSel`, `InvertSel`, `FillSel`.
 */

import {
  ClipRect,
  ClosePicture,
  CopyBits,
  DrawPicture,
  EraseRect,
  InvertRect,
  OpenPicture,
  PaintRect,
  PenMode,
  PenNormal,
  PenPat,
  PicComment,
  SetPort,
  SetPortBits,
  SetStdProcs,
  notSrcBic,
  patXor,
  srcBic,
  srcCopy,
  srcOr,
  srcXor,
  type QDProcs,
  type Rect,
} from "@mockintosh/quickdraw";
import { calcMask, hFlipBuf, rotBuf, trimBBox, vFlipBuf } from "./asm";
import {
  acceptEdits,
  allocMask,
  altToScrn,
  drawTxScrap,
  gridPoint,
  keyIsDown,
  killMask,
  killStuff,
  mainToAlt,
  maskToAlt,
  requireMask,
  scrnToAlt,
  setSelRect,
} from "./buffers";
import { bufAndBuf, bufToBuf, bufXorBuf, copyRect, insetRect, offsetRect, pt, rect, sectRect, zeroBuf } from "./bits";
import { invTool, setToolCursor } from "./palette";
import { LASSO_TOOL, SELECT_TOOL, type Paint } from "./state";
import { awaitPromise, type Co } from "./toolbox";

const MASK_COMMENT = 12345;

export function* cutOrCopy(p: Paint, cutFlag: boolean): Co {
  if (!(p.selFlag || p.maskFlag)) return;
  if (p.acceptFlag) acceptEdits(p);
  const scrapRect = copyRect(p.selRect);
  const masked = p.maskFlag;
  if (masked) maskToAlt(p, p.selRect, p.selRect, notSrcBic);

  SetPort(p.myWind.port);
  const pic = OpenPicture(scrapRect);
  if (masked) PicComment(MASK_COMMENT, 0, null);
  ClipRect(p.pageRect);
  CopyBits(p.altBits, p.myWind.port.portBits, p.selRect, p.selRect, srcCopy, null);
  ClosePicture();

  if (masked) {
    if (p.fatFlag) mainToAlt(p);
    scrnToAlt(p);
  }

  if (pic) {
    p.scrap = { pic, hostText: null };
    const scrap = p.scrap;
    scrap.hostText = yield* awaitPromise(p.host.clipboardText().catch(() => null));
  }

  if (cutFlag) {
    mainToAlt(p);
    altToScrn(p);
    p.selFlag = false;
    p.maskFlag = false;
  }
}

/** `CenterScrap`: centre `r` in the window, leaving FatBits if it won't fit. */
function centerScrap(p: Paint, r: Rect): Rect {
  const saveGrid = p.toolGrid;
  p.toolGrid = true;
  const width = r.right - r.left;
  const height = r.bottom - r.top;
  if (width > 48 || height > 30) p.fatFlag = false;
  const windRect = p.fatFlag ? p.fatBits.bounds : p.altBits.bounds;
  let topLeft = pt((windRect.left + windRect.right - width) >> 1, (windRect.top + windRect.bottom - height) >> 1);
  if (!p.fatFlag) topLeft = gridPoint(p, topLeft);
  p.toolGrid = saveGrid;
  return rect(topLeft.h, topLeft.v, topLeft.h + width, topLeft.v + height);
}

export function* paste(p: Paint): Co {
  SetPort(p.myWind.port);
  const wasSel = p.selFlag;
  p.selFlag = false;
  acceptEdits(p);
  killStuff(p);
  p.maskPaste = false;
  let scrapFound = false;
  p.whiteFlag = false;
  let dstRect = copyRect(p.selRect);

  const text = yield* awaitPromise(p.host.clipboardText().catch(() => null));
  SetPort(p.myWind.port);
  const scrap = p.scrap;
  const pictureIsNewer = scrap !== null && (!text || text === scrap.hostText);

  if (scrap && pictureIsNewer) {
    const srcRect = scrap.pic.pic.picFrame;
    const procs = {} as QDProcs;
    SetStdProcs(procs);
    procs.commentProc = (kind: number) => {
      if (kind === MASK_COMMENT) {
        p.maskPaste = true;
        zeroBuf(p.altBits);
      }
    };
    p.myWind.port.grafProcs = procs;
    if (!wasSel) dstRect = centerScrap(p, srcRect);
    SetPortBits(p.altBits);
    EraseRect(dstRect);
    DrawPicture(scrap.pic, dstRect);
    p.myWind.port.grafProcs = null;
    scrapFound = true;

    if (p.maskPaste) {
      allocMask(p);
      const mask = requireMask(p);
      calcMask(p.altBits, mask, dstRect, { h: dstRect.left, v: dstRect.top }, false, true);
      p.maskFlag = true;
      p.lassoBlack = false;
      p.oldLassoBlack = false;
      bufXorBuf(p.mainBits, p.altBits);
      bufAndBuf(mask, p.altBits);
      bufXorBuf(p.mainBits, p.altBits);
    }
  } else if (text) {
    p.txScrap = text;
    if (!wasSel) {
      dstRect = insetRect(p.altBits.bounds, 50, 0);
      zeroBuf(p.altBits);
      SetPortBits(p.altBits);
      drawTxScrap(p, dstRect);
      let r = offsetRect(dstRect, -p.altBits.bounds.left, -p.altBits.bounds.top);
      r = trimBBox(p.altBits, r);
      r = offsetRect(r, p.altBits.bounds.left, p.altBits.bounds.top);
      dstRect = insetRect(centerScrap(p, r), -6, -4);
      mainToAlt(p);
    }
    SetPortBits(p.altBits);
    drawTxScrap(p, dstRect);
    scrapFound = true;
  }

  altToScrn(p);
  if (scrapFound) {
    setSelRect(p, dstRect, true);
    p.oldSelRect = copyRect(p.selRect);
    SetPort(p.deskWind.port);
    invTool(p);
    if (p.maskPaste) {
      p.maskFlag = true;
      p.theTool = LASSO_TOOL;
    } else {
      p.selFlag = true;
      p.theTool = SELECT_TOOL;
    }
    invTool(p);
    setToolCursor(p);
    p.toolGrid = true;
    SetPort(p.myWind.port);
  }
}

export function traceEdges(p: Paint): void {
  if (p.acceptFlag) acceptEdits(p);
  const delta = keyIsDown(p, "shift") ? 3 : 2;
  const s = p.selRect;
  const srcRect = rect(s.left + 1, s.top + 1, s.right - delta + 1, s.bottom - delta + 1);
  allocMask(p);
  bufToBuf(p.altBits, requireMask(p));

  let dstRect = offsetRect(srcRect, -1, 0);
  CopyBits(p.altBits, p.altBits, srcRect, dstRect, srcOr, null);
  dstRect = offsetRect(dstRect, delta, 0);
  CopyBits(p.altBits, p.altBits, srcRect, dstRect, srcOr, null);

  dstRect = offsetRect(srcRect, 0, -1);
  CopyBits(p.altBits, p.altBits, srcRect, dstRect, srcOr, null);
  dstRect = offsetRect(dstRect, 0, delta);
  CopyBits(p.altBits, p.altBits, srcRect, dstRect, srcOr, null);

  maskToAlt(p, srcRect, srcRect, srcBic);
  killMask(p);
  altToScrn(p);
}

export function hFlip(p: Paint): void {
  if (p.acceptFlag) acceptEdits(p);
  allocMask(p);
  const alt = p.altBits.bounds;
  hFlipBuf(p.altBits, requireMask(p), p.selRect.top - alt.top, p.selRect.bottom - alt.top);
  const srcRect = copyRect(p.selRect);
  srcRect.left = alt.left + alt.right - p.selRect.right;
  srcRect.right = alt.left + alt.right - p.selRect.left;
  maskToAlt(p, srcRect, p.selRect, srcCopy);
  altToScrn(p);
  killMask(p);
}

export function vFlip(p: Paint): void {
  if (p.acceptFlag) acceptEdits(p);
  allocMask(p);
  const alt = p.altBits.bounds;
  vFlipBuf(p.altBits, requireMask(p));
  const srcRect = copyRect(p.selRect);
  srcRect.top = alt.top + alt.bottom - p.selRect.bottom;
  srcRect.bottom = alt.top + alt.bottom - p.selRect.top;
  maskToAlt(p, srcRect, p.selRect, srcCopy);
  altToScrn(p);
  killMask(p);
}

export function rotate(p: Paint): void {
  if (p.acceptFlag) acceptEdits(p);
  const s = p.selRect;
  const pivot = p.pivot;
  let flipRect: Rect;
  let flopRect: Rect;
  if (s.right - s.left === s.bottom - s.top) {
    flipRect = copyRect(s);
    flopRect = copyRect(s);
  } else {
    flipRect = sectRect(
      rect(pivot.h - (pivot.v - s.top), pivot.v + (pivot.h - s.right), pivot.h - (pivot.v - s.bottom), pivot.v + (pivot.h - s.left)),
      p.altBits.bounds,
    );
    flopRect = rect(
      pivot.h + pivot.v - flipRect.bottom,
      pivot.v - pivot.h + flipRect.left,
      pivot.h + pivot.v - flipRect.top,
      pivot.v - pivot.h + flipRect.right,
    );
  }

  allocMask(p);
  const mask = requireMask(p);
  zeroBuf(mask);
  const alt = p.altBits.bounds;
  let bufRect = offsetRect(flopRect, alt.left - flopRect.left, alt.top - flopRect.top);
  CopyBits(p.altBits, p.altBits, flopRect, bufRect, srcCopy, null);
  rotBuf(p.altBits, mask, bufRect.bottom - bufRect.top);

  mainToAlt(p);
  bufRect = offsetRect(flipRect, alt.left - flipRect.left, alt.bottom - flipRect.bottom);
  maskToAlt(p, bufRect, flipRect, srcCopy);
  altToScrn(p);
  killMask(p);
  setSelRect(p, flipRect, false);
}

export function clearSel(p: Paint): void {
  if (!(p.selFlag || p.maskFlag)) return;
  if (p.acceptFlag) acceptEdits(p);
  mainToAlt(p);
  altToScrn(p);
  if (p.txScrap !== null) killStuff(p);
  p.selFlag = false;
  p.maskFlag = false;
}

export function invertSel(p: Paint): void {
  if (p.acceptFlag) acceptEdits(p);
  if (p.selFlag) {
    SetPortBits(p.altBits);
    InvertRect(p.selRect);
    SetPortBits(p.docBits);
  }
  if (p.maskFlag && p.maskBits) {
    maskToAlt(p, p.maskBits.bounds, p.altBits.bounds, srcXor);
    p.lassoBlack = !p.lassoBlack;
  }
  altToScrn(p);
}

export function fillSel(p: Paint): void {
  if (p.acceptFlag) acceptEdits(p);
  SetPortBits(p.altBits);
  PenNormal();
  PenPat(p.thePat);
  if (p.selFlag) PaintRect(p.selRect);
  if (p.maskFlag && p.maskBits) {
    PenMode(patXor);
    PaintRect(p.selRect);
    maskToAlt(p, p.maskBits.bounds, p.altBits.bounds, srcBic);
    PaintRect(p.selRect);
  }
  PenNormal();
  SetPortBits(p.docBits);
  altToScrn(p);
}
