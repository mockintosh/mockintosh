/**
 * GET /api/club/credits — the signed-in member's credits and their latest
 * changes, for the Computer Club window and apps' `useApp().club`.
 */
import { clubAuth, memberFromRequest } from "../_auth.js";
import { clubCredits } from "../_credits.js";

const RECENT = 8;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const credits = clubCredits();
  const auth = clubAuth();
  if (!credits || !auth) return json({ error: "The Computer Club isn't open on this server yet." }, 503);
  const member = await memberFromRequest(auth, req);
  if (!member) return json({ error: "Not signed in", code: "not_a_member" }, 401);
  const [balance, recent] = await Promise.all([credits.balance(member.id), credits.recent(member.id, RECENT)]);
  return json({ balance, recent });
}
