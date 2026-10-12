/**
 * The Mockintosh Computer Club's accounts: Better Auth on the Club's
 * Postgres database, served at `/api/auth/*` (`api/auth/[...all].ts`).
 * There are no passwords: a member signs in with a six-digit code sent to
 * their email (which also makes a new member), or with GitHub or Google
 * on the Club's own pages. A Macintosh on Mockintosh's own sites shows the
 * email form itself; any other one connects through the Club's
 * `/connect` page with a device code. Macs on any site carry their session
 * as a bearer token, never a cookie; the Club's pages use a cookie. Every
 * session records the site it is for (`site`) and may have a daily
 * spending cap (`dailyCap`). See docs/computer-club-plan.md.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { bearer, deviceAuthorization, emailOTP, username } from "better-auth/plugins";
import type { Dialect } from "kysely";
import { databaseDialect } from "./_db.js";
import { emailSender, type SendEmail } from "./_email.js";
import { clubCredits, welcomeMember } from "./_credits.js";
import { clientAddress, guardEnvFromProcess } from "../../../api/_guard.js";

/** Where Better Auth's routes live; the Club window calls them here. */
export const AUTH_BASE_PATH = "/api/auth";
/** The Club's page where a Macintosh elsewhere is connected (`api/connect.ts`). */
export const CONNECT_PATH = "/connect";

/** Where `npm run dev:club` serves the Club. */
export const LOCAL_URL = "http://localhost:3002";

/** Mockintosh's own sites, whose Macs show the sign-in form: production, its previews, and `MAC_ORIGINS`. */
export const OWN_MAC_ORIGINS = ["https://mockintosh.com", "https://*.mockintosh.com", "https://mockintosh-*-mossive.vercel.app"];
/** Locally the Mac is on whatever port Vite got. */
const LOCAL_MAC_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"];

/** A member stays signed in on a Macintosh for 30 days after its last use. */
const SESSION_SECONDS = 60 * 60 * 24 * 30;
/** How long an emailed code works. */
const CODE_SECONDS = 10 * 60;
/** How long a Macintosh's connect code waits for the member. */
const CONNECT_EXPIRES = "15m";
/** How often a Macintosh asks whether its connect code was approved. */
const CONNECT_INTERVAL = "5s";

/**
 * Usernames: chosen when joining, unique, kept as typed for display
 * (`displayUsername`) and lower-cased for lookups. Letters, digits, `_` and
 * `.`, so one always makes a Mac disk name (at most 31 characters): a
 * member's home disk is named after it.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/** The sign-in providers the Club offers on its pages, when they are configured. */
export type Provider = "github" | "google";

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

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
  /**
   * Sites whose Macintosh may show the Club's own sign-in form (patterns,
   * `https://*.mockintosh.com`). Better Auth refuses to send a code to any
   * other `Origin`; those Macs connect on the Club's pages.
   */
  macOrigins: readonly string[];
  /** GitHub and Google sign-in, each when its OAuth app is configured. */
  providers?: Partial<Record<Provider, ProviderCredentials>>;
  /** Runs once for each new member with a verified email: their welcome credits. */
  welcome?: (memberId: string, headers?: Headers) => Promise<void>;
}

/** A connecting Macintosh's site, as `client_id`: a host name, with a port locally. */
export function isSiteName(value: string): boolean {
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(value) && value.length <= 253;
}

/** The host of `origin` (`https://foo.example` → `foo.example`), or `null`. */
export function siteOf(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

/** Who a new session is for: the connecting Macintosh's site, the Mac's own origin, or the Club's page. */
function sessionSite(ctx: { path?: string; body?: unknown; headers?: Headers; request?: Request } | null): string | null {
  const body = ctx?.body as { client_id?: unknown } | undefined;
  if (ctx?.path === "/device/token" && typeof body?.client_id === "string") return body.client_id;
  return siteOf((ctx?.headers ?? ctx?.request?.headers)?.get("origin"));
}

function codeEmail(otp: string): { subject: string; text: string } {
  return {
    subject: `${otp} is your Mockintosh Computer Club code`,
    text: [
      `Your code is ${otp}`,
      "",
      `Type it in the Computer Club window on mockintosh.com, or on the Club's own page (club.mockintosh.com). It works for ${CODE_SECONDS / 60} minutes.`,
      "",
      "Don't type it anywhere else: whoever has it can spend your credits. If you didn't ask for it, ignore this email.",
    ].join("\n"),
  };
}

export function clubAuthOptions(env: ClubAuthEnv) {
  const hosted = env.hosts.length > 0;
  const providers = env.providers ?? {};
  return {
    appName: "Mockintosh Computer Club",
    secret: env.secret,
    basePath: AUTH_BASE_PATH,
    baseURL: hosted
      ? { allowedHosts: [...env.hosts], fallback: `https://${env.hosts[0]}` }
      : (env.localURL ?? LOCAL_URL),
    trustedOrigins: [...env.macOrigins],
    plugins: [
      bearer(),
      username({ minUsernameLength: USERNAME_MIN, maxUsernameLength: USERNAME_MAX }),
      emailOTP({
        expiresIn: CODE_SECONDS,
        allowedAttempts: 5,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }) {
          await env.sendEmail({ to: email, ...codeEmail(otp) });
        },
      }),
      deviceAuthorization({
        verificationUri: CONNECT_PATH,
        expiresIn: CONNECT_EXPIRES,
        interval: CONNECT_INTERVAL,
        // `api/auth/[...all].ts` puts the Mac's site here, from its Origin.
        validateClient: isSiteName,
      }),
    ],
    socialProviders: {
      ...(providers.github && { github: { ...providers.github } }),
      ...(providers.google && { google: { ...providers.google, prompt: "select_account" as const } }),
    },
    database: { dialect: env.dialect, type: "postgres", transaction: true },
    session: {
      expiresIn: SESSION_SECONDS,
      additionalFields: {
        site: { type: "string", required: false, input: false },
        dailyCap: { type: "number", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Joining with an emailed code needs a username; the username plugin checks and normalizes it.
          async before(user, ctx) {
            if (ctx?.path === "/sign-in/email-otp" && !(user as { username?: unknown }).username) {
              throw new APIError("BAD_REQUEST", { code: "USERNAME_REQUIRED", message: "Choose a username to join." });
            }
          },
          async after(user, ctx) {
            if (user.emailVerified) await env.welcome?.(user.id, ctx?.headers ?? ctx?.request?.headers);
          },
        },
      },
      session: {
        create: {
          async before(session, ctx) {
            return { data: { ...session, site: sessionSite(ctx) } };
          },
        },
      },
    },
    // Better Auth skips the origin check under a test runner; keep the production behaviour there too.
    advanced: { disableOriginCheck: false },
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
    macOrigins: macOriginPatterns(),
    providers: configuredProviders(),
    welcome: welcomeNewMember,
  });
  return auth;
}

/** This deployment's sites whose Macs show the form: ours, `MAC_ORIGINS`, and any local port off Vercel. */
export function macOriginPatterns(): string[] {
  return [
    ...OWN_MAC_ORIGINS,
    ...(process.env.VERCEL ? [] : LOCAL_MAC_ORIGINS),
    ...(process.env.MAC_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
  ];
}

/** True when `origin` is one of `patterns`, where `*` stands for part of a host name or a port. */
export function originMatches(origin: string | null, patterns: readonly string[]): boolean {
  if (!origin) return false;
  return patterns.some((pattern) => {
    const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join("[a-z0-9.-]*");
    return new RegExp(`^${source}$`, "i").test(origin);
  });
}

/** GitHub and Google, each when its OAuth app's id and secret are set. */
function configuredProviders(): Partial<Record<Provider, ProviderCredentials>> {
  const providers: Partial<Record<Provider, ProviderCredentials>> = {};
  for (const provider of ["github", "google"] as const) {
    const prefix = provider.toUpperCase();
    const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) providers[provider] = { clientId, clientSecret };
  }
  return providers;
}

/** The providers this deployment offers, for its pages and `GET /api/config`. */
export function offeredProviders(): Provider[] {
  return Object.keys(configuredProviders()) as Provider[];
}

/** Welcome credits, counted per address in the guard's store. Never stops joining. */
async function welcomeNewMember(memberId: string, headers?: Headers): Promise<void> {
  try {
    const credits = clubCredits();
    const counters = guardEnvFromProcess().store;
    if (!credits || !counters) throw new Error("No database or limit store");
    const address = headers ? clientAddress(new Request("http://club.invalid/", { headers })) : "unknown";
    await welcomeMember(credits, counters, memberId, address);
  } catch (error) {
    console.error(`No welcome credits for ${memberId}:`, error);
  }
}

/** The signed-in member a request's session names (bearer token or, on the Club's pages, cookie). */
export interface Member {
  id: string;
  email: string;
  name: string;
  /** As the member typed it ("Ada"); `null` for a member who joined before usernames, or with GitHub or Google. */
  username: string | null;
  /** The session: one connected Macintosh, or a browser on the Club's pages. */
  session: {
    id: string;
    site: string | null;
    /** Credits it may spend per day; `null` = no cap. */
    dailyCap: number | null;
  };
}

export async function memberFromRequest(authInstance: ClubAuth | null, req: Request): Promise<Member | null> {
  if (!authInstance) return null;
  const found = await authInstance.api.getSession({ headers: req.headers });
  if (!found) return null;
  const session = found.session as typeof found.session & { site?: string | null; dailyCap?: number | null };
  const user = found.user as typeof found.user & { username?: string | null; displayUsername?: string | null };
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.displayUsername || user.username || null,
    session: { id: session.id, site: session.site ?? null, dailyCap: session.dailyCap ?? null },
  };
}
