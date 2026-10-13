/**
 * The Computer Club's Postgres database (Neon, `DATABASE_URL` from the
 * Vercel integration). One pool per function instance: Fluid compute
 * reuses instances across requests, and Neon's pooler sits behind it.
 */
import { Pool } from "@neondatabase/serverless";
import { PostgresDialect, type Dialect, type PostgresPool } from "kysely";

let dialect: Dialect | undefined;

/** Use `local` instead of `DATABASE_URL`: `npm run dev:club`'s own database. */
export function useLocalDatabase(local: Dialect): void {
  dialect = local;
}

/** The database as a Kysely dialect, or `null` when `DATABASE_URL` is unset. */
export function databaseDialect(): Dialect | null {
  if (dialect) return dialect;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const pool = new Pool({ connectionString });
  // Neon closes idle connections. The pool drops the client; without a listener
  // the error event would end the process (and print the connection string).
  pool.on("error", (error: Error) => console.warn("Database connection closed:", error.message));
  // Neon's Pool is node-postgres's API; only its `Client` class typing differs from Kysely's.
  dialect = new PostgresDialect({ pool: pool as unknown as PostgresPool });
  return dialect;
}
