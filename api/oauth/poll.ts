/**
 * GET /api/oauth/poll?id=<pairing id>   (Authorization: Bearer <poll token>)
 *   → { status: "pending" } | { status: "complete", params } | { status: "expired" }
 *
 * Completed parameters are handed out once and the pairing is removed.
 * See `_relay.ts`.
 */

import { STORE_MISSING_ERROR, isRandomId, json, relayStore } from "./_relay";

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const store = relayStore();
  if (!store) return json({ error: STORE_MISSING_ERROR }, 503);

  const id = new URL(req.url).searchParams.get("id");
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const record = isRandomId(id) ? await store.get(id) : null;
  if (!id || !record || !sameToken(token, record.pollToken)) return json({ status: "expired" });
  if (record.status === "pending") return json({ status: "pending" });

  await store.remove(id);
  return json({ status: "complete", params: record.params ?? {} });
}

export const config = { runtime: "edge" };
