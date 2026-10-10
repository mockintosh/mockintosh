/**
 * Brings the Computer Club's database up to date: Better Auth's tables
 * (`user`, `session`, `account`, `verification`), compared with what is
 * there and changed in place. Uses `DATABASE_URL` from the environment or
 * `.env.local` (`vercel env pull`).
 *
 *   npm run db:migrate              apply
 *   npm run db:migrate -- --print   print the SQL instead
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { getMigrations } from "better-auth/db/migration";
import { clubAuthOptions } from "../api/_auth";
import { databaseDialect } from "../api/_db";

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

// Migrations only read the schema the options describe; nothing is signed or sent.
const options = clubAuthOptions({ dialect, secret: "migrate", sendEmail: async () => {}, hosts: [] });
const { toBeCreated, toBeAdded, runMigrations, compileMigrations } = await getMigrations(options);

if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("The database is up to date.");
} else if (process.argv.includes("--print")) {
  console.log(await compileMigrations());
} else {
  await runMigrations();
  for (const { table } of toBeCreated) console.log(`Created ${table}`);
  for (const { table, fields } of toBeAdded) console.log(`Added ${Object.keys(fields).join(", ")} to ${table}`);
}
process.exit(0);
