/**
 * /api/auth/* — the Computer Club's accounts (Better Auth): emailed codes,
 * GitHub and Google, device codes for connecting a Macintosh, the session
 * and sign-out. See `api/_auth.ts`.
 */
import { clubAuth, siteOf } from "../_auth.js";
import { withCors } from "../_cors.js";

/** The device-code routes, whose `client_id` is the connecting Mac's site. */
const DEVICE_PATHS = ["/api/auth/device/code", "/api/auth/device/token"];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A device-code request with `client_id` set to the site in its `Origin`,
 * so the Club's connect page names the site that asked, not one it claims.
 * A server can still send any `Origin`; the code shown in both places is
 * what ties the page to the Mac.
 */
export async function withSiteAsClient(req: Request): Promise<Request | Response> {
  const site = siteOf(req.headers.get("origin"));
  if (!site) return json({ error: "invalid_request", error_description: "Connect from a Mockintosh in a browser." }, 400);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await req.text());
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ error: "invalid_request", error_description: "Expected a JSON body." }, 400);
  }
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  return new Request(req.url, { method: req.method, headers, body: JSON.stringify({ ...body, client_id: site }) });
}

const handler = withCors(async (req) => {
  const auth = clubAuth();
  if (!auth) return json({ message: "The Computer Club isn't open on this server yet." }, 503);
  if (req.method === "POST" && DEVICE_PATHS.includes(new URL(req.url).pathname)) {
    const rewritten = await withSiteAsClient(req);
    if (rewritten instanceof Response) return rewritten;
    return auth.handler(rewritten);
  }
  return auth.handler(req);
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
