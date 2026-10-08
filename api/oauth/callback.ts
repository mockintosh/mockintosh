/**
 * GET /api/oauth/callback?state=<pairing id>&code=…
 *
 * The redirect URI apps register with their provider. Stores what the
 * provider sent back for the Macintosh to collect. See `_relay.ts`.
 */

import {
  COMPLETED_TTL_SECONDS,
  EXPIRED_PAGE,
  STORE_MISSING_ERROR,
  html,
  isRandomId,
  page,
  relayStore,
} from "./_relay";

const MAX_PARAMS = 16;
const MAX_VALUE_LENGTH = 4096;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return page(html`<p>Method not allowed.</p>`, 405);
  const store = relayStore();
  if (!store) return page(html`<p>${STORE_MISSING_ERROR}</p>`, 503);

  const query = new URL(req.url).searchParams;
  const id = query.get("state");
  const record = isRandomId(id) ? await store.get(id) : null;
  if (!id || !record || record.status !== "pending") return page(EXPIRED_PAGE, 410);

  const params: Record<string, string> = {};
  for (const [key, value] of query) {
    if (key === "state" || Object.keys(params).length >= MAX_PARAMS) continue;
    params[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  await store.put(id, { ...record, status: "complete", params }, COMPLETED_TTL_SECONDS);

  if (params.error) {
    return page(
      params.error === "access_denied"
        ? html`<p>Sign-in was cancelled. You can close this page.</p>`
        : html`<p>Sign-in failed: ${params.error_description ?? params.error}</p>`
    );
  }
  return page(html`<p>You’re signed in. You can close this page and return to your Mockintosh.</p>`);
}

export const config = { runtime: "edge" };
