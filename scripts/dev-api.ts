import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const PORT = 3001;

function loadEnvLocal() {
  try {
    const envPath = resolve(import.meta.dirname!, "..", ".env.local");
    // `vercel env pull` quotes its values; parseEnv reads them as dotenv does.
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, "utf-8")))) {
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    console.warn(
      "No .env.local found — run `vercel env pull`, or set AI_GATEWAY_API_KEY in the environment"
    );
  }
}

loadEnvLocal();

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

async function nodeToWebRequest(
  req: IncomingMessage,
  body: string
): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  return new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });
}

async function webToNodeResponse(webRes: Response, res: ServerResponse) {
  const headers: Record<string, string | string[]> = Object.fromEntries(webRes.headers.entries());
  // Better Auth sets more than one cookie; fromEntries would keep the last.
  const cookies = webRes.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(webRes.status, headers);

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

const { default: chatHandler } = await import("../api/chat.js");
const { default: generateImageHandler } = await import(
  "../api/generate-image.js"
);
const { default: oauthStartHandler } = await import("../api/oauth/start.js");
const { default: oauthPairHandler } = await import("../api/oauth/pair.js");
const { default: oauthCallbackHandler } = await import(
  "../api/oauth/callback.js"
);
const { default: oauthPollHandler } = await import("../api/oauth/poll.js");
const { default: browseHandler } = await import("../api/browse.js");
const { default: webImageHandler } = await import("../api/web-image.js");
const { default: githubTokenHandler } = await import("../api/github/token.js");
const { default: appleMusicTokenHandler } = await import("../api/apple-music/token.js");
const { default: appleMusicSignInHandler } = await import("../api/apple-music/sign-in.js");
const { default: authHandler } = await import("../api/auth/[...all].js");
const { default: clubVerifiedHandler } = await import("../api/club/verified.js");
const { default: clubResetPasswordHandler } = await import("../api/club/reset-password.js");

const routes: Record<string, (req: Request) => Promise<Response>> = {
  "/api/chat": chatHandler,
  "/api/generate-image": generateImageHandler,
  "/api/oauth/start": oauthStartHandler,
  "/api/oauth/pair": oauthPairHandler,
  "/api/oauth/callback": oauthCallbackHandler,
  "/api/oauth/poll": oauthPollHandler,
  "/api/browse": browseHandler,
  "/api/web-image": webImageHandler,
  "/api/github/token": githubTokenHandler,
  "/api/apple-music/token": appleMusicTokenHandler,
  "/api/apple-music/sign-in": appleMusicSignInHandler,
  "/api/club/verified": clubVerifiedHandler,
  "/api/club/reset-password": clubResetPasswordHandler,
};

/** Catch-all functions (`api/auth/[...all].ts`), by path prefix. */
const prefixRoutes: Array<[string, (req: Request) => Promise<Response>]> = [["/api/auth/", authHandler]];

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const path = new URL(req.url ?? "/", `http://localhost:${PORT}`).pathname;
  const handler = routes[path] ?? prefixRoutes.find(([prefix]) => path.startsWith(prefix))?.[1];

  if (!handler) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const body = await readBody(req);
    const webReq = await nodeToWebRequest(req, body);
    const webRes = await handler(webReq);
    await webToNodeResponse(webRes, res);
  } catch (err) {
    console.error("Handler error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  const auth = process.env.AI_GATEWAY_API_KEY
    ? "AI_GATEWAY_API_KEY"
    : process.env.VERCEL_OIDC_TOKEN
      ? "VERCEL_OIDC_TOKEN (expires 12 hours after `vercel env pull`)"
      : null;
  console.log(`API server listening on http://localhost:${PORT}`);
  console.log(`  LLM_MODEL: ${process.env.LLM_MODEL || "openai/gpt-5.6-sol"}`);
  console.log(`  AI Gateway: ${auth ?? "NOT CONFIGURED — Assistant will return errors"}`);
  if (!auth) {
    console.log("\n  Link the project and pull its OIDC token:");
    console.log("    vercel link && vercel env pull");
    console.log("  or set AI_GATEWAY_API_KEY in .env.local.");
  }
});
