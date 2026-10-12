/**
 * Syncs a member's home disk with the Club (docs/club-storage-plan.md,
 * `packages/protocol/src/diskSync.ts`). Every node under the disk syncs;
 * the disk's own volume doesn't. The engine remembers, per node, the
 * revision it last agreed with the Club on (`base`): a node whose revision
 * differs has changed here and goes up; a node in `base` that's gone was
 * removed here. Pulling first, then pushing, keeps most changes from
 * meeting a newer one. When they do meet, the Club's version wins the
 * node, and a file changed here is kept beside it as "Name (site)".
 */
import { CURRENT_CATALOG_VERSION, type FileSystem, type FSNode, type NodeAttributes } from "@mockintosh/fs";
import {
  DISK_FILE_MAX,
  DISK_INLINE_MAX,
  NEWER_DISK_FORMAT,
  homeVolumeId,
  type DiskChange,
  type DiskChanges,
  type DiskPushResult,
  type SyncNode,
} from "@mockintosh/protocol";
import type { FetchRequest, FetchResponse } from "@mockintosh/sdk";

/** What the engine keeps between runs, on this Mac only. */
export interface SyncState {
  /** The Club's change number this Mac has seen up to. */
  cursor: number;
  /** Per node: the revision this Mac and the Club last agreed on. */
  base: Record<string, number>;
  /** Changes the Club refused for good (too large, over the quota), by the revision refused. */
  held?: Record<string, number>;
}

export interface SyncStore {
  load(): Promise<SyncState | null>;
  save(state: SyncState): Promise<void>;
}

export interface HomeSyncOptions {
  fs: FileSystem;
  /** The member's Club id: their disk is `homeVolumeId(member)`. */
  member: string;
  /** A request to the Club with the member's session. */
  request(path: string, init?: FetchRequest): Promise<FetchResponse>;
  store: SyncStore;
  /** What a conflict copy is named after: this Mac's site ("Report (mockintosh.com)"). */
  site: string;
  /** How long changes settle before they go up. */
  pushDelayMs?: number;
  /** How often to ask the Club for changes while running. */
  pollMs?: number;
  /** Something the member should hear about: the disk is full, a file too large, a newer Mockintosh wrote it. */
  onNotice?(message: string): void;
}

export interface HomeSync {
  /** Pull, then push; resolves when both are done (or failed). */
  syncNow(): Promise<void>;
  stop(): void;
  /** The disk's size and quota as of the last answer. */
  usage(): { used: number; quota: number } | null;
}

/** Changes per push request: a push of inline contents stays well under a request's 4.5 MB. */
const PUSH_BATCH = 100;
/** Rounds of pull and push in one sync, when a push was refused for a newer change. */
const MAX_ROUNDS = 3;

export class DiskSyncError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A node as the file system keeps it. */
function toFSNode(n: SyncNode): FSNode {
  const common = { id: n.id, name: n.name, parentId: n.parentId, createdAt: n.createdAt, modifiedAt: n.modifiedAt, revision: n.revision };
  const role = n.role ? { role: n.role as FSNode["role"] } : {};
  return n.kind === "file"
    ? { ...common, ...role, kind: "file", type: n.type ?? "application/octet-stream", size: n.size }
    : { ...common, ...role, kind: "directory" };
}

/** `name` with `(tag)` before its extension: "Report (mockintosh.com).txt". */
function taggedName(name: string, tag: string, isFile: boolean): string {
  const dot = isFile ? name.lastIndexOf(".") : -1;
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  return `${stem} (${tag})${ext}`;
}

export function startHomeSync(o: HomeSyncOptions): HomeSync {
  const root = homeVolumeId(o.member);
  let state: SyncState = { cursor: 0, base: {}, held: {} };
  const loaded = o.store.load().then((saved) => {
    if (saved) state = { cursor: saved.cursor, base: { ...saved.base }, held: { ...(saved.held ?? {}) } };
  });
  let usage: { used: number; quota: number } | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let readOnly = false;
  let ownWrites = 0;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const told = new Set<string>();

  const notice = (key: string, message: string) => {
    if (told.has(key)) return;
    told.add(key);
    o.onNotice?.(message);
  };

  /** Run the engine's own file-system changes without scheduling a push for them. */
  async function quietly<T>(work: () => Promise<T> | T): Promise<T> {
    ownWrites++;
    try {
      return await work();
    } finally {
      ownWrites--;
    }
  }

  async function save(): Promise<void> {
    await quietly(() => o.store.save(state));
  }

  async function call(path: string, init?: FetchRequest): Promise<FetchResponse> {
    const resp = await o.request(path, init);
    if (!resp.ok && resp.status !== 409) {
      const text = await resp.text().catch(() => "");
      throw new DiskSyncError(resp.status, `The Club answered ${resp.status}${text ? `: ${text}` : ""}`);
    }
    return resp;
  }

  /** Everything on the disk below its volume, folders before their contents. */
  function nodesOnDisk(): FSNode[] {
    const out: FSNode[] = [];
    const walk = (id: string) => {
      for (const child of o.fs.children(id)) {
        out.push(child);
        if (child.kind === "directory") walk(child.id);
      }
    };
    if (o.fs.directory(root)) walk(root);
    return out;
  }

  /** Keep this Mac's version of a file as a new file beside the node: it goes up as a file of its own. */
  async function keepCopy(local: FSNode): Promise<void> {
    if (local.kind !== "file" || !local.parentId) return;
    const bytes = (await o.fs.readBytes(local.id)) ?? new Uint8Array();
    const name = o.fs.availableName(local.parentId, taggedName(local.name, o.site, true));
    await o.fs.writeFile(local.parentId, name, bytes, { type: local.type, attributes: o.fs.attributes(local.id) });
  }

  async function contentsOf(n: SyncNode): Promise<Uint8Array | undefined> {
    if (n.kind !== "file") return undefined;
    if (n.content !== undefined) return fromBase64(n.content);
    if (!n.sha256) return new Uint8Array();
    const resp = await call(`/api/disk/blob?sha=${n.sha256}`);
    return new Uint8Array(await resp.arrayBuffer());
  }

  /** Take in one node from the Club. False when its folder isn't here yet. */
  async function applyOne(n: SyncNode): Promise<boolean> {
    const local = o.fs.node(n.id);
    const changedHere = local !== undefined && local.revision !== state.base[n.id];
    if (n.deleted) {
      if (local && o.fs.isWithin(local.id, root)) {
        if (changedHere) await keepCopy(local);
        await o.fs.remove(local.id);
      }
      delete state.base[n.id];
      return true;
    }
    // Nothing new at the Club: the version this Mac last agreed on (often its own push coming back).
    // A change made here since goes up in the push.
    if (state.base[n.id] === n.revision) return true;
    if (!o.fs.directory(n.parentId) || !o.fs.isWithin(n.parentId, root)) return false;
    if (local && changedHere) await keepCopy(local);
    // Another node of the same name here gets out of the way, and goes up under its new name.
    const clash = o.fs.child(n.parentId, n.name);
    if (clash && clash.id !== n.id) o.fs.rename(clash.id, o.fs.availableName(n.parentId, taggedName(clash.name, o.site, clash.kind === "file")));
    const content = await contentsOf(n);
    await o.fs.applyRemote(toFSNode(n), n.attributes as NodeAttributes | undefined, content);
    state.base[n.id] = n.revision;
    return true;
  }

  async function pull(): Promise<void> {
    for (;;) {
      const page = (await (await call(`/api/disk/changes?since=${state.cursor}`, { cache: "no-store" })).json()) as DiskChanges;
      usage = { used: page.used, quota: page.quota };
      await quietly(async () => {
        const waiting: SyncNode[] = [];
        for (const n of page.nodes) if (!(await applyOne(n))) waiting.push(n);
        // A folder may come later in the page than what's in it.
        for (const n of waiting) if (!(await applyOne(n))) console.warn(`Home disk: no folder for ${n.name}`);
      });
      if (page.cursor !== state.cursor || page.nodes.length) {
        state.cursor = page.cursor;
        await save();
      }
      if (!page.more) return;
    }
  }

  /** A node as it goes up, its larger contents uploaded first. `null`: it can't go (too large). */
  async function changeFor(node: FSNode): Promise<DiskChange | null> {
    const attributes = o.fs.attributes(node.id);
    const change: DiskChange = {
      id: node.id,
      parentId: node.parentId!,
      name: node.name,
      kind: node.kind,
      size: node.kind === "file" ? node.size : 0,
      revision: node.revision,
      baseRevision: state.base[node.id] ?? 0,
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
      ...(node.role && { role: node.role }),
      ...(Object.keys(attributes).length && { attributes: attributes as Record<string, unknown> }),
    };
    if (node.kind !== "file") return change;
    change.type = node.type;
    if (node.size > DISK_FILE_MAX) {
      hold(node, `"${node.name}" is too large to keep on your disk at the Club (the most is ${DISK_FILE_MAX / 1024 / 1024} MB), so it stays on this Mac.`);
      return null;
    }
    const bytes = (await o.fs.readBytes(node.id)) ?? new Uint8Array();
    if (bytes.byteLength <= DISK_INLINE_MAX) {
      change.content = toBase64(bytes);
      return change;
    }
    const sha = await sha256Hex(bytes);
    const resp = await call(`/api/disk/blob?sha=${sha}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    }).catch((error: unknown) => {
      if (error instanceof DiskSyncError && error.status === 413) return null;
      throw error;
    });
    if (!resp) {
      hold(node, "Your disk at the Club is full, so new files stay on this Mac.");
      return null;
    }
    change.sha256 = sha;
    change.size = bytes.byteLength;
    return change;
  }

  function hold(node: FSNode, message: string): void {
    (state.held ??= {})[node.id] = node.revision;
    notice(message, message);
  }

  async function push(): Promise<void> {
    const changes: DiskChange[] = [];
    const here = new Set<string>();
    for (const node of nodesOnDisk()) {
      here.add(node.id);
      if (state.base[node.id] === node.revision || state.held?.[node.id] === node.revision) continue;
      const change = await changeFor(node);
      if (change) changes.push(change);
    }
    for (const [id, revision] of Object.entries(state.base)) {
      if (here.has(id)) continue;
      changes.push({ id, parentId: root, name: "", kind: "file", size: 0, revision, baseRevision: revision, createdAt: 0, modifiedAt: 0, deleted: true });
    }
    if (!changes.length) return;

    for (let i = 0; i < changes.length; i += PUSH_BATCH) {
      const batch = changes.slice(i, i + PUSH_BATCH);
      const resp = await call("/api/disk/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: CURRENT_CATALOG_VERSION, changes: batch }),
      });
      if (resp.status === 409) {
        const body = (await resp.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === NEWER_DISK_FORMAT) {
          readOnly = true;
          notice(NEWER_DISK_FORMAT, "Your disk was changed by a newer Mockintosh. Reload this page to keep it in step; until then, changes made here stay on this Mac.");
          return;
        }
        throw new DiskSyncError(409, "The Club refused the changes");
      }
      const result = (await resp.json()) as DiskPushResult;
      usage = { used: result.used, quota: result.quota };
      const byId = new Map(batch.map((c) => [c.id, c]));
      for (const { id } of result.applied) {
        const change = byId.get(id)!;
        if (change.deleted) delete state.base[id];
        else state.base[id] = change.revision;
      }
      for (const refusal of result.refused) {
        const node = o.fs.node(refusal.id);
        if (refusal.reason === "over_quota" && node) hold(node, "Your disk at the Club is full, so new files stay on this Mac.");
        else if (refusal.reason === "too_large" && node) hold(node, `"${node.name}" is too large to keep on your disk at the Club, so it stays on this Mac.`);
        // A newer change at the Club, or a folder that didn't make it: pull and try again.
        else again = true;
      }
      await save();
    }
  }

  function syncNow(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      await loaded;
      let rounds = 0;
      do {
        again = false;
        await pull();
        if (!readOnly) await push();
      } while (again && !stopped && ++rounds < MAX_ROUNDS);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function schedulePush(): void {
    if (stopped || readOnly) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void syncNow().catch((error) => console.warn("Home disk sync:", error)), o.pushDelayMs ?? 20_000);
  }

  const unsubscribe = o.fs.subscribe(() => {
    if (ownWrites === 0) schedulePush();
  });
  const poll = setInterval(() => void syncNow().catch((error) => console.warn("Home disk sync:", error)), o.pollMs ?? 60_000);

  return {
    syncNow,
    usage: () => usage,
    stop() {
      stopped = true;
      clearTimeout(pushTimer);
      clearInterval(poll);
      unsubscribe();
    },
  };
}
