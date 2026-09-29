/**
 * The desk's palettes — tools down the left, line sizes under them,
 * patterns along the bottom — and the tool cursor. MacPaint.p `DrawPat`,
 * `InvTool`, `DrawTool`, `SetToolCursor`, `ChooseTool`, `InvLnSize`,
 * `ChooseLine`, `DrawLine`, `ChoosePat`.
 */

import {
  CopyBits,
  EraseRect,
  FillRect,
  FrameRect,
  GetPort,
  InvertRect,
  LineTo,
  Move,
  MoveTo,
  PaintRect,
  SetPort,
  SetPortBits,
  srcOr,
  srcXor,
  type Rect,
} from "@mockintosh/quickdraw";
import { glyphWords, paintGlyph } from "./art";
import { acceptEdits, altToScrn, killStuff, setLineSize, setSelRect } from "./buffers";
import { gray, insetRect, ltGray, offsetRect, pt, rect } from "./bits";
import {
  AIDS_ITEM,
  AIDS_MENU,
  BRUSH_TOOL,
  ERASE_TOOL,
  GRABBER_TOOL,
  LASSO_TOOL,
  LINE_LEFT,
  LINE_RIGHT,
  LINE_TOOL,
  LINE_TOP,
  PAT_BOTTOM,
  PAT_LEFT,
  PAT_MID,
  PAT_RIGHT,
  PAT_ROW,
  PAT_SPACE,
  PAT_START,
  PAT_TOP,
  PENCIL_TOOL,
  SELECT_TOOL,
  SPRAY_TOOL,
  TEXT_TOOL,
  FILL_TOOL,
  TOOL_BOTTOM,
  TOOL_LEFT,
  TOOL_MID,
  TOOL_RIGHT,
  TOOL_SPACE,
  TOOL_TOP,
  type Paint,
} from "./state";
import type { Co } from "./toolbox";
import { chooseBrush, editPat, showPage } from "./dialogs";
import { menuCommand } from "./commands";

/** `DrawChar` in PaintFont: the glyph hangs below the pen. */
export function drawPaintChar(code: number, mode = srcOr): void {
  const port = GetPort();
  if (!port) return;
  const glyph = paintGlyph(code);
  const { h, v } = port.pnLoc;
  const b = glyph.bits.bounds;
  CopyBits(glyph.bits, port.portBits, b, rect(h, v, h + b.right, v + b.bottom), mode, null);
  Move(glyph.width, 0);
}

export function paintCharWidth(code: number): number {
  return paintGlyph(code).width;
}

/** Paint `r` with the one-pixel drop shadow every palette has. */
function shadowBox(r: Rect): void {
  PaintRect(offsetRect(r, 1, 1));
  EraseRect(r);
  FrameRect(r);
}

export function drawPat(p: Paint): void {
  const savePort = GetPort();
  SetPort(p.deskWind.port);
  shadowBox(p.patRect);
  p.thePat = p.patterns[p.thePatIndex]!;
  p.fillSample = rect(PAT_LEFT + 8, PAT_TOP + 6, PAT_START - 7, PAT_BOTTOM - 6);
  FrameRect(p.fillSample);
  p.fillSample = insetRect(p.fillSample, 1, 1);
  FillRect(p.fillSample, p.thePat);
  PaintRect(rect(PAT_START - 1, PAT_TOP + 1, PAT_RIGHT - 1, PAT_BOTTOM - 1));
  let h = PAT_START;
  for (let i = 0; i < PAT_ROW; i++) {
    const left = h;
    h += PAT_SPACE;
    FillRect(rect(left, PAT_TOP + 1, h - 1, PAT_MID), p.patterns[i]!);
    FillRect(rect(left, PAT_MID + 1, h - 1, PAT_BOTTOM - 1), p.patterns[i + PAT_ROW]!);
  }
  if (savePort) SetPort(savePort);
}

export function invTool(p: Paint): void {
  const top = TOOL_TOP + 1 + (p.theTool >> 1) * TOOL_SPACE;
  const odd = p.theTool & 1;
  InvertRect(rect(odd ? TOOL_MID + 1 : TOOL_LEFT + 1, top, odd ? TOOL_RIGHT - 1 : TOOL_MID, top + TOOL_SPACE - 1));
}

export function drawTool(p: Paint): void {
  shadowBox(p.toolRect);
  MoveTo(TOOL_MID, TOOL_TOP);
  LineTo(TOOL_MID, TOOL_BOTTOM);
  let v = TOOL_TOP;
  let whichChar = "E".charCodeAt(0);
  for (let i = 0; i <= 9; i++) {
    MoveTo(TOOL_LEFT + 14 - (paintCharWidth(whichChar) >> 1), v + 4);
    drawPaintChar(whichChar);
    whichChar++;
    MoveTo(TOOL_MID + 14 - (paintCharWidth(whichChar) >> 1), v + 4);
    drawPaintChar(whichChar);
    whichChar++;
    v += TOOL_SPACE;
    MoveTo(TOOL_LEFT, v);
    if (i !== 9) LineTo(TOOL_RIGHT - 1, v);
  }
  invTool(p);
}

const CHECK = 65;

export function invLnSize(p: Paint): void {
  SetPort(p.deskWind.port);
  let v = LINE_TOP + 5;
  if (p.borderFlag) {
    if (p.lineSize === 1) v = LINE_TOP + 15;
    else if (p.lineSize === 2) v = LINE_TOP + 26;
    else if (p.lineSize === 4) v = LINE_TOP + 38;
    else if (p.lineSize === 8) v = LINE_TOP + 52;
  }
  MoveTo(LINE_LEFT + 2, v);
  drawPaintChar(CHECK, srcXor);
}

export function drawLine(p: Paint): void {
  shadowBox(p.lineRect);
  const left = LINE_LEFT + 17;
  const right = LINE_RIGHT - 7;
  FillRect(rect(left, LINE_TOP + 12, right, LINE_TOP + 13), ltGray);
  PaintRect(rect(left, LINE_TOP + 23, right, LINE_TOP + 24));
  PaintRect(rect(left, LINE_TOP + 33, right, LINE_TOP + 35));
  PaintRect(rect(left, LINE_TOP + 44, right, LINE_TOP + 48));
  PaintRect(rect(left, LINE_TOP + 57, right, LINE_TOP + 65));
  invLnSize(p);
}

/** `UpdateWindow(@deskWind)`: gray, then the three palettes. */
export function drawDesk(p: Paint): void {
  const savePort = GetPort();
  SetPort(p.deskWind.port);
  FillRect(p.deskWind.port.portRect, gray);
  drawTool(p);
  drawLine(p);
  drawPat(p);
  if (savePort) SetPort(savePort);
}

export function setToolCursor(p: Paint): void {
  let hotH = 8;
  let hotV = 8;
  let dataCh = 0;
  let maskCh = 97;
  switch (p.theTool) {
    case LASSO_TOOL:
      dataCh = 69;
      hotH = 2;
      hotV = 15;
      break;
    case SELECT_TOOL:
      dataCh = 114;
      maskCh = 115;
      break;
    case GRABBER_TOOL:
      dataCh = 71;
      maskCh = 109;
      break;
    case TEXT_TOOL:
      dataCh = 110;
      hotV = 13;
      break;
    case FILL_TOOL:
      dataCh = 73;
      maskCh = 93;
      hotH = 13;
      hotV = 16;
      break;
    case SPRAY_TOOL:
      dataCh = 111;
      break;
    case BRUSH_TOOL:
      dataCh = 120 + p.theBrush;
      break;
    case PENCIL_TOOL:
      dataCh = 76;
      maskCh = 116;
      hotH = 3;
      hotV = 16;
      break;
    case ERASE_TOOL:
      dataCh = 119;
      maskCh = 120;
      break;
    default:
      dataCh = p.lineSize === 1 ? 89 : p.lineSize === 2 ? 90 : p.lineSize === 4 ? 91 : 92;
  }
  p.toolCursor = { data: glyphWords(dataCh), mask: glyphWords(maskCh), hotSpot: pt(hotH, hotV) };
  p.cursorFlag = true;
}

/** Whether a tool snaps to the grid: `theTool IN [1,3,8,10..15,18,19]`. */
function toolGrids(tool: number): boolean {
  return [1, 3, 8, 10, 11, 12, 13, 14, 15, 18, 19].includes(tool);
}

export function* chooseTool(p: Paint, where: { h: number; v: number }): Co {
  killStuff(p);
  p.oldSelFlag = false;
  p.acceptFlag = false;
  p.fatScroll = false;
  SetPort(p.deskWind.port);

  if (p.theTool !== ERASE_TOOL) p.prevTool = p.theTool;
  invTool(p);
  p.theTool = Math.min(18, 2 * Math.trunc((where.v - TOOL_TOP) / TOOL_SPACE));
  if (where.h > TOOL_MID) p.theTool++;

  const tempRect = { ...(p.fatFlag ? p.fatBits.bounds : p.myWind.port.portRect) };
  if (p.theTool === ERASE_TOOL && p.clickCount > 1 && p.windOpen) {
    acceptEdits(p);
    SetPort(p.myWind.port);
    SetPortBits(p.altBits);
    EraseRect(tempRect);
    altToScrn(p);
    SetPort(p.deskWind.port);
    p.theTool = p.prevTool;
    p.clickCount = 1;
    p.workDirty = true;
    p.docDirty = true;
  }

  invTool(p);
  setToolCursor(p);
  p.toolGrid = toolGrids(p.theTool);

  if (p.clickCount > 1) {
    if (p.theTool === BRUSH_TOOL) yield* chooseBrush(p);
    if (p.windOpen) {
      if (p.theTool === SELECT_TOOL) {
        tempRect.right++;
        tempRect.bottom++;
        setSelRect(p, tempRect, true);
        p.selFlag = true;
        p.oldSelRect = { ...p.selRect };
        p.whiteFlag = true;
        p.acceptFlag = true;
      }
      if (p.theTool === GRABBER_TOOL) yield* showPage(p);
      if (p.theTool === PENCIL_TOOL) yield* menuCommand(p, AIDS_MENU, AIDS_ITEM.fat);
    }
  }
}

export function chooseLine(p: Paint, where: { h: number; v: number }): void {
  invLnSize(p);
  let size = 1;
  p.borderFlag = where.v > LINE_TOP + 18;
  if (where.v > LINE_TOP + 28) size = 2;
  if (where.v > LINE_TOP + 39) size = 4;
  if (where.v > LINE_TOP + 52) size = 8;
  setLineSize(p, size);
  invLnSize(p);
  if (p.theTool >= LINE_TOOL) setToolCursor(p);
}

export function* choosePat(p: Paint, where: { h: number; v: number }): Co {
  if (where.h > PAT_START) {
    p.thePatIndex = Math.trunc((where.h - PAT_START) / PAT_SPACE);
    if (where.v > PAT_MID) p.thePatIndex += PAT_ROW;
    p.thePat = p.patterns[p.thePatIndex]!;
    FillRect(p.fillSample, p.thePat);
  }
  if (p.clickCount > 1) yield* editPat(p);
}
