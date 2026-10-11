/**
 * /api/auth/* — the Computer Club's accounts (Better Auth): sign-up, sign-in,
 * sign-out, the session, email verification and password resets. See
 * `api/_auth.ts`.
 */
import { clubAuth } from "../_auth.js";
import { withCors } from "../_cors.js";

const handler = withCors(async (req) => {
  const auth = clubAuth();
  if (!auth) {
    return new Response(JSON.stringify({ message: "The Computer Club isn't open on this server yet." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  return auth.handler(req);
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
