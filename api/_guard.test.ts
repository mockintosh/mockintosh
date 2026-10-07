import { describe, expect, it } from "vitest";
import { createMemoryCounters, fromOwnSite, guardRequest, type GuardEnv, type RouteLimits } from "./_guard";

const LIMITS: RouteLimits = {
  route: "test",
  maxBodyBytes: 100,
  perClient: { max: 2, windowSeconds: 60 },
  global: { max: 3, windowSeconds: 86400 },
};

function hostedEnv(clock = { t: 0 }): GuardEnv {
  const now = () => clock.t;
  return { accessToken: "s3cret", hosted: true, allowedOrigins: ["https://mockintosh.com"], store: createMemoryCounters(now), now };
}

function post(options: { origin?: string | null; ip?: string; body?: string; host?: string; auth?: string | null } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", host: options.host ?? "app.vercel.app" };
  if (options.auth !== null) headers.authorization = options.auth ?? "Bearer s3cret";
  if (options.origin !== null) headers.origin = options.origin ?? "https://app.vercel.app";
  if (options.ip) headers["x-forwarded-for"] = `${options.ip}, 10.0.0.1`;
  return new Request("https://app.vercel.app/api/test", { method: "POST", headers, body: options.body ?? "{}" });
}

describe("guardRequest", () => {
  it("passes a same-origin POST and returns its body", async () => {
    const result = await guardRequest(post({ body: '{"a":1}' }), LIMITS, hostedEnv());
    expect(result).toEqual({ ok: true, body: '{"a":1}' });
  });

  it("refuses a missing or wrong token, hosted or not", async () => {
    for (const hosted of [true, false]) {
      for (const auth of [null, "Bearer wrong", "Bearer s3cre", "s3cret", "Basic s3cret"]) {
        const result = await guardRequest(post({ auth }), LIMITS, { ...hostedEnv(), hosted });
        expect(!result.ok && result.response.status).toBe(401);
      }
    }
  });

  it("refuses everyone when no token is configured", async () => {
    for (const hosted of [true, false]) {
      const result = await guardRequest(post(), LIMITS, { ...hostedEnv(), hosted, accessToken: null });
      expect(!result.ok && result.response.status).toBe(401);
    }
  });

  it("does not count unauthenticated requests against the limits", async () => {
    const env = hostedEnv();
    for (let i = 0; i < 5; i++) await guardRequest(post({ auth: null, ip: "1.1.1.1" }), LIMITS, env);
    expect((await guardRequest(post({ ip: "1.1.1.1" }), LIMITS, env)).ok).toBe(true);
  });

  it("accepts a configured origin", async () => {
    const result = await guardRequest(post({ origin: "https://mockintosh.com" }), LIMITS, hostedEnv());
    expect(result.ok).toBe(true);
  });

  it("refuses other origins and requests without one when hosted", async () => {
    for (const origin of ["https://evil.example", null]) {
      const result = await guardRequest(post({ origin }), LIMITS, hostedEnv());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  });

  it("skips the origin check off a hosted deployment", async () => {
    const env = { ...hostedEnv(), hosted: false };
    const result = await guardRequest(post({ origin: null }), LIMITS, env);
    expect(result.ok).toBe(true);
  });

  it("refuses non-POST", async () => {
    const result = await guardRequest(new Request("https://app.vercel.app/api/test"), LIMITS, hostedEnv());
    expect(!result.ok && result.response.status).toBe(405);
  });

  it("refuses bodies over the cap", async () => {
    const result = await guardRequest(post({ body: "x".repeat(101) }), LIMITS, hostedEnv());
    expect(!result.ok && result.response.status).toBe(413);
  });

  it("limits each client per window, then lets them back in", async () => {
    const clock = { t: 0 };
    const env = hostedEnv(clock);
    expect((await guardRequest(post({ ip: "1.1.1.1" }), LIMITS, env)).ok).toBe(true);
    expect((await guardRequest(post({ ip: "1.1.1.1" }), LIMITS, env)).ok).toBe(true);
    const third = await guardRequest(post({ ip: "1.1.1.1" }), LIMITS, env);
    expect(!third.ok && third.response.status).toBe(429);
    expect(!third.ok && third.response.headers.get("retry-after")).toBe("60");
    clock.t = 60_000;
    expect((await guardRequest(post({ ip: "1.1.1.1" }), LIMITS, env)).ok).toBe(true);
  });

  it("caps everyone together", async () => {
    const env = hostedEnv();
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      expect((await guardRequest(post({ ip }), LIMITS, env)).ok).toBe(true);
    }
    const fourth = await guardRequest(post({ ip: "4.4.4.4" }), LIMITS, env);
    expect(!fourth.ok && fourth.response.status).toBe(429);
  });

  it("refuses when hosted without a store", async () => {
    const result = await guardRequest(post(), LIMITS, { ...hostedEnv(), store: null });
    expect(!result.ok && result.response.status).toBe(503);
  });

  it("refuses when the store fails", async () => {
    const env = { ...hostedEnv(), store: { hit: () => Promise.reject(new Error("down")) } };
    const result = await guardRequest(post(), LIMITS, env);
    expect(!result.ok && result.response.status).toBe(503);
  });
});

describe("fromOwnSite", () => {
  function get(headers: Record<string, string>): Request {
    return new Request("https://app.vercel.app/api/web-image?url=x", { headers: { host: "app.vercel.app", ...headers } });
  }

  it("accepts a same-origin request, which carries no Origin when it is a GET", () => {
    expect(fromOwnSite(get({ "sec-fetch-site": "same-origin" }), hostedEnv())).toBe(true);
  });

  it("accepts this deployment's origin and configured ones", () => {
    expect(fromOwnSite(get({ origin: "https://app.vercel.app" }), hostedEnv())).toBe(true);
    expect(fromOwnSite(get({ "sec-fetch-site": "cross-site", origin: "https://mockintosh.com" }), hostedEnv())).toBe(true);
  });

  it("refuses other sites and requests with neither header when hosted", () => {
    expect(fromOwnSite(get({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }), hostedEnv())).toBe(false);
    expect(fromOwnSite(get({ "sec-fetch-site": "none" }), hostedEnv())).toBe(false);
    expect(fromOwnSite(get({}), hostedEnv())).toBe(false);
  });

  it("accepts anything off a hosted deployment", () => {
    expect(fromOwnSite(get({}), { ...hostedEnv(), hosted: false })).toBe(true);
  });
});
