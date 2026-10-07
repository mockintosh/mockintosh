import { parseUrl } from "@mockintosh/sdk";

export interface Bookmark {
  title: string;
  url: string;
  /**
   * The site's big icon: a sprite name, or a picture's URL. Omitted is the
   * site's `/apple-touch-icon.png`; with none there, a letter stands in.
   */
  icon?: string;
}

/** The file in Safari's preferences folder that holds the user's bookmarks. */
export const BOOKMARKS_KEY = "bookmarks.json";

/** Sites that read well without CSS or JavaScript: the bookmarks until the user changes them. */
export const DEFAULT_BOOKMARKS: readonly Bookmark[] = [
  { title: "Mockintosh Docs", url: "https://docs.mockintosh.com/", icon: "icon/happy" },
  { title: "Hacker News", url: "https://news.ycombinator.com/" },
  { title: "Wikipedia", url: "https://en.wikipedia.org/" },
  { title: "GitHub", url: "https://github.com/" },
  { title: "NPR", url: "https://text.npr.org/", icon: "https://media.npr.org/chrome/favicon/favicon-180x180.png" },
  { title: "CNN Lite", url: "https://lite.cnn.com/", icon: "https://www.cnn.com/media/sites/cnn/apple-touch-icon.png" },
];

function isWebUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && (parsed.scheme === "http" || parsed.scheme === "https") && parsed.hostname !== "";
}

/**
 * The bookmarks file's list. No file is the defaults; a file the user
 * edited by hand keeps whichever entries still make sense.
 */
export function parseBookmarks(text: string | null): Bookmark[] {
  if (text === null) return [...DEFAULT_BOOKMARKS];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [...DEFAULT_BOOKMARKS];
  }
  if (!Array.isArray(raw)) return [...DEFAULT_BOOKMARKS];
  return raw.flatMap((entry): Bookmark[] => {
    if (!entry || typeof entry !== "object") return [];
    const { title, url, icon } = entry as Record<string, unknown>;
    if (typeof url !== "string" || !isWebUrl(url)) return [];
    const name = typeof title === "string" && title.trim() ? title.trim() : bookmarkTitle(url);
    return [typeof icon === "string" && icon ? { title: name, url, icon } : { title: name, url }];
  });
}

export function serializeBookmarks(bookmarks: readonly Bookmark[]): string {
  return `${JSON.stringify(bookmarks, null, 2)}\n`;
}

/** A name for an address the user gave no name: its host, without `www.`. */
export function bookmarkTitle(url: string): string {
  return parseUrl(url)?.hostname.replace(/^www\./, "") || url;
}

/** Add at the end; a bookmark already at that address is renamed instead. */
export function addBookmark(bookmarks: readonly Bookmark[], bookmark: Bookmark): Bookmark[] {
  if (!isWebUrl(bookmark.url)) return [...bookmarks];
  const title = bookmark.title.trim() || bookmarkTitle(bookmark.url);
  const at = bookmarks.findIndex((existing) => existing.url === bookmark.url);
  if (at < 0) return [...bookmarks, { ...bookmark, title }];
  return bookmarks.map((existing, index) => (index === at ? { ...existing, title } : existing));
}

export function removeBookmark(bookmarks: readonly Bookmark[], url: string): Bookmark[] {
  return bookmarks.filter((bookmark) => bookmark.url !== url);
}
