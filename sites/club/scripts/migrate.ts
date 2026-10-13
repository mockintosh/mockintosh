/**
 * Brings the Computer Club's database up to date (`db/migrate.ts`): Better
 * Auth's tables, then `db/migrations/*.sql`. Uses `DATABASE_URL` from the
 * environment or an `.env.local` (`vercel env pull`).
 *
 *   npm run db:migrate              apply
 *   npm run db:migrate -- --print   print the SQL instead
 */
import { resolve } from "node:path";
import { loadEnvFiles } from "../../../scripts/functionServer";
import { databaseDialect } from "../api/_db";
import { migrate } from "../db/migrate";

const CLUB = resolve(import.meta.dirname, "..");
// The Club's own `.env.local` (`vercel env pull` linked to its project), then the OS's.
loadEnvFiles([resolve(CLUB, ".env.local"), resolve(CLUB, "..", "..", ".env.local")]);

const dialect = databaseDialect();
if (!dialect) {
  console.error("DATABASE_URL is unset. Run `vercel env pull`, or set it in the environment.");
  process.exit(1);
}

const report = await migrate(dialect, { print: process.argv.includes("--print") });
if (report.sql !== undefined) console.log(report.sql || "The database is up to date.");
else console.log(report.changes.length ? report.changes.join("\n") : "The database is up to date.");
process.exit(0);
