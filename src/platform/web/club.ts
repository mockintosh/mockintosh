import type { FetchFunction, FetchResponse } from "@mockintosh/sdk";
import type { ClubAccounts, ClubCredits, ClubMember, ClubSignInResult } from "../types";

/** Where Better Auth sends a verification link once it has checked it (`sites/club/api/verified.ts`). */
const VERIFIED_PAGE = "/api/verified";
/** The page a password-reset link opens (`sites/club/api/reset-password.ts`). */
const RESET_PAGE = "/api/reset-password";

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

/**
 * Where this computer keeps its session token for `club`: the page's
 * `localStorage`, which app processes (workers) can't reach, unlike the
 * disk. Missing or blocked storage just means signing in again.
 */
function tokenStore(club: string) {
  const key = `mockintosh.club.token:${club}`;
  return {
    get(): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(token: string | null): void {
      try {
        if (token) localStorage.setItem(key, token);
        else localStorage.removeItem(key);
      } catch {
        // Kept for this session only.
      }
    },
  };
}

/**
 * The Computer Club at `club`, its own service (`sites/club`). Every call
 * carries this computer's session token as `Authorization: Bearer`; the
 * Club hands a new one back in `set-auth-token` on sign-in.
 */
export function createWebClubAccounts(fetch: FetchFunction, club: string): ClubAccounts {
  const token = tokenStore(club);
  let held = token.get();

  function authorized(headers: Record<string, string> = {}): Record<string, string> {
    return held ? { ...headers, Authorization: `Bearer ${held}` } : headers;
  }

  function remember(next: string | null): void {
    held = next;
    token.set(next);
  }

  async function call(path: string, body?: unknown): Promise<{ status: number; data: any; resp: FetchResponse }> {
    const resp = await fetch(`${club}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: authorized(body === undefined ? {} : { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    return { status: resp.status, data, resp };
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
      if (!held) return null;
      const { status, data } = await call("/get-session");
      if (status !== 200) throw failure(status, data);
      const signedIn = member(data?.user);
      // The Club ended the session (signed out elsewhere, or expired).
      if (!signedIn) remember(null);
      return signedIn;
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
      const { status, data, resp } = await call("/sign-in/email", { email, password, rememberMe: true });
      if (status === 403 && data?.code === "EMAIL_NOT_VERIFIED") return { status: "unverified" };
      if (status === 401) return { status: "wrong-password" };
      const signedIn = status === 200 ? member(data?.user) : null;
      const issued = resp.headers.get("set-auth-token") ?? (typeof data?.token === "string" ? data.token : null);
      if (!signedIn || !issued) throw failure(status, data);
      remember(issued);
      return { status: "signed-in", member: signedIn };
    },

    async signOut() {
      try {
        const { status, data } = await call("/sign-out", {});
        if (status !== 200) throw failure(status, data);
      } finally {
        remember(null);
      }
    },

    async forgotPassword(email) {
      const { status, data } = await call("/request-password-reset", { email, redirectTo: RESET_PAGE });
      if (status !== 200) throw failure(status, data);
    },

    async credits(): Promise<ClubCredits | null> {
      if (!held) return null;
      const resp = await fetch(`${club}/api/credits`, { headers: authorized() });
      if (resp.status === 401) return null;
      const data: any = await resp.json().catch(() => null);
      if (!resp.ok || typeof data?.balance !== "number") throw failure(resp.status, data);
      return { balance: data.balance, recent: Array.isArray(data.recent) ? data.recent : [] };
    },

    fetch(path, init = {}) {
      return fetch(`${club}${path}`, { ...init, headers: authorized(init.headers) });
    },
  };
}
