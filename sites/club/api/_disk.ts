/**
 * Members' home disks on the Club (`db/migrations/0003_disk.sql`): the rows
 * a Macintosh syncs, the larger contents by hash, and the rules a push
 * follows. A change applies only if it was based on the Club's current
 * revision of that node; anything else comes back refused, with the
 * Club's version, for the Mac to settle. One push is one transaction.
 */
import { Kysely, sql, type Dialect, type Generated } from "kysely";
import {
  DISK_FILE_MAX,
  DISK_INLINE_MAX,
  DISK_PAGE,
  DISK_QUOTA,
  NEWER_DISK_FORMAT,
  homeVolumeId,
  type DiskChanges,
  type DiskPush,
  type DiskPushResult,
  type SyncNode,
} from "../../../packages/protocol/src/diskSync.js";
import { databaseDialect } from "./_db.js";

interface Tables {
  disk_node: {
    user_id: string;
    id: string;
    parent_id: string;
    name: string;
    kind: "file" | "directory";
    type: string | null;
    size: string | number;
    revision: number;
    created_at: string | number;
    modified_at: string | number;
    role: string | null;
    attributes: Record<string, unknown> | null;
    content: Uint8Array | null;
    sha256: string | null;
    deleted: boolean;
    seq: Generated<string | number>;
  };
  disk_blob: { user_id: string; sha256: string; size: string | number; content: Uint8Array };
  disk_format: { user_id: string; format: number };
}

/** A row as read back. */
type Row = Omit<Tables["disk_node"], "seq"> & { seq: string | number };

export type BlobResult = "stored" | "exists" | "mismatch" | "too_large" | "over_quota";

export interface Disk {
  changes(userId: string, since: number, limit?: number): Promise<DiskChanges>;
  /** A push's result, or the whole push refused because the disk has a newer format. */
  push(userId: string, push: DiskPush): Promise<DiskPushResult | typeof NEWER_DISK_FORMAT>;
  putBlob(userId: string, sha256: string, bytes: Uint8Array): Promise<BlobResult>;
  getBlob(userId: string, sha256: string): Promise<Uint8Array | null>;
  usage(userId: string): Promise<number>;
}

const SHA256 = /^[0-9a-f]{64}$/;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Buffer.from(digest).toString("hex");
}

/** A row as it travels: tombstones without contents, small contents inline. */
function toSyncNode(row: Row): SyncNode {
  const node: SyncNode = {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    kind: row.kind,
    size: Number(row.size),
    revision: row.revision,
    createdAt: Number(row.created_at),
    modifiedAt: Number(row.modified_at),
  };
  if (row.type) node.type = row.type;
  if (row.role) node.role = row.role;
  if (row.attributes && Object.keys(row.attributes).length) node.attributes = row.attributes;
  if (row.deleted) node.deleted = true;
  else if (row.content) node.content = toBase64(row.content);
  else if (row.sha256) node.sha256 = row.sha256;
  return node;
}

export function createDisk(dialect: Dialect, options: { quota?: number } = {}): Disk {
  const db = new Kysely<Tables>({ dialect });
  const quota = options.quota ?? DISK_QUOTA;

  async function usageIn(trx: Kysely<Tables>, userId: string): Promise<number> {
    const row = await trx
      .selectFrom("disk_node")
      .select((eb) => eb.fn.coalesce(eb.fn.sum<string | number>("size"), sql<number>`0`).as("used"))
      .where("user_id", "=", userId)
      .where("deleted", "=", false)
      .executeTakeFirst();
    return Number(row?.used ?? 0);
  }

  return {
    usage: (userId) => usageIn(db, userId),

    async changes(userId, since, limit = DISK_PAGE) {
      const rows = await db
        .selectFrom("disk_node")
        .selectAll()
        .where("user_id", "=", userId)
        .where("seq", ">", since)
        .orderBy("seq")
        .limit(limit + 1)
        .execute();
      const page = rows.slice(0, limit);
      return {
        cursor: page.length ? Number(page[page.length - 1].seq) : since,
        nodes: page.map(toSyncNode),
        more: rows.length > limit,
        used: await usageIn(db, userId),
        quota,
      };
    },

    async push(userId, { format, changes }) {
      return db.transaction().execute(async (trx) => {
        // A Mac older than the newest that wrote this disk may read it, not write it.
        const known = await trx
          .selectFrom("disk_format")
          .select("format")
          .where("user_id", "=", userId)
          .forUpdate()
          .executeTakeFirst();
        if (known && known.format > format) return NEWER_DISK_FORMAT;
        if (!known || known.format < format) {
          await trx
            .insertInto("disk_format")
            .values({ user_id: userId, format })
            .onConflict((c) => c.column("user_id").doUpdateSet({ format }))
            .execute();
        }

        const root = homeVolumeId(userId);
        const result: DiskPushResult = { applied: [], refused: [], used: await usageIn(trx, userId), quota };
        for (const change of changes) {
          const current = await trx
            .selectFrom("disk_node")
            .selectAll()
            .where("user_id", "=", userId)
            .where("id", "=", change.id)
            .forUpdate()
            .executeTakeFirst();
          if ((current?.revision ?? 0) !== change.baseRevision) {
            result.refused.push({ id: change.id, reason: "changed", current: current && !current.deleted ? toSyncNode(current) : null });
            continue;
          }
          const liveSize = current && !current.deleted ? Number(current.size) : 0;

          if (change.deleted) {
            if (current && !current.deleted) {
              await trx
                .updateTable("disk_node")
                .set({ deleted: true, content: null, sha256: null, size: 0, revision: change.baseRevision + 1, seq: sql`nextval('disk_seq')` })
                .where("user_id", "=", userId)
                .where("id", "=", change.id)
                .execute();
              result.used -= liveSize;
            }
            result.applied.push({ id: change.id });
            continue;
          }

          if (change.parentId !== root) {
            const parent = await trx
              .selectFrom("disk_node")
              .select(["kind", "deleted"])
              .where("user_id", "=", userId)
              .where("id", "=", change.parentId)
              .executeTakeFirst();
            if (!parent || parent.deleted || parent.kind !== "directory") {
              result.refused.push({ id: change.id, reason: "missing_parent" });
              continue;
            }
          }

          let content: Uint8Array | null = null;
          let sha256: string | null = null;
          let size = 0;
          if (change.kind === "file") {
            if (change.size > DISK_FILE_MAX) {
              result.refused.push({ id: change.id, reason: "too_large" });
              continue;
            }
            if (change.content !== undefined) {
              content = new Uint8Array(Buffer.from(change.content, "base64"));
              if (content.byteLength > DISK_INLINE_MAX) {
                // Too big to travel inline: the Mac should have uploaded it.
                result.refused.push({ id: change.id, reason: "missing_blob" });
                continue;
              }
              size = content.byteLength;
            } else if (change.sha256 && SHA256.test(change.sha256)) {
              const blob = await trx
                .selectFrom("disk_blob")
                .select("size")
                .where("user_id", "=", userId)
                .where("sha256", "=", change.sha256)
                .executeTakeFirst();
              if (!blob) {
                result.refused.push({ id: change.id, reason: "missing_blob" });
                continue;
              }
              sha256 = change.sha256;
              size = Number(blob.size);
            } else {
              content = new Uint8Array(0);
            }
            if (result.used - liveSize + size > quota) {
              result.refused.push({ id: change.id, reason: "over_quota" });
              continue;
            }
          }

          const values = {
            parent_id: change.parentId,
            name: change.name,
            kind: change.kind,
            type: change.type ?? null,
            size,
            revision: change.revision,
            created_at: change.createdAt,
            modified_at: change.modifiedAt,
            role: change.role ?? null,
            attributes: change.attributes && Object.keys(change.attributes).length ? change.attributes : null,
            content,
            sha256,
            deleted: false,
          };
          await trx
            .insertInto("disk_node")
            .values({ user_id: userId, id: change.id, ...values })
            .onConflict((c) => c.columns(["user_id", "id"]).doUpdateSet({ ...values, seq: sql`nextval('disk_seq')` }))
            .execute();
          result.used += size - liveSize;
          result.applied.push({ id: change.id });
        }
        return result;
      });
    },

    async putBlob(userId, sha256, bytes) {
      if (!SHA256.test(sha256) || (await sha256Hex(bytes)) !== sha256) return "mismatch";
      if (bytes.byteLength > DISK_FILE_MAX) return "too_large";
      const existing = await db
        .selectFrom("disk_blob")
        .select("size")
        .where("user_id", "=", userId)
        .where("sha256", "=", sha256)
        .executeTakeFirst();
      if (existing) return "exists";
      // A blob counts once a file uses it; this only stops filling the Club with unused ones.
      if ((await usageIn(db, userId)) + bytes.byteLength > quota) return "over_quota";
      await db
        .insertInto("disk_blob")
        .values({ user_id: userId, sha256, size: bytes.byteLength, content: bytes })
        .onConflict((c) => c.columns(["user_id", "sha256"]).doNothing())
        .execute();
      return "stored";
    },

    async getBlob(userId, sha256) {
      if (!SHA256.test(sha256)) return null;
      const row = await db
        .selectFrom("disk_blob")
        .select("content")
        .where("user_id", "=", userId)
        .where("sha256", "=", sha256)
        .executeTakeFirst();
      return row ? new Uint8Array(row.content) : null;
    },
  };
}

let disk: Disk | null | undefined;

/** Members' disks on this deployment, or `null` without a database. */
export function clubDisk(): Disk | null {
  if (disk !== undefined) return disk;
  const dialect = databaseDialect();
  disk = dialect ? createDisk(dialect) : null;
  return disk;
}
