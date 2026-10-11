/**
 * /api/reset-password — the page a password-reset email opens. Better
 * Auth checks the link and sends it here with `?token=…` (or `?error=…`);
 * the form posts the new password back here, which hands it to Better Auth.
 */
import { APIError } from "better-auth/api";
import { clubAuth } from "./_auth.js";
import { html, page } from "../../../api/_page.js";

const TITLE = "Reset Password";
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

const EXPIRED = html`<p>This link has expired or was already used.</p><p class="small">On your Mockintosh, choose Forgot Password in the Computer Club window to get a new one.</p>`;

function form(token: string, problem?: string): string {
  return html`<p><strong>Choose a new password</strong> for your Mockintosh Computer Club membership.</p>` +
    (problem ? html`<p>${problem}</p>` : "") +
    html`<form method="post">
<input type="hidden" name="token" value="${token}">
<label for="password">New password (at least ${MIN_LENGTH} characters)</label>
<input id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_LENGTH}" maxlength="${MAX_LENGTH}" required>
<label for="confirm">Type it again</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_LENGTH}" maxlength="${MAX_LENGTH}" required>
<button type="submit">Change Password</button>
</form>`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const token = query.get("token");
    if (!token || query.get("error")) return page(EXPIRED, 400, { title: TITLE });
    return page(form(token), 200, { title: TITLE, drawn: false });
  }
  if (req.method !== "POST") return page(html`<p>Method not allowed.</p>`, 405, { title: TITLE });

  const auth = clubAuth();
  if (!auth) return page(html`<p>The Computer Club isn't open on this server yet.</p>`, 503, { title: TITLE });

  const fields = new URLSearchParams(await req.text());
  const token = fields.get("token") ?? "";
  const password = fields.get("password") ?? "";
  if (!token) return page(EXPIRED, 400, { title: TITLE });
  if (password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
    return page(form(token, `Use ${MIN_LENGTH} to ${MAX_LENGTH} characters.`), 400, { title: TITLE, drawn: false });
  }
  if (password !== fields.get("confirm")) {
    return page(form(token, "The two passwords don't match."), 400, { title: TITLE, drawn: false });
  }
  try {
    await auth.api.resetPassword({ body: { newPassword: password, token } });
  } catch (error) {
    if (error instanceof APIError) return page(EXPIRED, 400, { title: TITLE });
    throw error;
  }
  return page(
    html`<p><strong>Your password is changed.</strong></p><p>Return to your Mockintosh and sign in to the Computer Club with it.</p>`,
    200,
    { title: TITLE },
  );
}
