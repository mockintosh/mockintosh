/**
 * What the disk routes share: the member a request's token names, and
 * JSON answers. See `api/_disk.ts`.
 */
import { clubAuth, memberFromRequest, type Member } from "../_auth.js";
import { clubDisk, type Disk } from "../_disk.js";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** The member and their disk, or the response refusing the request. */
export async function memberDisk(req: Request): Promise<{ member: Member; disk: Disk } | Response> {
  const disk = clubDisk();
  const auth = clubAuth();
  if (!disk || !auth) return json({ error: "The Computer Club isn't open on this server yet." }, 503);
  const member = await memberFromRequest(auth, req);
  if (!member) return json({ error: "Not signed in", code: "not_a_member" }, 401);
  return { member, disk };
}
