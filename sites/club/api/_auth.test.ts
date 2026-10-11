import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../db/migrate";
import { createClubAuth, memberFromRequest, type ClubAuth } from "./_auth";
import type { Email } from "./_email";

const ORIGIN = "http://localhost:5199";
const BASE = "http://localhost:3002";

const sent: Email[] = [];
const welcomed: string[] = [];
let auth: ClubAuth;

beforeAll(async () => {
  const dialect = new PGliteDialect(new PGlite());
  await migrate(dialect);
  const env = {
    dialect,
    secret: "test-secret-test-secret-test-secret",
    sendEmail: async (email: Email) => void sent.push(email),
    hosts: [],
    localURL: BASE,
    macOrigins: [ORIGIN],
    welcome: async (memberId: string) => void welcomed.push(memberId),
  };
  auth = createClubAuth(env);
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

function linkIn(email: Email): string {
  const link = /https?:\/\/\S+/.exec(email.text)?.[0];
  if (!link) throw new Error(`No link in "${email.subject}"`);
  return link;
}

describe("Computer Club accounts", () => {
  const member = { name: "Ada", email: "ada@example.com", password: "correct horse battery" };

  it("signs a member up, refuses them until their email is verified, then signs them in", async () => {
    const signUp = await post("/sign-up/email", { ...member, callbackURL: "/api/verified" });
    expect(signUp.status).toBe(200);
    expect(signUp.headers.getSetCookie()).toEqual([]);
    const welcome = sent.find((email) => email.to === member.email);
    expect(welcome?.subject).toBe("Welcome to the Mockintosh Computer Club");

    const early = await post("/sign-in/email", { email: member.email, password: member.password });
    expect(early.status).toBe(403);

    expect(welcomed).toEqual([]);
    const verify = await auth.handler(new Request(linkIn(welcome!)));
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toContain("/api/verified");
    expect(welcomed).toHaveLength(1);

    const wrong = await post("/sign-in/email", { email: member.email, password: "not the password" });
    expect(wrong.status).toBe(401);

    const signIn = await post("/sign-in/email", { email: member.email, password: member.password });
    expect(signIn.status).toBe(200);
    const authorization = bearerHeader(signIn);

    // A Mac on any site carries the token itself.
    const request = new Request(`${BASE}/api/chat`, { headers: { authorization, origin: "https://someones.example" } });
    expect(await memberFromRequest(auth, request)).toMatchObject({ email: member.email });

    const signOut = await post("/sign-out", {}, { authorization });
    expect(signOut.status).toBe(200);
    expect(await memberFromRequest(auth, request)).toBeNull();
  });

  it("resets a forgotten password from the emailed link", async () => {
    const count = sent.length;
    const ask = await post("/request-password-reset", { email: member.email, redirectTo: "/api/reset-password" });
    expect(ask.status).toBe(200);
    const reset = sent.slice(count).find((email) => email.subject.startsWith("Reset"));
    const landing = await auth.handler(new Request(linkIn(reset!)));
    expect(landing.status).toBe(302);
    const token = new URL(landing.headers.get("location")!, BASE).searchParams.get("token");
    expect(token).toBeTruthy();

    await auth.api.resetPassword({ body: { newPassword: "a brand new password", token: token! } });
    expect((await post("/sign-in/email", { email: member.email, password: member.password })).status).toBe(401);
    expect((await post("/sign-in/email", { email: member.email, password: "a brand new password" })).status).toBe(200);
  });

  it("refuses another site's request that carries the member's cookie", async () => {
    const signIn = await post("/sign-in/email", { email: member.email, password: "a brand new password" });
    const cookie = cookieHeader(signIn);
    const resp = await post("/sign-out", {}, { cookie, Origin: "https://evil.example" });
    expect(resp.status).toBe(403);
    expect(await memberFromRequest(auth, new Request(`${BASE}/api/chat`, { headers: { cookie } }))).not.toBeNull();
  });

  it("lets only Mockintosh's own sites show the sign-in form", async () => {
    const elsewhere = await post("/sign-in/email", { email: member.email, password: "a brand new password" }, { Origin: "https://someones.example" });
    expect(elsewhere.status).toBe(403);
  });

  it("has no member without a session", async () => {
    expect(await memberFromRequest(auth, new Request(`${BASE}/api/chat`))).toBeNull();
    expect(await memberFromRequest(null, new Request(`${BASE}/api/chat`))).toBeNull();
  });
});
