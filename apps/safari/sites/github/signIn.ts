import { encodeQuery, type AppCrypto, type FetchFunction, type SignInService } from "@mockintosh/sdk";

export const GITHUB_SIGN_IN_HOST = "github.com";
/**
 * Issues, discussions and comments on public repositories. OAuth apps have
 * nothing narrower: this also lets the token write code there.
 */
export const GITHUB_SCOPE = "public_repo";
/** The server's half: the OAuth app's client id, and the code exchange (`api/github/token.ts`). */
const TOKEN_ENDPOINT = "/api/github/token";

/**
 * Sign in to GitHub from the user's phone: the OS's sign-in sheet carries
 * the code back, and the server, which holds the OAuth app's secret, turns
 * it into a token. Resolves with the token, or `null` when the user cancels.
 * Rejects with a message to show when sign-in isn't set up or GitHub refuses.
 */
export async function signInToGithub(fetch: FetchFunction, signIn: SignInService, crypto: AppCrypto): Promise<string | null> {
  const app = await reply(await fetch(TOKEN_ENDPOINT));
  const clientId = typeof app.clientId === "string" ? app.clientId : "";
  if (!clientId) throw new Error(errorOf(app) || "GitHub sign-in isn't set up on this server.");

  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(await crypto.sha256(new TextEncoder().encode(verifier)));
  const query = encodeQuery([
    { name: "client_id", value: clientId },
    { name: "scope", value: GITHUB_SCOPE },
    { name: "code_challenge", value: challenge },
    { name: "code_challenge_method", value: "S256" },
  ]);
  const params = await signIn.authorize(`https://${GITHUB_SIGN_IN_HOST}/login/oauth/authorize?${query}`);
  if (!params) return null;
  if (!params.code) throw new Error(params.error_description || "GitHub did not send a sign-in code.");

  const exchanged = await reply(
    await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: params.code, code_verifier: verifier, redirect_uri: signIn.redirectUri }),
    }),
  );
  if (typeof exchanged.access_token !== "string") throw new Error(errorOf(exchanged) || "GitHub refused the sign-in.");
  return exchanged.access_token;
}

async function reply(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => ({}));
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function errorOf(body: Record<string, unknown>): string {
  return typeof body.error === "string" ? body.error : "";
}

function base64url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += alphabet[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += alphabet[n & 63];
  }
  return out;
}
