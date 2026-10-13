/**
 * GET /api/config — how the asking Macintosh signs in: with the Club's
 * email form drawn on the Mac (`form`, Mockintosh's own sites only) or by
 * connecting on the Club's page (`connect`), and which providers the
 * Club's pages offer.
 */
import { macOriginPatterns, offeredProviders, originMatches } from "./_auth.js";
import { withCors } from "./_cors.js";

const handler = withCors(async (req) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const signIn = originMatches(req.headers.get("origin"), macOriginPatterns()) ? "form" : "connect";
  return new Response(JSON.stringify({ signIn, providers: offeredProviders() }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
