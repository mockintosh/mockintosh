/**
 * The painting tools and the selection. MacPaint.p lines 905–959 and
 * 2022–3372: every tool tracks the mouse itself while the button is down,
 * drawing into altBits (or straight onto the screen) and showing progress
 * with `AltToScrn`.
 */

import {
  CloseRgn,
  CopyBits,
  DisposeRgn,
  EmptyRgn,
  FixRatio,
  FrameOval,
  FrameRect,
  FrameRoundRect,
  HiWord,
  Line,
  LineTo,
  MoveTo,
  NewRgn,
  OffsetRgn,
  OpenRgn,
  PaintOval,
  PaintRect,
  PaintRgn,
  PaintRoundRect,
  PenNormal,
  PenPat,
  SetPort,
  SetPortBits,
  patBic,
  notPatBic,
  PenMode,
  srcBic,
  srcCopy,
  srcXor,
  type BitMap,
  type Pattern,
  type Point,
  type Rect,
  type RgnHandle,
} from "@mockintosh/quickdraw";
import { calcEdges, calcMask, drawBrush, fatToScrn, getSelPat, trimBBox } from "./asm";
import {
  acceptEdits,
  allocMask,
  altToScrn,
  bandToScrn,
  bitsToScrn,
  constrain,
  cursorNormal,
  drawTxScrap,
  getFatMouse,
  getGridMouse,
  gridPoint,
  hvConstrain,
  initConstrain,
  invertCaret,
  jamFill,
  jamLine,
  keyIsDown,
  killMask,
  killStuff,
  mainToAlt,
  maskToAlt,
  pinGridMouse,
  requireMask,
  scrnToAlt,
  scrollMask,
  setLineSize,
  setPinRect,
  setSelRect,
  showEdges,
  updateText,
} from "./buffers";
import {
  bufAndBuf,
  bufOrBuf,
  bufToBuf,
  copyRect,
  div,
  emptyRect,
  equalPt,
  equalRect,
  insetRect,
  invertBuf,
  mapRect,
  nearPt,
  offsetRect,
  pinWord,
  pixelTrue,
  pt,
  pt2Rect,
  ptInRect,
  rect,
  trunc8,
  white,
  zeroBuf,
} from "./bits";
import { setDocOrigin, scrollTo } from "./document";
import { menuCommand } from "./commands";
import { setToolCursor } from "./palette";
import {
  AIDS_ITEM,
  AIDS_MENU,
  BRUSH_TOOL,
  CORNER,
  DOC_HEIGHT,
  DOC_WIDTH,
  ERASE_TOOL,
  GRABBER_TOOL,
  MAX_LINES,
  PENCIL_TOOL,
  SPRAY_TOOL,
  TEXT_TOOL,
  type Paint,
} from "./state";
import { CARET_TIME, DOUBLE_TIME, tick, type Co } from "./toolbox";

type ShapeCode = "rect" | "rRect" | "oval";

// ---------------------------------------------------------------------------
// Shapes and lines
// ---------------------------------------------------------------------------

function* createShape(p: Paint, shape: ShapeCode, filled: boolean): Co {
  jamLine(p);
  const startPt = pinGridMouse(p);
  let oldPt = pt(1000, 0);
  while (p.tb.stillDown()) {
    let newPt = pinGridMouse(p);
    if (p.shiftFlag) newPt = constrain(startPt, newPt, false);
    if (!equalPt(newPt, oldPt)) {
      mainToAlt(p);
      const r = pt2Rect(startPt, newPt);
      r.left -= p.halfLineSize;
      r.top -= p.halfLineSize;
      r.right += p.lineSize - p.halfLineSize;
      r.bottom += p.lineSize - p.halfLineSize;
      SetPortBits(p.altBits);
      if (filled) {
        jamFill(p);
        if (shape === "rect") PaintRect(r);
        else if (shape === "rRect") PaintRoundRect(r, CORNER, CORNER);
        else PaintOval(r);
      }
      if (p.borderFlag || !filled) {
        jamLine(p);
        if (shape === "rect") FrameRect(r);
        else if (shape === "rRect") FrameRoundRect(r, CORNER, CORNER);
        else FrameOval(r);
      }
      altToScrn(p);
      oldPt = newPt;
    }
    yield* tick();
  }
}

function altBufLine(p: Paint, pt1: Point, pt2: Point, oldPt: Point): void {
  const lineTop = Math.min(oldPt.v, pt1.v, pt2.v) - p.halfLineSize;
  const lineBot = Math.max(oldPt.v, pt1.v, pt2.v) - p.halfLineSize + p.lineSize;
  SetPortBits(p.altBits);
  MoveTo(pt1.h - p.halfLineSize, pt1.v - p.halfLineSize);
  LineTo(pt2.h - p.halfLineSize, pt2.v - p.halfLineSize);
  SetPortBits(p.docBits);
  bandToScrn(p, p.altBits, lineTop, lineBot);
}

function* straightLine(p: Paint): Co {
  jamLine(p);
  const startPt = pinGridMouse(p);
  let oldPt = pt(1000, 0);
  do {
    let newPt = pinGridMouse(p);
    if (p.shiftFlag) newPt = constrain(startPt, newPt, true);
    if (!equalPt(newPt, oldPt)) {
      mainToAlt(p);
      altBufLine(p, startPt, newPt, oldPt);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown());
}

function* hollowCurve(p: Paint): Co {
  const tol = p.fatFlag ? 1 : 3;
  jamLine(p);
  let oldPt = pinGridMouse(p);
  altBufLine(p, oldPt, oldPt, oldPt);
  do {
    const newPt = pinGridMouse(p);
    if (!nearPt(oldPt, newPt, tol)) {
      altBufLine(p, oldPt, newPt, oldPt);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown());
}

/** Close a traced outline into a region, building it in one go since the region buffer is global. */
function outlineRgn(points: readonly Point[], dh: number, dv: number): RgnHandle {
  OpenRgn();
  MoveTo(points[0]!.h - dh, points[0]!.v - dv);
  for (let i = 1; i < points.length; i++) LineTo(points[i]!.h - dh, points[i]!.v - dv);
  LineTo(points[0]!.h - dh, points[0]!.v - dv);
  const rgn = NewRgn();
  CloseRgn(rgn);
  return rgn;
}

const PT_MAX = 1000;

/** `GetRgn`: trace a freehand outline; with `fillFlag`, paint it as a filled shape. */
function* getRgn(p: Paint, fillFlag: boolean): Co<RgnHandle> {
  if (fillFlag) jamLine(p);
  const dstBits = p.fatFlag ? p.fatBits : p.docBits;
  const half = p.halfLineSize;
  const firstPt = pinGridMouse(p);
  const ptArray: Point[] = [firstPt];
  MoveTo(firstPt.h - half, firstPt.v - half);
  SetPortBits(dstBits);
  Line(0, 0);
  SetPortBits(p.docBits);
  if (p.fatFlag) fatToScrn(p.fatBits, p.scrn);

  let oldPt = firstPt;
  do {
    const newPt = pinGridMouse(p);
    if (Math.abs(newPt.h - oldPt.h) + Math.abs(newPt.v - oldPt.v) > 1) {
      SetPortBits(dstBits);
      LineTo(newPt.h - half, newPt.v - half);
      SetPortBits(p.docBits);
      if (p.fatFlag) fatToScrn(p.fatBits, p.scrn);
      ptArray.push(newPt);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown() && ptArray.length < PT_MAX);

  SetPortBits(dstBits);
  LineTo(firstPt.h - half, firstPt.v - half);
  SetPortBits(p.docBits);
  if (p.fatFlag) fatToScrn(p.fatBits, p.scrn);
  const tempRgn = outlineRgn(ptArray, half, half);
  OffsetRgn(tempRgn, half, half);

  if (fillFlag) {
    SetPortBits(p.altBits);
    jamFill(p);
    PaintRgn(tempRgn);
    jamLine(p);
    if (!p.borderFlag) PenPat(p.thePat);
    MoveTo(firstPt.h - half, firstPt.v - half);
    for (let i = 1; i < ptArray.length; i++) LineTo(ptArray[i]!.h - half, ptArray[i]!.v - half);
    LineTo(firstPt.h - half, firstPt.v - half);
  }
  altToScrn(p);
  return tempRgn;
}

/** `PolyLine`: rubber-band one side from `startPt` until a click; `aborted` on a key or a click outside. */
function* polyLine(p: Paint, startPt: Point): Co<{ aborted: boolean; endPt: Point }> {
  let oldPt = pt(1000, 0);
  let newPt = startPt;
  for (;;) {
    newPt = pinGridMouse(p);
    if (p.shiftFlag) newPt = constrain(startPt, newPt, true);
    if (!equalPt(newPt, oldPt)) {
      altToScrn(p);
      const half = p.halfLineSize;
      if (p.fatFlag) {
        SetPortBits(p.fatBits);
        MoveTo(startPt.h - half, startPt.v - half);
        LineTo(newPt.h - half, newPt.v - half);
        SetPortBits(p.docBits);
        fatToScrn(p.fatBits, p.scrn);
      } else {
        MoveTo(startPt.h - half, startPt.v - half);
        LineTo(newPt.h - half, newPt.v - half);
      }
      oldPt = newPt;
    }
    const event = p.tb.getNextEvent();
    if (event) {
      const aborted = event.what === "keyDown" || (event.what === "mouseDown" && !ptInRect(event.where, p.docRect));
      if (aborted) return { aborted: true, endPt: startPt };
      if (event.what === "mouseUp") {
        p.clickTime = event.when;
        p.clickLoc = { ...event.where };
        return { aborted: false, endPt: newPt };
      }
    }
    yield* tick();
  }
}

function* createPoly(p: Paint, filled: boolean): Co {
  if (p.clickCount > 1) return;
  jamLine(p);
  const startPt = pinGridMouse(p);
  const ptArray: Point[] = [startPt];
  let oldPt = startPt;
  let newPt = startPt;
  let closed = false;
  let done = false;
  do {
    const side = yield* polyLine(p, oldPt);
    done = side.aborted;
    newPt = side.endPt;
    if (!done) {
      scrnToAlt(p);
      ptArray.push(newPt);
    }
    closed = false;
    if (ptArray.length > 2) {
      closed = nearPt(newPt, startPt, 4 * p.lineSize);
      done = done || closed || nearPt(newPt, oldPt, 4 * p.lineSize);
    }
    done = done || ptArray.length === PT_MAX;
    oldPt = newPt;
  } while (!done);

  if (filled || closed) altBufLine(p, newPt, startPt, newPt);

  if (filled) {
    const tempRgn = outlineRgn(ptArray, 0, 0);
    SetPortBits(p.altBits);
    jamFill(p);
    PaintRgn(tempRgn);
    DisposeRgn(tempRgn);
    jamLine(p);
    if (!p.borderFlag) PenPat(p.thePat);
    const half = p.halfLineSize;
    MoveTo(startPt.h - half, startPt.v - half);
    for (let i = 1; i < ptArray.length; i++) LineTo(ptArray[i]!.h - half, ptArray[i]!.v - half);
    LineTo(startPt.h - half, startPt.v - half);
  }
  altToScrn(p);
  p.killDouble = true;
}

// ---------------------------------------------------------------------------
// Brushes
// ---------------------------------------------------------------------------

function* brushPaint(p: Paint, brush: Uint16Array, pat: Pattern): Co {
  if (p.theTool === ERASE_TOOL) p.featureFlag = false;
  const portRect = p.myWind.port.portRect;
  const hMid = (portRect.left + portRect.right) >> 1;
  const vMid = (portRect.top + portRect.bottom) >> 1;
  let dstBits: BitMap = p.docBits;
  let clip: Rect = portRect;
  if (p.fatFlag) {
    dstBits = p.fatBits;
    clip = p.fatBits.bounds;
  }
  const orMode = p.featureFlag;
  const brushAt = (h: number, v: number): void => drawBrush(brush, pat, h + hMid, v + vMid, dstBits, clip, orMode);
  const symBrush = (h0: number, v0: number): void => {
    const h = h0 - hMid;
    const v = v0 - vMid;
    brushAt(h, v);
    const sym = p.symByte;
    if (p.fatFlag || ((sym << 1) & 0xff) === 0 || p.theTool !== BRUSH_TOOL) return;
    if (sym & 0x40) brushAt(-h, v);
    if (sym & 0x20) brushAt(h, -v);
    if (sym & 0x10) brushAt(-h, -v);
    if (sym & 0x08) brushAt(v, h);
    if (sym & 0x04) brushAt(-v, h);
    if (sym & 0x02) brushAt(v, -h);
    if (sym & 0x01) brushAt(-v, -h);
  };
  const paintBrush = (at: Point): void => {
    symBrush(at.h, at.v);
    if (p.fatFlag) fatToScrn(p.fatBits, p.scrn);
  };
  const brushLine = (from: Point, to: Point): void => {
    const dh = to.h - from.h;
    const dv = to.v - from.v;
    const nSteps = Math.max(Math.abs(dh), Math.abs(dv));
    const deltaH = FixRatio(dh, nSteps);
    const deltaV = FixRatio(dv, nSteps);
    let horiz = from.h * 65536 + 0x8000;
    let vert = from.v * 65536 + 0x8000;
    for (let step = 1; step <= nSteps; step++) {
      horiz += deltaH;
      vert += deltaV;
      symBrush(HiWord(horiz), HiWord(vert));
    }
    if (p.fatFlag) fatToScrn(p.fatBits, p.scrn);
  };

  let oldPt = getFatMouse(p);
  paintBrush(oldPt);
  initConstrain(p, oldPt);
  const tol = p.theTool === ERASE_TOOL ? 0 : p.theTool === SPRAY_TOOL ? 2 : 1;
  do {
    const newPt = hvConstrain(p, getFatMouse(p));
    if (Math.abs(newPt.h - oldPt.h) + Math.abs(newPt.v - oldPt.v) > tol) {
      if (p.theTool === SPRAY_TOOL) paintBrush(newPt);
      else brushLine(oldPt, newPt);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown());
  scrnToAlt(p);
}

function* pencilPaint(p: Paint): Co {
  if (p.fatScroll) {
    yield* scrollDoc(p);
    return;
  }
  if (p.featureFlag) {
    yield* menuCommand(p, AIDS_MENU, AIDS_ITEM.fat);
    return;
  }
  const saveSize = p.lineSize;
  setLineSize(p, 1);
  const startPt = pinGridMouse(p);
  PenNormal();
  if (pixelTrue(startPt.h, startPt.v, p.altBits)) PenPat(white);
  altBufLine(p, startPt, startPt, startPt);
  initConstrain(p, startPt);
  let oldPt = startPt;
  do {
    const newPt = hvConstrain(p, pinGridMouse(p));
    if (!equalPt(oldPt, newPt)) {
      altBufLine(p, oldPt, newPt, oldPt);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown());
  setLineSize(p, saveSize);
}

function* eraseSome(p: Paint): Co {
  let brush = p.toolCursor.mask;
  if (p.fatFlag) {
    brush = new Uint16Array(16);
    brush[7] = 0x0180;
    brush[8] = 0x0180;
  }
  yield* brushPaint(p, brush, white);
}

function seedFill(p: Paint, startPt: Point): void {
  const firstBlack = pixelTrue(startPt.h, startPt.v, p.mainBits);
  calcMask(p.mainBits, p.altBits, p.altBits.bounds, startPt, firstBlack, false);
  SetPortBits(p.altBits);
  PenPat(p.thePat);
  if (firstBlack) {
    PenMode(patBic);
    PaintRect(p.altBits.bounds);
    invertBuf(p.altBits);
    bufAndBuf(p.mainBits, p.altBits);
  } else {
    PenMode(notPatBic);
    PaintRect(p.altBits.bounds);
    bufOrBuf(p.mainBits, p.altBits);
  }
  PenNormal();
  altToScrn(p);
  p.clickTime = p.tb.tickCount();
  p.clickLoc = { ...p.tb.mouse };
  p.killDouble = true;
}

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

function* scrollFat(p: Paint): Co {
  const saveFat = copyRect(p.fatBits.bounds);
  const startPt = p.tb.getMouse();
  initConstrain(p, startPt);
  let oldPt = startPt;
  const portRect = p.myWind.port.portRect;
  const maxDh = p.fatBits.bounds.left - portRect.left;
  const minDh = p.fatBits.bounds.right - portRect.right;
  const maxDv = p.fatBits.bounds.top - portRect.top;
  const minDv = p.fatBits.bounds.bottom - portRect.bottom;
  do {
    const newPt = hvConstrain(p, p.tb.getMouse());
    if (!equalPt(newPt, oldPt)) {
      const dh = pinWord(div(newPt.h - startPt.h, 3), minDh, maxDh);
      const dv = pinWord(div(newPt.v - startPt.v, 3), minDv, maxDv);
      p.fatBits.bounds = offsetRect(saveFat, -dh, -dv);
      bitsToScrn(p, p.mainBits);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown());
  p.fatCenter = pt((p.fatBits.bounds.left + p.fatBits.bounds.right) >> 1, (p.fatBits.bounds.top + p.fatBits.bounds.bottom) >> 1);
}

export function* scrollDoc(p: Paint): Co {
  if (p.fatFlag) {
    yield* scrollFat(p);
    return;
  }
  SetPort(p.myWind.port);
  const oldOrigin = pt(p.myWind.port.portRect.left, p.myWind.port.portRect.top);
  let newOrigin = oldOrigin;
  const pinRect = rect(0, 0, DOC_WIDTH - 416, DOC_HEIGHT - 240);
  acceptEdits(p);

  const startPt = p.tb.localToGlobal(getGridMouse(p));
  initConstrain(p, startPt);
  let oldPt = startPt;
  do {
    const newPt = hvConstrain(p, p.tb.localToGlobal(getGridMouse(p)));
    if (!equalPt(newPt, oldPt)) {
      const h = oldOrigin.h - newPt.h + startPt.h;
      const v = oldOrigin.v - newPt.v + startPt.v;
      newOrigin = pt(pinWord(h, pinRect.left, pinRect.right), pinWord(v, pinRect.top, pinRect.bottom));
      setDocOrigin(p, newOrigin.h, newOrigin.v);
      zeroBuf(p.altBits);
      CopyBits(p.mainBits, p.altBits, p.mainBits.bounds, p.mainBits.bounds, srcCopy, null);
      altToScrn(p);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown());

  if (!equalPt(newOrigin, oldOrigin)) yield* scrollTo(p, newOrigin);
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

function* dragImage(p: Paint): Co {
  p.workDirty = true;
  p.docDirty = true;
  const saveGrid = p.toolGrid;
  p.toolGrid = true;
  const multiFlag = p.optionFlag && p.featureFlag;
  const copyFlag = p.optionFlag && !p.featureFlag;
  let stretchFlag = p.featureFlag && !p.optionFlag;

  if (copyFlag) p.acceptFlag = true;
  if (p.acceptFlag) acceptEdits(p);
  if (p.optionFlag) p.whiteFlag = false;
  if (multiFlag) p.acceptFlag = true;

  const tempRect = p.fatFlag ? p.fatBits.bounds : p.myWind.port.portRect;
  const minDh = tempRect.left - p.selRect.left;
  const maxDh = tempRect.right - p.selRect.right;
  const minDv = tempRect.top - p.selRect.top;
  const maxDv = tempRect.bottom - p.selRect.bottom;

  PenNormal();
  PenPat(getSelPat(p.selIndex));
  const srcRect = copyRect(p.selRect);
  let dstRect = copyRect(srcRect);
  const startPt = getGridMouse(p);
  initConstrain(p, startPt);

  if (p.maskFlag) stretchFlag = false;
  const anchorPt = pt(0, 0);
  let hSame = false;
  let vSame = false;
  if (stretchFlag) {
    const s = p.selRect;
    let third = div(s.right - s.left, 3);
    if (startPt.h < s.left + third) anchorPt.h = s.right;
    else if (startPt.h > s.right - third) anchorPt.h = s.left;
    else hSame = true;
    third = div(s.bottom - s.top, 3);
    if (startPt.v < s.top + third) anchorPt.v = s.bottom;
    else if (startPt.v > s.bottom - third) anchorPt.v = s.top;
    else vSame = true;
    if (hSame && vSame) stretchFlag = false;
  }

  const stretchText = stretchFlag && p.txScrap !== null;
  if (!p.maskFlag && !stretchText) {
    allocMask(p);
    bufToBuf(p.altBits, requireMask(p));
  }

  let tol = 1;
  if (multiFlag) {
    tol = 2 * p.lineSize;
    if (tol === 2) tol = 1;
  }

  const srcBits = p.fatFlag ? p.fatBits : p.docBits;
  let oldPt = pt(1000, 0);
  let dh = 0;
  let dv = 0;
  do {
    let newPt = getGridMouse(p);
    if (!stretchFlag) newPt = hvConstrain(p, newPt);
    if (!nearPt(newPt, oldPt, tol)) {
      const oldDstRect = dstRect;
      dstRect = copyRect(srcRect);
      if (stretchFlag) {
        let tempPt = startPt;
        if (p.shiftFlag) {
          tempPt = constrain(anchorPt, tempPt, false);
          newPt = constrain(anchorPt, newPt, false);
        }
        const fromRect = pt2Rect(anchorPt, tempPt);
        const toRect = pt2Rect(anchorPt, newPt);
        if (hSame) {
          toRect.left = fromRect.left;
          toRect.right = fromRect.right;
        }
        if (vSame) {
          toRect.top = fromRect.top;
          toRect.bottom = fromRect.bottom;
        }
        dstRect = mapRect(dstRect, fromRect, toRect);
      } else {
        dh = pinWord(newPt.h - startPt.h, minDh, maxDh);
        dv = pinWord(newPt.v - startPt.v, minDv, maxDv);
        if (p.gridOn && p.toolGrid) {
          dh = trunc8(dh);
          dv = trunc8(dv);
        }
        dstRect = offsetRect(dstRect, dh, dv);
      }

      if (!multiFlag && !stretchText) mainToAlt(p);

      if (p.selFlag) {
        SetPortBits(p.altBits);
        if (stretchText) {
          mainToAlt(p);
          drawTxScrap(p, dstRect);
        } else maskToAlt(p, srcRect, dstRect, srcCopy);
        if (!multiFlag) FrameRect(dstRect);
      }

      if (p.maskFlag) {
        CopyBits(srcBits, p.altBits, oldDstRect, dstRect, srcXor, null);
        maskToAlt(p, srcRect, dstRect, srcBic);
        CopyBits(srcBits, p.altBits, oldDstRect, dstRect, srcXor, null);
      }

      altToScrn(p);
      oldPt = newPt;
    }
    yield* tick();
  } while (p.tb.stillDown());

  if (p.selFlag) {
    setSelRect(p, dstRect, true);
    SetPortBits(p.altBits);
    if (stretchText) {
      mainToAlt(p);
      drawTxScrap(p, dstRect);
    } else if (!multiFlag) {
      mainToAlt(p);
      maskToAlt(p, srcRect, dstRect, srcCopy);
    }
    altToScrn(p);
  }

  if (p.maskFlag) {
    p.selRect = dstRect;
    scrollMask(p, dh, dv);
  }

  if (!p.maskFlag) killMask(p);
  p.toolGrid = saveGrid;
}

function* selDragImage(p: Paint): Co {
  const whole = p.fatFlag ? p.fatBits.bounds : p.myWind.port.portRect;
  if (p.inSel && (p.featureFlag || !equalRect(p.selRect, whole))) {
    yield* dragImage(p);
    return;
  }

  killStuff(p);
  p.oldSelFlag = false;
  p.oldMaskFlag = false;

  const saveSize = p.lineSize;
  setLineSize(p, 1);
  PenNormal();

  const startPt = pinGridMouse(p);
  let dstRect = pt2Rect(startPt, startPt);
  allocMask(p);
  const mask = requireMask(p);
  let oldIndex = -1;
  while (p.tb.stillDown()) {
    let now = p.tb.tickCount() & 0xffff;
    if (p.fatFlag) now = div(now, 3);
    p.selIndex = now & 7;
    if (p.selIndex !== oldIndex) {
      const newPt = pinGridMouse(p);
      dstRect = pt2Rect(startPt, newPt);
      p.selFlag = !emptyRect(dstRect);
      if (p.selFlag) {
        dstRect.right++;
        dstRect.bottom++;
      }
      bufToBuf(p.altBits, mask);
      SetPortBits(mask);
      PenPat(getSelPat(p.selIndex));
      FrameRect(dstRect);
      SetPortBits(p.docBits);
      bitsToScrn(p, mask);
      oldIndex = p.selIndex;
    }
    yield* tick();
  }
  killMask(p);
  if (p.selFlag) setSelRect(p, dstRect, true);
  p.acceptFlag = true;
  p.whiteFlag = true;
  setLineSize(p, saveSize);
}

function* lasso(p: Paint): Co {
  killStuff(p);
  p.whiteFlag = false;
  p.oldMaskFlag = false;
  p.lassoBlack = false;
  p.oldLassoBlack = false;

  const saveSize = p.lineSize;
  p.lineSize = 1;
  p.halfLineSize = 0;
  setPinRect(p, 2);
  PenNormal();
  const lassoRgn = yield* getRgn(p, false);

  if (EmptyRgn(lassoRgn)) {
    DisposeRgn(lassoRgn);
  } else {
    p.selRect = insetRect(lassoRgn.rgn.rgnBBox, -1, -1);
    zeroBuf(p.altBits);
    const srcBits = p.fatFlag ? p.fatBits : p.docBits;
    CopyBits(srcBits, p.altBits, p.selRect, p.selRect, srcCopy, lassoRgn);
    DisposeRgn(lassoRgn);
    allocMask(p);
    const mask = requireMask(p);
    calcMask(p.altBits, mask, p.selRect, { h: p.selRect.left, v: p.selRect.top }, false, true);
    p.maskFlag = true;
    let r = offsetRect(p.selRect, -mask.bounds.left, -mask.bounds.top);
    r = trimBBox(mask, r);
    p.selRect = offsetRect(r, mask.bounds.left, mask.bounds.top);
    if (emptyRect(p.selRect)) killMask(p);
    if (p.fatFlag) bufToBuf(p.mainBits, p.altBits);
    scrnToAlt(p);
    setSelRect(p, insetRect(p.selRect, -1, -1), true);
  }

  p.whiteFlag = true;
  p.acceptFlag = true;
  p.oldSelRect = copyRect(p.selRect);
  setLineSize(p, saveSize);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function placeCaret(p: Paint, startPt: Point, newLeft: boolean): void {
  const event = p.theEvent;
  if (event && event.when < p.clickTime + DOUBLE_TIME && nearPt(event.where, p.clickLoc, 4)) return;
  acceptEdits(p);
  killStuff(p);
  const at = gridPoint(p, startPt);
  p.textLoc = { ...at };
  p.caretLoc = { ...at };
  if (newLeft) p.textLeft = at.h;
  p.textFlag = true;
  p.textLines = [];
}

export function textChar(p: Paint): void {
  if (!p.textFlag) return;
  p.workDirty = true;
  p.docDirty = true;
  if (p.acceptFlag) acceptEdits(p);
  p.whiteFlag = false;

  if (p.theKey === "\x03") {
    placeCaret(p, p.caretLoc, false);
    return;
  }
  if (p.textLines.length === 0) p.textLines.push("");
  if (p.theKey === "\r") {
    if (p.textLines.length === MAX_LINES) return;
    p.textLines.push("");
  }
  if (p.theKey === "\b") {
    const last = p.textLines.length - 1;
    const line = p.textLines[last]!;
    if (line.length > 0) p.textLines[last] = line.slice(0, -1);
    else p.textLines.pop();
  }
  if (p.theKey >= " " && p.theKey !== "\x7f") {
    const last = p.textLines.length - 1;
    if (p.textLines[last]!.length < 80) p.textLines[last] += p.theKey;
  }
  updateText(p);
}

// ---------------------------------------------------------------------------
// EditDoc and TrackCursor
// ---------------------------------------------------------------------------

export function* editDoc(p: Paint): Co {
  if (p.theTool > TEXT_TOOL || p.theTool === GRABBER_TOOL) {
    acceptEdits(p);
    p.whiteFlag = false;
    p.acceptFlag = true;
  }
  if (!p.fatFlag) p.fatCenter = p.tb.getMouse();
  const where = getFatMouse(p);
  if (p.theTool > TEXT_TOOL) {
    p.workDirty = true;
    p.docDirty = true;
  }
  switch (p.theTool) {
    case 0:
      if (p.inSel) yield* dragImage(p);
      else yield* lasso(p);
      break;
    case 1:
      yield* selDragImage(p);
      break;
    case 2:
      yield* scrollDoc(p);
      break;
    case 3:
      placeCaret(p, where, true);
      break;
    case 4:
      seedFill(p, where);
      break;
    case 5:
    case 6:
      yield* brushPaint(p, p.toolCursor.data, p.thePat);
      break;
    case 7:
      yield* pencilPaint(p);
      break;
    case 8:
      yield* straightLine(p);
      break;
    case 9:
      yield* eraseSome(p);
      break;
    case 10:
      yield* createShape(p, "rect", false);
      break;
    case 11:
      yield* createShape(p, "rect", true);
      break;
    case 12:
      yield* createShape(p, "rRect", false);
      break;
    case 13:
      yield* createShape(p, "rRect", true);
      break;
    case 14:
      yield* createShape(p, "oval", false);
      break;
    case 15:
      yield* createShape(p, "oval", true);
      break;
    case 16:
      yield* hollowCurve(p);
      break;
    case 17:
      DisposeRgn(yield* getRgn(p, true));
      break;
    case 18:
      yield* createPoly(p, false);
      break;
    case 19:
      yield* createPoly(p, true);
      break;
  }
}

export function trackCursor(p: Paint): void {
  const ticks = p.tb.tickCount();
  if (p.textFlag && ticks > p.nextCaretTime) {
    invertCaret(p);
    p.nextCaretTime = ticks + CARET_TIME;
  }

  const wasInWindow = p.inWindow;
  const wasInSel = p.inSel;
  const wasFatScroll = p.fatScroll;

  p.fatScroll = p.fatFlag && keyIsDown(p, "option") && p.theTool === PENCIL_TOOL;
  if (p.fatScroll !== wasFatScroll) {
    const saveTool = p.theTool;
    if (p.fatScroll) p.theTool = GRABBER_TOOL;
    setToolCursor(p);
    p.theTool = saveTool;
  }

  SetPort(p.myWind.port);
  SetPortBits(p.docBits);
  p.inWindow = p.windOpen && ptInRect(p.tb.getMouse(), p.myWind.port.portRect);
  const mousePt = getFatMouse(p);

  if (p.maskFlag && p.maskBits) {
    if (!p.edgeFlag) {
      calcEdges(p.maskBits, p.altBits, p.selRect.top - p.altBits.bounds.top, p.selRect.bottom - p.selRect.top, p.lassoBlack);
      p.edgeFlag = true;
    }
    p.inSel = false;
    for (let dh = -2; dh <= 2 && !p.inSel; dh++) {
      for (let dv = -2; dv <= 2 && !p.inSel; dv++) {
        if (pixelTrue(mousePt.h + dh, mousePt.v + dv, p.maskBits)) p.inSel = true;
      }
    }
  } else p.inSel = p.selFlag && ptInRect(mousePt, p.selRect);

  if (p.cursorFlag || p.inWindow !== wasInWindow || p.inSel !== wasInSel) {
    if (!p.inWindow) cursorNormal(p);
    else p.cursor = p.inSel ? "arrow" : "tool";
  }

  const oldIndex = p.selIndex;
  let now = ticks & 0xffff;
  if (p.fatFlag) now = div(now, 3);
  p.selIndex = now & 7;
  if (p.selIndex !== oldIndex) {
    if (p.edgeFlag) showEdges(p);
    if (p.selFlag) {
      PenNormal();
      PenPat(getSelPat(p.selIndex));
      if (p.fatFlag) {
        SetPortBits(p.fatBits);
        FrameRect(p.selRect);
        SetPortBits(p.docBits);
        fatToScrn(p.fatBits, p.scrn);
      } else FrameRect(p.selRect);
    }
  }
  p.cursorFlag = false;
}
