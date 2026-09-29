/**
 * The document on disk and the window onto it. MacPaint keeps the whole
 * 576×720 page in a work file and only the 416×240 window in memory;
 * `ReadWrite` streams the page through a band buffer, merging the window's
 * edits, shifting, shrinking for Show Page, printing and loading the window
 * as it goes. Here the work file is a page in memory and the disk is the
 * host's file system, but the band walk is the original's.
 * MacPaint.p lines 1210–1517, 2750–2774, 4288–4924.
 */

import {
  CopyBits,
  EraseRect,
  FillRect,
  FrameRect,
  PenNormal,
  SetOrigin,
  SetPort,
  srcCopy,
  srcXor,
  type BitMap,
  type Pattern,
} from "@mockintosh/quickdraw";
import type { PaintDocument } from "@mockintosh/sdk";
import { zeroFat } from "./asm";
import { acceptEdits, altToScrn, bandToScrn, busyCursor, killStuff, scrnToAlt } from "./buffers";
import { copyRect, emptyRect, equalPattern, insetRect, ltGray, newBits, offsetRect, pinPt, pt, rect, sectRect, zeroBuf } from "./bits";
import { saveAlert, shouldSave } from "./dialogs";
import { drawPat } from "./palette";
import { copyBits, BAND_HEIGHT, DOC_HEIGHT, DOC_ROW, DOC_WIDTH, type Paint, type PaintFileRef } from "./state";
import { awaitPromise, type Co } from "./toolbox";
import { PAINT_PATTERNS } from "./patterns";

const PATTERN_COUNT = 38;

/** A page as it streams from a file: its pixels and, from version 2 on, its patterns. */
export interface PageSource {
  bits: BitMap;
  patterns: Pattern[] | null;
}

export interface ReadWriteOptions {
  /** Merge the window's accepted edits (mainBits) into the page. */
  fromMain: boolean;
  /** Load the window (altBits and the screen) from the page. */
  toAlt: boolean;
  /** Draw the page at one third size in the window, for Show Page. */
  toShrink: boolean;
  toPrint: boolean;
  /** Take the patterns stored with the page. */
  newPat: boolean;
  /** Produce the resulting page, as writing to `dstFile` did. */
  write: boolean;
}

export function newPage(): BitMap {
  return newBits(rect(0, 0, DOC_WIDTH, DOC_HEIGHT), DOC_ROW);
}

export function pageFromDocument(doc: PaintDocument): PageSource {
  const bits: BitMap = { baseAddr: doc.bits, rowBytes: DOC_ROW, bounds: rect(0, 0, DOC_WIDTH, DOC_HEIGHT) };
  let patterns: Pattern[] | null = null;
  if (doc.patterns) {
    patterns = [];
    for (let i = 0; i < PATTERN_COUNT; i++) patterns.push(doc.patterns.slice(i * 8, i * 8 + 8));
  }
  return { bits, patterns };
}

export function documentFromPage(page: BitMap, patterns: readonly Pattern[]): PaintDocument {
  const packed = new Uint8Array(PATTERN_COUNT * 8);
  patterns.forEach((pat, i) => packed.set(pat, i * 8));
  return { bits: page.baseAddr.slice(), patterns: packed };
}

/** `ReadWrite`: returns the written page when `write` is set. */
export function* readWrite(p: Paint, src: PageSource, opts: ReadWriteOptions): Co<BitMap | null> {
  busyCursor(p);
  SetPort(p.myWind.port);
  p.okPrint = opts.toPrint;
  if (opts.toAlt) scrnToAlt(p);

  let shrinkRect = rect(0, 0, 0, 0);
  if (opts.toShrink) {
    FillRect(p.myWind.port.portRect, ltGray);
    shrinkRect = copyRect(p.myWind.port.portRect);
    shrinkRect.left = shrinkRect.left + 208 - 96;
    shrinkRect.right = shrinkRect.left + 192;
    PenNormal();
    EraseRect(shrinkRect);
    FrameRect(insetRect(shrinkRect, -1, -1));
    shrinkRect.bottom = shrinkRect.top + BAND_HEIGHT / 3;
  }

  if (opts.newPat && src.patterns && !src.patterns.every((pat, i) => equalPattern(pat, p.patterns[i]!))) {
    p.patterns = src.patterns.map((pat) => pat.slice());
    drawPat(p);
  }

  const out = opts.write ? newPage() : null;
  const printed = opts.toPrint ? newPage() : null;
  const band = newBits(rect(0, 0, DOC_WIDTH, BAND_HEIGHT), DOC_ROW);
  const bandRows = band.baseAddr;

  for (let b = 0; b < DOC_HEIGHT / BAND_HEIGHT; b++) {
    for (let row = 0; row < BAND_HEIGHT; row++) {
      const srcRow = b * BAND_HEIGHT + row - p.rwShftDv;
      const dst = row * DOC_ROW;
      if (srcRow < 0 || srcRow >= DOC_HEIGHT) bandRows.fill(0, dst, dst + DOC_ROW);
      else bandRows.set(src.bits.baseAddr.subarray(srcRow * DOC_ROW, (srcRow + 1) * DOC_ROW), dst);
    }

    const mainRect = sectRect(p.mainBits.bounds, band.bounds);
    if (opts.fromMain && !emptyRect(mainRect)) CopyBits(p.mainBits, band, mainRect, mainRect, srcCopy, null);

    const dh = p.rwShftDh;
    if (dh !== 0) {
      const srcRect = copyRect(band.bounds);
      const dstRect = copyRect(band.bounds);
      const erasRect = copyRect(band.bounds);
      if (dh > 0) {
        srcRect.right -= dh;
        dstRect.left += dh;
        erasRect.right = erasRect.left + dh;
      } else {
        srcRect.left -= dh;
        dstRect.right += dh;
        erasRect.left = erasRect.right + dh;
      }
      CopyBits(band, band, srcRect, dstRect, srcCopy, null);
      CopyBits(band, band, erasRect, erasRect, srcXor, null);
    }

    if (opts.toShrink) {
      CopyBits(band, p.docBits, band.bounds, shrinkRect, srcCopy, null);
      shrinkRect = offsetRect(shrinkRect, 0, BAND_HEIGHT / 3);
    }

    if (printed) printed.baseAddr.set(bandRows, b * BAND_HEIGHT * DOC_ROW);

    const altRect = sectRect(p.altBits.bounds, band.bounds);
    if (opts.toAlt && !emptyRect(altRect)) {
      CopyBits(band, p.altBits, altRect, altRect, srcCopy, null);
      bandToScrn(p, p.altBits, altRect.top, altRect.bottom);
    }

    if (out) out.baseAddr.set(bandRows, b * BAND_HEIGHT * DOC_ROW);
    band.bounds = offsetRect(band.bounds, 0, BAND_HEIGHT);
  }

  if (printed) {
    try {
      yield* awaitPromise(p.host.printPage(printed));
    } catch {
      p.okPrint = false;
    }
  }
  p.cursorFlag = true;
  if (p.cursor === "watch") p.cursor = "arrow";
  return out;
}

/** Stream the work page back through the window, keeping the result as the new work page when dirty. */
export function* cycleWork(p: Paint, opts: Omit<ReadWriteOptions, "fromMain" | "write" | "newPat">): Co {
  const dirty = p.workDirty;
  const out = yield* readWrite(p, { bits: p.work, patterns: null }, { ...opts, fromMain: dirty, write: dirty, newPat: false });
  if (out) {
    p.work = out;
    p.workDirty = false;
  }
}

/** `SetOrigin` on the document window, then `docBits := portBits; altBits.bounds := portRect`. */
export function setDocOrigin(p: Paint, h: number, v: number): void {
  SetOrigin(h, v);
  p.docBits = copyBits(p.myWind.port.portBits);
  p.altBits.bounds = copyRect(p.myWind.port.portRect);
}

/** `ScrollTo`: move the window over the page and reload it. */
export function* scrollTo(p: Paint, newOrigin: { h: number; v: number }): Co {
  SetPort(p.myWind.port);
  const origin = pinPt(newOrigin, rect(0, 0, DOC_WIDTH - 416, DOC_HEIGHT - 240));
  setDocOrigin(p, origin.h, origin.v);
  yield* cycleWork(p, { toAlt: true, toShrink: false, toPrint: false });
  p.mainBits.bounds = copyRect(p.altBits.bounds);
  if (p.maskBits) p.maskBits.bounds = copyRect(p.altBits.bounds);
  acceptEdits(p);
  p.fatCenter = pt(origin.h + 208, origin.v + 120);
}

export function newDocInit(p: Paint): void {
  p.mainBits.bounds = rect(80, 120, 80 + 416, 120 + 240);
  zeroBuf(p.mainBits);
  p.altBits.bounds = copyRect(p.mainBits.bounds);
  zeroBuf(p.altBits);

  p.fatBits.bounds = rect(80 + 208 - 26, 120 + 120 - 15, 80 + 208 + 26, 120 + 120 + 15);
  p.fatCenter = pt(80 + 208, 120 + 120);
  p.pivot = { ...p.fatCenter };
  zeroFat(p.fatBits);
  p.fatFlag = false;

  SetPort(p.myWind.port);
  EraseRect(p.myWind.port.portRect);
  setDocOrigin(p, p.mainBits.bounds.left, p.mainBits.bounds.top);

  p.textFlag = false;
  p.maskFlag = false;
  p.maskBits = null;
  p.edgeFlag = false;
  p.whiteFlag = false;
  p.acceptFlag = false;
  p.selFlag = false;
  p.selRect = copyRect(p.zeroRect);
  p.lassoBlack = false;
  p.textLoc = pt(0, 0);
  p.textLeft = 0;
  p.caretLoc = pt(0, 0);

  p.oldWhiteFlag = p.whiteFlag;
  p.oldAcceptFlag = p.acceptFlag;
  p.oldMaskFlag = p.maskFlag;
  p.oldSelFlag = p.selFlag;
  p.oldSelRect = copyRect(p.selRect);
  p.oldPivot = { ...p.pivot };
  p.oldLassoBlack = p.lassoBlack;

  p.selIndex = 0;
  p.docDirty = false;
  p.workDirty = false;
}

/** `BlankDoc`: an empty page in the work file. */
export function blankDoc(p: Paint): void {
  p.work = newPage();
}

export function openMyWind(p: Paint): void {
  p.host.showDocWindow(true);
  SetPort(p.myWind.port);
  p.windOpen = true;
}

function setTitle(p: Paint, title: string): void {
  p.host.setDocTitle(title);
}

export const TITLE_STRING = "MacPaint by Bill Atkinson";
export const UNTITLED_STRING = "untitled";
export const SAVE_STRING = "Save document as:";

/** `OpenFirstDoc`: the document the Finder opened MacPaint with, else a blank one. */
export function* openFirstDoc(p: Paint, file: PaintFileRef | null): Co {
  p.quitFlag = true;
  if (!file) {
    setTitle(p, UNTITLED_STRING);
  } else {
    setTitle(p, file.name);
    const doc = yield* awaitPromise(p.host.readDocument(file));
    if (!doc) {
      yield* saveAlert(p, "rErr");
      return;
    }
    p.docName = file.name;
    p.docFile = file;
    const out = yield* readWrite(p, pageFromDocument(doc), { fromMain: false, toAlt: true, toShrink: false, toPrint: false, newPat: true, write: true });
    if (out) p.work = out;
  }
  p.quitFlag = false;
  acceptEdits(p);
  altToScrn(p);
}

export function* newDoc(p: Paint): Co {
  newDocInit(p);
  p.docName = "";
  p.docFile = null;
  setTitle(p, UNTITLED_STRING);
  openMyWind(p);
  if (!PAINT_PATTERNS.every((pat, i) => equalPattern(pat, p.patterns[i]!))) {
    p.patterns = PAINT_PATTERNS.map((pat) => pat.slice());
    drawPat(p);
  }
  blankDoc(p);
  acceptEdits(p);
}

export function* openDoc(p: Paint): Co {
  const file = yield* awaitPromise(p.host.getFile());
  if (!file) return;
  yield* openDocFile(p, file);
}

/** A document opened from the Finder while MacPaint runs: close this one first, as Open requires. */
export function* finderOpen(p: Paint, file: PaintFileRef): Co {
  if (p.windOpen) {
    killStuff(p);
    acceptEdits(p);
    yield* closeMyWind(p);
    if (p.windOpen) return;
  }
  yield* openDocFile(p, file);
}

function* openDocFile(p: Paint, file: PaintFileRef): Co {
  const doc = yield* awaitPromise(p.host.readDocument(file));
  if (!doc) {
    yield* saveAlert(p, "rErr");
    return;
  }
  newDocInit(p);
  p.docName = file.name;
  p.docFile = file;
  setTitle(p, file.name);
  openMyWind(p);
  const out = yield* readWrite(p, pageFromDocument(doc), { fromMain: false, toAlt: true, toShrink: false, toPrint: false, newPat: true, write: true });
  if (out) p.work = out;
  acceptEdits(p);
  altToScrn(p);
}

/** `SaveDoc`: false when cancelled or when writing failed. */
export function* saveDoc(p: Paint, askFirst: boolean): Co<boolean> {
  let name = p.docName;
  if (askFirst || name.length === 0) {
    acceptEdits(p);
    const reply = yield* awaitPromise(p.host.putFile(SAVE_STRING, p.docName));
    SetPort(p.myWind.port);
    if (!reply) return false;
    name = reply;
  }

  const page = yield* readWrite(p, { bits: p.work, patterns: null }, { fromMain: p.workDirty, toAlt: false, toShrink: false, toPrint: false, newPat: false, write: true });
  if (!page) return false;
  let written: PaintFileRef;
  try {
    const near = p.docFile;
    written = yield* awaitPromise(p.host.writeDocument(name, documentFromPage(page, p.patterns), near));
  } catch {
    yield* saveAlert(p, "wErr");
    return false;
  }
  if (p.workDirty) {
    p.work = page;
    p.workDirty = false;
  }
  if (p.docName !== written.name || p.docFile?.id !== written.id) {
    p.docName = written.name;
    p.docFile = written;
    setTitle(p, written.name);
  }
  p.docDirty = false;
  return true;
}

export function* revertDoc(p: Paint): Co {
  const result = yield* saveAlert(p, "revert");
  if (result !== 1) return;
  if (p.docName.length === 0 || !p.docFile) {
    newDocInit(p);
    blankDoc(p);
  } else {
    const doc = yield* awaitPromise(p.host.readDocument(p.docFile));
    if (!doc) {
      yield* saveAlert(p, "rErr");
      return;
    }
    const out = yield* readWrite(p, pageFromDocument(doc), { fromMain: false, toAlt: true, toShrink: false, toPrint: false, newPat: true, write: true });
    if (out) p.work = out;
  }
  p.docDirty = false;
  p.workDirty = false;
  acceptEdits(p);
  altToScrn(p);
}

export function* closeMyWind(p: Paint): Co {
  if (p.docDirty && p.windOpen) {
    const result = yield* shouldSave(p, "close");
    if (result === 3) return;
    if (result === 1 && !(yield* saveDoc(p, false))) return;
  }
  p.host.showDocWindow(false);
  p.windOpen = false;
  p.selFlag = false;
  p.maskFlag = false;
}

export function* printDoc(p: Paint): Co {
  acceptEdits(p);
  yield* cycleWork(p, { toAlt: false, toShrink: false, toPrint: true });
  altToScrn(p);
}

export function* quitProgram(p: Paint): Co {
  if (p.docDirty && p.windOpen) {
    p.quitFlag = false;
    const result = yield* shouldSave(p, "quit");
    if (result === 3) return;
    if (result === 1 && !(yield* saveDoc(p, false))) return;
    p.quitFlag = true;
  }
  busyCursor(p);
}
