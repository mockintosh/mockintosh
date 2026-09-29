import type { JSX } from "@mockintosh/ui";
import { parseMarkdown } from "@mockintosh/markdown";
import { DocumentView } from "./document";

export type { LayoutNode, InlineSegment, TableRow, FormControl, WebForm } from "@mockintosh/markdown";
export { parseMarkdown } from "@mockintosh/markdown";

export interface MarkdownProps {
  text: string;
  onLink?: (href: string) => void;
}

/** Renders markdown through the 1-bit layout tree (`box` / `text` / `image`). */
export function Markdown(props: MarkdownProps): JSX.Element {
  return <DocumentView nodes={parseMarkdown(props.text || "")} onLink={props.onLink} />;
}
