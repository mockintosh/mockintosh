import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../db/migrate";
import { WELCOME_CREDITS, WELCOMES_PER_ADDRESS_PER_DAY, createCredits, welcomeMember, type Credits } from "./_credits";
import { createMemoryCounters } from "./_guard";
import type { Usage } from "./_pricing";

let credits: Credits;
let members = 0;
let db: Kysely<any>;

/** A member row for the ledger's foreign keys. */
async function member(): Promise<string> {
  const id = `member-${++members}`;
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, ${id}, ${`${id}@example.com`}, true)`.execute(db);
  return id;
}

const usage = (costMicroUsd: number): Usage => ({ model: "openai/test", costMicroUsd, inputTokens: 100, outputTokens: 10 });

beforeAll(async () => {
  const dialect = new PGliteDialect(new PGlite());
  await migrate(dialect);
  db = new Kysely({ dialect });
  credits = createCredits(dialect);
}, 30_000);

describe("credits", () => {
  it("starts members at zero", async () => {
    expect(await credits.balance(await member())).toBe(0);
  });

  it("grants once per ref", async () => {
    const id = await member();
    expect(await credits.grant(id, 10_000, "purchase", "order-1")).toBe(true);
    expect(await credits.grant(id, 10_000, "purchase", "order-1")).toBe(false);
    expect(await credits.balance(id)).toBe(10_000);
  });

  it("charges twice what a call cost, in tenths of a cent, rounding up", async () => {
    const id = await member();
    await credits.grant(id, 1000, "grant", `welcome:${id}`);
    // $0.0123 at 2× is 24.6 tenths of a cent.
    expect(await credits.charge(id, usage(12_300), "usage:a")).toBe(1000 - 25);
    expect(await credits.charge(id, usage(12_300), "usage:a")).toBe(975);
    const [entry] = await credits.recent(id);
    expect(entry).toMatchObject({ kind: "usage", delta: -25, model: "openai/test" });
  });

  it("charges even a free call one credit, and lets a balance go below zero", async () => {
    const id = await member();
    expect(await credits.charge(id, usage(0), "usage:b")).toBe(-1);
  });

  it("keeps the balance right under concurrent charges", async () => {
    const id = await member();
    await credits.grant(id, 5000, "purchase", `order-${id}`);
    await Promise.all(Array.from({ length: 20 }, (_, i) => credits.charge(id, usage(1000), `usage:c${i}`)));
    expect(await credits.balance(id)).toBe(5000 - 20 * 2);
    const ledger = await sql<{ sum: string }>`select sum(delta) as sum from credit_ledger where user_id = ${id}`.execute(db);
    expect(Number(ledger.rows[0]!.sum)).toBe(await credits.balance(id));
  });

  it("lists the latest changes first", async () => {
    const id = await member();
    await credits.grant(id, 100, "grant", `welcome:${id}`);
    await credits.charge(id, usage(5000), "usage:d");
    expect((await credits.recent(id)).map((entry) => entry.kind)).toEqual(["usage", "grant"]);
  });

  it("refuses to grant nothing", async () => {
    await expect(credits.grant(await member(), 0, "grant", "nothing")).rejects.toThrow();
  });

  it("forgets a member's credits with the member", async () => {
    const id = await member();
    await credits.grant(id, 100, "grant", `welcome:${id}`);
    await sql`delete from "user" where id = ${id}`.execute(db);
    expect(await credits.balance(id)).toBe(0);
    expect(await credits.recent(id)).toEqual([]);
  });
});

describe("welcome credits", () => {
  it("welcomes each member once", async () => {
    const id = await member();
    const counters = createMemoryCounters();
    expect(await welcomeMember(credits, counters, id, "1.1.1.1")).toBe(true);
    expect(await welcomeMember(credits, counters, id, "1.1.1.1")).toBe(false);
    expect(await credits.balance(id)).toBe(WELCOME_CREDITS);
  });

  it("welcomes only a few members from one address a day", async () => {
    const counters = createMemoryCounters();
    const now = Date.UTC(2026, 9, 10, 12);
    for (let i = 0; i < WELCOMES_PER_ADDRESS_PER_DAY; i++) {
      expect(await welcomeMember(credits, counters, await member(), "2.2.2.2", now)).toBe(true);
    }
    const late = await member();
    expect(await welcomeMember(credits, counters, late, "2.2.2.2", now)).toBe(false);
    expect(await credits.balance(late)).toBe(0);
    expect(await welcomeMember(credits, counters, await member(), "3.3.3.3", now)).toBe(true);
    expect(await welcomeMember(credits, counters, late, "2.2.2.2", now + 86_400_000)).toBe(true);
  });
});
