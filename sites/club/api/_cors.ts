/**
 * The Club answers Macintoshes on any site: mockintosh.com, a preview, or
 * someone's own copy. They authenticate with a bearer token, never a
 * cookie, so allowing every origin lends nobody's session to another site.
 * Preflights are cached for a day, so a Mac asks once.
 */

const ALLOW_HEADERS = "Authorization, Content-Type";
/** Better Auth's bearer plugin hands a new session token back in this header. */
const EXPOSE_HEADERS = "set-auth-token";

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Expose-Headers": EXPOSE_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** `handler`, answering preflights and adding CORS headers to every response. */
export function withCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    const resp = await handler(req);
    const headers = new Headers(resp.headers);
    for (const [name, value] of Object.entries(corsHeaders(req))) headers.set(name, value);
    // Cookies would be third-party on every other site; the Mac uses the bearer token instead.
    headers.delete("set-cookie");
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
  };
}
