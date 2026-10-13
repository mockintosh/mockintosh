/**
 * Computer Club credits: each member's balance and the ledger of every
 * change to it (`db/migrations/0001_credits.sql`). A change is one
 * transaction — the ledger row, then the balance — and each has a `ref`
 * that can be used once, so a retried webhook or a repeated welcome never
 * counts twice.
 */
import { Kysely, sql, type Dialect, type Generated } from "kysely";
import { databaseDialect } from "./_db.js";
import { creditsFor, type Usage } from "./_pricing.js";

export type CreditKind = "grant" | "purchase" | "usage" | "refund" | "adjust";

interface Tables {
  credit_balance: { user_id: string; balance: string | number };
  credit_ledger: {
    id: Generated<string>;
    user_id: string;
    delta: number;
    kind: CreditKind;
    ref: string;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_microusd: number | null;
    session_id: string | null;
    created_at: Generated<Date>;
  };
}

/** One change to a balance, as the Club window lists it. */
export interface LedgerEntry {
  /** Milliseconds since the epoch. */
  at: number;
  kind: CreditKind;
  delta: number;
  model: string | null;
}

export interface Credits {
  balance(userId: string): Promise<number>;
  /** Adds `amount`; false when `ref` was already used (nothing changes). */
  grant(userId: string, amount: number, kind: Exclude<CreditKind, "usage">, ref: string): Promise<boolean>;
  /**
   * Takes what `usage` costs at our prices, spent by `sessionId` when known;
   * returns the balance after. A repeated `ref` charges nothing.
   */
  charge(userId: string, usage: Usage, ref: string, sessionId?: string): Promise<number>;
  /** Credits a session has spent since `since` (milliseconds since the epoch). */
  spentBy(sessionId: string, since: number): Promise<number>;
  /** The latest changes, newest first. */
  recent(userId: string, limit?: number): Promise<LedgerEntry[]>;
}

export function createCredits(dialect: Dialect): Credits {
  const db = new Kysely<Tables>({ dialect });

  async function balance(userId: string): Promise<number> {
    const row = await db.selectFrom("credit_balance").select("balance").where("user_id", "=", userId).executeTakeFirst();
    return Number(row?.balance ?? 0);
  }

  /** The new balance, or `null` when `ref` was already used. */
  function apply(
    userId: string,
    delta: number,
    kind: CreditKind,
    ref: string,
    usage?: Usage,
    sessionId?: string,
  ): Promise<number | null> {
    return db.transaction().execute(async (trx) => {
      const added = await trx
        .insertInto("credit_ledger")
        .values({
          user_id: userId,
          delta,
          kind,
          ref,
          model: usage?.model ?? null,
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: usage?.outputTokens ?? null,
          cost_microusd: usage?.costMicroUsd ?? null,
          session_id: sessionId ?? null,
        })
        .onConflict((conflict) => conflict.column("ref").doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!added) return null;
      const row = await trx
        .insertInto("credit_balance")
        .values({ user_id: userId, balance: delta })
        .onConflict((conflict) =>
          conflict.column("user_id").doUpdateSet({ balance: sql`credit_balance.balance + excluded.balance` }),
        )
        .returning("balance")
        .executeTakeFirstOrThrow();
      return Number(row.balance);
    });
  }

  return {
    balance,
    async grant(userId, amount, kind, ref) {
      if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Can't grant ${amount} credits`);
      return (await apply(userId, amount, kind, ref)) !== null;
    },
    async charge(userId, usage, ref, sessionId) {
      return (await apply(userId, -creditsFor(usage.costMicroUsd), "usage", ref, usage, sessionId)) ?? (await balance(userId));
    },
    async spentBy(sessionId, since) {
      const row = await db
        .selectFrom("credit_ledger")
        .select((eb) => eb.fn.coalesce(eb.fn.sum<string | number>("delta"), sql<number>`0`).as("total"))
        .where("session_id", "=", sessionId)
        .where("kind", "=", "usage")
        .where("created_at", ">=", new Date(since))
        .executeTakeFirst();
      return Math.abs(Number(row?.total ?? 0));
    },
    async recent(userId, limit = 10) {
      const rows = await db
        .selectFrom("credit_ledger")
        .select(["created_at", "kind", "delta", "model"])
        .where("user_id", "=", userId)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .execute();
      return rows.map((row) => ({
        at: new Date(row.created_at).getTime(),
        kind: row.kind,
        delta: Number(row.delta),
        model: row.model,
      }));
    },
  };
}

let credits: Credits | null | undefined;

/** The Club's credits on this deployment, or `null` without a database. */
export function clubCredits(): Credits | null {
  if (credits !== undefined) return credits;
  const dialect = databaseDialect();
  credits = dialect ? createCredits(dialect) : null;
  return credits;
}

/**
 * Charges a member for a call that has been made: their balance after, or
 * `undefined` for our own scripts, and when charging failed (the call is
 * answered anyway; the failure is logged).
 */
export async function chargeCaller(
  caller: { kind: "member"; id: string; sessionId?: string } | { kind: "service" },
  usage: Usage,
  ref: string,
): Promise<number | undefined> {
  if (caller.kind !== "member") return undefined;
  try {
    const credits = clubCredits();
    if (!credits) throw new Error("No database for credits");
    return await credits.charge(caller.id, usage, ref, caller.sessionId);
  } catch (error) {
    console.error(`Couldn't charge ${caller.id} for ${ref}:`, error);
    return undefined;
  }
}

/** Credits a new member starts with, once their email is verified. */
export const WELCOME_CREDITS = 500;
/** Welcomes paid out to one address per day, so making accounts in bulk doesn't keep paying. */
export const WELCOMES_PER_ADDRESS_PER_DAY = 3;

/**
 * Gives a newly verified member their welcome credits, unless their
 * address has had its share today. True when credits were added.
 */
export async function welcomeMember(
  credits: Credits,
  counters: { hit(key: string, ttlSeconds: number): Promise<number> },
  memberId: string,
  address: string,
  now = Date.now(),
): Promise<boolean> {
  const day = Math.floor(now / 86_400_000);
  if ((await counters.hit(`welcome:${address}:${day}`, 86_400)) > WELCOMES_PER_ADDRESS_PER_DAY) {
    console.warn(`No welcome credits for ${memberId}: ${address} has had ${WELCOMES_PER_ADDRESS_PER_DAY} today`);
    return false;
  }
  return credits.grant(memberId, WELCOME_CREDITS, "grant", `welcome:${memberId}`);
}
