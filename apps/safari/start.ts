import type { InlineSegment, LayoutNode } from "@mockintosh/sdk";
import { START_URL, type DocumentPage } from "./page";

export interface Bookmark {
  title: string;
  url: string;
  note: string;
}

/** Sites that read well without CSS or JavaScript. The start page and the Bookmarks menu list them. */
export const BOOKMARKS: readonly Bookmark[] = [
  { title: "Mockintosh Docs", url: "https://docs.mockintosh.com/", note: "how this Macintosh works" },
  { title: "Hacker News", url: "https://news.ycombinator.com/", note: "front page and comment threads" },
  { title: "Wikipedia", url: "https://en.wikipedia.org/", note: "the free encyclopedia" },
  { title: "GitHub", url: "https://github.com/", note: "people, repositories, issues" },
  { title: "NPR", url: "https://text.npr.org/", note: "text-only news" },
  { title: "CNN Lite", url: "https://lite.cnn.com/", note: "text-only news" },
];

function link(text: string, href: string): InlineSegment {
  return { kind: "link", text, href };
}

export function startPage(): DocumentPage {
  const nodes: LayoutNode[] = [
    { type: "heading", level: 1, text: "Safari", align: "left" },
    {
      type: "paragraph",
      align: "left",
      segments: [{ kind: "text", text: "Type an address or some words to search for. Pages are drawn the way the early web was: text, links, pictures and forms, without style sheets or scripts." }],
    },
    {
      type: "form",
      form: {
        action: "https://lite.duckduckgo.com/lite/",
        method: "get",
        controls: [
          { kind: "text", name: "q", value: "", placeholder: "Search DuckDuckGo" },
          { kind: "submit", name: "", value: "", label: "Search" },
        ],
      },
    },
    { type: "heading", level: 2, text: "Bookmarks", align: "left" },
    ...BOOKMARKS.map((bookmark): LayoutNode => ({
      type: "listItem",
      indent: 0,
      segments: [link(bookmark.title, bookmark.url), { kind: "text", text: ` — ${bookmark.note}` }],
    })),
  ];
  return { kind: "document", url: START_URL, title: "Start page", nodes };
}
