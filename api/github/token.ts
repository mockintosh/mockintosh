/**
 * Signing in to GitHub from Safari. GitHub's OAuth apps need their client
 * secret to turn a sign-in code into a token, even with PKCE, and its token
 * endpoint can't be read from a page, so the exchange happens here.
 *
 *   GET  /api/github/token  → { clientId }, or 503 when the deployment has no OAuth app
 *   POST /api/github/token  { code, code_verifier, redirect_uri }
 *     → { access_token, scope } | { error }
 *
 * The code arrives through the phone sign-in relay (`api/oauth/*`). Nothing
 * is stored: the token goes straight back to the Macintosh that asked.
 * Configure with `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from an OAuth
 * app whose callback URL is this deployment's `/api/oauth/callback`.
 */

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const MAX_FIELD = 512;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function app(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const NOT_CONFIGURED = "GitHub sign-in needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server.";

function field(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD ? value : null;
}

export default async function handler(req: Request): Promise<Response> {
  const oauth = app();
  if (req.method === "GET") return oauth ? json({ clientId: oauth.clientId }) : json({ error: NOT_CONFIGURED }, 503);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!oauth) return json({ error: NOT_CONFIGURED }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const code = field(body, "code");
  const verifier = field(body, "code_verifier");
  const redirectUri = field(body, "redirect_uri");
  if (!code || !verifier || !redirectUri) return json({ error: "Missing code, code_verifier or redirect_uri" }, 400);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  const reply = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof reply.access_token === "string") {
    return json({ access_token: reply.access_token, scope: typeof reply.scope === "string" ? reply.scope : "" });
  }
  const error = typeof reply.error_description === "string" ? reply.error_description : typeof reply.error === "string" ? reply.error : "";
  return json({ error: error || `GitHub returned ${response.status}.` }, 502);
}

export const config = { runtime: "edge" };
