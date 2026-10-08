// ---------------------------------------------------------------------------
// Core types for the @mockintosh/markdown package.
//
// LayoutNode[] is the render-target model: the bridge between a source
// (markdown here, HTML on the server, a site's API in Safari) and the 1-bit
// renderer. It describes *what to draw* without knowing anything about
// pixels or fonts.
// ---------------------------------------------------------------------------

export type Align = "left" | "center" | "right";

// Inline content within a paragraph or list item.
export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  /**
   * `bold` sets a link in bold, as a page's own name in a site's header;
   * `underline: "hover"` underlines it only while the pointer is over it.
   */
  | { kind: "link"; text: string; href: string; bold?: boolean; underline?: "hover" };

// A link hit-rect produced during a render pass.
export interface LinkRect {
  x: number;
  y: number;
  w: number;
  h: number;
  href: string;
}

/** One row of a table. Cells are inline content only; block content is flattened before it gets here. */
export interface TableRow {
  header: boolean;
  cells: InlineSegment[][];
}

/**
 * A form control. Only what a 1-bit page can show and submit. A text
 * control's `label` is drawn in bold above it, with a plain `*` after it
 * when it's `required` ("**Add a title** *").
 */
export type FormControl =
  /** One line of text; `icon` names a sprite inset before it, as a search field's magnifying glass. */
  | { kind: "text"; name: string; value: string; placeholder: string; icon?: string; label?: string; required?: boolean }
  /**
   * Several lines of text; a form with one stacks its controls and spans
   * the page. `markdown` gives it a formatting toolbar and a Preview tab.
   */
  | { kind: "textarea"; name: string; value: string; rows: number; markdown?: boolean; label?: string; required?: boolean }
  | { kind: "hidden"; name: string; value: string }
  /** A button; `icon` names a sprite drawn before the label, and `tooltip` captions it when hovered. */
  | { kind: "submit"; name: string; value: string; label: string; icon?: string; tooltip?: string };

/** A form: submitting it sends its controls' `name=value` pairs to `action`. */
export interface WebForm {
  /** Absolute URL, or empty for "the page this form is on". */
  action: string;
  method: "get" | "post";
  controls: FormControl[];
  /** Where a one-line form's controls sit across the page. Omitted is the left. */
  align?: Align;
  /** Corner radius of the form's fields and buttons; the theme's when omitted. */
  radius?: number;
}

/** One item of a page's `menu`: a link to follow, or a form to submit. */
export type MenuEntry = { label: string; href: string } | { label: string; form: WebForm };

/** A rectangle of a `bitmap`, in its pixels, that names itself when hovered. */
export interface BitmapTip {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** One tab of a `tabs` row. */
export interface PageTab {
  label: string;
  href: string;
  current: boolean;
}

/** One column of a `columns` block. */
export interface LayoutColumn {
  /** Fixed width in pixels; omitted columns share the rest. */
  width?: number;
  nodes: LayoutNode[];
}

// Block-level nodes passed to the renderer.
export type LayoutNode =
  | { type: "heading"; level: 1 | 2 | 3; text: string; align: Align; href?: string }
  | { type: "paragraph"; segments: InlineSegment[]; align: Align }
  | { type: "listItem"; segments: InlineSegment[]; indent: number; marker?: string }
  | { type: "code"; text: string }
  | { type: "table"; rows: TableRow[] }
  | { type: "form"; form: WebForm }
  /** A rule across the column; `dotted` breaks it into dots. */
  | { type: "hr"; dotted?: boolean }
  | {
      type: "image";
      src: string;
      alt: string;
      align: Align;
      href?: string;
      /** Draw at this size (scaled down to fit) instead of the picture's own. */
      width?: number;
      height?: number;
      /** CSS-style corner radius the picture is clipped to (half its size for a circle). */
      borderRadius?: number;
      /** A 1px black border around the picture, inside its size, following `borderRadius`. */
      border?: boolean;
    }
  /**
   * Columns side by side, stacked instead when the page is narrower than
   * `minWidth`. `center` lines their contents up on the row's middle, for a
   * toolbar; they otherwise hang from the top.
   */
  | { type: "columns"; columns: LayoutColumn[]; gap: number; minWidth: number; center?: boolean }
  /** A bordered card around its nodes, its corners rounded by `radius` pixels. */
  | { type: "box"; nodes: LayoutNode[]; radius?: number }
  /**
   * 1-bit pixels a page makes itself, drawn at their own size and cut off
   * where the page is narrower: `data` is row by row, 1 for ink, 0 for paper.
   * Hovering one of `tips`' rectangles shows its label in a tooltip.
   */
  | { type: "bitmap"; width: number; height: number; data: Uint8Array; alt: string; tips?: BitmapTip[] }
  /**
   * Content `width` wide in a pane as wide as the page, which scrolls
   * sideways when the content is wider: drag it, or its bar. `start: "end"`
   * opens it scrolled all the way right, for the latest end of a timeline.
   */
  | { type: "scroller"; width: number; nodes: LayoutNode[]; start?: "start" | "end" }
  /**
   * A pull-down menu: `label` drawn like a link opens `items` under it, or
   * `image` (a picture's `src`, drawn round at `size`, ringed with `border`) in the label's place.
   * `align: "right"` puts it, and hangs the menu, at the right.
   */
  | { type: "menu"; label: string; items: MenuEntry[]; align: Align; image?: { src: string; size: number; border?: boolean } }
  /**
   * A site's page tabs over a rule across the page, as github.com's: the
   * current tab bold with a line under it on the rule, the others plain links.
   */
  | { type: "tabs"; items: PageTab[] }
  | { type: "spacer"; height: number }
  | { type: "br" };
