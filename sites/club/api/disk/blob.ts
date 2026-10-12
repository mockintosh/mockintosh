/**
 * GET/PUT /api/disk/blob?sha=<sha256> — a larger file's contents on the
 * member's disk, by hash: uploaded before the push that uses it, fetched by
 * other Macs. See `api/_disk.ts`.
 */
import { DISK_FILE_MAX } from "../../../../packages/protocol/src/diskSync.js";
import { withCors } from "../_cors.js";
import { json, memberDisk } from "./_common.js";

const handler = withCors(async (req) => {
  const found = await memberDisk(req);
  if (found instanceof Response) return found;
  const sha = new URL(req.url).searchParams.get("sha") ?? "";

  if (req.method === "GET") {
    const bytes = await found.disk.getBlob(found.member.id, sha);
    if (!bytes) return json({ error: "No such contents" }, 404);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" },
    });
  }

  if (req.method === "PUT") {
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > DISK_FILE_MAX) return json({ error: "Too large", code: "too_large" }, 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    const result = await found.disk.putBlob(found.member.id, sha, bytes);
    if (result === "mismatch") return json({ error: "The contents don't match their hash", code: "mismatch" }, 400);
    if (result === "too_large") return json({ error: "Too large", code: "too_large" }, 413);
    if (result === "over_quota") return json({ error: "The disk is full", code: "over_quota" }, 413);
    return new Response(null, { status: result === "stored" ? 201 : 204 });
  }

  return json({ error: "Method not allowed" }, 405);
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
