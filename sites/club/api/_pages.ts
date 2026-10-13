/**
 * What the Club's own pages share (`/`, the account page, and `/connect`):
 * signing in with an emailed code or a provider, in plain HTML forms that
 * post back to the page. These pages are first-party on the Club's host,
 * so the session is Better Auth's cookie; a POST must come from the Club's
 * own origin.
 */
import { html, page } from "../../../api/_page.js";
import { USERNAME_MAX, USERNAME_MIN, offeredProviders, type ClubAuth, type Provider } from "./_auth.js";

export const TITLE = "Mockintosh Computer Club";

const PROVIDER_NAMES: Record<Provider, string> = { github: "GitHub", google: "Google" };

/** Styles beyond `api/_page.ts`'s, for the account page's lists. */
const STYLE = html`<style>
  .card { max-width: 26em; margin: 1.5em auto; text-align: left; }
  .row { display: flex; justify-content: space-between; gap: 1em; padding: .35em 0; border-bottom: 1px solid #000; }
  .row:last-child { border-bottom: 0; }
  .mac { padding: .8em 0; border-bottom: 1px solid #000; }
  .mac form { display: inline; max-width: none; margin: 0; }
  .mac select { font: inherit; padding: .2em; border: 2px solid #000; }
  .mac button, .inline button { width: auto; margin: .4em .4em 0 0; padding: .2em .8em; }
  .inline { display: inline; max-width: none; margin: 0; }
  .providers button { width: 100%; margin: .3em 0; }
  h1 { font-size: 22px; }
  h2 { font-size: 18px; margin-top: 1.6em; }
</style>`;

/** A Club page: plain HTML, not redrawn (it has forms). */
export function clubPage(body: string, status = 200, headers: Headers = new Headers()): Response {
  const resp = page(STYLE + body, status, { title: TITLE, drawn: false, referrer: "same-origin" });
  for (const [name, value] of resp.headers) headers.set(name, value);
  return new Response(resp.body, { status, headers });
}

/** A redirect after a form, carrying the cookies Better Auth set. */
export function seeOther(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** A form POST's fields, or `null` when another site sent it. */
export async function formFields(req: Request): Promise<URLSearchParams | null> {
  const sameOrigin =
    req.headers.get("sec-fetch-site") === "same-origin" || req.headers.get("origin") === new URL(req.url).origin;
  if (!sameOrigin) return null;
  return new URLSearchParams(await req.text());
}

/** What a username may be, as the forms say it. */
export const USERNAME_RULE = `A username is ${USERNAME_MIN} to ${USERNAME_MAX} letters, digits, "_" or ".".`;

/**
 * Checks a new member's username before a code is sent for it: a code is
 * used up by a refused sign-up. Throws an `AuthFailure` the form can show.
 */
export async function assertUsernameFree(auth: ClubAuth, username: string): Promise<void> {
  const resp = await ok(await auth.api.isUsernameAvailable({ body: { username }, asResponse: true }));
  const { available } = (await resp.json()) as { available?: boolean };
  if (!available) throw new AuthFailure(400, { code: "USERNAME_IS_ALREADY_TAKEN" });
}

/** A refused Better Auth call: its status and JSON body. */
export class AuthFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: { message?: string; error_description?: string; code?: string; error?: string },
  ) {
    super(body.error_description ?? body.message ?? `Better Auth answered ${status}`);
  }
}

/** Better Auth's error as a sentence for the page. */
export function problemOf(error: unknown): string {
  if (error instanceof AuthFailure) {
    const { body } = error;
    if (body.code === "INVALID_OTP" || body.code === "OTP_EXPIRED") return "That code didn't work. Check it, or send a new one.";
    if (body.code === "TOO_MANY_ATTEMPTS") return "Too many tries with that code. Send a new one.";
    if (body.code === "USERNAME_REQUIRED") return "New members choose a username. Type one, then send a new code.";
    if (body.code === "USERNAME_IS_ALREADY_TAKEN") return "That username is taken. Choose another.";
    if (body.code === "USERNAME_TOO_SHORT" || body.code === "USERNAME_TOO_LONG" || body.code === "INVALID_USERNAME") return USERNAME_RULE;
    if (error.status === 429) return "Too many tries. Wait a minute, then try again.";
    return error.message;
  }
  console.error("Club page:", error);
  return "Something went wrong at the Club. Try again in a moment.";
}

/** The session cookie's member, or `null`. */
export async function signedIn(auth: ClubAuth, req: Request) {
  return auth.api.getSession({ headers: req.headers });
}

/** Cookies a Better Auth response set. */
function cookiesOf(resp: Response): string[] {
  return resp.headers.getSetCookie();
}

/** Throws Better Auth's error for a failed `asResponse` call. */
export async function ok(resp: Response): Promise<Response> {
  if (resp.ok) return resp;
  let body: AuthFailure["body"] = {};
  try {
    body = (await resp.json()) as AuthFailure["body"];
  } catch {
    // No JSON: the status says enough.
  }
  throw new AuthFailure(resp.status, body);
}

/** The page request's headers for a Better Auth call: its cookie and origin, not the form's body headers. */
export function authHeaders(req: Request): Headers {
  const headers = new Headers(req.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return headers;
}

/**
 * The sign-in forms' actions: `send-code`, `sign-in`, `provider`. Returns
 * the response to send, or `null` when `action` isn't one of them.
 * `back` is this page's own path and query, where sign-in returns.
 */
export async function signInAction(
  auth: ClubAuth,
  req: Request,
  fields: URLSearchParams,
  back: string,
): Promise<Response | null> {
  const action = fields.get("action");
  const email = (fields.get("email") ?? "").trim();
  const username = (fields.get("username") ?? "").trim();
  if (action === "send-code") {
    try {
      if (!email) throw new AuthFailure(400, { message: "Type your email address." });
      if (username) await assertUsernameFree(auth, username);
      await ok(await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: authHeaders(req), asResponse: true }));
      return clubPage(signInForm({ action: back, step: "code", email, username }));
    } catch (error) {
      return clubPage(signInForm({ action: back, step: "email", email, username, problem: problemOf(error) }), 400);
    }
  }
  if (action === "sign-in") {
    try {
      const otp = (fields.get("otp") ?? "").replace(/\D/g, "");
      const resp = await ok(
        await auth.api.signInEmailOTP({
          body: { email, otp, ...(username && { username, displayUsername: username, name: username }) },
          headers: authHeaders(req),
          asResponse: true,
        }),
      );
      return seeOther(back, cookiesOf(resp));
    } catch (error) {
      return clubPage(signInForm({ action: back, step: "code", email, username, problem: problemOf(error) }), 400);
    }
  }
  if (action === "provider") {
    const provider = fields.get("provider") as Provider;
    if (!offeredProviders().includes(provider)) return clubPage(signInForm({ action: back, step: "email" }), 400);
    try {
      const resp = await ok(
        await auth.api.signInSocial({
          body: { provider, callbackURL: back, errorCallbackURL: `${back}${back.includes("?") ? "&" : "?"}error=provider` },
          headers: authHeaders(req),
          asResponse: true,
        }),
      );
      const { url } = (await resp.json()) as { url?: string };
      if (!url) throw new Error(`${provider} gave no sign-in address`);
      return seeOther(url, cookiesOf(resp));
    } catch (error) {
      return clubPage(signInForm({ action: back, step: "email", problem: problemOf(error) }), 400);
    }
  }
  return null;
}

/** Signs the page's browser out of the Club. */
export async function signOut(auth: ClubAuth, req: Request, back: string): Promise<Response> {
  const resp = await auth.api.signOut({ headers: authHeaders(req), asResponse: true });
  return seeOther(back, cookiesOf(resp));
}

/**
 * Signing in, in two steps: an email address (and a username, for someone
 * new), then the six-digit code the Club emails. Or a provider.
 */
export function signInForm(options: {
  action: string;
  step: "email" | "code";
  email?: string;
  username?: string;
  problem?: string;
}): string {
  const problem = options.problem ? html`<p><strong>${options.problem}</strong></p>` : "";
  if (options.step === "code") {
    return (
      problem +
      html`<p>We sent a six-digit code to <strong>${options.email ?? ""}</strong>. It works for ten minutes.</p>
<form method="post" action="${options.action}">
<input type="hidden" name="action" value="sign-in">
<input type="hidden" name="email" value="${options.email ?? ""}">
<input type="hidden" name="username" value="${options.username ?? ""}">
<label for="otp">Code</label>
<input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required autofocus>
<button type="submit">Sign In</button>
</form>
<form method="post" action="${options.action}" class="inline">
<input type="hidden" name="action" value="send-code">
<input type="hidden" name="email" value="${options.email ?? ""}">
<input type="hidden" name="username" value="${options.username ?? ""}">
<p class="small">No email? <button type="submit">Send Another Code</button></p>
</form>`
    );
  }
  const providers = offeredProviders();
  return (
    problem +
    html`<form method="post" action="${options.action}">
<input type="hidden" name="action" value="send-code">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" value="${options.email ?? ""}" required autofocus>
<label for="username">Username <span class="small">(if you're new)</span></label>
<input id="username" name="username" autocomplete="username" minlength="${USERNAME_MIN}" maxlength="${USERNAME_MAX}" pattern="[A-Za-z0-9_.]+" value="${options.username ?? ""}">
<p class="small">${USERNAME_RULE} Your disk on every Mockintosh is named after it.</p>
<button type="submit">Send Me a Code</button>
</form>` +
    (providers.length
      ? html`<p class="small">or</p>` +
        html`<form method="post" action="${options.action}" class="providers"><input type="hidden" name="action" value="provider">` +
        providers.map((provider) => html`<button type="submit" name="provider" value="${provider}">Continue with ${PROVIDER_NAMES[provider]}</button>`).join("") +
        `</form>`
      : "")
  );
}

/** A device code as the Mac shows it: `ABCD-EFGH`. */
export function formatUserCode(code: string): string {
  const clean = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
