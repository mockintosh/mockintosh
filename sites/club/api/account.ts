/**
 * / (`vercel.json` rewrites it here) — the Computer Club's own page: sign
 * in or join, then your credits, the Macintoshes connected to them (each
 * with a daily cap and Disconnect), and Sign Out.
 */
import { html } from "../../../api/_page.js";
import { clubAuth } from "./_auth.js";
import { clubCredits, type LedgerEntry } from "./_credits.js";
import { USERNAME_MAX, USERNAME_MIN } from "./_auth.js";
import {
  USERNAME_RULE,
  assertUsernameFree,
  authHeaders,
  clubPage,
  formFields,
  ok,
  problemOf,
  seeOther,
  signInAction,
  signInForm,
  signOut,
  signedIn,
} from "./_pages.js";
import { clubSessions, type ConnectedSession } from "./_sessions.js";

const PATH = "/";
/** The caps offered per Mac, in credits a day (1,000 credits = $1). */
const CAPS = [100, 250, 500, 1000, 2500, 5000];

const formatDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const formatCredits = (credits: number) => credits.toLocaleString("en-US");

function entryLabel(entry: LedgerEntry): string {
  switch (entry.kind) {
    case "grant":
      return "Welcome credits";
    case "purchase":
      return "Bought credits";
    case "refund":
      return "Refund";
    case "adjust":
      return "Adjustment";
    case "usage":
      return entry.model?.includes("image") ? "Assistant picture" : "Assistant reply";
  }
}

function signedOutPage(): Response {
  return clubPage(
    html`<h1>Mockintosh Computer Club</h1>
<p>Members use the Assistant and the other AI on <a href="https://mockintosh.com">mockintosh.com</a>, and on any Mockintosh they connect. Joining is free and comes with credits to start.</p>` +
      signInForm({ action: PATH, step: "email" }),
  );
}

function macRow(session: ConnectedSession): string {
  const name = session.site ?? "A Mockintosh";
  const since = html`<span class="small">Since ${formatDate(session.connectedAt)}</span>`;
  const options = [html`<option value="">No daily limit</option>`]
    .concat(
      CAPS.map((cap) =>
        session.dailyCap === cap
          ? html`<option value="${cap}" selected>${formatCredits(cap)} credits a day</option>`
          : html`<option value="${cap}">${formatCredits(cap)} credits a day</option>`,
      ),
    )
    .join("");
  const custom =
    session.dailyCap !== null && !CAPS.includes(session.dailyCap)
      ? html`<option value="${session.dailyCap}" selected>${formatCredits(session.dailyCap)} credits a day</option>`
      : "";
  return (
    html`<div class="mac"><strong>${name}</strong> ` +
    since +
    html`<br><form method="post" action="${PATH}"><input type="hidden" name="session" value="${session.id}"><input type="hidden" name="action" value="cap">` +
    `<select name="cap" aria-label="Daily limit for ${html`${name}`}">${options}${custom}</select>` +
    html`<button type="submit">Save</button></form><form method="post" action="${PATH}"><input type="hidden" name="session" value="${session.id}"><button type="submit" name="action" value="disconnect">Disconnect</button></form></div>`
  );
}

interface PageUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  username?: string | null;
  displayUsername?: string | null;
}

/** For a member without a username (one who joined with GitHub or Google): choosing one. */
function chooseUsername(problem?: string): string {
  return (
    html`<div class="card"><h2>Choose a username</h2>` +
    (problem ? html`<p><strong>${problem}</strong></p>` : "") +
    html`<form method="post" action="${PATH}">
<input type="hidden" name="action" value="username">
<label for="username">Username</label>
<input id="username" name="username" autocomplete="username" minlength="${USERNAME_MIN}" maxlength="${USERNAME_MAX}" pattern="[A-Za-z0-9_.]+" required>
<p class="small">${USERNAME_RULE} Your disk on every Mockintosh is named after it.</p>
<button type="submit">Choose</button>
</form></div>`
  );
}

async function memberPage(user: PageUser, currentSession: string, problem?: string): Promise<Response> {
  const credits = clubCredits();
  const sessions = clubSessions();
  if (!credits || !sessions) return clubPage(html`<p>The Computer Club isn't open on this server yet.</p>`, 503);
  const [balance, recent, connected] = await Promise.all([credits.balance(user.id), credits.recent(user.id, 8), sessions.list(user.id)]);
  const macs = connected.filter((session) => session.id !== currentSession);
  return clubPage(
    html`<h1>Mockintosh Computer Club</h1>
<div class="card">
<div class="row"><span>Member</span><span>${user.displayUsername || user.username || user.name || user.email}</span></div>
<div class="row"><span>Email</span><span>${user.email}</span></div>
<div class="row"><span>Since</span><span>${formatDate(new Date(user.createdAt).getTime())}</span></div>
<div class="row"><span>Credits</span><strong>${formatCredits(balance)}</strong></div>
</div>` +
      (user.username ? "" : chooseUsername(problem)) +
      (recent.length
        ? html`<div class="card"><h2>Latest</h2>` +
          recent
            .map(
              (entry) =>
                html`<div class="row"><span>${new Date(entry.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${entryLabel(entry)}</span><span>${entry.delta > 0 ? "+" : "−"}${formatCredits(Math.abs(entry.delta))}</span></div>`,
            )
            .join("") +
          `</div>`
        : "") +
      html`<div class="card"><h2>Connected Macintoshes</h2>` +
      (macs.length
        ? html`<p class="small">Each can spend your credits until you disconnect it. A daily limit counts the last 24 hours.</p>` +
          macs.map(macRow).join("")
        : html`<p class="small">None yet. On a Mockintosh, choose Computer Club… from the Apple menu.</p>`) +
      html`<div class="mac"><strong>This browser</strong> <span class="small">Signed in here</span></div>` +
      html`<form method="post" action="${PATH}" class="inline"><button type="submit" name="action" value="sign-out">Sign Out</button></form></div>`,
  );
}

async function handler(req: Request): Promise<Response> {
  const auth = clubAuth();
  if (!auth) return clubPage(html`<p>The Computer Club isn't open on this server yet.</p>`, 503);

  if (req.method === "POST") {
    const fields = await formFields(req);
    if (!fields) return clubPage(html`<p>That form came from another site.</p>`, 403);
    const signingIn = await signInAction(auth, req, fields, PATH);
    if (signingIn) return signingIn;
    if (fields.get("action") === "sign-out") return signOut(auth, req, PATH);
    const session = await signedIn(auth, req);
    const sessions = clubSessions();
    if (!session || !sessions) return seeOther(PATH);
    if (fields.get("action") === "username") {
      const username = (fields.get("username") ?? "").trim();
      try {
        await assertUsernameFree(auth, username);
        await ok(
          await auth.api.updateUser({ body: { username, displayUsername: username }, headers: authHeaders(req), asResponse: true }),
        );
      } catch (error) {
        return memberPage(session.user as PageUser, session.session.id, problemOf(error));
      }
      return seeOther(PATH);
    }
    const target = fields.get("session") ?? "";
    if (fields.get("action") === "disconnect" && target !== session.session.id) await sessions.disconnect(session.user.id, target);
    if (fields.get("action") === "cap") {
      const cap = Number(fields.get("cap"));
      await sessions.setCap(session.user.id, target, fields.get("cap") && Number.isInteger(cap) && cap > 0 ? cap : null);
    }
    return seeOther(PATH);
  }

  if (req.method !== "GET") return clubPage(html`<p>Method not allowed.</p>`, 405);
  const session = await signedIn(auth, req);
  if (!session) return signedOutPage();
  return memberPage(session.user as PageUser, session.session.id);
}

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };
