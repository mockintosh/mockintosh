import type { FetchFunction, LayoutNode, Sprite, WebUrl } from "@mockintosh/sdk";

/** What Safari asks for when it goes somewhere. */
export interface PageRequest {
  /** Absolute `http(s)` URL, or `about:start`. */
  url: string;
  method: "get" | "post";
  /** `application/x-www-form-urlencoded`, for `post`. */
  body?: string;
  /** Read only the article (View › Reader). */
  reader: boolean;
}

interface PageBase {
  /** Where the page is, after redirects. Shown in the address bar. */
  url: string;
  title: string;
}

/** A page of text, links, pictures and forms, drawn by `DocumentView`. */
export interface DocumentPage extends PageBase {
  kind: "document";
  nodes: LayoutNode[];
}

/** One picture drawn from the app's own pixels, centred on the page. */
export interface PicturePage extends PageBase {
  kind: "picture";
  picture: Sprite;
  /** Page fill. `1` is black. Omitted is white. */
  background?: 0 | 1;
}

/** `about:start`: the bookmarks as a grid of Favorites, drawn by `StartView`. */
export interface StartPage extends PageBase {
  kind: "start";
}

/** A page ready to draw. */
export type WebPage = DocumentPage | PicturePage | StartPage;

/** Settings a site adapter may read. Each is stored in the app's storage. */
export interface SiteSettings {
  /** Personal access token for api.github.com. Empty for anonymous access. */
  githubToken: string;
}

export interface SiteContext {
  fetch: FetchFunction;
  settings: SiteSettings;
}

/**
 * A site Safari draws from its API rather than its HTML. Adapters mostly
 * produce the same `LayoutNode[]` as every other page, with ordinary links
 * back into the site, so history, the address bar and link clicks need no
 * special case. A site can instead be a single picture (`PicturePage`).
 */
export interface SiteAdapter {
  id: string;
  /** The URLs this adapter draws. Adapters only see GET requests. */
  handles(url: WebUrl): boolean;
  load(url: WebUrl, context: SiteContext): Promise<WebPage>;
}

/** An error to show in place of the page. */
export class PageError extends Error {}

export const START_URL = "about:start";

export function pageRequest(url: string, options: Partial<Omit<PageRequest, "url">> = {}): PageRequest {
  return { url, method: options.method ?? "get", body: options.body, reader: options.reader ?? false };
}
