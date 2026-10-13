/**
 * /connect (`vercel.json` rewrites it here) — where a Macintosh on any site
 * is connected to a member's credits. The Mac asks the Club for a device
 * code and opens this page with it (`?user_code=ABCDEFGH`), in a real browser
 * window or on a phone. The member signs in here (emailed code, GitHub,
 * Google), sees which site asked, checks the code matches, and allows it;
 * the Mac, polling `/api/auth/device/token`, then receives its token.
 */
import { html } from "../../../api/_page.js";
import { clubAuth, type ClubAuth } from "./_auth.js";
import {
  authHeaders,
  clubPage,
  formatUserCode,
  formFields,
  ok,
  problemOf,
  signInAction,
  signInForm,
  signOut,
  signedIn,
} from "./_pages.js";

const PATH = "/connect";

function backTo(code: string): string {
  return code ? `${PATH}?user_code=${encodeURIComponent(code)}` : PATH;
}

function askForCode(problem?: string): Response {
  return clubPage(
    (problem ? html`<p><strong>${problem}</strong></p>` : "") +
      html`<h1>Connect a Mockintosh</h1>
<p>Type the code your Mockintosh shows in its Computer Club window.</p>
<form method="get" action="${PATH}">
<label for="code">Code</label>
<input id="code" name="user_code" autocomplete="off" autocapitalize="characters" maxlength="9" required autofocus>
<button type="submit">Continue</button>
</form>`,
    problem ? 400 : 200,
  );
}

/** The device code's state for the signed-in member, which also claims it for them. */
async function lookUp(auth: ClubAuth, req: Request, code: string): Promise<{ status: string; site: string }> {
  const resp = await ok(await auth.api.deviceVerify({ query: { user_code: code }, headers: authHeaders(req), asResponse: true }));
  const data = (await resp.json()) as { status?: string; client_id?: string };
  return { status: data.status ?? "pending", site: data.client_id ?? "A website" };
}

function memberLine(email: string, code: string): string {
  return html`<form method="post" action="${backTo(code)}" class="inline"><input type="hidden" name="action" value="sign-out"><p class="small">Signed in as ${email}. <button type="submit">Not You?</button></p></form>`;
}

function consent(site: string, code: string, email: string): string {
  return html`<h1>Connect ${site}?</h1>
<p><strong>${site}</strong>'s Mockintosh wants to use your Computer Club credits.</p>
<p>Check that it shows this code:</p>
<p style="font-size: 28px; letter-spacing: .1em"><strong>${formatUserCode(code)}</strong></p>
<p class="small">Connect only a Mockintosh you're using now. Anything it runs can spend your credits; you can disconnect it, or cap what it spends a day, on your account page.</p>
<form method="post" action="${backTo(code)}">
<button type="submit" name="action" value="approve">Connect</button>
<button type="submit" name="action" value="deny">Don't Connect</button>
</form>` + memberLine(email, code);
}

async function handler(req: Request): Promise<Response> {
  const auth = clubAuth();
  if (!auth) return clubPage(html`<p>The Computer Club isn't open on this server yet.</p>`, 503);
  const code = (new URL(req.url).searchParams.get("user_code") ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (new URL(req.url).searchParams.get("error")) {
    return clubPage(html`<p><strong>That sign-in didn't finish.</strong></p>` + signInForm({ action: backTo(code), step: "email" }), 400);
  }

  if (req.method === "POST") {
    const fields = await formFields(req);
    if (!fields) return clubPage(html`<p>That form came from another site.</p>`, 403);
    const signingIn = await signInAction(auth, req, fields, backTo(code));
    if (signingIn) return signingIn;
    if (fields.get("action") === "sign-out") return signOut(auth, req, backTo(code));
    const session = await signedIn(auth, req);
    if (!session) return clubPage(signInForm({ action: backTo(code), step: "email" }), 401);
    const action = fields.get("action");
    if (action !== "approve" && action !== "deny") return clubPage(html`<p>Unknown action.</p>`, 400);
    try {
      const call = action === "approve" ? auth.api.deviceApprove : auth.api.deviceDeny;
      await ok(await call({ body: { userCode: code }, headers: authHeaders(req), asResponse: true }));
    } catch (error) {
      return clubPage(html`<p><strong>${problemOf(error)}</strong></p><p>Get a new code on your Mockintosh and try again.</p>`, 400);
    }
    return clubPage(
      action === "approve"
        ? html`<h1>Connected</h1><p>Your Mockintosh signs in by itself in a moment. You can close this page.</p><p class="small"><a href="/">Your account</a></p>`
        : html`<h1>Not connected</h1><p>That Mockintosh can't use your credits. You can close this page.</p>`,
    );
  }

  if (req.method !== "GET") return clubPage(html`<p>Method not allowed.</p>`, 405);
  if (!code) return askForCode();
  const session = await signedIn(auth, req);
  if (!session) {
    return clubPage(
      html`<h1>Connect a Mockintosh</h1><p>Sign in to the Computer Club, or join: a new membership comes with credits to start.</p>` +
        signInForm({ action: backTo(code), step: "email" }),
    );
  }
  let state: { status: string; site: string };
  try {
    state = await lookUp(auth, req, code);
  } catch (error) {
    return askForCode(problemOf(error));
  }
  if (state.status === "approved") return clubPage(html`<h1>Connected</h1><p>${state.site}'s Mockintosh is connected. You can close this page.</p>`);
  if (state.status === "denied") return askForCode("That code was turned down. Get a new one on your Mockintosh.");
  return clubPage(consent(state.site, code, session.user.email));
}

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
