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

// Without DATABASE_URL (or with it set to nothing), a database of its own in
// `.dev-db`, so the Club runs without Neon. Delete the folder to start over.
const LOCAL_DB = resolve(CLUB, ".dev-db");
if (!process.env.DATABASE_URL) {
  const [{ PGlite }, { PGliteDialect }, { useLocalDatabase }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("kysely-pglite-dialect"),
    import("../api/_db.js"),
    import("../db/migrate.js"),
  ]);
  const local = new PGliteDialect(new PGlite(LOCAL_DB));
  const { changes } = await migrate(local);
  for (const change of changes) console.log(`  ${change}`);
  useLocalDatabase(local);
}

const { default: authHandler } = await import("../api/auth/[...all].js");
const { default: chatHandler } = await import("../api/chat.js");
const { default: generateImageHandler } = await import("../api/generate-image.js");
const { default: creditsHandler } = await import("../api/credits.js");
const { default: configHandler } = await import("../api/config.js");
const { default: accountHandler } = await import("../api/account.js");
const { default: connectHandler } = await import("../api/connect.js");
const { default: diskChangesHandler } = await import("../api/disk/changes.js");
const { default: diskPushHandler } = await import("../api/disk/push.js");
const { default: diskBlobHandler } = await import("../api/disk/blob.js");

serveFunctions({
  port: PORT,
  routes: {
    exact: {
      "/api/chat": chatHandler,
      "/api/generate-image": generateImageHandler,
      "/api/credits": creditsHandler,
      "/api/config": configHandler,
      "/": accountHandler,
      "/connect": connectHandler,
      "/api/disk/changes": diskChangesHandler,
      "/api/disk/push": diskPushHandler,
      "/api/disk/blob": diskBlobHandler,
    },
    prefix: [["/api/auth/", authHandler]],
  },
  onListen() {
    console.log(`Computer Club listening on http://localhost:${PORT} (account page at /, connect page at /connect)`);
    console.log(`  Database: ${process.env.DATABASE_URL ? "DATABASE_URL" : `local, in ${LOCAL_DB}`}`);
    console.log(`  Email: ${process.env.RESEND_API_KEY ? "Resend" : "printed here"}`);
  },
});
