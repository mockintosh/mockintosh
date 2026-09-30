/**
 * FileSystem — the reactive catalog plus content access.
 *
 * Reads are Solid-store reads: call them inside a memo/effect and the caller
 * re-runs when exactly the nodes it touched change (a rename in one folder
 * doesn't invalidate the desktop). Mutations are the only writers; each one
 * updates the catalog, the per-directory child index and the debounced
 * persistence in one place.
 *
 * Durability ordering: a file body is written to the backend *before* its
 * catalog entry appears, and a catalog entry is removed *before* its body is
 * deleted — so a crash can leave an orphan blob (harmless) but never a
 * dangling entry.
 */
import { createStore, flush, getObserver, runWithOwner, snapshot, type StoreSetter } from "solid-js";
import type { FSBackend } from "./backend";
import { CURRENT_CATALOG_VERSION, emptyCatalog, parseCatalog, type CatalogDocument } from "./catalogDocument";
import { FSError } from "./errors";
import { inferMimeType } from "./mime";
import {
  ROOT_ID,
  type AttributeValue,
  type FSDirectory,
  type FSFile,
  type FSNode,
  type FileContent,
  type NodeAttributes,
  type NodeId,
  type NodeRole,
  type WriteFileOptions,
} from "./types";

export interface FileSystemOptions {
  backend: FSBackend;
  /** Debounce for catalog persistence. Default 500 ms; 0 persists on the next tick. */
  persistDelayMs?: number;
  now?: () => number;
  generateId?: () => NodeId;
}

export interface MkdirOptions {
  role?: NodeRole;
  /**
   * Create the folder with this id. An app process answers `mkdir` before the
   * OS has run it, so it chooses the id the app already holds.
   */
  id?: NodeId;
}

interface CatalogState {
  nodes: Record<NodeId, FSNode>;
  attributes: Record<NodeId, NodeAttributes>;
  /** Unsorted child ids per directory — the reactive index behind `children()`. */
  childIds: Record<NodeId, NodeId[]>;
  /** `roleKey(volumeId, role)` → directory id — the index behind `locate()`. */
  roles: Record<string, NodeId>;
}

function roleKey(volumeId: NodeId, role: NodeRole): string {
  return `${volumeId}/${role}`;
}

let catalogFlushing = false;

/** The volume containing `id` (or `id` itself when it is a volume), from a plain node map. */
function volumeIdOf(nodes: Record<NodeId, FSNode>, id: NodeId): NodeId | undefined {
  let current = nodes[id];
  while (current && current.parentId !== null) {
    if (current.parentId === ROOT_ID) return current.id;
    current = nodes[current.parentId];
  }
  return undefined;
}

function indexRole(s: CatalogState, id: NodeId): void {
  const n = s.nodes[id];
  if (!n || !n.role || n.role === "root" || n.role === "volume") return;
  const vol = volumeIdOf(s.nodes, id);
  if (vol) s.roles[roleKey(vol, n.role)] = id;
}

function unindexRole(s: CatalogState, id: NodeId): void {
  for (const [key, nodeId] of Object.entries(s.roles)) {
    if (nodeId === id) delete s.roles[key];
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function defaultGenerateId(): NodeId {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function assertValidName(name: string): void {
  if (!name || name.includes("/") || name === "." || name === "..") {
    throw new FSError("invalid-name", `Invalid file name: "${name}"`);
  }
}

export class FileSystem {
  private readonly backend: FSBackend;
  private readonly persistDelayMs: number;
  private readonly now: () => number;
  private readonly generateId: () => NodeId;

  private state: CatalogState;
  private setState: StoreSetter<CatalogState>;

  private catalogDirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistInFlight: Promise<void> | null = null;
  private batchDepth = 0;
  private listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private writes: Promise<unknown> = Promise.resolve();
  private locked = new Set<NodeId>();

  private constructor(options: FileSystemOptions, doc: CatalogDocument) {
    this.backend = options.backend;
    this.persistDelayMs = options.persistDelayMs ?? 500;
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? defaultGenerateId;

    const childIds: Record<NodeId, NodeId[]> = {};
    for (const n of Object.values(doc.nodes)) {
      if (n.kind === "directory") childIds[n.id] ??= [];
      if (n.parentId !== null) (childIds[n.parentId] ??= []).push(n.id);
    }
    const initial: CatalogState = { nodes: doc.nodes, attributes: doc.attributes, childIds, roles: {} };
    for (const n of Object.values(doc.nodes)) indexRole(initial, n.id);

    const [state, setState] = createStore<CatalogState>(initial);
    this.state = state;
    this.setState = setState;
  }

  /** Initialise the backend, load and migrate the catalog. */
  static async open(options: FileSystemOptions): Promise<FileSystem> {
    await options.backend.init();
    const raw = await options.backend.readCatalog();
    const now = (options.now ?? Date.now)();
    const doc = parseCatalog(raw, now);
    const fs = new FileSystem(options, doc);
    // Persist immediately if we migrated or created the catalog so the next
    // boot reads the current shape.
    if (raw === null || !raw.includes(`"version":${CURRENT_CATALOG_VERSION}`)) {
      fs.markDirty();
    }
    return fs;
  }

  // =========================================================================
  // Reads (reactive)
  // =========================================================================

  node(id: NodeId): FSNode | undefined {
    return this.state.nodes[id];
  }

  file(id: NodeId): FSFile | undefined {
    const n = this.state.nodes[id];
    return n?.kind === "file" ? n : undefined;
  }

  directory(id: NodeId): FSDirectory | undefined {
    const n = this.state.nodes[id];
    return n?.kind === "directory" ? n : undefined;
  }

  exists(id: NodeId): boolean {
    return this.state.nodes[id] !== undefined;
  }

  /** Children of a directory: folders first, then files, each A→Z. */
  children(dirId: NodeId): FSNode[] {
    const ids = this.state.childIds[dirId];
    if (!ids) return [];
    const out: FSNode[] = [];
    for (const id of ids) {
      const n = this.state.nodes[id];
      if (n) out.push(n);
    }
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  childCount(dirId: NodeId): number {
    return this.state.childIds[dirId]?.length ?? 0;
  }

  child(dirId: NodeId, name: string): FSNode | undefined {
    const ids = this.state.childIds[dirId];
    if (!ids) return undefined;
    for (const id of ids) {
      const n = this.state.nodes[id];
      if (n && n.name === name) return n;
    }
    return undefined;
  }

  /**
   * `name` if unused in the directory, else the first free of `name 2`,
   * `name 3`, … (the extension, if any, stays at the end).
   */
  availableName(dirId: NodeId, name: string): string {
    if (!this.child(dirId, name)) return name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 2; ; i++) {
      const candidate = `${stem} ${i}${ext}`;
      if (!this.child(dirId, candidate)) return candidate;
    }
  }

  /** Resolve an absolute path like `/Mockintosh HD/Desktop Folder`. */
  resolve(path: string): FSNode | undefined {
    let current: FSNode | undefined = this.state.nodes[ROOT_ID];
    for (const part of path.split("/").filter(Boolean)) {
      if (!current || current.kind !== "directory") return undefined;
      current = this.child(current.id, part);
    }
    return current;
  }

  /** Absolute path of a node; the root is `/`. */
  pathOf(id: NodeId): string {
    const parts: string[] = [];
    let current = this.state.nodes[id];
    while (current && current.parentId !== null) {
      parts.unshift(current.name);
      current = this.state.nodes[current.parentId];
    }
    return "/" + parts.join("/");
  }

  /** Whether `ancestorId` is `id` or one of its ancestors. */
  isWithin(id: NodeId, ancestorId: NodeId): boolean {
    let current = this.state.nodes[id];
    while (current) {
      if (current.id === ancestorId) return true;
      if (current.parentId === null) return false;
      current = this.state.nodes[current.parentId];
    }
    return false;
  }

  volumes(): FSDirectory[] {
    return this.children(ROOT_ID).filter((n): n is FSDirectory => n.kind === "directory");
  }

  /**
   * Find the directory with a well-known role. Searches the given volume, or
   * every volume in order when omitted.
   */
  locate(role: NodeRole, volumeId?: NodeId): FSDirectory | undefined {
    if (role === "root") return this.directory(ROOT_ID);
    if (role === "volume") {
      return volumeId ? this.directory(volumeId) : this.volumes()[0];
    }
    const volumes = volumeId ? [volumeId] : this.volumes().map((v) => v.id);
    for (const vid of volumes) {
      const id = this.state.roles[roleKey(vid, role)];
      if (id) return this.directory(id);
    }
    return undefined;
  }

  /** The volume a node lives on (itself, if it is a volume). */
  volumeOf(id: NodeId): FSDirectory | undefined {
    const vid = volumeIdOf(this.state.nodes, id);
    return vid ? this.directory(vid) : undefined;
  }

  attributes(id: NodeId): NodeAttributes {
    return this.state.attributes[id] ?? EMPTY_ATTRIBUTES;
  }

  // =========================================================================
  // Content
  // =========================================================================

  async readBytes(id: NodeId): Promise<Uint8Array | null> {
    const n = this.state.nodes[id];
    if (!n || n.kind !== "file") return null;
    return this.backend.readBlob(id);
  }

  async readText(id: NodeId): Promise<string | null> {
    const bytes = await this.readBytes(id);
    return bytes === null ? null : textDecoder.decode(bytes);
  }

  async readJSON<T>(id: NodeId): Promise<T | null> {
    const text = await this.readText(id);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  // =========================================================================
  // Mutations
  // =========================================================================

  mkdir(parentId: NodeId, name: string, options: MkdirOptions = {}): FSDirectory {
    assertValidName(name);
    const parent = this.requireDirectory(parentId);
    const existing = this.child(parent.id, name);
    if (existing) {
      if (existing.kind === "directory") return this.adoptRole(existing, options.role);
      throw new FSError("exists", `A file named "${name}" already exists`);
    }
    if (options.id !== undefined && this.state.nodes[options.id]) {
      throw new FSError("exists", `Node ${options.id} already exists`);
    }
    const now = this.now();
    const dir: FSDirectory = {
      id: options.id ?? this.generateId(),
      name,
      kind: "directory",
      parentId: parent.id,
      createdAt: now,
      modifiedAt: now,
      revision: 1,
    };
    if (options.role) {
      if (options.role === "root") throw new FSError("invalid-name", "Only the root has the root role");
      if (options.role === "volume" && parent.id !== ROOT_ID) {
        throw new FSError("invalid-move", "Volumes must be created at the root");
      }
      const vol = options.role === "volume" ? undefined : volumeIdOf(this.state.nodes, parent.id);
      if (vol && this.state.roles[roleKey(vol, options.role)]) {
        throw new FSError("exists", `This volume already has a "${options.role}" folder`);
      }
      dir.role = options.role;
    }
    this.commit((s) => {
      s.nodes[dir.id] = dir;
      s.childIds[dir.id] = [];
      s.childIds[parent.id].push(dir.id);
      indexRole(s, dir.id);
      touch(s, parent.id, now);
    });
    return (this.state.nodes[dir.id] as FSDirectory | undefined) ?? dir;
  }

  /**
   * A plain folder that already has a role folder's name (a user-made
   * "Fonts" from before the OS knew the role) becomes that role folder,
   * so the OS finds what the user put in it.
   */
  private adoptRole(dir: FSDirectory, role: NodeRole | undefined): FSDirectory {
    if (!role || dir.role || role === "root" || role === "volume") return dir;
    const vol = volumeIdOf(this.state.nodes, dir.id);
    if (!vol || this.state.roles[roleKey(vol, role)]) return dir;
    this.commit((s) => {
      s.nodes[dir.id]!.role = role;
      indexRole(s, dir.id);
    });
    return (this.state.nodes[dir.id] as FSDirectory | undefined) ?? dir;
  }

  /**
   * Create or overwrite a file. Overwriting keeps the node id (and therefore
   * open windows, attributes and shortcuts pointing at it).
   */
  async writeFile(
    parentId: NodeId,
    name: string,
    content: FileContent,
    options: WriteFileOptions = {}
  ): Promise<FSFile> {
    const bytes = typeof content === "string" ? textEncoder.encode(content) : content.slice();
    const run = this.writes.then(() => this.writeFileLocked(parentId, name, bytes, options));
    this.writes = run.catch(() => {});
    return run;
  }

  private async writeFileLocked(parentId: NodeId, name: string, content: FileContent, options: WriteFileOptions): Promise<FSFile> {
    assertValidName(name);
    const parent = this.requireDirectory(parentId);
    const found = this.child(parent.id, name);
    if (found && found.kind !== "file") {
      throw new FSError("exists", `A folder named "${name}" already exists`);
    }
    const existing = found as FSFile | undefined;
    if (options.expectedRevision !== undefined && options.expectedRevision !== (existing?.revision ?? 0)) {
      throw new FSError("conflict", "Resource revision changed");
    }
    const bytes = typeof content === "string" ? textEncoder.encode(content) : content;
    const id = existing?.id ?? this.generateId();
    const now = this.now();
    const file: FSFile = {
      id,
      name,
      kind: "file",
      parentId: parent.id,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
      type: options.type ?? existing?.type ?? inferMimeType(name),
      size: bytes.byteLength,
    };
    if (existing?.role) file.role = existing.role;

    this.locked.add(parentId);
    this.locked.add(id);
    try {
      await this.backend.writeBlob(id, bytes);
    } finally {
      this.locked.delete(parentId);
      this.locked.delete(id);
    }

    this.commit((s) => {
      s.nodes[id] = file;
      if (!existing) s.childIds[parent.id].push(id);
      if (options.attributes) mergeAttributes(s, id, options.attributes);
      touch(s, parent.id, now);
    });
    return (this.state.nodes[id] as FSFile | undefined) ?? file;
  }

  writeJSON(parentId: NodeId, name: string, value: unknown, options: WriteFileOptions = {}): Promise<FSFile> {
    return this.writeFile(parentId, name, JSON.stringify(value), options);
  }

  rename(id: NodeId, name: string): void {
    assertValidName(name);
    const node = this.requireMutable(id);
    if (node.name === name) return;
    const clash = this.child(node.parentId!, name);
    if (clash && clash.id !== id) {
      throw new FSError("exists", `"${name}" already exists in this folder`);
    }
    const now = this.now();
    // Only infer a new type when the old one was also inferred from the name.
    const typeWasInferred = node.kind === "file" && (node as FSFile).type === inferMimeType(node.name);
    const parentId = node.parentId!;
    this.commit((s) => {
      const n = s.nodes[id];
      n.name = name;
      n.modifiedAt = now;
      n.revision++;
      if (n.kind === "file" && typeWasInferred) n.type = inferMimeType(name);
      touch(s, parentId, now);
    });
  }

  move(id: NodeId, newParentId: NodeId): void {
    const node = this.requireMutable(id);
    const target = this.requireDirectory(newParentId);
    if (node.parentId === target.id) return;
    if (this.isWithin(target.id, id)) {
      throw new FSError("invalid-move", "Cannot move a folder into itself");
    }
    if (this.child(target.id, node.name)) {
      throw new FSError("exists", `"${node.name}" already exists in the destination`);
    }
    if (node.role === "volume" || target.id === ROOT_ID) {
      throw new FSError("invalid-move", "Volumes cannot be moved and only volumes live at the root");
    }
    const oldParentId = node.parentId!;
    const now = this.now();
    const subtree = this.collectSubtree(id);
    this.commit((s) => {
      s.childIds[oldParentId] = s.childIds[oldParentId].filter((c) => c !== id);
      s.childIds[target.id].push(id);
      s.nodes[id].parentId = target.id;
      s.nodes[id].modifiedAt = now;
      s.nodes[id].revision++;
      // Roles are per volume; re-index in case the move crossed volumes.
      for (const d of subtree) {
        unindexRole(s, d);
        indexRole(s, d);
      }
      touch(s, oldParentId, now);
      touch(s, target.id, now);
    });
  }

  /** Remove a node and, for directories, everything beneath it. */
  async remove(id: NodeId): Promise<void> {
    const node = this.requireMutable(id);
    const doomed = this.collectSubtree(id);
    const fileIds = doomed.filter((d) => this.state.nodes[d]?.kind === "file");
    const now = this.now();

    this.commit((s) => {
      s.childIds[node.parentId!] = s.childIds[node.parentId!].filter((c) => c !== id);
      for (const d of doomed) {
        unindexRole(s, d);
        delete s.nodes[d];
        delete s.attributes[d];
        delete s.childIds[d];
      }
      touch(s, node.parentId!, now);
    });

    // Catalog first, blobs second (see module comment).
    await this.flush();
    await Promise.all(fileIds.map((f) => this.backend.deleteBlob(f)));
  }

  /**
   * Merge attributes into a node's bag. A `null` value deletes the key.
   * Attributes are consumer-owned metadata (see `NodeAttributes`).
   */
  setAttributes(id: NodeId, patch: NodeAttributes): void {
    if (!this.state.nodes[id]) throw new FSError("not-found", `No such node: ${id}`);
    this.assertUnlocked(id);
    this.commit((s) => { mergeAttributes(s, id, patch); touch(s, id, this.now()); });
  }

  /**
   * Run several mutations as one unit: listeners see a single reactive update
   * and the catalog is persisted once.
   */
  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.catalogDirty) this.schedulePersist();
    }
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  /**
   * Format the disk: empty catalog, no blobs. The next `bootstrapFileSystem`
   * sees a first-boot volume.
   */
  async erase(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persistInFlight) {
      try { await this.persistInFlight; } catch { /* wipe anyway */ }
    }
    await this.backend.clear();
    const empty = emptyCatalog(this.now());
    this.commit((s) => {
      for (const id of Object.keys(s.nodes)) {
        if (id !== ROOT_ID) delete s.nodes[id];
      }
      s.nodes[ROOT_ID] = empty.nodes[ROOT_ID]!;
      for (const id of Object.keys(s.attributes)) delete s.attributes[id];
      for (const id of Object.keys(s.childIds)) {
        if (id !== ROOT_ID) delete s.childIds[id];
      }
      s.childIds[ROOT_ID] = [];
      for (const key of Object.keys(s.roles)) delete s.roles[key];
    });
    await this.flush();
  }

  /** Write the catalog now if it has unsaved changes. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persistInFlight) await this.persistInFlight;
    if (this.catalogDirty) await this.persistNow();
  }

  /** Serialised catalog — what `flush()` writes. */
  toJSON(): CatalogDocument {
    const s = snapshot(this.state);
    return { version: CURRENT_CATALOG_VERSION, nodes: s.nodes, attributes: s.attributes };
  }

  private commit(mutate: (s: CatalogState) => void): void {
    const inEffect = !!getObserver();
    runWithOwner(null, () => {
      this.setState(mutate);
      // Store writes are staged until the microtask; the catalog API is
      // synchronous (mkdir returns the new node; the next call reads it).
      // Inside an effect apply, flush() is already running — don't reenter it.
      if (!inEffect && !catalogFlushing) {
        catalogFlushing = true;
        try {
          flush();
        } finally {
          catalogFlushing = false;
        }
      }
    });
    this.markDirty();
    for (const listener of this.listeners) listener();
  }

  private markDirty(): void {
    this.catalogDirty = true;
    if (this.batchDepth === 0) this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow().catch(error => console.error("FileSystem: failed to persist catalog", error));
    }, this.persistDelayMs);
  }

  private persistNow(): Promise<void> {
    if (this.persistInFlight) return this.persistInFlight;
    this.catalogDirty = false;
    const json = JSON.stringify(this.toJSON());
    let failed = false;
    this.persistInFlight = this.backend
      .writeCatalog(json)
      .catch((err) => {
        failed = true;
        this.catalogDirty = true;
        throw err;
      })
      .finally(() => {
        this.persistInFlight = null;
        if (this.catalogDirty && !failed) this.schedulePersist();

      });
    return this.persistInFlight;
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private assertUnlocked(id: NodeId): void {
    if ([...this.locked].some((locked) => this.isWithin(locked, id))) {
      throw new FSError("conflict", "A content write is in progress");
    }
  }

  private requireDirectory(id: NodeId): FSDirectory {
    this.assertUnlocked(id);
    const n = this.state.nodes[id];
    if (!n) throw new FSError("not-found", `No such directory: ${id}`);
    if (n.kind !== "directory") throw new FSError("not-a-directory", `"${n.name}" is not a folder`);
    return n;
  }

  private requireMutable(id: NodeId): FSNode {
    this.assertUnlocked(id);
    const n = this.state.nodes[id];
    if (!n) throw new FSError("not-found", `No such node: ${id}`);
    if (n.parentId === null) throw new FSError("immutable", "The root cannot be changed");
    return n;
  }

  private collectSubtree(id: NodeId): NodeId[] {
    const out: NodeId[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      for (const c of this.state.childIds[cur] ?? []) stack.push(c);
    }
    return out;
  }
}

const EMPTY_ATTRIBUTES: NodeAttributes = Object.freeze({});

function touch(s: CatalogState, dirId: NodeId, now: number): void {
  const d = s.nodes[dirId];
  if (d) { d.modifiedAt = now; d.revision++; }
}

function mergeAttributes(s: CatalogState, id: NodeId, patch: NodeAttributes): void {
  const current: Record<string, AttributeValue> = { ...(s.attributes[id] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete current[key];
    else current[key] = value;
  }
  if (Object.keys(current).length === 0) delete s.attributes[id];
  else s.attributes[id] = current;
}
