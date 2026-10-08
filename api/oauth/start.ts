/**
 * POST /api/oauth/start  { url, appTitle }
 *   → { id, poll_token, url, expires_in, interval }
 *
 * `url` is the provider's authorize URL with `redirect_uri` pointing at this
 * relay's callback. The relay sets `state` to the new pairing id and returns
 * the URL, for signing in with the Macintosh's own browser instead of the
 * phone. See `_relay.ts`.
 */

import {
  CALLBACK_PATH,
  PAIRING_TTL_SECONDS,
  POLL_INTERVAL_SECONDS,
  STORE_MISSING_ERROR,
  json,
  randomId,
  relayStore,
} from "./_relay";

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 64;

function authorizeUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const redirect = url.searchParams.get("redirect_uri");
  try {
    if (!redirect || new URL(redirect).pathname !== CALLBACK_PATH) return null;
  } catch {
    return null;
  }
  return url;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const store = relayStore();
  if (!store) return json({ error: STORE_MISSING_ERROR }, 503);

  let body: { url?: unknown; appTitle?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const url = authorizeUrl(body.url);
  if (!url) return json({ error: "The sign-in URL must be https and redirect to the relay callback" }, 400);
  const appTitle = typeof body.appTitle === "string" ? body.appTitle.trim().slice(0, MAX_TITLE_LENGTH) : "";
  if (!appTitle) return json({ error: "Missing appTitle" }, 400);

  const id = randomId();
  const pollToken = randomId();
  url.searchParams.set("state", id);
  await store.put(id, { status: "pending", url: url.toString(), appTitle, pollToken }, PAIRING_TTL_SECONDS);
  return json({ id, poll_token: pollToken, url: url.toString(), expires_in: PAIRING_TTL_SECONDS, interval: POLL_INTERVAL_SECONDS });
}

export const config = { runtime: "edge" };
