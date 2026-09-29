/**
 * Server-side fetch for pages and images the Macintosh asks for. Every hop
 * of a redirect chain is checked, so a public URL cannot bounce the server
 * onto its own network. (DNS that resolves a public name to a private
 * address is not caught here.)
 */

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

export class RemoteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface RemoteRequest {
  method?: "GET" | "POST";
  /** `application/x-www-form-urlencoded` body for POST. */
  body?: string;
  accept: string;
  maxBytes: number;
}

export interface RemoteResponse {
  /** Where the last redirect landed. */
  url: string;
  status: number;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** `https://` in front of a bare host, like an address bar. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Why `url` may not be fetched, or null when it may. */
export function blockedReason(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https addresses can be opened.";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return "That address is on a private network.";
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return "That address is on a private network.";
  return null;
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
}

export async function fetchRemote(rawUrl: string, request: RemoteRequest): Promise<RemoteResponse> {
  let url: URL;
  try {
    url = new URL(normalizeUrl(rawUrl));
  } catch {
    throw new RemoteError("That is not a web address.", 400);
  }
  let method = request.method ?? "GET";
  let body = request.body;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      const blocked = blockedReason(url);
      if (blocked) throw new RemoteError(blocked, 403);
      const response = await fetch(url, {
        method,
        body: method === "POST" ? body : undefined,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          ...BROWSER_HEADERS,
          Accept: request.accept,
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) throw new RemoteError("Too many redirects.", 508);
        url = new URL(location, url);
        if (response.status !== 307 && response.status !== 308) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      if (!response.ok) throw new RemoteError(statusMessage(response.status, response.statusText), response.status);
      const bytes = await readCapped(response, request.maxBytes);
      return { url: url.toString(), status: response.status, contentType: response.headers.get("content-type") ?? "", bytes };
    }
  } catch (error) {
    if (error instanceof RemoteError) throw error;
    if (controller.signal.aborted) throw new RemoteError("The site took too long to answer.", 504);
    throw new RemoteError(`Could not reach the site: ${error instanceof Error ? error.message : String(error)}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

function statusMessage(status: number, statusText: string): string {
  const hint =
    status === 401 || status === 403
      ? " (this site blocks automated access)"
      : status === 404
        ? " (page not found)"
        : status === 429
          ? " (rate limited, try again later)"
          : "";
  return `${status} ${statusText}${hint}`.trim();
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RemoteError("That page is too large to open.", 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Decode an HTML or text body with the charset its header or `<meta>` names. */
export function decodeText(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
