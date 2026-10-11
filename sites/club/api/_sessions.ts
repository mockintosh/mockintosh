/**
 * A member's sessions as the account page lists them: each connected
 * Macintosh (and each browser signed in to the Club's pages), with its
 * site and daily cap. Better Auth's `session` table, with the `site` and
 * `dailyCap` fields `api/_auth.ts` adds.
 */
import { Kysely, type Dialect } from "kysely";
import { databaseDialect } from "./_db.js";

interface Tables {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    site: string | null;
    dailyCap: number | null;
  };
}

export interface ConnectedSession {
  id: string;
  /** The site of the Mac it belongs to, or of the Club's own page. */
  site: string | null;
  /** Milliseconds since the epoch. */
  connectedAt: number;
  lastUsedAt: number;
  dailyCap: number | null;
}

export interface Sessions {
  list(userId: string): Promise<ConnectedSession[]>;
  /** Sets one of the member's sessions' daily cap; `null` removes it. False when it isn't theirs. */
  setCap(userId: string, sessionId: string, cap: number | null): Promise<boolean>;
  /** Ends one of the member's sessions: that Mac's token stops working. False when it isn't theirs. */
  disconnect(userId: string, sessionId: string): Promise<boolean>;
}

export function createSessions(dialect: Dialect): Sessions {
  const db = new Kysely<Tables>({ dialect });
  return {
    async list(userId) {
      const rows = await db
        .selectFrom("session")
        .select(["id", "site", "createdAt", "updatedAt", "dailyCap"])
        .where("userId", "=", userId)
        .where("expiresAt", ">", new Date())
        .orderBy("createdAt", "desc")
        .execute();
      return rows.map((row) => ({
        id: row.id,
        site: row.site,
        connectedAt: new Date(row.createdAt).getTime(),
        lastUsedAt: new Date(row.updatedAt).getTime(),
        dailyCap: row.dailyCap === null ? null : Number(row.dailyCap),
      }));
    },
    async setCap(userId, sessionId, cap) {
      const result = await db
        .updateTable("session")
        .set({ dailyCap: cap })
        .where("id", "=", sessionId)
        .where("userId", "=", userId)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },
    async disconnect(userId, sessionId) {
      const result = await db.deleteFrom("session").where("id", "=", sessionId).where("userId", "=", userId).executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },
  };
}

let sessions: Sessions | null | undefined;

/** The Club's sessions on this deployment, or `null` without a database. */
export function clubSessions(): Sessions | null {
  if (sessions !== undefined) return sessions;
  const dialect = databaseDialect();
  sessions = dialect ? createSessions(dialect) : null;
  return sessions;
}
