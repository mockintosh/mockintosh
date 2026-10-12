import { describe, expect, it } from "vitest";
import { signDeveloperToken } from "./token";

function fromBase64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

async function p8Key(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = btoa(String.fromCharCode(...der)).replace(/.{64}/g, "$&\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`, publicKey: pair.publicKey };
}

describe("Apple Music developer token", () => {
  it("is an ES256 JWT naming the key and team, verifiable with the key's public half", async () => {
    const { pem, publicKey } = await p8Key();
    const { token, expiresAt } = await signDeveloperToken({ teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem }, 1_000);
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(header!)))).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(payload!)))).toEqual({ iss: "TEAM123456", iat: 1_000, exp: expiresAt });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      fromBase64url(signature!),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });

  it("accepts a key pasted into one line with escaped newlines", async () => {
    const { pem } = await p8Key();
    const oneLine = pem.replace(/\n/g, "\\n");
    await expect(signDeveloperToken({ teamId: "T", keyId: "K", privateKey: oneLine }, 0)).resolves.toBeTruthy();
  });
});
