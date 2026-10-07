// QuickDraw global state
// Equivalent to the global variables declared in QuickDraw.p and GrafTypes.a.
// In the original, these lived at a fixed negative offset from register A5.

import {
  GrafPort,
  Pattern,
  Cursor,
  BitMap,
  RgnHandle,
  Point,
  PolyHandle,
  PicHandle,
} from "./types";
import { makeRect } from "./types";
import { QDError } from "./errors";
import { EMPTY_DATA } from "./regionData";
import type { FMOutput } from "./fontManager";
import { fallbackFMOutput, installFontManager } from "./fontManager";

function wideOpenRgn(): RgnHandle {
  return {
    rgn: {
      rgnSize: 10,
      rgnBBox: makeRect(-32767, -32767, 32767, 32767),
      data: EMPTY_DATA,
    },
  };
}

/**
 * The QuickDraw global state block (`GrafTypes.a:247-290`).
 */
export const globals: {
  thePort: GrafPort | null;

  white: Pattern;
  black: Pattern;
  gray: Pattern;
  ltGray: Pattern;
  dkGray: Pattern;

  arrow: Cursor;
  screenBits: BitMap;
  randSeed: number;

  wideOpen: RgnHandle;
  rgnBuf: Point[] | null;
  rgnIndex: number;
  rgnMax: number;
  playPic: PicHandle | null;
  thePoly: PolyHandle | null;
  thePic: PicHandle | null;
  polyMax: number;
  patAlign: Point;
  /** Unscaled Fixed width from the last `StdTxMeas` (`GrafTypes.a:275`). */
  fixTxWid: number;
  /** Stashed `FMOutput` from the last `StdTxMeas` (`GrafTypes.a:276`). */
  fontPtr: FMOutput | null;
  playIndex: number;
} = {
  thePort: null,

  white: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  black: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
  gray: new Uint8Array([0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55]),
  ltGray: new Uint8Array([0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22]),
  dkGray: new Uint8Array([0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd]),

  arrow: {
    data: new Uint16Array([
      0x0000, 0x4000, 0x6000, 0x7000, 0x7800, 0x7c00, 0x7e00, 0x7f00, 0x7f80,
      0x7c00, 0x6c00, 0x4600, 0x0600, 0x0300, 0x0300, 0x0000,
    ]),
    mask: new Uint16Array([
      0xc000, 0xe000, 0xf000, 0xf800, 0xfc00, 0xfe00, 0xff00, 0xff80, 0xffc0,
      0xffe0, 0xfe00, 0xef00, 0xcf00, 0x8780, 0x0780, 0x0380,
    ]),
    hotSpot: { v: 1, h: 1 },
  },

  screenBits: {
    baseAddr: new Uint8Array(0),
    rowBytes: 0,
    bounds: makeRect(0, 0, 0, 0),
  },

  randSeed: 1,

  wideOpen: wideOpenRgn(),

  rgnBuf: null,
  rgnIndex: 0,
  rgnMax: 0,
  playPic: null,
  thePoly: null,
  thePic: null,
  polyMax: 0,
  patAlign: { h: 0, v: 0 },
  fixTxWid: 0,
  fontPtr: null,
  playIndex: 0,
};

/** Reset every private global `InitGraf` clears (`GrafAsm.a:29-46`). */
export function resetPrivateGlobals(): void {
  globals.thePort = null;
  globals.randSeed = 1;
  globals.wideOpen = wideOpenRgn();
  globals.rgnBuf = null;
  globals.rgnIndex = 0;
  globals.rgnMax = 0;
  globals.playPic = null;
  globals.thePoly = null;
  globals.thePic = null;
  globals.polyMax = 0;
  globals.patAlign = { h: 0, v: 0 };
  globals.fixTxWid = 0;
  globals.fontPtr = null;
  globals.playIndex = 0;
}

/**
 * Dereference `thePort`. Throws {@link QDError} if NIL — the original would
 * fault. Query routines that never touch the port must not call this.
 */
export function requirePort(): GrafPort {
  if (!globals.thePort) throw new QDError();
  return globals.thePort;
}

/**
 * @deprecated Phase 7 — use {@link installFontManager}. Builds a width table
 * from `measure` and ignores `draw` (glyphs come from the strike).
 */
export function __injectFontFunctions(
  measure: (text: string) => number,
  _draw: (text: string, x: number, y: number, port: GrafPort) => void
): void {
  installFontManager((inRec) => {
    const out = fallbackFMOutput(inRec);
    const widths = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      widths[i] = (measure(String.fromCharCode(i)) | 0) << 16;
    }
    out.widthTable = widths;
    return out;
  });
}
