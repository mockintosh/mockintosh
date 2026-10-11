/**
 * GET /api/verified — where a Computer Club verification link lands
 * once Better Auth has checked it (`?error=…` when it couldn't).
 */
import { html, page } from "../../../api/_page.js";

const TITLE = "Mockintosh Computer Club";

async function handler(req: Request): Promise<Response> {
  const error = new URL(req.url).searchParams.get("error");
  if (error) {
    return page(
      html`<p>This link has expired or was already used.</p><p class="small">On your Mockintosh, sign in to the Computer Club to get a new one.</p>`,
      400,
      { title: TITLE },
    );
  }
  return page(
    html`<p><strong>Welcome to the Mockintosh Computer Club!</strong></p><p>Your email is confirmed. Return to your Mockintosh: it signs you in by itself.</p>`,
    200,
    { title: TITLE },
  );
}

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
