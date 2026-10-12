/**
 * GET /api/disk/changes?since=N — the member's disk rows changed after N,
 * oldest first, a page at a time. See `api/_disk.ts`.
 */
import { withCors } from "../_cors.js";
import { json, memberDisk } from "./_common.js";

const handler = withCors(async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const found = await memberDisk(req);
  if (found instanceof Response) return found;
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) return json({ error: "since must be a change number" }, 400);
  return json(await found.disk.changes(found.member.id, since));
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
