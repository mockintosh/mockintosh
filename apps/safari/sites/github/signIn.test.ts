import { describe, expect, it } from "vitest";
import type { AppCrypto, FetchFunction, FetchResponse, SignInService } from "@mockintosh/sdk";
import { signInToGithub } from "./signIn";

function reply(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const crypto: AppCrypto = {
  randomBytes: (n) => new Uint8Array(n).fill(7),
  sha256: async () => new Uint8Array(32).fill(1),
} as AppCrypto;

function phone(answer: Record<string, string> | null): SignInService & { asked: string[] } {
  const asked: string[] = [];
  return { asked, redirectUri: "https://mac.example/api/oauth/callback", authorize: async (url) => (asked.push(url), answer) };
}

describe("signInToGithub", () => {
  it("asks the phone to authorize with PKCE, then trades the code for a token on the server", async () => {
    const posts: unknown[] = [];
    const fetch: FetchFunction = async (url, options) => {
      expect(url).toBe("/api/github/token");
      if (options?.method !== "POST") return reply({ clientId: "Iv1.abc" });
      posts.push(JSON.parse(String(options.body)));
      return reply({ access_token: "gho_token", scope: "public_repo,notifications" });
    };
    const signIn = phone({ code: "the-code" });
    expect(await signInToGithub(fetch, signIn, crypto)).toBe("gho_token");

    const authorize = new URL(signIn.asked[0]);
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({ client_id: "Iv1.abc", scope: "public_repo notifications", code_challenge_method: "S256" });
    expect(posts).toEqual([{ code: "the-code", code_verifier: expect.stringMatching(/^[\w-]{64}$/), redirect_uri: signIn.redirectUri }]);
  });

  it("resolves null when the user cancels, and says why when sign-in isn't set up", async () => {
    const ready: FetchFunction = async () => reply({ clientId: "Iv1.abc" });
    expect(await signInToGithub(ready, phone(null), crypto)).toBeNull();
    const unset: FetchFunction = async () => reply({ error: "GitHub sign-in needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server." }, 503);
    await expect(signInToGithub(unset, phone({ code: "c" }), crypto)).rejects.toThrow(/GITHUB_CLIENT_ID/);
  });
});
