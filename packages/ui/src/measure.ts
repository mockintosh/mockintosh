/**
 * Text measurement bridge — connects the layout engine's MeasureFunc
 * to the font system, without the layout engine importing any font code.
 */

import { createContext, useContext } from "solid-js";
import type { MeasureFunc } from "./layout";
import { initBuiltinFonts } from "./fonts/registry";
import { layoutNodeText } from "./fonts/textLayout";
import { layoutNodeRuns } from "./fonts/runLayout";
import { nodeRuns, runFaceOf } from "./textRuns";
import { alignmentHeight } from "./fonts/metrics";
import { fontFromProps, type FontStyle } from "./fonts/style";
import { collectNodeText, textWraps, type CanvasNode, type TextVerticalAlign } from "./nodes";

/**
 * Create the MeasureFunc used by computeLayout.
 * Injected into the layout engine during createUI().
 *
 * For `text` nodes `availableWidth` is the content-box width (padding already
 * removed by the layout engine); wrapped text breaks lines against it.
 */
export function createMeasureFunc(): MeasureFunc {
  initBuiltinFonts();
  return (node: CanvasNode, availableWidth: number): { width: number; height: number } => {
    if (node.type === "_text_content") {
      // Bare string child of a box — single line in the parent's font.
      const text = node.textContent;
      if (!text) return { width: 0, height: 0 };
      const font = fontFromProps(node.parent?.props);
      const block = layoutNodeText(node, font, text);
      const valign = (node.parent?.props["verticalAlign"] as TextVerticalAlign | undefined) ?? "top";
      return { width: block.width, height: alignmentHeight(font, block.lines.length, block.height, valign) };
    }
    if (node.type === "text") {
      const font = fontFromProps(node.props);
      const valign = (node.props["verticalAlign"] as TextVerticalAlign | undefined) ?? "top";
      const runs = nodeRuns(node);
      if (runs) {
        const block = layoutNodeRuns(node, runFaceOf(node), runs, textWraps(node.props) ? availableWidth : undefined);
        return {
          width: block.width,
          height: alignmentHeight(font, block.lines.length, block.height, valign),
        };
      }
      const text = collectNodeText(node);
      if (!text) {
        return { width: 0, height: alignmentHeight(font, 1, font.glyphHeight, valign) };
      }
      const wrap = textWraps(node.props);
      const block = layoutNodeText(node, font, text, wrap ? availableWidth : undefined);
      return {
        width: block.width,
        height: alignmentHeight(font, block.lines.length, block.height, valign),
      };
    }
    if (node.type === "image") {
      const src = node.props["src"] as { width: number; height: number } | undefined;
      if (src) return { width: src.width, height: src.height };
    }
    if (node.type === "raster" || node.type === "bitmap") {
      return { width: 0, height: 0 };
    }
    return { width: 0, height: 0 };
  };
}

// -------------------------------------------------------------------------
// useMeasure hook — exposes measurement to components
// -------------------------------------------------------------------------

export interface MeasureAPI {
  measureText(text: string, fontName?: string, style?: FontStyle, size?: number): number;
}

export const MeasureContext = createContext<MeasureAPI | null>(null);

export function useMeasure(): MeasureAPI {
  const ctx = useContext(MeasureContext);
  if (!ctx) throw new Error("useMeasure() called outside of a UI tree");
  return ctx;
}
