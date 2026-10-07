/**
 * Colour to 1 bit. Terminal programs paint in colour, mostly assuming a dark
 * theme; the Macintosh has black ink on white paper. This is the one place
 * a cell's colours and attributes become how it is drawn.
 *
 * - The foreground's colour has no meaning here: text draws in plain ink.
 *   Dark greys and SGR 2 (faint) are marked *dim*, but drawn like any text
 *   (see `CellStyle.dim`).
 * - The background decides the paper. A program sets a background to set
 *   something apart, so the paper says how strongly: a dark-theme tint (the
 *   greys a TUI puts behind a selected row) is a light 25% pattern, anything
 *   brighter is black paper with white ink, as a reversed status bar should
 *   look. A background as dark as a dark theme's own is no background.
 * - `inverse` swaps ink and paper after that.
 */

export type TerminalColor =
  | { mode: "default" }
  | { mode: "palette"; index: number }
  | { mode: "rgb"; value: number };

export interface CellAttributes {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  invisible?: boolean;
  strikethrough?: boolean;
}

export type Paper = "white" | "light" | "black";

export interface CellStyle {
  bold: boolean;
  underline: boolean;
  strikethrough: boolean;
  invisible: boolean;
  /** Glyph pixels: black on light paper, white on black paper. */
  ink: "black" | "white";
  /**
   * The program's dark-grey or faint text. Drawn in plain ink: Monaco 9's
   * strokes are one pixel wide, so any pattern knocked out of them breaks
   * letters, and a screen-aligned one breaks every other line (cells are 11
   * pixels tall). A program's emphasis still shows through bold.
   */
  dim: boolean;
  paper: Paper;
}

export const PLAIN_STYLE: Readonly<CellStyle> = Object.freeze({
  bold: false,
  underline: false,
  strikethrough: false,
  invisible: false,
  ink: "black",
  dim: false,
  paper: "white",
});

const ANSI16 = [
  0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5,
  0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff,
];

/** The xterm 256-colour palette as 0xRRGGBB. */
export function paletteRgb(index: number): number {
  if (index < 16) return ANSI16[index] ?? 0;
  if (index < 232) {
    const i = index - 16;
    const level = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    return (level(Math.floor(i / 36)) << 16) | (level(Math.floor(i / 6) % 6) << 8) | level(i % 6);
  }
  const grey = 8 + (index - 232) * 10;
  return (grey << 16) | (grey << 8) | grey;
}

function rgbOf(color: TerminalColor): number | null {
  if (color.mode === "default") return null;
  return color.mode === "palette" ? paletteRgb(color.index) : color.value;
}

/** Relative luminance, 0–1 (Rec. 709 weights on the encoded values; close enough for picking a pattern). */
export function luminance(rgb: number): number {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** A grey, or near enough: the channels agree within a few levels. */
function isGrey(rgb: number): boolean {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b) <= 24;
}

function quietForeground(color: TerminalColor): boolean {
  // Palette 8, "bright black", is the classic secondary-text colour.
  if (color.mode === "palette" && color.index === 8) return true;
  const rgb = rgbOf(color);
  if (rgb === null || !isGrey(rgb)) return false;
  const l = luminance(rgb);
  // Pure black is the ink itself on paper; dark-to-mid greys are quieter text.
  return l > 0.02 && l < 0.55;
}

function paperFor(color: TerminalColor): Paper {
  const rgb = rgbOf(color);
  if (rgb === null) return "white";
  const l = luminance(rgb);
  if (l < 0.04) return "white";
  if (isGrey(rgb)) return l < 0.3 ? "light" : "black";
  // A colour is a deliberate mark (a status bar, a diff line) unless it is a dark tint.
  const brightest = Math.max((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
  return brightest < 0x60 ? "light" : "black";
}

export function monochromeStyle(fg: TerminalColor, bg: TerminalColor, attrs: CellAttributes = {}): CellStyle {
  let paper = paperFor(bg);
  let ink: "black" | "white" = paper === "black" ? "white" : "black";
  if (attrs.inverse) {
    // Swap: dark ink on paper becomes paper-coloured ink on black, and the reverse.
    if (paper === "black") {
      paper = "white";
      ink = "black";
    } else {
      paper = "black";
      ink = "white";
    }
  }
  return {
    bold: attrs.bold === true,
    underline: attrs.underline === true,
    strikethrough: attrs.strikethrough === true,
    invisible: attrs.invisible === true,
    ink,
    dim: attrs.dim === true || quietForeground(fg),
    paper,
  };
}

export function sameStyle(a: CellStyle, b: CellStyle): boolean {
  return a.bold === b.bold && a.underline === b.underline && a.strikethrough === b.strikethrough &&
    a.invisible === b.invisible && a.ink === b.ink && a.dim === b.dim && a.paper === b.paper;
}

/** A short stable key for a style, for row caches. */
export function styleKey(s: CellStyle): string {
  return `${s.bold ? "b" : ""}${s.underline ? "u" : ""}${s.strikethrough ? "s" : ""}${s.invisible ? "i" : ""}${s.dim ? "d" : ""}${s.ink[0]}${s.paper[0]}`;
}
