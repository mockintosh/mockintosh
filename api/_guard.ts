/**
 * Spend protection for the endpoints that call a paid model with our key
 * (`/api/chat`, `/api/generate-image`), and `fromOwnSite` for the free
 * ones that fetch the web for Safari. Anyone who can reach the function
 * can send it a request, so each one passes, in order:
 *
 *   0. Authentication — `Authorization: Bearer <API_ACCESS_TOKEN>`. With no
 *      token configured every request is refused, on every host: there are
 *      no anonymous model responses. The limits below still apply, in case
 *      the token leaks.
 *   1. Origin — a browser always sends `Origin` on a POST; it must be this
 *      deployment (or `ALLOWED_ORIGINS`). This stops other sites and casual
 *      scripts, not a determined caller, who can forge the header.
 *   2. Size — the body is read up to a cap, whatever `Content-Length` says.
 *   3. Limits — a fixed-window count per client IP, and one per day for
 *      everyone together. These are what actually bound the bill.
 *
 * Counters live in the same Redis REST store as the sign-in relay
 * (`KV_REST_API_URL` / `KV_REST_API_TOKEN`). On Vercel without one the
 * guard refuses: per-instance memory would not bound anything. Off Vercel
 * (`scripts/dev-api.ts`, `npm run agent:eval`) it counts in memory and
 * skips the origin check, since those callers are local.
 */

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowSeconds: number;
}

export interface RouteLimits {
  /** Counter namespace, e.g. `"chat"`. */
  route: string;
  maxBodyBytes: number;
  perClient: Limit;
  /** Every client together. */
  global: Limit;
}

export interface CounterStore {
  /** Adds one to `key`, starting a `ttlSeconds` window on the first hit; returns the new count. */
  hit(key: string, ttlSeconds: number): Promise<number>;
}

export interface GuardEnv {
  /** The bearer token callers must present; `null` refuses everyone. */
  accessToken: string | null;
  /** True on a hosted deployment, where callers are strangers. */
  hosted: boolean;
  /** Origins besides the request's own host, e.g. a custom domain. */
  allowedOrigins: readonly string[];
  store: CounterStore | null;
  now(): number;
}

export type GuardResult =
  | { ok: true; body: string }
  | { ok: false; response: Response };

function reply(status: number, error: string, headers: Record<string, string> = {}): GuardResult {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  };
}

export function createMemoryCounters(now: () => number = Date.now): CounterStore {
  const counts = new Map<string, { count: number; expiresAt: number }>();
  return {
    async hit(key, ttlSeconds) {
      const entry = counts.get(key);
      if (!entry || now() >= entry.expiresAt) {
        counts.set(key, { count: 1, expiresAt: now() + ttlSeconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
  };
}

function createRedisRestCounters(url: string, token: string): CounterStore {
  return {
    async hit(key, ttlSeconds) {
      // INCR then EXPIRE NX in one round trip: the window starts at the first hit.
      const resp = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", `api-limit:${key}`],
          ["EXPIRE", `api-limit:${key}`, ttlSeconds, "NX"],
        ]),
      });
      if (!resp.ok) throw new Error(`Limit store error: ${resp.status}`);
      const results = (await resp.json()) as Array<{ result?: unknown; error?: string }>;
      const count = results[0]?.result;
      if (typeof count !== "number") throw new Error(`Limit store error: ${results[0]?.error ?? "no count"}`);
      return count;
    },
  };
}

function envList(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** A whole number from the environment, or `fallback`. */
export function envLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

let defaultEnv: GuardEnv | undefined;

export function guardEnvFromProcess(): GuardEnv {
  if (defaultEnv) return defaultEnv;
  const hosted = !!process.env.VERCEL;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  const store = url && token ? createRedisRestCounters(url, token) : hosted ? null : createMemoryCounters();
  const allowedOrigins = [
    ...envList("ALLOWED_ORIGINS"),
    ...[process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL]
      .filter((host): host is string => !!host)
      .map((host) => `https://${host}`),
  ];
  const accessToken = process.env.API_ACCESS_TOKEN?.trim() || null;
  defaultEnv = { accessToken, hosted, allowedOrigins, store, now: Date.now };
  return defaultEnv;
}

/** The caller's address as Vercel's proxy reports it. */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Compares without stopping at the first differing byte. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function authenticated(req: Request, env: GuardEnv): boolean {
  if (!env.accessToken) return false;
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return !!match && sameSecret(match[1].trim(), env.accessToken);
}

function isOwnOrigin(origin: string | null, req: Request, env: GuardEnv): boolean {
  if (!origin) return false;
  if (env.allowedOrigins.includes(origin)) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return !!host && origin === `https://${host}`;
}

function originAllowed(req: Request, env: GuardEnv): boolean {
  return isOwnOrigin(req.headers.get("origin"), req, env);
}

/**
 * True when a browser on this deployment sent the request: for the free
 * endpoints (`/api/browse`, `/api/web-image`), which need no token but
 * should not be a proxy for other sites. A same-origin GET carries no
 * `Origin`, so `Sec-Fetch-Site` answers first. Like the origin check, it
 * stops other sites and casual scripts, not a forged header; the Vercel
 * Firewall's per-IP rate limit on these paths bounds the rest.
 */
export function fromOwnSite(req: Request, env: GuardEnv = guardEnvFromProcess()): boolean {
  if (!env.hosted) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  return isOwnOrigin(req.headers.get("origin"), req, env);
}

/** The body as text, or `null` once it passes `maxBytes`. */
async function readCapped(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function windowKey(route: string, scope: string, limit: Limit, now: number): string {
  return `${route}:${scope}:${limit.windowSeconds}:${Math.floor(now / 1000 / limit.windowSeconds)}`;
}

/**
 * Checks a POST against `limits` and returns its body, or the response to
 * send instead. Call before any work that costs money.
 */
export async function guardRequest(req: Request, limits: RouteLimits, env: GuardEnv = guardEnvFromProcess()): Promise<GuardResult> {
  if (req.method !== "POST") return reply(405, "Method not allowed");
  if (!authenticated(req, env)) return reply(401, "Sign-in required.", { "WWW-Authenticate": "Bearer" });
  if (env.hosted && !originAllowed(req, env)) return reply(403, "Forbidden");
  if (!env.store) return reply(503, "This endpoint needs a Redis store for its limits: set KV_REST_API_URL and KV_REST_API_TOKEN");

  const now = env.now();
  try {
    const perClient = await env.store.hit(windowKey(limits.route, clientAddress(req), limits.perClient, now), limits.perClient.windowSeconds);
    if (perClient > limits.perClient.max) {
      return reply(429, "Too many requests. Try again later.", { "Retry-After": String(limits.perClient.windowSeconds) });
    }
    const global = await env.store.hit(windowKey(limits.route, "all", limits.global, now), limits.global.windowSeconds);
    if (global > limits.global.max) {
      return reply(429, "The daily limit for everyone has been reached. Try again tomorrow.", { "Retry-After": String(limits.global.windowSeconds) });
    }
  } catch (error) {
    console.error("Limit store unavailable:", error);
    return reply(503, "Service temporarily unavailable");
  }

  const body = await readCapped(req, limits.maxBodyBytes);
  if (body === null) return reply(413, "Request too large");
  return { ok: true, body };
}
