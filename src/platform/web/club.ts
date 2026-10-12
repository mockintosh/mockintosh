import type { FetchFunction, FetchResponse } from "@mockintosh/sdk";
import type { ClubAccounts, ClubConfig, ClubConnection, ClubCredits, ClubMember } from "../types";

interface AuthUser {
  id?: string;
  name?: string;
  email?: string;
  createdAt?: string;
}

/** What Better Auth's error bodies say, by `code`, in the Club window's words. */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL: "That doesn't look like an email address.",
  INVALID_OTP: "That code didn't work. Check it, or send a new one.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many tries with that code. Send a new one.",
};

/** What a device token answers while the member hasn't approved yet. */
const STILL_WAITING = new Set(["authorization_pending", "slow_down"]);
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

function member(user: AuthUser | undefined): ClubMember | null {
  if (!user?.email || !user.id) return null;
  const since = Date.parse(user.createdAt ?? "");
  return { id: user.id, name: user.name || user.email, email: user.email, since: Number.isFinite(since) ? since : Date.now() };
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

    async config(): Promise<ClubConfig> {
      const resp = await fetch(`${club}/api/config`);
      const data: any = await resp.json().catch(() => null);
      if (!resp.ok || (data?.signIn !== "form" && data?.signIn !== "connect")) throw failure(resp.status, data);
      const providers = Array.isArray(data.providers) ? data.providers.filter((p: unknown) => p === "github" || p === "google") : [];
      return { signIn: data.signIn, providers };
    },

    async sendCode(email) {
      const { status, data } = await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
      if (status !== 200) throw failure(status, data);
    },

    async signInWithCode(email, code, name) {
      const otp = code.replace(/\D/g, "");
      const { status, data, resp } = await call("/sign-in/email-otp", { email, otp, ...(name && { name }) });
      const signedIn = status === 200 ? member(data?.user) : null;
      const issued = resp.headers.get("set-auth-token") ?? (typeof data?.token === "string" ? data.token : null);
      if (!signedIn || !issued) throw failure(status, data);
      remember(issued);
      return signedIn;
    },

    async connect(): Promise<ClubConnection> {
      // The Club names this computer after the site in its request's Origin.
      const { status, data } = await call("/device/code", {});
      if (status !== 200 || typeof data?.device_code !== "string") throw failure(status, data);
      const deviceCode: string = data.device_code;
      const raw = String(data.user_code ?? "");
      return {
        code: raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw,
        url: String(data.verification_uri_complete ?? data.verification_uri ?? `${club}/connect`),
        expiresAt: Date.now() + Number(data.expires_in ?? 900) * 1000,
        pollIntervalMs: Math.max(5, Number(data.interval ?? 5)) * 1000,
        async poll() {
          const answer = await call("/device/token", { grant_type: DEVICE_GRANT, device_code: deviceCode });
          if (answer.status === 200 && typeof answer.data?.access_token === "string") {
            remember(answer.data.access_token);
            return "connected";
          }
          const error = answer.data?.error;
          if (STILL_WAITING.has(error)) return "pending";
          if (error === "access_denied") return "denied";
          if (error === "expired_token") return "expired";
          throw failure(answer.status, answer.data);
        },
      };
    },

    async signOut() {
      try {
        const { status, data } = await call("/sign-out", {});
        if (status !== 200) throw failure(status, data);
      } finally {
        remember(null);
      }
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
