import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { beforeAll, describe, expect, it } from "vitest";
import { DISK_INLINE_MAX, NEWER_DISK_FORMAT, homeVolumeId, type DiskChange, type DiskPushResult } from "../../../packages/protocol/src/diskSync";
import { migrate } from "../db/migrate";
import { createDisk, type Disk } from "./_disk";

let disk: Disk;
let db: Kysely<any>;
let members = 0;

async function member(): Promise<string> {
  const id = `member-${++members}`;
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, ${id}, ${`${id}@example.com`}, true)`.execute(db);
  return id;
}

beforeAll(async () => {
  const dialect = new PGliteDialect(new PGlite());
  await migrate(dialect);
  db = new Kysely({ dialect });
  disk = createDisk(dialect, { quota: 1000 });
}, 30_000);

const b64 = (text: string) => Buffer.from(text).toString("base64");

function folder(user: string, id: string, name: string, parentId = homeVolumeId(user)): DiskChange {
  return { id, parentId, name, kind: "directory", size: 0, revision: 1, baseRevision: 0, createdAt: 1, modifiedAt: 1 };
}

function file(id: string, parentId: string, name: string, text: string, revision = 1, baseRevision = 0): DiskChange {
  return { id, parentId, name, kind: "file", type: "text/plain", size: text.length, revision, baseRevision, createdAt: 1, modifiedAt: 2, content: b64(text) };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)).toString("hex");
}

describe("members' disks", () => {
  it("keeps pushed folders and files, and hands them out in change order", async () => {
    const user = await member();
    const result = await disk.push(user, { format: 3, changes: [folder(user, "desk", "Desktop Folder"), file("note", "desk", "Note", "hello")] });
    expect(result).toMatchObject({ applied: [{ id: "desk" }, { id: "note" }], refused: [], used: 5 });

    const changes = await disk.changes(user, 0);
    expect(changes.nodes.map((n) => n.id)).toEqual(["desk", "note"]);
    expect(Buffer.from(changes.nodes[1].content!, "base64").toString()).toBe("hello");
    expect(await disk.changes(user, changes.cursor)).toMatchObject({ nodes: [], more: false });
  });

  it("refuses a change based on an old revision, with the Club's version", async () => {
    const user = await member();
    await disk.push(user, { format: 3, changes: [folder(user, "desk", "Desktop Folder"), file("note", "desk", "Note", "one")] });
    await disk.push(user, { format: 3, changes: [file("note", "desk", "Note", "two", 2, 1)] });
    const stale = await disk.push(user, { format: 3, changes: [file("note", "desk", "Note", "three", 2, 1)] });
    expect(stale).toMatchObject({ applied: [], refused: [{ id: "note", reason: "changed", current: { revision: 2 } }] });
  });

  it("refuses a node whose folder isn't there, and keeps a removal as a tombstone", async () => {
    const user = await member();
    expect(await disk.push(user, { format: 3, changes: [file("lost", "nowhere", "Lost", "x")] })).toMatchObject({
      refused: [{ id: "lost", reason: "missing_parent" }],
    });
    await disk.push(user, { format: 3, changes: [folder(user, "desk", "Desktop Folder"), file("note", "desk", "Note", "bye")] });
    const { cursor } = await disk.changes(user, 0);
    const removed = await disk.push(user, { format: 3, changes: [{ ...file("note", "desk", "Note", ""), deleted: true, baseRevision: 1 }] });
    expect(removed).toMatchObject({ applied: [{ id: "note" }], used: 0 });
    expect((await disk.changes(user, cursor)).nodes).toEqual([expect.objectContaining({ id: "note", deleted: true, revision: 2 })]);
  });

  it("keeps larger contents by hash, uploaded first", async () => {
    const user = await member();
    const bytes = new Uint8Array(DISK_INLINE_MAX + 1).fill(7);
    const hash = await sha256(bytes);
    const change: DiskChange = { ...file("big", homeVolumeId(user), "Big", ""), content: undefined, sha256: hash, size: bytes.length };
    expect(((await disk.push(user, { format: 3, changes: [change] })) as DiskPushResult).refused).toEqual([{ id: "big", reason: "missing_blob" }]);
    expect(await disk.putBlob(user, hash, new Uint8Array(3))).toBe("mismatch");
    expect(await disk.putBlob(user, hash, bytes)).toBe("over_quota");
  });

  it("stops at the quota", async () => {
    const user = await member();
    const result = await disk.push(user, {
      format: 3,
      changes: [file("a", homeVolumeId(user), "A", "x".repeat(600)), file("b", homeVolumeId(user), "B", "y".repeat(600))],
    });
    expect(result).toMatchObject({ applied: [{ id: "a" }], refused: [{ id: "b", reason: "over_quota" }], used: 600 });
  });

  it("lets only the newest Mockintosh that wrote a disk write to it", async () => {
    const user = await member();
    await disk.push(user, { format: 4, changes: [] });
    expect(await disk.push(user, { format: 3, changes: [folder(user, "desk", "Desktop Folder")] })).toBe(NEWER_DISK_FORMAT);
    expect(await disk.push(user, { format: 4, changes: [folder(user, "desk", "Desktop Folder")] })).toMatchObject({ applied: [{ id: "desk" }] });
  });

  it("keeps each member's disk to themselves", async () => {
    const ada = await member();
    const bob = await member();
    await disk.push(ada, { format: 3, changes: [file("note", homeVolumeId(ada), "Note", "Ada's")] });
    expect((await disk.changes(bob, 0)).nodes).toEqual([]);
  });
});

describe("larger contents", () => {
  it("are stored once per member and read back", async () => {
    const dialect = new PGliteDialect(new PGlite());
    await migrate(dialect);
    const roomy = createDisk(dialect);
    const local = new Kysely<any>({ dialect });
    await sql`insert into "user" (id, name, email, "emailVerified") values ('m', 'm', 'm@example.com', true)`.execute(local);
    const bytes = new Uint8Array(DISK_INLINE_MAX + 10).fill(9);
    const hash = await sha256(bytes);
    expect(await roomy.putBlob("m", hash, bytes)).toBe("stored");
    expect(await roomy.putBlob("m", hash, bytes)).toBe("exists");
    const change: DiskChange = { ...file("big", homeVolumeId("m"), "Big", ""), content: undefined, sha256: hash, size: bytes.length };
    expect(await roomy.push("m", { format: 3, changes: [change] })).toMatchObject({ applied: [{ id: "big" }], used: bytes.length });
    expect((await roomy.changes("m", 0)).nodes[0]).toMatchObject({ id: "big", sha256: hash, size: bytes.length });
    expect(await roomy.getBlob("m", hash)).toEqual(bytes);
  }, 30_000);
});
