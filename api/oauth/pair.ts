/**
 * GET /api/oauth/pair?id=<pairing id>
 *
 * The page the QR code opens on the phone: names the app and the provider
 * and links on to the provider's sign-in. See `_relay.ts`.
 */

import { EXPIRED_PAGE, STORE_MISSING_ERROR, html, isRandomId, page, relayStore } from "./_relay";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return page(html`<p>Method not allowed.</p>`, 405);
  const store = relayStore();
  if (!store) return page(html`<p>${STORE_MISSING_ERROR}</p>`, 503);

  const id = new URL(req.url).searchParams.get("id");
  const record = isRandomId(id) ? await store.get(id) : null;
  if (!record || record.status !== "pending") return page(EXPIRED_PAGE, 410);

  const host = new URL(record.url).host;
  return page(html`
<p><strong>${record.appTitle}</strong> on your Macintosh wants you to sign in at <strong>${host}</strong>.</p>
<a class="button" href="${record.url}">Continue</a>
<p class="small">Only continue if you just scanned this code on your own Macintosh.</p>`);
}

export const config = { runtime: "edge" };
