/**
 * The Computer Club's database schema: Better Auth's tables (compared with
 * the database and changed in place), then our own `db/migrations/*.sql`,
 * each applied once, in name order, and recorded in `schema_migrations`.
 * Used by `npm run db:migrate` and by the tests' in-memory database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { Kysely, sql, type Dialect } from "kysely";
import { clubAuthOptions } from "../api/_auth";

const MIGRATIONS = join(import.meta.dirname, "migrations");

/** A migration file's statements. Ours are plain DDL: no `;` inside a statement. */
function statements(source: string): string[] {
  return source
    .replace(/--.*$/gm, "")
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export interface MigrationReport {
  /** What changed, one line each; empty when the database was up to date. */
  changes: string[];
  /** With `print`: the SQL that would run, instead of running it. */
  sql?: string;
}

export async function migrate(dialect: Dialect, options: { print?: boolean } = {}): Promise<MigrationReport> {
  // Migrations only read the schema the options describe; nothing is signed or sent.
  const authOptions = clubAuthOptions({ dialect, secret: "migrate", sendEmail: async () => {}, hosts: [], macOrigins: [] });
  const auth = await getMigrations(authOptions);
  const db = new Kysely<any>({ dialect });
  const changes: string[] = [];
  const printed: string[] = [];

  if (auth.toBeCreated.length || auth.toBeAdded.length) {
    if (options.print) printed.push(await auth.compileMigrations());
    else {
      await auth.runMigrations();
      for (const { table } of auth.toBeCreated) changes.push(`Created ${table}`);
      for (const { table, fields } of auth.toBeAdded) changes.push(`Added ${Object.keys(fields).join(", ")} to ${table}`);
    }
  }

  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`.execute(db);
  const applied = new Set(
    (await db.selectFrom("schema_migrations").select("name").execute()).map((row: { name: string }) => row.name),
  );
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const source = readFileSync(join(MIGRATIONS, name), "utf8");
    if (options.print) {
      printed.push(`-- ${name}\n${source}`);
      continue;
    }
    await db.transaction().execute(async (trx) => {
      for (const statement of statements(source)) await sql.raw(statement).execute(trx);
      await trx.insertInto("schema_migrations").values({ name }).execute();
    });
    changes.push(`Applied ${name}`);
  }
  return options.print ? { changes, sql: printed.join("\n\n") } : { changes };
}
