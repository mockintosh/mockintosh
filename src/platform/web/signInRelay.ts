import type { FetchFunction } from "@mockintosh/sdk";
import type { SignInPollResult, SignInRelay } from "../types";

/**
 * The page's origin with `localhost` spelled as a loopback literal, which
 * providers (Spotify) require for redirect URIs (RFC 8252 §7.3). IPv4,
 * because GitHub won't register an IPv6 one; the dev server listens there.
 */
function loopbackLiteral(origin: string): string {
  return origin.replace("//localhost", "//127.0.0.1").replace("//[::1]", "//127.0.0.1");
}

interface StartResponse {
  id?: string;
  poll_token?: string;
  url?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
}

/** The relay served next to the OS, `api/oauth/*` (see `api/oauth/_relay.ts`). */
export function createWebSignInRelay(fetch: FetchFunction, origin: string): SignInRelay {
  const redirectUri = `${loopbackLiteral(origin)}/api/oauth/callback`;
  return {
    redirectUri,
    async start({ url, appTitle }) {
      const authorize = new URL(url);
      authorize.searchParams.set("redirect_uri", redirectUri);
      authorize.searchParams.delete("state");
      const resp = await fetch(`${origin}/api/oauth/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: authorize.toString(), appTitle }),
      });
      const data = (await resp.json().catch(() => ({}))) as StartResponse;
      if (!resp.ok || !data.id || !data.poll_token) {
        throw new Error(data.error ?? `Sign-in relay unavailable (${resp.status})`);
      }
      const { id, poll_token: pollToken } = data;
      const link = `${origin}/api/oauth/pair?id=${encodeURIComponent(id)}`;
      return {
        link,
        browserLink: data.url ?? link,
        expiresInMs: (data.expires_in ?? 600) * 1000,
        pollIntervalMs: (data.interval ?? 2) * 1000,
        async poll(): Promise<SignInPollResult> {
          const r = await fetch(`${origin}/api/oauth/poll?id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${pollToken}` },
          });
          if (!r.ok) throw new Error(`Sign-in relay error (${r.status})`);
          const result = (await r.json()) as SignInPollResult;
          return result.status === "complete" || result.status === "pending" ? result : { status: "expired" };
        },
      };
    },
  };
}
