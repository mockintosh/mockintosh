import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./token";

const ORIGIN = "https://mac.example";

function exchange(body: unknown) {
  return handler(new Request(`${ORIGIN}/api/github/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

describe("GitHub token exchange", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.abc");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "shh");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("names the OAuth app, and trades a code for a token with its secret", async () => {
    expect(await (await handler(new Request(`${ORIGIN}/api/github/token`))).json()).toEqual({ clientId: "Iv1.abc" });
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ access_token: "gho_token", scope: "public_repo", token_type: "bearer" });
    });
    const response = await exchange({ code: "c", code_verifier: "v", redirect_uri: `${ORIGIN}/api/oauth/callback` });
    expect(await response.json()).toEqual({ access_token: "gho_token", scope: "public_repo" });
    expect(sent).toEqual([{
      url: "https://github.com/login/oauth/access_token",
      body: { client_id: "Iv1.abc", client_secret: "shh", code: "c", code_verifier: "v", redirect_uri: `${ORIGIN}/api/oauth/callback` },
    }]);
  });

  it("passes GitHub's refusal on, and refuses incomplete requests", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }));
    const refused = await exchange({ code: "c", code_verifier: "v", redirect_uri: "r" });
    expect(refused.status).toBe(502);
    expect(await refused.json()).toEqual({ error: "The code passed is incorrect or expired." });
    expect((await exchange({ code: "c" })).status).toBe(400);
  });

  it("says what to configure when the deployment has no OAuth app", async () => {
    vi.stubEnv("GITHUB_CLIENT_SECRET", "");
    const response = await handler(new Request(`${ORIGIN}/api/github/token`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET/) });
  });
});
