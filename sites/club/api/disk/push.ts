/**
 * POST /api/disk/push — a Macintosh's changes to the member's disk, each
 * applied only if based on the Club's current revision. See `api/_disk.ts`.
 */
import { DISK_FILE_MAX, NEWER_DISK_FORMAT, type DiskPush } from "../../../../packages/protocol/src/diskSync.js";
import { withCors } from "../_cors.js";
import { json, memberDisk } from "./_common.js";

/** A push carries inline contents up to 16 KB each; this bounds the request. */
const MAX_BODY = DISK_FILE_MAX;

function isPush(value: unknown): value is DiskPush {
  const push = value as DiskPush | null;
  return (
    !!push &&
    Number.isInteger(push.format) &&
    Array.isArray(push.changes) &&
    push.changes.every(
      (c) =>
        typeof c?.id === "string" &&
        typeof c.parentId === "string" &&
        typeof c.name === "string" &&
        (c.kind === "file" || c.kind === "directory") &&
        Number.isInteger(c.revision) &&
        Number.isInteger(c.baseRevision),
    )
  );
}

const handler = withCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const found = await memberDisk(req);
  if (found instanceof Response) return found;
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "Push fewer changes at once" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Expected JSON" }, 400);
  }
  if (!isPush(body)) return json({ error: "Expected { format, changes }" }, 400);
  const result = await found.disk.push(found.member.id, body);
  if (result === NEWER_DISK_FORMAT) {
    return json({ error: "This disk was written by a newer Mockintosh. Reload to get it, then try again.", code: NEWER_DISK_FORMAT }, 409);
  }
  return json(result);
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
