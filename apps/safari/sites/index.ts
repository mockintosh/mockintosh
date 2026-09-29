import type { WebUrl } from "@mockintosh/sdk";
import type { SiteAdapter, SiteBookmark } from "../page";
import { githubSite } from "./github/page";
import { hackerNewsSite } from "./hackernews";
import { mockintoshSite } from "./mockintosh";

/** Sites Safari draws itself, from their APIs or its own pixels. Everything else is read from its HTML on the server. */
export const SITE_ADAPTERS: readonly SiteAdapter[] = [githubSite, hackerNewsSite, mockintoshSite];

/** The bookmarks bar: every site that has a button, in adapter order. */
export const SITE_BOOKMARKS: readonly SiteBookmark[] = SITE_ADAPTERS.flatMap((adapter) => (adapter.bookmark ? [adapter.bookmark] : []));

export function adapterFor(url: WebUrl): SiteAdapter | undefined {
  return SITE_ADAPTERS.find((adapter) => adapter.handles(url));
}
