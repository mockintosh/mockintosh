/**
 * The Apple Music developer token. MusicKit and the Apple Music API both
 * want a short-lived ES256 JWT signed with a MusicKit private key, which must
 * never reach the page, so it is signed here.
 *
 *   GET /api/apple-music/token → { developerToken, expiresAt } | { error } (503 when unconfigured)
 *
 * Configure with `APPLE_MUSIC_TEAM_ID` (Membership details), `APPLE_MUSIC_KEY_ID`
 * and `APPLE_MUSIC_PRIVATE_KEY` (the downloaded .p8, newlines kept or written
 * as `\n`), from a key with Media Services enabled.
 */

/** Apple allows up to six months; a day keeps a leaked token short-lived. */
const LIFETIME_SECONDS = 24 * 60 * 60;
/** Mint a fresh token once the cached one has less than this left. */
const REFRESH_MARGIN_SECONDS = 60 * 60;

const NOT_CONFIGURED =
  "Apple Music needs APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID and APPLE_MUSIC_PRIVATE_KEY on the server.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface MusicKitKey {
  teamId: string;
  keyId: string;
  privateKey: string;
}

function musicKitKey(): MusicKitKey | null {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  return teamId && keyId && privateKey ? { teamId, keyId, privateKey } : null;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** Signs `{ iss, iat, exp }` with ES256. Web Crypto's ECDSA signature is already JWS's r‖s form. */
export async function signDeveloperToken(key: MusicKitKey, now: number): Promise<{ token: string; expiresAt: number }> {
  const encoder = new TextEncoder();
  const exp = now + LIFETIME_SECONDS;
  const header = base64url(encoder.encode(JSON.stringify({ alg: "ES256", kid: key.keyId })));
  const payload = base64url(encoder.encode(JSON.stringify({ iss: key.teamId, iat: now, exp })));
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(key.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    encoder.encode(`${header}.${payload}`),
  );
  return { token: `${header}.${payload}.${base64url(new Uint8Array(signature))}`, expiresAt: exp };
}

let cached: { token: string; expiresAt: number } | null = null;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const key = musicKitKey();
  if (!key) return json({ error: NOT_CONFIGURED }, 503);

  const now = Math.floor(Date.now() / 1000);
  if (!cached || cached.expiresAt - now < REFRESH_MARGIN_SECONDS) {
    try {
      cached = await signDeveloperToken(key, now);
    } catch {
      return json({ error: "APPLE_MUSIC_PRIVATE_KEY is not a valid MusicKit .p8 key." }, 500);
    }
  }
  return json({ developerToken: cached.token, expiresAt: cached.expiresAt * 1000 });
}

export const config = { runtime: "edge" };
