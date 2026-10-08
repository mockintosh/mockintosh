/**
 * Sign-in relay — lets an app on the Macintosh sign in to an OAuth provider
 * from the user's phone, the way TVs do. It stands in for the OAuth
 * device-authorization grant, which most providers (Spotify among them) keep
 * for their own clients.
 *
 *   1. `start`: the OS posts the provider's authorize URL (redirect_uri already
 *      set to our `callback`). The relay mints a pairing id, sets it as `state`,
 *      and returns the id plus a poll token that never leaves the Macintosh.
 *   2. The OS shows a QR code for `pair?id=…`. That page names the app and the
 *      provider's host and links on to the authorize URL — a confirmation step,
 *      so the relay is never a blind redirect off our domain.
 *   3. The provider redirects the phone to `callback`, which stores the query
 *      parameters (`code`, `error`, …) under the pairing.
 *   4. The OS polls `poll` with the token and receives the parameters once.
 *
 * `start` also returns the authorize URL with `state` set, so the user can
 * sign in in the Macintosh's own browser instead: the same pairing, minus
 * the confirmation page, which only guards a scanned code.
 *
 * The relay knows nothing about providers and never sees a client secret or
 * token: apps use PKCE and exchange the code themselves. Handlers may run as
 * separate stateless functions, so pairings live in a Redis REST store
 * (Upstash / Vercel KV env vars); local dev runs every handler in one Node
 * process and falls back to memory.
 */

export const CALLBACK_PATH = "/api/oauth/callback";
export const PAIRING_TTL_SECONDS = 600;
export const COMPLETED_TTL_SECONDS = 120;
export const POLL_INTERVAL_SECONDS = 2;

export interface RelayRecord {
  status: "pending" | "complete";
  /** The provider's authorize URL, `state` included. */
  url: string;
  /** Shown on the confirmation page. */
  appTitle: string;
  pollToken: string;
  /** What the provider sent back to `callback`, minus `state`. */
  params?: Record<string, string>;
}

export interface RelayStore {
  get(id: string): Promise<RelayRecord | null>;
  /** Creates or replaces the record; `ttlSeconds` counts from now. */
  put(id: string, record: RelayRecord, ttlSeconds: number): Promise<void>;
  remove(id: string): Promise<void>;
}

function createMemoryStore(): RelayStore {
  const records = new Map<string, { record: RelayRecord; expiresAt: number }>();
  return {
    async get(id) {
      const entry = records.get(id);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        records.delete(id);
        return null;
      }
      return entry.record;
    },
    async put(id, record, ttlSeconds) {
      records.set(id, { record, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async remove(id) {
      records.delete(id);
    },
  };
}

function createRedisRestStore(url: string, token: string): RelayStore {
  const key = (id: string) => `oauth-relay:${id}`;
  async function command(args: Array<string | number>): Promise<unknown> {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!resp.ok) throw new Error(`Relay store error: ${resp.status}`);
    return ((await resp.json()) as { result?: unknown }).result ?? null;
  }
  return {
    async get(id) {
      const raw = await command(["GET", key(id)]);
      if (typeof raw !== "string") return null;
      try {
        return JSON.parse(raw) as RelayRecord;
      } catch {
        return null;
      }
    },
    async put(id, record, ttlSeconds) {
      await command(["SET", key(id), JSON.stringify(record), "EX", ttlSeconds]);
    },
    async remove(id) {
      await command(["DEL", key(id)]);
    },
  };
}

let store: RelayStore | null | undefined;

/**
 * The configured store, or `null` on a serverless deployment without one —
 * memory there would not be shared between the handlers.
 */
export function relayStore(): RelayStore | null {
  if (store !== undefined) return store;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) store = createRedisRestStore(url, token);
  else if (process.env.VERCEL) store = null;
  else store = createMemoryStore();
  return store;
}

export const STORE_MISSING_ERROR =
  "Phone sign-in needs a Redis store: set KV_REST_API_URL and KV_REST_API_TOKEN";

/** 128 random bits, base64url. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const RANDOM_ID = /^[A-Za-z0-9_-]{22}$/;

export function isRandomId(value: string | null | undefined): value is string {
  return !!value && RANDOM_ID.test(value);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The script that redraws a page in 1-bit (`src/relay/main.tsx`): the
 * built file on a deployment, the source through Vite in development.
 */
const PAGE_SCRIPT = process.env.VERCEL ? "/relay.js" : "/src/relay/main.tsx";

/**
 * A page for the phone. `body` is trusted HTML; interpolate through `html`.
 * Keep it to paragraphs and `a.button` links: the page script redraws
 * those in 1-bit, and the HTML stays for screen readers.
 */
export function page(body: string, status = 200): Response {
  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Mockintosh Sign In</title>
<style>
  body { font: 18px/1.45 -apple-system, system-ui, sans-serif; margin: 3em 1.5em; text-align: center; color: #000; background: #fff; }
  a.button { display: inline-block; margin: 1em 0; padding: .6em 1.4em; border: 2px solid #000; border-radius: 10px; color: #000; text-decoration: none; font-weight: 600; }
  .small { font-size: 14px; color: #555; }
  #screen { position: fixed; inset: 0; display: none; }
  .drawn #screen { display: block; }
  /* Drawn in 1-bit over the page; still read aloud. */
  .drawn #content { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
</head>
<body><div id="content">${body}</div><div id="screen" aria-hidden="true"></div><script type="module" src="${PAGE_SCRIPT}"></script></body>
</html>`;
  return new Response(doc, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Tagged template that escapes every interpolated value. */
export function html(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? escapeHtml(String(values[i])) : ""), "");
}

export const EXPIRED_PAGE = html`<p>This code has expired. Show a new one on your Mockintosh and scan again.</p>`;
