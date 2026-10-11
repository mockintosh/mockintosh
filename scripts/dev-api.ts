/**
 * The OS's `api/` functions on port 3001, behind Vite's `/api` proxy. The
 * Computer Club runs separately (`npm run dev:club`, port 3002).
 */
import { resolve } from "node:path";
import { loadEnvFiles, serveFunctions } from "./functionServer";

const PORT = 3001;

if (!loadEnvFiles([resolve(import.meta.dirname, "..", ".env.local")])) {
  console.warn("No .env.local found — run `vercel env pull`, or set AI_GATEWAY_API_KEY in the environment");
}

const { default: chatHandler } = await import("../api/chat.js");
const { default: generateImageHandler } = await import("../api/generate-image.js");
const { default: oauthStartHandler } = await import("../api/oauth/start.js");
const { default: oauthPairHandler } = await import("../api/oauth/pair.js");
const { default: oauthCallbackHandler } = await import("../api/oauth/callback.js");
const { default: oauthPollHandler } = await import("../api/oauth/poll.js");
const { default: browseHandler } = await import("../api/browse.js");
const { default: webImageHandler } = await import("../api/web-image.js");
const { default: githubTokenHandler } = await import("../api/github/token.js");
const { default: appleMusicTokenHandler } = await import("../api/apple-music/token.js");
const { default: appleMusicSignInHandler } = await import("../api/apple-music/sign-in.js");
const { default: configHandler, hostConfig } = await import("../api/config.js");

serveFunctions({
  port: PORT,
  answerPreflights: true,
  routes: {
    exact: {
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
      "/api/config": configHandler,
    },
  },
  onListen() {
    const auth = process.env.AI_GATEWAY_API_KEY
      ? "AI_GATEWAY_API_KEY"
      : process.env.VERCEL_OIDC_TOKEN
        ? "VERCEL_OIDC_TOKEN (expires 12 hours after `vercel env pull`)"
        : null;
    const config = hostConfig();
    console.log(`API server listening on http://localhost:${PORT}`);
    console.log(`  Computer Club: ${config.club ?? "none"} (AI paid by ${config.ai})`);
    console.log(`  LLM_MODEL: ${process.env.LLM_MODEL || "openai/gpt-5.6-sol"}`);
    console.log(`  AI Gateway: ${auth ?? "NOT CONFIGURED — Assistant will return errors"}`);
    if (!auth) {
      console.log("\n  Link the project and pull its OIDC token:");
      console.log("    vercel link && vercel env pull");
      console.log("  or set AI_GATEWAY_API_KEY in .env.local.");
    }
  },
});
