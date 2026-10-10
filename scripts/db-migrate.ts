/**
 * Brings the Computer Club's database up to date (`db/migrate.ts`): Better
 * Auth's tables, then `db/migrations/*.sql`. Uses `DATABASE_URL` from the
 * environment or `.env.local` (`vercel env pull`).
 *
 *   npm run db:migrate              apply
 *   npm run db:migrate -- --print   print the SQL instead
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { databaseDialect } from "../api/_db";
import { migrate } from "../db/migrate";

try {
  const env = parseEnv(readFileSync(resolve(import.meta.dirname, "..", ".env.local"), "utf-8"));
  for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
} catch {
  // No .env.local: DATABASE_URL must come from the environment.
}

const dialect = databaseDialect();
if (!dialect) {
  console.error("DATABASE_URL is unset. Run `vercel env pull`, or set it in the environment.");
  process.exit(1);
}

const report = await migrate(dialect, { print: process.argv.includes("--print") });
if (report.sql !== undefined) console.log(report.sql || "The database is up to date.");
else console.log(report.changes.length ? report.changes.join("\n") : "The database is up to date.");
process.exit(0);
