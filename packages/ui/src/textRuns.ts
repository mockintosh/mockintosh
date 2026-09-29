/**
 * Host `<text runs>` — the paragraph's clickable runs. Layout and paint stay
 * on the intrinsic (measure.ts / draw.ts); this maps a click or a hover on
 * the node to the run under the pointer, the way `selectable.ts` maps drags
 * onto a selection.
 */

import { layoutNodeRuns, runAtPoint, type RunBlock, type RunFace } from "./fonts/runLayout";
import { fontNameFromProps, fontSizeFromProps, fontStyleFromProps } from "./fonts/style";
import { setNodeProperty, textWraps, type CanvasNode, type TextAlign, type TextRun } from "./nodes";

export function nodeRuns(node: CanvasNode): readonly TextRun[] | undefined {
  const runs = node.props["runs"];
  return Array.isArray(runs) ? (runs as readonly TextRun[]) : undefined;
}

export function runFaceOf(node: CanvasNode): RunFace {
  return {
    fontName: fontNameFromProps(node.props),
    size: fontSizeFromProps(node.props),
    style: fontStyleFromProps(node.props),
  };
}

/** Lay out a runs node against its current content box. */
function nodeBlock(node: CanvasNode, runs: readonly TextRun[]): { block: RunBlock; innerW: number; padL: number; padT: number } {
  const s = node.style;
  const padL = s.paddingLeft ?? s.padding ?? 0;
  const padR = s.paddingRight ?? s.padding ?? 0;
  const padT = s.paddingTop ?? s.padding ?? 0;
  const innerW = Math.max(0, node.layout.width - padL - padR);
  const block = layoutNodeRuns(node, runFaceOf(node), runs, textWraps(node.props) ? innerW : undefined);
  return { block, innerW, padL, padT };
}

function clickableRunAt(node: CanvasNode, lx: number, ly: number): TextRun | undefined {
  const runs = nodeRuns(node);
  if (!runs) return undefined;
  const { block, innerW, padL, padT } = nodeBlock(node, runs);
  const align = (node.props["align"] as TextAlign | undefined) ?? "left";
  const index = runAtPoint(block, lx - padL, ly - padT, align, innerW);
  const run = index >= 0 ? runs[index] : undefined;
  return run?.onClick ? run : undefined;
}

const installed = new WeakSet<CanvasNode>();

/** Called whenever `runs` is set on a node. */
export function applyRuns(node: CanvasNode, runs: unknown): void {
  const clickable = Array.isArray(runs) && (runs as readonly TextRun[]).some((run) => run.onClick);
  if (clickable && !installed.has(node)) {
    installed.add(node);
    setNodeProperty(node, "onClick", (lx: number, ly: number) => clickableRunAt(node, lx, ly)?.onClick?.());
    setNodeProperty(node, "onMouseMove", (lx: number, ly: number) => {
      setNodeProperty(node, "cursor", clickableRunAt(node, lx, ly) ? "pointer" : undefined);
    });
    setNodeProperty(node, "onMouseLeave", () => setNodeProperty(node, "cursor", undefined));
  } else if (!clickable && installed.has(node)) {
    installed.delete(node);
    setNodeProperty(node, "onClick", undefined);
    setNodeProperty(node, "onMouseMove", undefined);
    setNodeProperty(node, "onMouseLeave", undefined);
    setNodeProperty(node, "cursor", undefined);
  }
}
