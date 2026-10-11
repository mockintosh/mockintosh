import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../db/migrate";
import { createClubAuth, memberFromRequest, originMatches, OWN_MAC_ORIGINS, type ClubAuth } from "./_auth";
import { withSiteAsClient } from "./auth/[...all]";
import type { Email } from "./_email";
import { createSessions, type Sessions } from "./_sessions";

/** A Mac on one of Mockintosh's own sites: it may show the email form. */
const ORIGIN = "http://localhost:5199";
const BASE = "http://localhost:3002";
/** Someone's own copy, which connects on the Club's page instead. */
const ELSEWHERE = "https://someones.example";

const sent: Email[] = [];
const welcomed: string[] = [];
let auth: ClubAuth;
let sessions: Sessions;

beforeAll(async () => {
  const dialect = new PGliteDialect(new PGlite());
  await migrate(dialect);
  auth = createClubAuth({
    dialect,
    secret: "test-secret-test-secret-test-secret",
    sendEmail: async (email: Email) => void sent.push(email),
    hosts: [],
    localURL: BASE,
    macOrigins: [ORIGIN],
    welcome: async (memberId: string) => void welcomed.push(memberId),
  });
  sessions = createSessions(dialect);
}, 30_000);

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** The `name=value` pairs of a response's cookies, as a `Cookie` header. */
function cookieHeader(resp: Response): string {
  return resp.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

/** The session token a sign-in hands back, as an `Authorization` header. */
function bearerHeader(resp: Response): string {
  const token = resp.headers.get("set-auth-token");
  if (!token) throw new Error("No set-auth-token on the sign-in");
  return `Bearer ${token}`;
}

/** The code in the latest email to `to`. */
function codeFor(to: string): string {
  const email = sent.filter((message) => message.to === to).at(-1);
  const code = email && /\b(\d{6})\b/.exec(email.subject)?.[1];
  if (!code) throw new Error(`No code emailed to ${to}`);
  return code;
}

/** Signs `email` in from `origin` with an emailed code. */
async function signInWithCode(email: string, origin = ORIGIN, name?: string): Promise<Response> {
  expect((await post("/email-otp/send-verification-otp", { email, type: "sign-in" }, { Origin: origin })).status).toBe(200);
  return post("/sign-in/email-otp", { email, otp: codeFor(email), ...(name && { name }) }, { Origin: origin });
}

function chatRequest(authorization: string): Request {
  return new Request(`${BASE}/api/chat`, { headers: { authorization, origin: ELSEWHERE } });
}

describe("Computer Club accounts", () => {
  it("makes a new member from an emailed code, welcomes them once, and hands the Mac a token", async () => {
    const signIn = await signInWithCode("ada@example.com", ORIGIN, "Ada");
    expect(signIn.status).toBe(200);
    expect(welcomed).toHaveLength(1);
    const member = await memberFromRequest(auth, chatRequest(bearerHeader(signIn)));
    expect(member).toMatchObject({ email: "ada@example.com", name: "Ada", session: { site: "localhost:5199", dailyCap: null } });

    const again = await signInWithCode("ada@example.com");
    expect(again.status).toBe(200);
    expect(welcomed).toHaveLength(1);

    const signOut = await post("/sign-out", {}, { authorization: bearerHeader(signIn) });
    expect(signOut.status).toBe(200);
    expect(await memberFromRequest(auth, chatRequest(bearerHeader(signIn)))).toBeNull();
    expect(await memberFromRequest(auth, chatRequest(bearerHeader(again)))).not.toBeNull();
  });

  it("refuses a wrong code", async () => {
    await post("/email-otp/send-verification-otp", { email: "ada@example.com", type: "sign-in" });
    const code = codeFor("ada@example.com");
    const wrong = await post("/sign-in/email-otp", { email: "ada@example.com", otp: code === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get("set-auth-token")).toBeNull();
  });

  it("sends codes only to Macs on Mockintosh's own sites", async () => {
    const count = sent.length;
    const elsewhere = await post("/email-otp/send-verification-otp", { email: "ada@example.com", type: "sign-in" }, { Origin: ELSEWHERE });
    expect(elsewhere.status).toBe(403);
    expect(sent).toHaveLength(count);
  });

  it("refuses another site's request that carries the member's cookie", async () => {
    const cookie = cookieHeader(await signInWithCode("ada@example.com"));
    const resp = await post("/sign-out", {}, { cookie, Origin: "https://evil.example" });
    expect(resp.status).toBe(403);
    expect(await memberFromRequest(auth, new Request(`${BASE}/api/chat`, { headers: { cookie } }))).not.toBeNull();
  });

  it("connects a Mac on another site once the member approves its code on the Club's page", async () => {
    const deviceRequest = (path: string, body: unknown) =>
      withSiteAsClient(
        new Request(`${BASE}/api/auth${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: ELSEWHERE },
          // The Mac can't choose its own name: the Club uses its Origin.
          body: JSON.stringify({ ...(body as object), client_id: "mockintosh.com" }),
        }),
      ).then((req) => (req instanceof Response ? req : auth.handler(req)));

    const start = await deviceRequest("/device/code", {});
    expect(start.status).toBe(200);
    const { device_code, user_code, verification_uri_complete } = (await start.json()) as Record<string, string>;
    expect(verification_uri_complete).toContain(`/connect?user_code=${user_code}`);

    const waiting = await deviceRequest("/device/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code });
    expect(((await waiting.json()) as { error: string }).error).toBe("authorization_pending");

    // On the Club's page, signed in with the cookie.
    const page = { cookie: cookieHeader(await signInWithCode("ada@example.com")), origin: BASE };
    const verify = await auth.api.deviceVerify({ query: { user_code }, headers: new Headers(page) });
    expect(verify).toMatchObject({ status: "pending", client_id: "someones.example" });
    await auth.api.deviceApprove({ body: { userCode: user_code }, headers: new Headers(page) });

    // The Mac polls no faster than the interval it was given.
    await new Promise((resolve) => setTimeout(resolve, 5100));
    const granted = await deviceRequest("/device/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code });
    expect(granted.status).toBe(200);
    const { access_token } = (await granted.json()) as { access_token: string };
    const member = await memberFromRequest(auth, chatRequest(`Bearer ${access_token}`));
    expect(member).toMatchObject({ email: "ada@example.com", session: { site: "someones.example" } });

    // The account page lists it; a cap sticks to it, and Disconnect ends it.
    const listed = await sessions.list(member!.id);
    expect(listed.map((session) => session.site)).toContain("someones.example");
    expect(await sessions.setCap(member!.id, member!.session.id, 500)).toBe(true);
    expect((await memberFromRequest(auth, chatRequest(`Bearer ${access_token}`)))?.session.dailyCap).toBe(500);
    expect(await sessions.disconnect("someone-else", member!.session.id)).toBe(false);
    expect(await sessions.disconnect(member!.id, member!.session.id)).toBe(true);
    expect(await memberFromRequest(auth, chatRequest(`Bearer ${access_token}`))).toBeNull();
  }, 15_000);

  it("refuses a device code request without an Origin", async () => {
    const resp = await withSiteAsClient(
      new Request(`${BASE}/api/auth/device/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    );
    expect(resp).toBeInstanceOf(Response);
    expect((resp as Response).status).toBe(400);
  });

  it("has no member without a session", async () => {
    expect(await memberFromRequest(auth, new Request(`${BASE}/api/chat`))).toBeNull();
    expect(await memberFromRequest(null, new Request(`${BASE}/api/chat`))).toBeNull();
  });
});

describe("originMatches", () => {
  it("knows Mockintosh's own sites", () => {
    expect(originMatches("https://mockintosh.com", OWN_MAC_ORIGINS)).toBe(true);
    expect(originMatches("https://www.mockintosh.com", OWN_MAC_ORIGINS)).toBe(true);
    expect(originMatches("https://mockintosh-git-x-mossive.vercel.app", OWN_MAC_ORIGINS)).toBe(true);
    expect(originMatches("https://mockintosh.com.evil.example", OWN_MAC_ORIGINS)).toBe(false);
    expect(originMatches("https://evil.example/mockintosh.com", OWN_MAC_ORIGINS)).toBe(false);
    expect(originMatches("http://mockintosh.com", OWN_MAC_ORIGINS)).toBe(false);
    expect(originMatches(null, OWN_MAC_ORIGINS)).toBe(false);
  });
});
