/**
 * GET /api/config — how this Mockintosh is set up (`src/shared/hostConfig.ts`).
 *
 * `CLUB_URL` names the Computer Club, or is empty for none; unset, a
 * deployment uses ours and local development the one `npm run dev:club`
 * serves. `AI_ACCESS=open` lets a Club-less deployment's own key pay.
 */
import { OFFICIAL_CLUB_URL, type HostConfig } from "../src/shared/hostConfig.js";

/** Where `npm run dev:club` listens (`sites/club/scripts/dev.ts`). */
const LOCAL_CLUB_URL = "http://localhost:3002";

export function hostConfig(env: Record<string, string | undefined> = process.env): HostConfig {
  const named = env.CLUB_URL;
  const club = named === undefined ? (env.VERCEL ? OFFICIAL_CLUB_URL : LOCAL_CLUB_URL) : named.trim().replace(/\/$/, "") || null;
  return { club, ai: club ? "club" : env.AI_ACCESS === "open" ? "open" : "key" };
}

async function handler(): Promise<Response> {
  return new Response(JSON.stringify(hostConfig()), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
