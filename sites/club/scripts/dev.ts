/**
 * The Computer Club's functions on port 3002, the Club local Macs use
 * (`api/config.ts`). Reads `sites/club/.env.local` (`vercel env pull` in a
 * checkout linked to the Club's project), then the OS's `.env.local`.
 */
import { resolve } from "node:path";
import { loadEnvFiles, serveFunctions } from "../../../scripts/functionServer";

const PORT = 3002;
const CLUB = resolve(import.meta.dirname, "..");

loadEnvFiles([resolve(CLUB, ".env.local"), resolve(CLUB, "..", "..", ".env.local")]);

const { default: authHandler } = await import("../api/auth/[...all].js");
const { default: chatHandler } = await import("../api/chat.js");
const { default: generateImageHandler } = await import("../api/generate-image.js");
const { default: creditsHandler } = await import("../api/credits.js");
const { default: verifiedHandler } = await import("../api/verified.js");
const { default: resetPasswordHandler } = await import("../api/reset-password.js");

serveFunctions({
  port: PORT,
  routes: {
    exact: {
      "/api/chat": chatHandler,
      "/api/generate-image": generateImageHandler,
      "/api/credits": creditsHandler,
      "/api/verified": verifiedHandler,
      "/api/reset-password": resetPasswordHandler,
    },
    prefix: [["/api/auth/", authHandler]],
  },
  onListen() {
    console.log(`Computer Club listening on http://localhost:${PORT}`);
    console.log(`  Database: ${process.env.DATABASE_URL ? "DATABASE_URL" : "NOT CONFIGURED — run vercel env pull"}`);
    console.log(`  Email: ${process.env.RESEND_API_KEY ? "Resend" : "printed here"}`);
  },
});
