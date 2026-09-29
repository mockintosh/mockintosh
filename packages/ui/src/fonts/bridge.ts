import type { GrafPort } from "@mockintosh/quickdraw";
import {
  DrawText,
  ForeColor,
  GetPort,
  MoveTo,
  SetPort,
  TextFace,
  TextFont,
  TextMode,
  TextSize,
  blackColor,
  installFontManager,
  srcBic,
  srcOr,
  whiteColor,
} from "@mockintosh/quickdraw";
import { initBuiltinFonts } from "./registry";
import { resolveFont, textFace, type FontStyle } from "./style";
import { encodeUiText, fontAscent, fontFamilyId, hostSwapFont } from "./strike";
import { textAdvance } from "./font";
import { faceMetricsByName } from "./metrics";
import { drawUnderline } from "./underline";
import { OUTLINE_PAD, SHADOW_PAD } from "./outlineSmear";

let bridgeInstalled = false;

/**
 * Install the Font Manager seam. Call once during createUI().
 */
export function installFontBridge(): void {
  if (bridgeInstalled) return;
  initBuiltinFonts();
  installFontManager(hostSwapFont);
  bridgeInstalled = true;
}

/**
 * Measure text width for a given font name. Same advances as `TextWidth`
 * when that font is selected (including synthesized bold / italic / outline extra).
 */
export function measureText(
  text: string,
  fontName: string = "body",
  style: FontStyle = {},
  size?: number
): number {
  return textAdvance(resolveFont(fontName, style, size), text);
}

/**
 * Line height of a named font, in pixels — FontInfo
 * `ascent + descent + leading`. Same advance `layoutText` uses.
 */
export function fontLineHeight(fontName: string = "body", size?: number): number {
  return faceMetricsByName(fontName, size).lineHeight;
}

function applyInk(color: number): void {
  if (color) {
    ForeColor(blackColor);
    TextMode(srcOr);
  } else {
    ForeColor(whiteColor);
    TextMode(srcBic);
  }
}

/**
 * Paint one line with any mix of bold / italic / outline / shadow.
 * Outline: inverted stem, then the ring in `color`.
 * Shadow: the same as outline, plus that ring again 1px south-east.
 */
export function drawStyledLine(
  text: string,
  x: number,
  y: number,
  fontName: string,
  style: FontStyle,
  color: number,
  size?: number
): void {
  const measured = resolveFont(fontName, style, size);
  const inner = resolveFont(fontName, { ...style, outline: false, shadow: false }, size);
  const ring = resolveFont(fontName, { ...style, outline: true, shadow: false }, size);
  const pad = ring.outlinePad ?? OUTLINE_PAD;
  const drop = style.shadow ? SHADOW_PAD : 0;
  const hollow = style.outline || style.shadow;
  const face = textFace({ ...style, outline: false, shadow: false });
  TextFont(fontFamilyId(fontName));
  TextSize(measured.size ?? 0);
  let cursor = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (hollow) {
      const ringFace = textFace({ ...style, outline: true, shadow: false });
      const ringBytes = encodeUiText(ring, ch);
      if (drop) {
        TextFace(ringFace);
        applyInk(color);
        MoveTo(cursor + drop, y + drop + ring.glyphHeight);
        DrawText(ringBytes, 0, ringBytes.length);
      }
      TextFace(face);
      applyInk(color ? 0 : 1);
      MoveTo(cursor + pad, y + pad + inner.glyphHeight);
      const innerBytes = encodeUiText(inner, ch);
      DrawText(innerBytes, 0, innerBytes.length);
      TextFace(ringFace);
      applyInk(color);
      MoveTo(cursor, y + ring.glyphHeight);
      DrawText(ringBytes, 0, ringBytes.length);
    } else {
      TextFace(face);
      applyInk(color);
      const bytes = encodeUiText(inner, ch);
      MoveTo(cursor, y + inner.glyphHeight);
      DrawText(bytes, 0, bytes.length);
    }
    cursor += textAdvance(measured, ch);
  }
}

export function drawOutlineLine(
  text: string,
  x: number,
  y: number,
  fontName: string,
  style: FontStyle,
  color: number,
  size?: number
): void {
  drawStyledLine(text, x, y, fontName, { ...style, outline: true }, color, size);
}

/**
 * Draw one line on `port`. `(x, y)` is the **top-left** of the line — the
 * helper adds ascent so QuickDraw's baseline `pnLoc.v` sits at the cell bottom.
 */
export function drawString(
  port: GrafPort,
  text: string,
  x: number,
  y: number,
  fontName: string = "body",
  color: number = 1,
  style: FontStyle = {},
  size?: number
): void {
  const previous = GetPort();
  SetPort(port);
  const font = resolveFont(fontName, style, size);
  TextFont(fontFamilyId(fontName));
  TextSize(font.size ?? 0);
  if (style.outline || style.shadow) {
    drawStyledLine(text, x, y, fontName, style, color, size);
  } else {
    TextFace(textFace(style));
    applyInk(color);
    const bytes = encodeUiText(font, text);
    MoveTo(x, y + font.glyphHeight);
    DrawText(bytes, 0, bytes.length);
    if (style.underline) drawUnderline(font, text, x, y, color);
  }
  if (previous) SetPort(previous);
}

export { fontAscent, fontFamilyId, encodeUiText };
