/**
 * Window definitions — what each `OSWindowKind` means for chrome, layering
 * and input. The Macintosh kept this in the window definition function (WDEF)
 * a window's `procID` selected; here it is one table, and it is the only
 * place a kind's behaviour is spelled out. `Window.solid.tsx`,
 * `windowGeometry.ts` and `layering.ts` all read from it.
 */

import type { WindowKind } from "@mockintosh/sdk";

/** SDK kinds plus the shell's own: Finder folder windows are documents the Finder can tell apart. */
export type OSWindowKind = WindowKind | "finder-folder";

export interface WindowDefinition {
  /** Title bar with the title text; also what makes the window draggable. */
  titleBar: boolean;
  closeBox: boolean;
  zoomBox: boolean;
  /** Outer hairline in pixels; 0 draws no frame. */
  frame: number;
  /**
   * White gap between the outer hairline and `innerFrame`. Combined with
   * `innerFrame` this is the dBoxProc “picture frame”: 1px / 2px white / 2px.
   */
  frameGap?: number;
  /** Inner band inside `frameGap`; 0 or omitted means no inner band. */
  innerFrame?: number;
  /** 1px drop shadow to the right and below. */
  shadow: boolean;
  /** Grow box in the bottom-right corner when the window is `resizable`. */
  growBox: boolean;
  /** The window is the whole screen: bounds are fixed and the menubar hides while it is frontmost. */
  coversScreen: boolean;
  /** System-modal: every other window ignores input while one is open. */
  modal: boolean;
  /** Stacking layer; higher layers paint above lower ones regardless of activation order. */
  layer: number;
  /**
   * Outer height of the drag/title bar, including the top frame line.
   * Document windows are 20. Kinds without a title bar use 0.
   */
  titleBarHeight: number;
  /**
   * Outer drag-bar height when this is a tool palette with an empty title:
   * the 1px frame plus the HIG's 11px untitled drag region.
   */
  untitledBarHeight?: number;
  /** Drag-bar fill while the window is showing its active chrome. Utility windows are 25% gray, not racing stripes. */
  titleFill: "stripes" | "gray25";
  /**
   * Tool palette. While its app is frontmost the drag bar stays filled even
   * though a document is the key window, and a press does not take the key
   * window — the first click changes a control. Hidden when another app is frontmost.
   */
  toolPalette: boolean;
  /**
   * The app's desk: the whole screen under the menubar, always behind the
   * app's other windows. A press does not take the key window. Hidden when
   * another app is frontmost.
   */
  backdrop?: boolean;
  /** Opened without a position, the window goes in the upper centre of the screen, where `Alert()` put its box. */
  upperCentre?: boolean;
}

const DOCUMENT: WindowDefinition = {
  titleBar: true,
  closeBox: true,
  zoomBox: true,
  frame: 1,
  shadow: true,
  growBox: true,
  coversScreen: false,
  modal: false,
  layer: 1,
  titleBarHeight: 20,
  titleFill: "stripes",
  toolPalette: false,
};

const PLAIN: WindowDefinition = {
  titleBar: false,
  closeBox: false,
  zoomBox: false,
  frame: 1,
  shadow: true,
  growBox: false,
  coversScreen: false,
  modal: false,
  layer: 1,
  titleBarHeight: 0,
  titleFill: "stripes",
  toolPalette: false,
};

const WINDOW_DEFINITIONS: Record<OSWindowKind, WindowDefinition> = {
  document: DOCUMENT,
  "finder-folder": DOCUMENT,
  dialog: { ...DOCUMENT, zoomBox: false, growBox: false },
  // Above fullscreen so a tool palette stays on a full-screen picture.
  // Untitled (empty title): 12px outer bar = frame + the HIG's 11px drag region, 25% gray, no stripes.
  utility: {
    ...DOCUMENT,
    zoomBox: false,
    growBox: false,
    layer: 4,
    titleFill: "gray25",
    untitledBarHeight: 12,
    toolPalette: true,
  },
  plain: PLAIN,
  // dBoxProc: 1px outer, 2px white, 2px inner band; square; system-modal.
  alert: { ...PLAIN, frameGap: 2, innerFrame: 2, modal: true, layer: 5, upperCentre: true },
  desk: { ...PLAIN, frame: 0, shadow: false, backdrop: true },
  // A menubar app's panel: plain, above palettes and full-screen pictures, under alerts.
  panel: { ...PLAIN, layer: 4, upperCentre: true },
  fullscreen: {
    titleBar: false,
    closeBox: false,
    zoomBox: false,
    frame: 0,
    shadow: false,
    growBox: false,
    coversScreen: true,
    modal: false,
    layer: 3,
    titleBarHeight: 0,
    titleFill: "stripes",
    toolPalette: false,
  },
};

export function windowDefinition(kind: OSWindowKind): WindowDefinition {
  return WINDOW_DEFINITIONS[kind] ?? DOCUMENT;
}
