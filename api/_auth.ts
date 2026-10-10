/**
 * The Mockintosh Computer Club's accounts: Better Auth on the Club's
 * Postgres database, served at `/api/auth/*` (`api/auth/[...all].ts`).
 * Members join with email and password from the Club window; the email
 * must be verified before they can sign in. The session is an httpOnly
 * cookie on this origin, so app processes' same-origin `fetch` carries it
 * to `/api/chat` without seeing it. See docs/computer-club-plan.md.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { Dialect } from "kysely";
import { databaseDialect } from "./_db.js";
import { emailSender, type SendEmail } from "./_email.js";
import { clubCredits, welcomeMember } from "./_credits.js";
import { clientAddress, guardEnvFromProcess } from "./_guard.js";

/** Where Better Auth's routes live; the Club window calls them here. */
export const AUTH_BASE_PATH = "/api/auth";
/** Where a verification link lands once the email is verified (`api/club/verified.ts`). */
export const VERIFIED_PATH = "/api/club/verified";
/** The page a password-reset link opens (`api/club/reset-password.ts`). */
export const RESET_PASSWORD_PATH = "/api/club/reset-password";

/** A member stays signed in on a Macintosh for 30 days after its last use. */
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export interface ClubAuthEnv {
  dialect: Dialect;
  sendEmail: SendEmail;
  /** Signs cookies and tokens: `BETTER_AUTH_SECRET`. */
  secret: string;
  /**
   * The hosts this deployment answers on (production, branch and deployment
   * URLs, `ALLOWED_ORIGINS`); links in email use the one the request came
   * to. Empty off Vercel, where `baseURL` is the local API server.
   */
  hosts: readonly string[];
  /** Off Vercel: the API server's own URL, which email links point at. */
  localURL?: string;
  /** Runs once a member's email is verified: their welcome credits. */
  welcome?: (memberId: string, request?: Request) => Promise<void>;
}

export function clubAuthOptions(env: ClubAuthEnv) {
  const hosted = env.hosts.length > 0;
  return {
    appName: "Mockintosh Computer Club",
    secret: env.secret,
    basePath: AUTH_BASE_PATH,
    baseURL: hosted
      ? { allowedHosts: [...env.hosts], fallback: `https://${env.hosts[0]}` }
      : (env.localURL ?? "http://localhost:3001"),
    // The local API server sits behind Vite's proxy, on whatever port it got.
    trustedOrigins: hosted ? [] : ["http://localhost:*", "http://127.0.0.1:*"],
    database: { dialect: env.dialect, type: "postgres", transaction: true },
    session: { expiresIn: SESSION_SECONDS },
    // Better Auth skips the origin check under a test runner; keep the production behaviour there too.
    advanced: { disableOriginCheck: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await env.sendEmail({
          to: user.email,
          subject: "Reset your Mockintosh Computer Club password",
          text: [
            `Hi ${user.name},`,
            "",
            "Someone asked to reset the password for your Mockintosh Computer Club membership. To choose a new one, open this link within an hour:",
            "",
            url,
            "",
            "If it wasn't you, ignore this email; your password stays as it is.",
          ].join("\n"),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // The Macintosh signs itself in once the link is opened, wherever that is.
      autoSignInAfterVerification: false,
      async afterEmailVerification(user, request) {
        await env.welcome?.(user.id, request);
      },
      async sendVerificationEmail({ user, url }) {
        await env.sendEmail({
          to: user.email,
          subject: "Welcome to the Mockintosh Computer Club",
          text: [
            `Hi ${user.name},`,
            "",
            "To finish joining the Mockintosh Computer Club, confirm your email address by opening this link within an hour:",
            "",
            url,
            "",
            "Then return to your Mockintosh: it signs you in by itself.",
            "",
            "If you didn't join, ignore this email.",
          ].join("\n"),
        });
      },
    },
  } satisfies BetterAuthOptions;
}

export function createClubAuth(env: ClubAuthEnv) {
  return betterAuth(clubAuthOptions(env));
}

export type ClubAuth = ReturnType<typeof createClubAuth>;

/** The hosts a Vercel deployment answers on, as the guard's allowed origins also list them. */
function deploymentHosts(): string[] {
  const hosts = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim().replace(/^https?:\/\//, "")),
  ];
  return [...new Set(hosts.filter((host): host is string => !!host))];
}

/**
 * Off Vercel without `BETTER_AUTH_SECRET`: a secret for this process only,
 * so the local API server works before `vercel env pull`. Members are
 * signed out when it restarts.
 */
function localSecret(): string | undefined {
  if (process.env.VERCEL) return undefined;
  console.warn("BETTER_AUTH_SECRET is unset: using a temporary one, so restarting signs everyone out.");
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
}

let auth: ClubAuth | null | undefined;

/**
 * The Club's accounts on this deployment, or `null` when it has no
 * database or secret (then everything that needs a member is refused).
 */
export function clubAuth(): ClubAuth | null {
  if (auth !== undefined) return auth;
  const dialect = databaseDialect();
  const secret = process.env.BETTER_AUTH_SECRET?.trim() || localSecret();
  if (!dialect || !secret) {
    auth = null;
    return auth;
  }
  auth = createClubAuth({
    dialect,
    secret,
    sendEmail: emailSender(),
    hosts: process.env.VERCEL ? deploymentHosts() : [],
    localURL: process.env.BETTER_AUTH_URL,
    welcome: welcomeNewMember,
  });
  return auth;
}

/** Welcome credits, counted per address in the guard's store. Never stops verification. */
async function welcomeNewMember(memberId: string, request?: Request): Promise<void> {
  try {
    const credits = clubCredits();
    const counters = guardEnvFromProcess().store;
    if (!credits || !counters) throw new Error("No database or limit store");
    await welcomeMember(credits, counters, memberId, request ? clientAddress(request) : "unknown");
  } catch (error) {
    console.error(`No welcome credits for ${memberId}:`, error);
  }
}

/** The signed-in member a request's session cookie names, if any. */
export interface Member {
  id: string;
  email: string;
}

export async function memberFromRequest(authInstance: ClubAuth | null, req: Request): Promise<Member | null> {
  if (!authInstance) return null;
  const session = await authInstance.api.getSession({ headers: req.headers });
  return session ? { id: session.user.id, email: session.user.email } : null;
}
