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
  | { kind: "link"; text: string; href: string };

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

/** A form control. Only what a 1-bit page can show and submit. */
export type FormControl =
  | { kind: "text"; name: string; value: string; placeholder: string }
  | { kind: "hidden"; name: string; value: string }
  | { kind: "submit"; name: string; value: string; label: string };

/** A form: submitting it sends its controls' `name=value` pairs to `action`. */
export interface WebForm {
  /** Absolute URL, or empty for "the page this form is on". */
  action: string;
  method: "get" | "post";
  controls: FormControl[];
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
  | { type: "hr" }
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
    }
  /** Columns side by side, stacked instead when the page is narrower than `minWidth`. */
  | { type: "columns"; columns: LayoutColumn[]; gap: number; minWidth: number }
  /** A bordered card around its nodes. */
  | { type: "box"; nodes: LayoutNode[] }
  | { type: "spacer"; height: number }
  | { type: "br" };
