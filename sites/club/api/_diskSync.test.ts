/**
 * Two Macintoshes keeping one member's home disk in step through the Club:
 * the Mac's sync engine (`src/os/homeSync.ts`) against the Club's disk
 * (`api/_disk.ts`) on an in-memory database, without the HTTP layer.
 */
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend } from "@mockintosh/fs";
import type { FetchRequest, FetchResponse } from "@mockintosh/sdk";
import { NEWER_DISK_FORMAT } from "../../../packages/protocol/src/diskSync";
import type { ClubMember } from "../../../src/platform/types";
import { bootstrapFileSystem } from "../../../src/os/fsBootstrap";
import { mountHomeDisk } from "../../../src/os/home";
import { startHomeSync, type HomeSync, type SyncState } from "../../../src/os/homeSync";
import { migrate } from "../db/migrate";
import { createDisk, type Disk } from "./_disk";

let disk: Disk;
let db: Kysely<any>;
let members = 0;
const running: HomeSync[] = [];

beforeAll(async () => {
  const dialect = new PGliteDialect(new PGlite());
  await migrate(dialect);
  db = new Kysely({ dialect });
  disk = createDisk(dialect);
}, 30_000);

afterEach(() => {
  for (const sync of running.splice(0)) sync.stop();
});

async function newMember(): Promise<ClubMember> {
  const id = `member-${++members}`;
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, ${id}, ${`${id}@example.com`}, true)`.execute(db);
  return { id, name: "Ada", username: "Ada", email: `${id}@example.com`, since: 0 };
}

function respond(body: unknown, status = 200): FetchResponse {
  return new Response(body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body), { status });
}

/** The Club's disk routes, answered in-process for `member`. */
function clubFor(member: ClubMember) {
  return async (path: string, init: FetchRequest = {}): Promise<FetchResponse> => {
    const url = new URL(path, "http://club.test");
    if (url.pathname === "/api/disk/changes") return respond(await disk.changes(member.id, Number(url.searchParams.get("since"))));
    if (url.pathname === "/api/disk/push") {
      const result = await disk.push(member.id, JSON.parse(init.body as string));
      return result === NEWER_DISK_FORMAT ? respond({ code: NEWER_DISK_FORMAT }, 409) : respond(result);
    }
    if (url.pathname === "/api/disk/blob") {
      const sha = url.searchParams.get("sha")!;
      if (init.method === "PUT") return respond(null, (await disk.putBlob(member.id, sha, init.body as Uint8Array)) === "stored" ? 201 : 204);
      const bytes = await disk.getBlob(member.id, sha);
      return bytes ? respond(bytes) : respond({}, 404);
    }
    return respond({}, 404);
  };
}

/** A Macintosh signed in as `member`, its disk mounted and syncing (by hand: `sync.syncNow()`). */
async function mac(member: ClubMember, site: string) {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  const { volume } = mountHomeDisk(fs, member);
  let saved: SyncState | null = null;
  const notices: string[] = [];
  const sync = startHomeSync({
    fs,
    member: member.id,
    request: clubFor(member),
    store: { load: async () => saved, save: async (state) => void (saved = structuredClone(state)) },
    site,
    pushDelayMs: 60 * 60 * 1000,
    pollMs: 60 * 60 * 1000,
    onNotice: (message) => void notices.push(message),
  });
  running.push(sync);
  const desktop = () => fs.locate("desktop", volume.id)!;
  const names = () => fs.children(desktop().id).map((n) => n.name).sort();
  return { fs, sync, desktop, names, notices };
}

describe("a home disk on two Macs", () => {
  it("carries a file from one Mac to the other, then an edit back", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    const b = await mac(ada, "b.example");

    const note = await a.fs.writeFile(a.desktop().id, "Note", "from A", { attributes: { position: { x: 40, y: 60 } } });
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.names()).toEqual(["Note"]);
    expect(await b.fs.readText(note.id)).toBe("from A");
    expect(b.fs.attributes(note.id).position).toEqual({ x: 40, y: 60 });

    await b.fs.writeFile(b.desktop().id, "Note", "edited on B");
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(await a.fs.readText(note.id)).toBe("edited on B");
  });

  it("keeps both versions of a file changed on both Macs", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    const b = await mac(ada, "b.example");
    const note = await a.fs.writeFile(a.desktop().id, "Report", "first");
    await a.sync.syncNow();
    await b.sync.syncNow();

    await a.fs.writeFile(a.desktop().id, "Report", "A's change");
    await b.fs.writeFile(b.desktop().id, "Report", "B's change");
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();

    for (const m of [a, b]) {
      expect(m.names()).toEqual(["Report", "Report (b.example)"]);
      expect(await m.fs.readText(note.id)).toBe("A's change");
      const copy = m.fs.child(m.desktop().id, "Report (b.example)")!;
      expect(await m.fs.readText(copy.id)).toBe("B's change");
    }
  });

  it("removes what was removed on the other Mac, folders and all", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    const b = await mac(ada, "b.example");
    const folder = a.fs.mkdir(a.desktop().id, "Old Things");
    await a.fs.writeFile(folder.id, "Letter", "dear");
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.names()).toEqual(["Old Things"]);

    await a.fs.remove(folder.id);
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.names()).toEqual([]);
    expect(await disk.usage(ada.id)).toBe(0);
  });

  it("moves and renames like the other Mac did", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    const b = await mac(ada, "b.example");
    const folder = a.fs.mkdir(a.desktop().id, "Drafts");
    const note = await a.fs.writeFile(a.desktop().id, "Idea", "…");
    await a.sync.syncNow();
    await b.sync.syncNow();

    a.fs.move(note.id, folder.id);
    a.fs.rename(note.id, "Big Idea");
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.fs.node(note.id)).toMatchObject({ name: "Big Idea", parentId: folder.id });
    expect(b.names()).toEqual(["Drafts"]);
  });

  it("sends larger files by their contents' hash", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    const b = await mac(ada, "b.example");
    const bytes = new Uint8Array(40_000).map((_, i) => i % 251);
    const picture = await a.fs.writeFile(a.fs.locate("pictures", `${ada.id}.home`)!.id, "Sunset", bytes);
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(await b.fs.readBytes(picture.id)).toEqual(bytes);
  });

  it("names a file the same as one on the other Mac apart from it", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    const b = await mac(ada, "b.example");
    await a.fs.writeFile(a.desktop().id, "Untitled", "A's");
    await b.fs.writeFile(b.desktop().id, "Untitled", "B's");
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(a.names()).toEqual(["Untitled", "Untitled (b.example)"]);
    expect(b.names()).toEqual(["Untitled", "Untitled (b.example)"]);
  });

  it("keeps a file changed here that the other Mac removed", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    const b = await mac(ada, "b.example");
    const note = await a.fs.writeFile(a.desktop().id, "Note", "first");
    await a.sync.syncNow();
    await b.sync.syncNow();

    await a.fs.remove(note.id);
    await b.fs.writeFile(b.desktop().id, "Note", "B kept writing");
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    for (const m of [a, b]) {
      expect(m.names()).toEqual(["Note (b.example)"]);
      expect(await m.fs.readText(m.fs.child(m.desktop().id, "Note (b.example)")!.id)).toBe("B kept writing");
    }
  });

  it("takes in the other Mac's disk on a first sync, keeping its own files", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    await a.fs.writeFile(a.desktop().id, "Theirs", "A");
    await a.sync.syncNow();
    const b = await mac(ada, "b.example");
    await b.fs.writeFile(b.desktop().id, "Mine", "B");
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(a.names()).toEqual(["Mine", "Theirs"]);
    expect(b.names()).toEqual(["Mine", "Theirs"]);
  });

  it("stops writing a disk a newer Mockintosh wrote, and says so once", async () => {
    const ada = await newMember();
    const a = await mac(ada, "a.example");
    await disk.push(ada.id, { format: 999, changes: [] });
    await a.fs.writeFile(a.desktop().id, "Note", "stays here");
    await a.sync.syncNow();
    await a.fs.writeFile(a.desktop().id, "Note", "still here");
    await a.sync.syncNow();
    expect(a.notices).toHaveLength(1);
    expect((await disk.changes(ada.id, 0)).nodes).toEqual([]);
  });
});
