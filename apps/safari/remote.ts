import { parseUrl, type FetchFunction, type ImageFrame, type ImageService, type LayoutNode } from "@mockintosh/sdk";
import { PageError, type PageRequest, type DocumentPage } from "./page";

/** `POST /api/browse` body; the server's `BrowseRequest` in `api/browse.ts`. */
interface BrowseRequest {
  url: string;
  reader: boolean;
  method: "get" | "post";
  body?: string;
}

interface BrowseReply {
  url?: string;
  title?: string;
  nodes?: LayoutNode[];
  error?: string;
}

/** Any page, read on the server from its HTML. */
export async function loadRemotePage(fetch: FetchFunction, request: PageRequest): Promise<DocumentPage> {
  const body: BrowseRequest = { url: request.url, reader: request.reader, method: request.method, body: request.body };
  let response;
  try {
    response = await fetch("/api/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PageError("Safari can't reach the server.");
  }
  // The firewall's 429, or a function that crashed, has no JSON body.
  const reply = ((await response.json().catch(() => null)) ?? {}) as BrowseReply;
  if (!response.ok && !reply.error) {
    reply.error =
      response.status === 429
        ? "Safari is opening pages too quickly. Wait a minute, then try again."
        : `Could not load the page (${response.status}).`;
  }
  if (reply.error || !Array.isArray(reply.nodes)) throw new PageError(reply.error ?? "The server sent back nothing.");
  const url = reply.url || request.url;
  return { kind: "document", url, title: reply.title || url, nodes: reply.nodes };
}

/**
 * Image hosts that allow any origin (`Access-Control-Allow-Origin: *`), so
 * Safari reads them itself rather than through the server.
 */
const CORS_IMAGE_HOSTS = /^(avatars|raw)\.githubusercontent\.com$/i;

/**
 * Pixels for an image on a web page: straight from the hosts that allow it,
 * otherwise through the server (pages are cross-origin).
 */
export function remoteImageLoader(fetch: FetchFunction, images: ImageService | undefined, maxWidth: number) {
  const get = async (url: string): Promise<ImageFrame | null> => {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return images!.decode(bytes, response.headers.get("content-type") ?? undefined, { maxWidth });
  };
  const proxied = (src: string) => get(`/api/web-image?url=${encodeURIComponent(src)}`);
  return async (src: string): Promise<ImageFrame | null> => {
    if (!images || !/^https?:\/\//i.test(src)) return null;
    const host = parseUrl(src)?.hostname ?? "";
    if (!CORS_IMAGE_HOSTS.test(host)) return proxied(src);
    try {
      return (await get(src)) ?? (await proxied(src));
    } catch {
      return proxied(src);
    }
  };
}
