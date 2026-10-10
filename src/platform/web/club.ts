import type { FetchFunction } from "@mockintosh/sdk";
import type { ClubAccounts, ClubMember, ClubSignInResult } from "../types";

/** Where Better Auth sends a verification link once it has checked it (`api/club/verified.ts`). */
const VERIFIED_PAGE = "/api/club/verified";
/** The page a password-reset link opens (`api/club/reset-password.ts`). */
const RESET_PAGE = "/api/club/reset-password";

interface AuthUser {
  name?: string;
  email?: string;
  createdAt?: string;
}

/** What Better Auth's error bodies say, by `code`, in the Club window's words. */
const MESSAGES: Record<string, string> = {
  PASSWORD_TOO_SHORT: "Use a password of at least 8 characters.",
  PASSWORD_TOO_LONG: "Use a password of at most 128 characters.",
  INVALID_EMAIL: "That doesn't look like an email address.",
};

function member(user: AuthUser | undefined): ClubMember | null {
  if (!user?.email) return null;
  const since = Date.parse(user.createdAt ?? "");
  return { name: user.name || user.email, email: user.email, since: Number.isFinite(since) ? since : Date.now() };
}

/** The Computer Club's accounts, `api/auth/*` next to the OS (see `api/_auth.ts`). */
export function createWebClubAccounts(fetch: FetchFunction, origin: string): ClubAccounts {
  async function call(path: string, body?: unknown): Promise<{ status: number; data: any }> {
    const resp = await fetch(`${origin}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    return { status: resp.status, data };
  }

  function failure(status: number, data: any): Error {
    if (status === 429) return new Error("Too many tries. Wait a minute, then try again.");
    const known = typeof data?.code === "string" ? MESSAGES[data.code] : undefined;
    if (known) return new Error(known);
    if (status === 503 && typeof data?.message === "string") return new Error(data.message);
    return new Error(`The Computer Club didn't answer (${status}). Try again in a moment.`);
  }

  return {
    async session() {
      const { status, data } = await call("/get-session");
      if (status !== 200) throw failure(status, data);
      return member(data?.user);
    },

    async join({ name, email, password }) {
      const { status, data } = await call("/sign-up/email", { name, email, password, callbackURL: VERIFIED_PAGE });
      if (status !== 200) throw failure(status, data);
    },

    async resendVerification(email) {
      const { status, data } = await call("/send-verification-email", { email, callbackURL: VERIFIED_PAGE });
      if (status !== 200) throw failure(status, data);
    },

    async signIn(email, password): Promise<ClubSignInResult> {
      const { status, data } = await call("/sign-in/email", { email, password, rememberMe: true });
      if (status === 403 && data?.code === "EMAIL_NOT_VERIFIED") return { status: "unverified" };
      if (status === 401) return { status: "wrong-password" };
      const signedIn = status === 200 ? member(data?.user) : null;
      if (!signedIn) throw failure(status, data);
      return { status: "signed-in", member: signedIn };
    },

    async signOut() {
      const { status, data } = await call("/sign-out", {});
      if (status !== 200) throw failure(status, data);
    },

    async forgotPassword(email) {
      const { status, data } = await call("/request-password-reset", { email, redirectTo: RESET_PAGE });
      if (status !== 200) throw failure(status, data);
    },
  };
}
