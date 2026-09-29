/**
 * MacPaint's pictures: the ICN# and ICON resources from MacPaint.rsrc, and
 * PaintFont (FONT 249) — tool icons, cursors, brushes and the check mark,
 * drawn with `DrawChar` in the original. The font resource itself is not in
 * the reference, so its glyphs are redrawn here. PaintFont has no ascent:
 * a glyph's image starts at the pen's baseline and hangs below it, which
 * is what lets `SetToolCursor` draw one straight into a 16×16 cursor.
 */

import type { Sprite } from "@mockintosh/sdk";
import type { BitMap } from "@mockintosh/quickdraw";

function hexRowsToPixels(rows: readonly string[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const hex = rows[y] ?? "";
    for (let x = 0; x < width; x++) {
      const nibble = Number.parseInt(hex[x >> 2] ?? "0", 16);
      out[y * width + x] = (nibble >> (3 - (x & 3))) & 1;
    }
  }
  return out;
}

/** An ICN# (icon + mask) or ICON resource, one hex string per row. */
function iconFromHex(icon: readonly string[], mask?: readonly string[]): Sprite {
  const data = hexRowsToPixels(icon, 32, 32);
  return mask ? { width: 32, height: 32, data, mask: hexRowsToPixels(mask, 32, 32) } : { width: 32, height: 32, data };
}

/** ICN# 128. The resource's mask stops one row short; the last row is clear. */
export const APP_ICON: Sprite = iconFromHex(
  [
    "00010000", "00028000", "00044000", "00082000", "00107000", "0020F800", "0041FC00", "0083FA00",
    "0102F100", "0205E080", "0409C040", "08028020", "10010010", "20020008", "40003F04", "80084082",
    "40108041", "20313022", "1039C814", "081E7F8F", "04023007", "02010007", "01008007", "00806007",
    "00401FE7", "0020021F", "00100407", "00080800", "00041000", "00022000", "00014000", "00008000",
  ],
  [
    "00010000", "00038000", "0007C000", "000FE000", "001FF000", "003FF800", "007FFC00", "00FFFE00",
    "01FFFF00", "03FFFF80", "07FFFFC0", "0FFFFFE0", "1FFFFFF0", "3FFFFFF8", "7FFFFFFC", "FFFFFFFE",
    "7FFFFFFF", "3FFFFFFE", "1FFFFFFC", "0FFFFFFF", "07FFFFFF", "03FFFFFF", "01FFFFFF", "00FFFFFF",
    "007FFFFF", "003FFE1F", "001FFC07", "000FF800", "0007F000", "0003E000", "0001C000", "00008000",
  ],
);

/** ICN# 129: a MacPaint document. */
export const DOCUMENT_ICON: Sprite = iconFromHex(
  [
    "0FFFFE00", "08000300", "09D00280", "09D00240", "09D00220", "09D00210", "09D003F8", "09D00008",
    "09D00008", "09D00008", "09D00008", "09D00008", "09F00008", "09100008", "09100008", "09100008",
    "09100008", "09100008", "08E00008", "09F00008", "09F00008", "09F80008", "09F80008", "09E85FE8",
    "09F80BE8", "08D03FE8", "08F0FFE8", "08703FE8", "0819FFE8", "08000008", "08000008", "0FFFFFF8",
  ],
  [
    "0FFFFE00", "0FFFFF00", "0FFFFF80", "0FFFFFC0", "0FFFFFE0", "0FFFFFF0", "0FFFFFF8", "0FFFFFF8",
    "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8",
    "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8",
    "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8", "0FFFFFF8",
  ],
);

/** ICON 2006: Bill Atkinson, for the About box. */
export const BILL_ICON: Sprite = iconFromHex([
  "0017C300", "00BFAF80", "01B7FFC0", "06EFB7E0", "03F73AF0", "07D40960", "05C20330", "0FA00230",
  "07800138", "1D8001FC", "178000DC", "0F8000FC", "3FBA2F6C", "1BBDDC88", "3B566A4C", "190A1D4C",
  "3C024054", "0C8640BC", "07742E3C", "0F034034", "058FF87A", "029BECD0", "009C1CA0", "0043E080",
  "0061C280", "00400070", "0050044E", "00C80861", "0783E060", "18800040", "20C000C0", "00600300",
]);

// ---------------------------------------------------------------------------
// PaintFont
// ---------------------------------------------------------------------------

/** One PaintFont character: its image, whose top row sits on the baseline. */
export interface PaintGlyph {
  /** Advance width, which is also the image width. */
  width: number;
  bits: BitMap;
}

function glyph(rows: readonly string[], width = Math.max(...rows.map((r) => r.length))): PaintGlyph {
  const rowBytes = ((width + 15) >> 4) << 1;
  const height = rows.length;
  const baseAddr = new Uint8Array(rowBytes * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length && x < width; x++) {
      if (row[x] === "#") baseAddr[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  });
  return { width, bits: { baseAddr, rowBytes, bounds: { top: 0, left: 0, bottom: height, right: width } } };
}

function filledSquare(size: number): string[] {
  const pad = (16 - size) >> 1;
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    rows.push(y >= pad && y < pad + size ? " ".repeat(pad) + "#".repeat(size) : "");
  }
  return rows;
}

function filledCircle(diameter: number): string[] {
  const rows: string[] = [];
  const r = diameter / 2;
  const c = 8;
  for (let y = 0; y < 16; y++) {
    let row = "";
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      row += dx * dx + dy * dy <= r * r ? "#" : " ";
    }
    rows.push(row);
  }
  return rows;
}

function hLine(length: number): string[] {
  const pad = (16 - length) >> 1;
  return Array.from({ length: 16 }, (_, y) => (y === 8 ? " ".repeat(pad) + "#".repeat(length) : ""));
}

function vLine(length: number): string[] {
  const pad = (16 - length) >> 1;
  return Array.from({ length: 16 }, (_, y) => (y >= pad && y < pad + length ? " ".repeat(8) + "#" : ""));
}

function diagonal(length: number, rising: boolean): string[] {
  const pad = (16 - length) >> 1;
  return Array.from({ length: 16 }, (_, y) => {
    const i = y - pad;
    if (i < 0 || i >= length) return "";
    const x = rising ? pad + length - 1 - i : pad + i;
    return " ".repeat(x) + "#";
  });
}

function dots(spacing: number, count: number): string[] {
  const span = spacing * (count - 1) + 1;
  const pad = (16 - span) >> 1;
  return Array.from({ length: 16 }, (_, y) => {
    const i = y - pad;
    if (i < 0 || i >= span || i % spacing !== 0) return "";
    let row = " ".repeat(pad);
    for (let k = 0; k < span; k++) row += k % spacing === 0 ? "#" : " ";
    return row;
  });
}

const TOOL_GLYPHS: readonly (readonly string[])[] = [
  // 69 'E' lasso
  [
    "                ",
    "      #####     ",
    "    ##     ##   ",
    "   #         #  ",
    "  #           # ",
    "  #           # ",
    "  #           # ",
    "   #         #  ",
    "    ##     ##   ",
    "     # #####    ",
    "    # #         ",
    "    # #         ",
    "     #          ",
    "    #           ",
    "   #            ",
    "  #             ",
  ],
  // 70 'F' selection rectangle
  [
    "                ",
    "                ",
    " ## ## ## ## ## ",
    "                ",
    " #            # ",
    " #            # ",
    "                ",
    " #            # ",
    " #            # ",
    "                ",
    " #            # ",
    " #            # ",
    "                ",
    " ## ## ## ## ## ",
  ],
  // 71 'G' grabber
  [
    "       ##       ",
    "   ## #  #      ",
    "  #  ##  # ##   ",
    "  #  ##  ##  #  ",
    "   #  #  ##  #  ",
    "   #  #  #  # # ",
    " ## # #  #  #  #",
    "#  ##       #  #",
    "#   #          #",
    " #            # ",
    "  #           # ",
    "  #          #  ",
    "   #         #  ",
    "    #       #   ",
    "     #      #   ",
    "     ########   ",
  ],
  // 72 'H' text
  [
    "                ",
    "      #         ",
    "     ###        ",
    "     ###        ",
    "    # ###       ",
    "    # ###       ",
    "   #   ###      ",
    "   #######      ",
    "  #     ###     ",
    "  #     ###     ",
    " ###   #####    ",
  ],
  // 73 'I' paint bucket
  [
    "      ##        ",
    "     #  #       ",
    "     #  ##      ",
    "     #  # #     ",
    "    ##  #  #    ",
    "   # #  ##  #   ",
    "  #  # #  #  #  ",
    " #    ##   #  # ",
    "#           # ##",
    " #         #  ##",
    "  #       #   ##",
    "   #     #    ##",
    "    #   #     ##",
    "     # #      ##",
    "      #       # ",
    "              # ",
  ],
  // 74 'J' spray can
  [
    "        # # #   ",
    "          # #   ",
    "    ##   # # #  ",
    "    ##          ",
    "   ####         ",
    "  #    #        ",
    "  #    #        ",
    "  ######        ",
    "  #    #        ",
    "  # ## #        ",
    "  # ## #        ",
    "  # ## #        ",
    "  #    #        ",
    "  #    #        ",
    "  ######        ",
  ],
  // 75 'K' paintbrush
  [
    "             ## ",
    "            ### ",
    "           ###  ",
    "          ###   ",
    "         ###    ",
    "        ###     ",
    "       ###      ",
    "      # #       ",
    "     # #        ",
    "   ### #        ",
    "  #####         ",
    "  #####         ",
    " #####          ",
    " ###            ",
    "##              ",
  ],
  // 76 'L' pencil
  [
    "            ##  ",
    "           #  # ",
    "          #  ## ",
    "         #  # # ",
    "        #  # #  ",
    "       #  # #   ",
    "      #  # #    ",
    "     #  # #     ",
    "    #  # #      ",
    "    # # #       ",
    "   # # #        ",
    "   ## #         ",
    "   ###          ",
    "   ##           ",
    "   #            ",
  ],
  // 77 'M' line
  [
    "              # ",
    "             #  ",
    "            #   ",
    "           #    ",
    "          #     ",
    "         #      ",
    "        #       ",
    "       #        ",
    "      #         ",
    "     #          ",
    "    #           ",
    "   #            ",
    "  #             ",
    " #              ",
  ],
  // 78 'N' eraser
  [
    "                ",
    "      ######### ",
    "     #        ##",
    "    #        # #",
    "   #        #  #",
    "  #        #   #",
    " #        #   # ",
    "##########   #  ",
    "#        #  #   ",
    "#        # #    ",
    "#        ##     ",
    "##########      ",
  ],
  // 79 'O' rectangle
  [
    "                    ",
    "####################",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    "####################",
  ],
  // 80 'P' filled rectangle
  [
    "                    ",
    "####################",
    "## # # # # # # # # #",
    "# # # # # # # # # ##",
    "## # # # # # # # # #",
    "# # # # # # # # # ##",
    "## # # # # # # # # #",
    "# # # # # # # # # ##",
    "## # # # # # # # # #",
    "# # # # # # # # # ##",
    "## # # # # # # # # #",
    "####################",
  ],
  // 81 'Q' round rectangle
  [
    "                    ",
    "   ##############   ",
    "  #              #  ",
    " #                # ",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    "#                  #",
    " #                # ",
    "  #              #  ",
    "   ##############   ",
  ],
  // 82 'R' filled round rectangle
  [
    "                    ",
    "   ##############   ",
    "  ## # # # # # # #  ",
    " # # # # # # # # ## ",
    "## # # # # # # # # #",
    "# # # # # # # # # ##",
    "## # # # # # # # # #",
    "# # # # # # # # # ##",
    "## # # # # # # # # #",
    " ## # # # # # # # # ",
    "  # # # # # # # ##  ",
    "   ##############   ",
  ],
  // 83 'S' oval
  [
    "                    ",
    "      ########      ",
    "   ###        ###   ",
    "  #              #  ",
    " #                # ",
    "#                  #",
    "#                  #",
    "#                  #",
    " #                # ",
    "  #              #  ",
    "   ###        ###   ",
    "      ########      ",
  ],
  // 84 'T' filled oval
  [
    "                    ",
    "      ########      ",
    "   ### # # # ####   ",
    "  # # # # # # # ##  ",
    " # # # # # # # # ## ",
    "## # # # # # # # # #",
    "# # # # # # # # # ##",
    "## # # # # # # # # #",
    " # # # # # # # # ## ",
    "  # # # # # # # ##  ",
    "   ### # # # ####   ",
    "      ########      ",
  ],
  // 85 'U' free-form shape
  [
    "                    ",
    "       ###          ",
    "     ##   ##    ### ",
    "    #       ####   #",
    "   #               #",
    "  #               # ",
    "  #              #  ",
    "   #             #  ",
    "    ##            # ",
    "      ##    ##    # ",
    "        ####  #### ",
  ],
  // 86 'V' filled free-form shape
  [
    "                    ",
    "       ###          ",
    "     ### # ##   ### ",
    "    # # # # ####  ##",
    "   # # # # # # # # #",
    "  # # # # # # # ### ",
    "  ## # # # # # # #  ",
    "   # # # # # # # ## ",
    "    ### # # # # # # ",
    "      ### # ### # # ",
    "        ####  #### ",
  ],
  // 87 'W' polygon
  [
    "                    ",
    "     #              ",
    "    # ##            ",
    "   #    ##          ",
    "  #       ##        ",
    " #          ########",
    "  #               # ",
    "   #             #  ",
    "    #           #   ",
    "     #         #    ",
    "      ##########    ",
  ],
  // 88 'X' filled polygon
  [
    "                    ",
    "     #              ",
    "    ###             ",
    "   # # ##           ",
    "  # # # ###         ",
    " # # # # # #########",
    "  # # # # # # # # # ",
    "   # # # # # # # #  ",
    "    # # # # # # #   ",
    "     # # # # # #    ",
    "      ##########    ",
  ],
];

function crosshair(size: number): string[] {
  const rows: string[] = [];
  const lo = 8 - (size >> 1);
  const hi = lo + size;
  for (let y = 0; y < 16; y++) {
    let row = "";
    for (let x = 0; x < 16; x++) {
      const inBox = size > 1 && x >= lo && x < hi && y >= lo && y < hi;
      const onArm = (x === 8 && y >= 1) || (y === 8 && x >= 1);
      row += inBox || onArm ? "#" : " ";
    }
    rows.push(row);
  }
  return rows;
}

const PAINT_FONT = new Map<number, PaintGlyph>();

TOOL_GLYPHS.forEach((rows, i) => PAINT_FONT.set(69 + i, glyph(rows)));

// 65 'A': the check mark beside the chosen line width.
PAINT_FONT.set(
  65,
  glyph([
    "",
    "",
    "",
    "          #",
    "         ##",
    "        ## ",
    "       ##  ",
    "#     ##   ",
    "##   ##    ",
    " ## ##     ",
    "  ###      ",
    "   #       ",
  ], 11),
);

// 89–92: the cross-hair for line widths 1, 2, 4 and 8.
[1, 2, 4, 8].forEach((size, i) => PAINT_FONT.set(89 + i, glyph(crosshair(size), 16)));

// 93: the paint bucket's mask.
PAINT_FONT.set(
  93,
  glyph([
    "      ##        ",
    "     ####       ",
    "     #####      ",
    "     ######     ",
    "    ########    ",
    "   ##########   ",
    "  ############  ",
    " ############## ",
    "################",
    " ###############",
    "  ##############",
    "   ########## ##",
    "    ########  ##",
    "     ######   ##",
    "      ####    ##",
    "              # ",
  ], 16),
);

// 97: all clear — the mask of a cursor that XORs with the screen.
PAINT_FONT.set(97, glyph([""], 16));

// 109: the grabber's mask.
PAINT_FONT.set(
  109,
  glyph([
    "       ##       ",
    "   ## ####      ",
    "  #########     ",
    "  ###########   ",
    "   ##########   ",
    "   ############ ",
    " ###############",
    "################",
    "################",
    " ############## ",
    "  ############# ",
    "  ############  ",
    "   ###########  ",
    "    #########   ",
    "     ########   ",
    "     ########   ",
  ], 16),
);

// 110: the I-beam; its short bar marks the baseline.
PAINT_FONT.set(
  110,
  glyph([
    "",
    "",
    "    ### ###     ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "     #####      ",
    "       #        ",
    "    ### ###     ",
  ], 16),
);

// 111: the spray can's nozzle pattern, also its brush.
PAINT_FONT.set(
  111,
  glyph([
    "                ",
    "     #   #      ",
    "  #    #    #   ",
    "    #     #     ",
    " #    # #    #  ",
    "   #       #    ",
    "     # # #      ",
    " # #       # #  ",
    "     # # #      ",
    "   #       #    ",
    " #    # #    #  ",
    "    #     #     ",
    "  #    #    #   ",
    "     #   #      ",
  ], 16),
);

// 114, 115: the selection cross-hair and its mask.
PAINT_FONT.set(
  114,
  glyph([
    "",
    "",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "               ",
    "  #####   ##### ",
    "               ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
    "       #        ",
  ], 16),
);
PAINT_FONT.set(
  115,
  glyph([
    "",
    "      ###       ",
    "      ###       ",
    "      ###       ",
    "      ###       ",
    "      ###       ",
    "      ###       ",
    " ####### ###### ",
    " ####### ###### ",
    " ####### ###### ",
    "      ###       ",
    "      ###       ",
    "      ###       ",
    "      ###       ",
    "      ###       ",
    "      ###       ",
  ], 16),
);

// 116: the pencil's mask.
PAINT_FONT.set(
  116,
  glyph([
    "            ##  ",
    "           #### ",
    "          ######",
    "         ###### ",
    "        ######  ",
    "       ######   ",
    "      ######    ",
    "     ######     ",
    "    ######      ",
    "    #####       ",
    "   #####        ",
    "   ####         ",
    "   ###          ",
    "   ##           ",
    "   #            ",
  ], 16),
);

// 119: the eraser's box; its mask is brush 120, all set.
PAINT_FONT.set(
  119,
  glyph(["################", ...Array.from({ length: 14 }, () => "#              #"), "################"], 16),
);

// 120–151: the brush shapes, four to a column of the Brush Shape dialog.
const BRUSHES: readonly (readonly string[])[] = [
  filledSquare(16), filledSquare(10), filledSquare(6), filledSquare(3),
  filledCircle(12), filledCircle(9), filledCircle(6), filledCircle(4),
  hLine(14), hLine(10), hLine(6), hLine(3),
  vLine(14), vLine(10), vLine(6), vLine(3),
  diagonal(12, true), diagonal(9, true), diagonal(6, true), diagonal(3, true),
  diagonal(12, false), diagonal(9, false), diagonal(6, false), diagonal(3, false),
  dots(3, 5), dots(3, 4), dots(3, 3), dots(3, 2),
  dots(4, 4), dots(4, 3), dots(2, 5), dots(2, 3),
];
BRUSHES.forEach((rows, i) => PAINT_FONT.set(120 + i, glyph(rows, 16)));

const EMPTY_GLYPH = glyph([""], 0);

export function paintGlyph(code: number): PaintGlyph {
  return PAINT_FONT.get(code) ?? EMPTY_GLYPH;
}

/**
 * A glyph as 16 cursor rows, drawn at the top-left of a cleared 16×16 cell
 * exactly as `SetToolCursor` draws `dataCh` and `maskCh`.
 */
export function glyphWords(code: number): Uint16Array {
  const { bits } = paintGlyph(code);
  const out = new Uint16Array(16);
  const height = Math.min(16, bits.bounds.bottom);
  const width = Math.min(16, bits.bounds.right);
  for (let y = 0; y < height; y++) {
    let word = 0;
    for (let x = 0; x < width; x++) {
      if ((bits.baseAddr[y * bits.rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1) word |= 0x8000 >> x;
    }
    out[y] = word;
  }
  return out;
}
