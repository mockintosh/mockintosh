/**
 * MacPaint.p's globals, gathered into one record. The routines that use
 * them are free functions taking `p: Paint`, one module per part of the
 * original listing.
 */

import {
  GetPort,
  OpenPort,
  RectRgn,
  SetPort,
  type BitMap,
  type FontInfo,
  type GrafPort,
  type Pattern,
  type PicHandle,
  type Point,
  type Rect,
} from "@mockintosh/quickdraw";
import type { PaintDocument } from "@mockintosh/sdk";
import { BUF_HEIGHT, BUF_WIDTH, FAT_HEIGHT, FAT_WIDTH, newBuf, newFatBits } from "./asm";
import { newBits, pt, rect } from "./bits";
import { PAINT_PATTERNS } from "./patterns";
import { Toolbox, type EventModifiers, type EventRecord, type MacWindow } from "./toolbox";

export const DOC_WIDTH = 576;
export const DOC_HEIGHT = 720;
export const DOC_ROW = 72;
export const BAND_HEIGHT = 48;

export const PAT_LEFT = 77;
export const PAT_RIGHT = 500;
export const PAT_TOP = 300;
export const PAT_BOTTOM = 335;
export const PAT_MID = 317;
export const PAT_SPACE = 20;
export const PAT_ROW = 19;
export const PAT_START = 120;

export const LINE_LEFT = 15;
export const LINE_RIGHT = 68;
export const LINE_TOP = 258;
export const LINE_BOTTOM = 335;

export const TOOL_LEFT = 15;
export const TOOL_RIGHT = 68;
export const TOOL_TOP = 28;
export const TOOL_BOTTOM = 249;
export const TOOL_MID = 41;
export const TOOL_SPACE = 22;

export const LASSO_TOOL = 0;
export const SELECT_TOOL = 1;
export const GRABBER_TOOL = 2;
export const TEXT_TOOL = 3;
export const FILL_TOOL = 4;
export const SPRAY_TOOL = 5;
export const BRUSH_TOOL = 6;
export const PENCIL_TOOL = 7;
export const LINE_TOOL = 8;
export const ERASE_TOOL = 9;

/** Diameter of curvature for round rects. */
export const CORNER = 18;
/** How many lines of type-in text. */
export const MAX_LINES = 20;

export const APPLE_MENU = 1;
export const FILE_MENU = 2;
export const EDIT_MENU = 3;
export const AIDS_MENU = 4;
export const FONT_MENU = 5;
export const SIZE_MENU = 6;
export const STYLE_MENU = 7;

export const FILE_ITEM = { new: 1, open: 2, close: 3, save: 4, saveAs: 5, revert: 6, prDraft: 7, prFinal: 8, prCat: 9, quit: 10 } as const;
export const EDIT_ITEM = { undo: 1, cut: 3, copy: 4, paste: 5, clear: 6, invert: 8, fill: 9, edges: 10, hFlip: 11, vFlip: 12, rotate: 13 } as const;
export const AIDS_ITEM = { grid: 1, fat: 2, page: 3, patEd: 4, brush: 5, sym: 6, intro: 7, short: 8 } as const;
export const STYLE_ITEM = { plain: 1, bold: 2, italic: 3, underline: 4, outline: 5, shadow: 6, left: 8, center: 9, right: 10 } as const;

export const FONT_SIZES = [9, 10, 12, 14, 18, 24, 36, 48, 72] as const;

export type TextJust = "left" | "center" | "right";

/** `InitCursor`, the hourglass (`GetCursor(4)`), or `SetCursor(toolCursor)`. */
export type PaintCursor = "arrow" | "watch" | "tool";

/** A 16×16 'CURS': one word per row, MSB leftmost. */
export interface ToolCursor {
  data: Uint16Array;
  mask: Uint16Array;
  hotSpot: Point;
}

/**
 * MacPaint's 'PICT' scrap. The system clipboard only carries text, so the
 * picture stays with MacPaint; `hostText` is what the system clipboard held
 * when it was cut, so a later copy elsewhere wins at Paste.
 */
export interface PaintScrap {
  pic: PicHandle;
  hostText: string | null;
}

/** What MacPaint needs from the machine around it: its windows, the disk, the printer. */
export interface PaintHost {
  /** Show a dialog whose content is `win.bits`; returns a handle for {@link closeDialog}. */
  openDialog(win: MacWindow, options: { modal: boolean }): string;
  closeDialog(id: string): void;
  /** `ShowWindow` / `HideWindow` on the document window. */
  showDocWindow(show: boolean): void;
  setDocTitle(title: string): void;
  beep(): void;
  quit(): void;
  /** `Alert`: resolves the 1-based item hit. */
  alertDialog(message: string, buttons: readonly string[], icon: "stop" | "note" | "caution"): Promise<number>;
  /** QuickDraw family number of the system font dialogs are drawn in. */
  systemFont(): number;
  /** The system clipboard's text: the 'TEXT' scrap. */
  clipboardText(): Promise<string | null>;
  /** `GetKeys`, for the modifier keys MacPaint polls while tracking. */
  heldModifiers(): EventModifiers;
  /** `SFGetFile` for 'PNTG' files: resolves the chosen file, or `null` on Cancel. */
  getFile(): Promise<PaintFileRef | null>;
  /** `SFPutFile`: resolves the typed name, or `null` on Cancel. */
  putFile(message: string, defaultName: string): Promise<string | null>;
  readDocument(file: PaintFileRef): Promise<PaintDocument | null>;
  /** Write `doc` beside `near` (or on the desktop), replacing a file of that name. */
  writeDocument(name: string, doc: PaintDocument, near: PaintFileRef | null): Promise<PaintFileRef>;
  /** Print the page, `docWidth` wide. */
  printPage(page: BitMap): Promise<void>;
  /** Font family names for the Font menu (`AddResMenu(…, 'FONT')`). */
  fontNames(): string[];
  /** QuickDraw family number for a Font menu name (`GetFNum`). */
  fontNumber(name: string): number;
  /** The name of the application font (`GetFontName(1, …)`). */
  applicationFont(): string;
}

export interface PaintFileRef {
  id: string;
  name: string;
}

/** `NewWindow`'s port: drawing into `bits`, local coordinates = `bits.bounds`. */
export function newWindowPort(bits: BitMap): GrafPort {
  const savePort = GetPort();
  const port = {} as GrafPort;
  OpenPort(port);
  port.portBits = copyBits(bits);
  port.portRect = { ...bits.bounds };
  RectRgn(port.visRgn, bits.bounds);
  if (savePort) SetPort(savePort);
  return port;
}

/** A MacWindow over fresh pixels of `size`, its content at `origin` on the screen. */
export function newMacWindow(origin: Point, width: number, height: number): MacWindow {
  const bits = newBits(rect(0, 0, width, height));
  return { port: newWindowPort(bits), origin, bits };
}

export class Paint {
  readonly tb: Toolbox;
  readonly host: PaintHost;

  active = true;
  quitFlag = false;
  /** True when the screen image is in altBuf. */
  scrnFlag = false;
  /** What `SetCursor` last installed. */
  cursor: PaintCursor = "arrow";
  theEvent: EventRecord | null = null;

  okPrint = false;

  /** The whole page — the work files `Paint1`/`Paint2` of the original, in memory. */
  work: BitMap = newBits(rect(0, 0, DOC_WIDTH, DOC_HEIGHT), DOC_ROW);
  workDirty = false;
  docDirty = false;
  windOpen = true;
  /** Empty for an untitled document. */
  docName = "";
  docFile: PaintFileRef | null = null;
  /** A document the Finder asked the running MacPaint to open. */
  pendingOpen: PaintFileRef | null = null;

  /** The document window: content at `docRect`, pixels in {@link scrn}. */
  readonly myWind: MacWindow;
  /** The desk behind it: the whole screen, holding the palettes. */
  readonly deskWind: MacWindow;
  /** Controls MacPaint shows in `myWind` (window coordinates). */
  readonly okButtonRect = rect(320, 172, 400, 190);
  readonly cancelButtonRect = rect(320, 206, 400, 224);

  theKey = "";

  shiftFlag = false;
  featureFlag = false;
  optionFlag = false;
  hiResFlag = true;

  textFlag = false;
  textLoc: Point = pt(0, 0);
  textLeft = 0;
  caretLoc: Point = pt(0, 0);
  caretState = false;
  nextCaretTime = 0;
  textLines: string[] = [];
  prevSizeChar = ",";
  nextSizeChar = ".";

  clickTime = 0;
  clickCount = 1;
  clickLoc: Point = pt(0, 0);
  killDouble = false;
  skipDouble = false;

  patterns: Pattern[] = PAINT_PATTERNS.map((pat) => pat.slice());
  lineSize = 1;
  halfLineSize = 0;
  borderFlag = true;

  thePat: Pattern;
  thePatIndex = 0;

  gridOn = false;
  toolGrid = false;

  toolCursor: ToolCursor = { data: new Uint16Array(16), mask: new Uint16Array(16), hotSpot: pt(8, 8) };
  cursorFlag = true;
  inWindow = false;
  inSel = false;
  fatScroll = false;

  /** Pasted text: typed text becomes a scrap when it is selected and pasted. */
  txScrap: string | null = null;
  txMinWidth = 0;
  txMinHeight = 0;

  fonts: string[] = [];
  /** 1-based index into {@link fonts}. */
  theFont = 1;
  theFontID = 0;
  theFontSize = 3;
  txJustItem: number = STYLE_ITEM.left;
  textJust: TextJust = "left";
  info: FontInfo = { ascent: 0, descent: 0, widMax: 0, leading: 0 };

  readonly zeroRect = rect(0, 0, 0, 0);
  readonly pageRect = rect(0, 0, DOC_WIDTH, DOC_HEIGHT);
  readonly docRect = rect(80, 48, 496, 288);
  readonly patRect = rect(PAT_LEFT, PAT_TOP, PAT_RIGHT, PAT_BOTTOM);
  fillSample = rect(0, 0, 0, 0);
  readonly lineRect = rect(LINE_LEFT, LINE_TOP, LINE_RIGHT, LINE_BOTTOM);
  readonly toolRect = rect(TOOL_LEFT, TOOL_TOP, TOOL_RIGHT, TOOL_BOTTOM);

  whiteFlag = false;
  acceptFlag = false;
  selFlag = false;
  selRect: Rect = rect(0, 0, 0, 0);
  pivot: Point = pt(0, 0);

  /** True if edges are in altBits. */
  edgeFlag = false;
  lassoBlack = false;
  /** True if the mask is in maskBits. */
  maskFlag = false;
  maskBits: BitMap | null = null;
  maskPaste = false;

  oldWhiteFlag = false;
  oldAcceptFlag = false;
  oldSelFlag = false;
  oldSelRect: Rect = rect(0, 0, 0, 0);
  oldPivot: Point = pt(0, 0);
  oldMaskFlag = false;
  oldLassoBlack = false;
  selIndex = 0;

  theTool = BRUSH_TOOL;
  prevTool = BRUSH_TOOL;
  theBrush = 7;

  hSymFlag = false;
  vSymFlag = false;
  hvSymFlag = false;
  vhSymFlag = false;
  symByte = 0x80;

  fatFlag = false;
  fatBits: BitMap;
  fatCenter: Point = pt(0, 0);

  /** `myWind.port.portBits`: the window's pixels, in page coordinates. */
  docBits: BitMap;
  mainBits: BitMap;
  altBits: BitMap;
  /** The document window's pixels: `scrnPtr`, always at buffer coordinates. */
  readonly scrn: BitMap;

  myPinRect: Rect = rect(0, 0, 0, 0);
  hConstrain = false;
  vConstrain = false;
  ptConstrain: Point = pt(0, 0);

  rwShftDh = 0;
  rwShftDv = 0;
  patEdPt: Point = pt(0, 0);

  scrap: PaintScrap | null = null;
  /** Open dialogs and modal loops (Show Page, help pictures): the menubar is dead while any is up. */
  dialogDepth = 0;

  constructor(host: PaintHost, tb: Toolbox, screen: Rect) {
    this.host = host;
    this.tb = tb;
    this.thePat = this.patterns[0]!;
    this.scrn = newBuf(rect(0, 0, BUF_WIDTH, BUF_HEIGHT));
    this.myWind = { port: newWindowPort(this.scrn), origin: pt(this.docRect.left, this.docRect.top), bits: this.scrn };
    const deskBits = newBits(screen);
    this.deskWind = { port: newWindowPort(deskBits), origin: pt(screen.left, screen.top), bits: deskBits };
    tb.addWindow(this.myWind);
    tb.addWindow(this.deskWind);
    this.docBits = copyBits(this.myWind.port.portBits);
    this.mainBits = newBuf(rect(80, 120, 80 + BUF_WIDTH, 120 + BUF_HEIGHT));
    this.altBits = newBuf(this.mainBits.bounds);
    this.fatBits = newFatBits(rect(0, 0, FAT_WIDTH, FAT_HEIGHT));
  }
}

/** `BitMap` records are values in Pascal: assigning one copies it. */
export function copyBits(bits: BitMap): BitMap {
  return { baseAddr: bits.baseAddr, rowBytes: bits.rowBytes, bounds: { ...bits.bounds } };
}
