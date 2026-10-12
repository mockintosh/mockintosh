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
import { assertNewNameFits, availableChildName, fitName, fitNameWithSuffix } from "./names";
import type { VolumeImage, VolumeImageEntry } from "./volumeImage";
import { mountedVolumes, roleSearchOrder } from "./volumes";
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
  /** Nodes of mounted images: shown, never persisted. */
  private mountedIds = new Set<NodeId>();
  /** A mounted file's body, read from its image. */
  private mountedBodies = new Map<NodeId, () => Promise<Uint8Array>>();

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
    const n = this.state.nodes[id];
    return n && !this.isEjected(id) ? n : undefined;
  }

  file(id: NodeId): FSFile | undefined {
    const n = this.node(id);
    return n?.kind === "file" ? n : undefined;
  }

  directory(id: NodeId): FSDirectory | undefined {
    const n = this.node(id);
    return n?.kind === "directory" ? n : undefined;
  }

  exists(id: NodeId): boolean {
    return this.node(id) !== undefined;
  }

  /** Children of a directory: folders first, then files, each A→Z. */
  children(dirId: NodeId): FSNode[] {
    const ids = this.state.childIds[dirId];
    if (!ids || this.isEjected(dirId)) return [];
    const out: FSNode[] = [];
    for (const id of ids) {
      const n = this.state.nodes[id];
      if (n && !(n.parentId === ROOT_ID && (n as FSDirectory).ejected)) out.push(n);
    }
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  childCount(dirId: NodeId): number {
    if (dirId === ROOT_ID) return this.volumes().length;
    return this.isEjected(dirId) ? 0 : (this.state.childIds[dirId]?.length ?? 0);
  }

  child(dirId: NodeId, name: string): FSNode | undefined {
    const ids = this.state.childIds[dirId];
    if (!ids || this.isEjected(dirId)) return undefined;
    for (const id of ids) {
      const n = this.state.nodes[id];
      if (n && n.name === name && !(n.parentId === ROOT_ID && (n as FSDirectory).ejected)) return n;
    }
    return undefined;
  }

  /**
   * `name` if unused in the directory, else the first free of `name 2`,
   * `name 3`, … (the extension, if any, stays at the end). A name longer than
   * {@link MAX_NAME_LENGTH} is shortened to fit, number and all.
   */
  availableName(dirId: NodeId, name: string): string {
    return availableChildName(this, dirId, name);
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

  /** Mounted volumes: the startup disk first, then any home disk, then mounted locked ones. */
  volumes(): FSDirectory[] {
    return mountedVolumes(this.children(ROOT_ID).filter((n): n is FSDirectory => n.kind === "directory"));
  }

  /** Whether `id` is on a locked disk, where nothing can change. */
  isLocked(id: NodeId): boolean {
    return !!this.volumeOf(id)?.locked;
  }

  /**
   * Find the directory with a well-known role. Searches the given volume, or
   * every mounted volume when omitted: a home disk first (so new files go to
   * the member's disk), then the startup disk. `volume` without an id is the
   * startup disk.
   */
  locate(role: NodeRole, volumeId?: NodeId): FSDirectory | undefined {
    if (role === "root") return this.directory(ROOT_ID);
    if (role === "volume") {
      return volumeId ? this.directory(volumeId) : this.volumes()[0];
    }
    const volumes = volumeId ? [volumeId] : roleSearchOrder(this.volumes()).map((v) => v.id);
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

  /** Total body size of every file under a directory, in bytes. */
  usedBytes(dirId: NodeId): number {
    let total = 0;
    for (const id of this.state.childIds[dirId] ?? []) {
      const n = this.state.nodes[id];
      if (!n) continue;
      total += n.kind === "file" ? n.size : this.usedBytes(id);
    }
    return total;
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
    const mounted = this.mountedBodies.get(id);
    if (mounted) return mounted();
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
    assertNewNameFits(name);
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
    if (!found) assertNewNameFits(name);
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
    if (options.url) file.url = options.url;

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
    assertNewNameFits(name);
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

  // =========================================================================
  // Mounted disks
  // =========================================================================

  /**
   * Show `image` as a locked volume (see `VolumeImage`). Its node ids are
   * `<key>:<path>`, so attributes and open windows can find them again.
   */
  mount(image: VolumeImage): FSDirectory {
    const volumeId = `${image.key}:`;
    if (this.state.nodes[volumeId]) throw new FSError("exists", `"${image.name}" is already mounted`);
    assertValidName(image.name);
    const now = this.now();
    const nodes: FSNode[] = [];
    const attributes: [NodeId, NodeAttributes][] = [];
    const bodies: [NodeId, () => Promise<Uint8Array>][] = [];
    const volume: FSDirectory = {
      id: volumeId, name: image.name, kind: "directory", parentId: ROOT_ID,
      createdAt: now, modifiedAt: now, revision: 1, role: "volume", locked: true,
      ...(image.ejectable ? { ejectable: true } : {}),
    };
    nodes.push(volume);
    if (image.attributes) attributes.push([volumeId, image.attributes]);
    const add = (entries: readonly VolumeImageEntry[], parentId: NodeId, path: string): void => {
      for (const entry of entries) {
        assertValidName(entry.name);
        const id = `${volumeId}${path}${entry.name}`;
        if (entry.attributes) attributes.push([id, entry.attributes]);
        if (entry.kind === "directory") {
          nodes.push({ id, name: entry.name, kind: "directory", parentId, createdAt: now, modifiedAt: now, revision: 1 });
          add(entry.entries, id, `${path}${entry.name}/`);
          continue;
        }
        const inline = entry.content === undefined ? undefined : typeof entry.content === "string" ? textEncoder.encode(entry.content) : entry.content;
        const read = inline ? async () => inline.slice() : entry.read;
        if (!read) throw new FSError("not-found", `"${entry.name}" has no content`);
        bodies.push([id, read]);
        nodes.push({
          id, name: entry.name, kind: "file", parentId, createdAt: now, modifiedAt: now, revision: 1,
          type: entry.type, size: inline?.byteLength ?? entry.size ?? 0, ...(entry.url ? { url: entry.url } : {}),
        });
      }
    };
    add(image.entries, volumeId, "");
    for (const n of nodes) this.mountedIds.add(n.id);
    for (const [id, read] of bodies) this.mountedBodies.set(id, read);
    this.commit((s) => {
      for (const n of nodes) {
        s.nodes[n.id] = n;
        if (n.kind === "directory") s.childIds[n.id] ??= [];
        s.childIds[n.parentId!]!.push(n.id);
      }
      for (const [id, attrs] of attributes) mergeAttributes(s, id, attrs);
    });
    return this.state.nodes[volumeId] as FSDirectory;
  }

  /** Take a mounted volume away: eject it. Its nodes go; the user's disks are untouched. */
  unmount(volumeId: NodeId): void {
    const volume = this.state.nodes[volumeId];
    if (!volume || volume.parentId !== ROOT_ID || !this.mountedIds.has(volumeId)) {
      throw new FSError("invalid-move", "Only a mounted disk can be ejected");
    }
    const doomed = this.collectSubtree(volumeId);
    this.commit((s) => {
      s.childIds[ROOT_ID] = s.childIds[ROOT_ID]!.filter((c) => c !== volumeId);
      for (const d of doomed) {
        delete s.nodes[d];
        delete s.attributes[d];
        delete s.childIds[d];
      }
    });
    for (const d of doomed) {
      this.mountedIds.delete(d);
      this.mountedBodies.delete(d);
    }
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
  // Home disks
  // =========================================================================

  /** The home disk of `member`, mounted or ejected. */
  homeVolume(member: string): FSDirectory | undefined {
    for (const id of this.state.childIds[ROOT_ID] ?? []) {
      const n = this.state.nodes[id];
      if (n?.kind === "directory" && n.home === member) return n;
    }
    return undefined;
  }

  /**
   * Mount `member`'s home disk, creating it as `name` (with `id`, when
   * given) the first time. Its folders are the caller's to create (`locate`
   * finds them by role).
   */
  mountHome(member: string, name: string, id?: NodeId): FSDirectory {
    const existing = this.homeVolume(member);
    if (existing) {
      if (!existing.ejected) return existing;
      const mounted: FSDirectory = { ...existing };
      delete mounted.ejected;
      this.commit((s) => { delete (s.nodes[existing.id] as FSDirectory).ejected; });
      return (this.state.nodes[existing.id] as FSDirectory | undefined) ?? mounted;
    }
    // Every volume's name counts, ejected ones too, so two members' disks never share one.
    const taken = new Set((this.state.childIds[ROOT_ID] ?? []).map((id) => this.state.nodes[id]?.name));
    let candidate = fitName(name.trim() || "Home");
    for (let n = 2; taken.has(candidate); n++) candidate = fitNameWithSuffix(name.trim() || "Home", ` ${n}`);
    const volume = this.mkdir(ROOT_ID, candidate, { role: "volume", id });
    this.commit((s) => { (s.nodes[volume.id] as FSDirectory).home = member; });
    return (this.state.nodes[volume.id] as FSDirectory | undefined) ?? { ...volume, home: member };
  }

  /** Eject a volume: it and everything on it read as absent until mounted again. */
  eject(volumeId: NodeId): void {
    const volume = this.state.nodes[volumeId];
    if (volume?.kind !== "directory" || volume.parentId !== ROOT_ID) throw new FSError("not-found", `No such volume: ${volumeId}`);
    if (volume.ejected) return;
    this.commit((s) => { (s.nodes[volumeId] as FSDirectory).ejected = true; });
  }

  // =========================================================================
  // Sync
  // =========================================================================

  /**
   * Put `node` in the catalog exactly as another computer has it: its id,
   * name, folder, revision and times, its attributes replaced, and for a
   * file `content` as its body. Used by a synced disk to take in what the
   * Club sends; ordinary changes go through the methods above, which keep
   * revisions and names in order. Its folder must exist.
   */
  async applyRemote(node: FSNode, attributes: NodeAttributes | undefined, content?: Uint8Array): Promise<void> {
    const parent = node.parentId === null ? undefined : this.state.nodes[node.parentId];
    if (!parent || parent.kind !== "directory") throw new FSError("not-found", `No such directory: ${node.parentId}`);
    const existing = this.state.nodes[node.id];
    if (existing && existing.kind !== node.kind) throw new FSError("conflict", `${node.id} changed between file and folder`);
    if (node.kind === "file" && content) await this.backend.writeBlob(node.id, content);
    this.commit((s) => {
      const before = s.nodes[node.id];
      if (before && before.parentId !== node.parentId && before.parentId !== null) {
        s.childIds[before.parentId] = (s.childIds[before.parentId] ?? []).filter((c) => c !== node.id);
      }
      if (!before || before.parentId !== node.parentId) (s.childIds[node.parentId!] ??= []).push(node.id);
      if (node.kind === "directory") s.childIds[node.id] ??= [];
      s.nodes[node.id] = { ...node };
      if (attributes && Object.keys(attributes).length) s.attributes[node.id] = { ...attributes };
      else delete s.attributes[node.id];
      for (const id of this.collectSubtreeIn(s, node.id)) {
        unindexRole(s, id);
        indexRole(s, id);
      }
    });
  }

  /**
   * Give a folder a new id: its contents, attributes and role go with it.
   * For a home disk made before its folders had the ids every Mac derives.
   */
  renumberDirectory(oldId: NodeId, newId: NodeId): void {
    const dir = this.state.nodes[oldId];
    if (dir?.kind !== "directory" || dir.parentId === null) throw new FSError("not-found", `No such folder: ${oldId}`);
    if (oldId === newId) return;
    if (this.state.nodes[newId]) throw new FSError("exists", `Node ${newId} already exists`);
    this.commit((s) => {
      const node = { ...s.nodes[oldId], id: newId } as FSDirectory;
      delete s.nodes[oldId];
      s.nodes[newId] = node;
      const siblings = s.childIds[node.parentId!] ?? [];
      s.childIds[node.parentId!] = siblings.map((c) => (c === oldId ? newId : c));
      s.childIds[newId] = s.childIds[oldId] ?? [];
      delete s.childIds[oldId];
      for (const child of s.childIds[newId]) if (s.nodes[child]) s.nodes[child].parentId = newId;
      if (s.attributes[oldId]) {
        s.attributes[newId] = s.attributes[oldId];
        delete s.attributes[oldId];
      }
      // Roles are keyed by volume, which may be this folder: index them all again.
      for (const key of Object.keys(s.roles)) delete s.roles[key];
      for (const id of Object.keys(s.nodes)) indexRole(s, id);
    });
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
    this.mountedIds.clear();
    this.mountedBodies.clear();
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

  /** Serialised catalog — what `flush()` writes. Mounted disks aren't part of it. */
  toJSON(): CatalogDocument {
    const s = snapshot(this.state);
    if (this.mountedIds.size === 0) return { version: CURRENT_CATALOG_VERSION, nodes: s.nodes, attributes: s.attributes };
    const kept = <T,>(record: Record<NodeId, T>) =>
      Object.fromEntries(Object.entries(record).filter(([id]) => !this.mountedIds.has(id)));
    return { version: CURRENT_CATALOG_VERSION, nodes: kept(s.nodes), attributes: kept(s.attributes) };
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

  /** Whether `id` is on an ejected volume. Cheap when nothing is ejected. */
  private isEjected(id: NodeId): boolean {
    const volumes = this.state.childIds[ROOT_ID];
    if (!volumes?.some((v) => (this.state.nodes[v] as FSDirectory | undefined)?.ejected)) return false;
    const volumeId = volumeIdOf(this.state.nodes, id);
    return !!volumeId && !!(this.state.nodes[volumeId] as FSDirectory | undefined)?.ejected;
  }

  private assertUnlocked(id: NodeId): void {
    if ([...this.locked].some((locked) => this.isWithin(locked, id))) {
      throw new FSError("conflict", "A content write is in progress");
    }
  }

  private requireDirectory(id: NodeId): FSDirectory {
    this.assertUnlocked(id);
    const n = this.node(id);
    if (!n) throw new FSError("not-found", `No such directory: ${id}`);
    if (n.kind !== "directory") throw new FSError("not-a-directory", `"${n.name}" is not a folder`);
    this.assertWritable(id);
    return n;
  }

  private requireMutable(id: NodeId): FSNode {
    this.assertUnlocked(id);
    const n = this.node(id);
    if (!n) throw new FSError("not-found", `No such node: ${id}`);
    if (n.parentId === null) throw new FSError("immutable", "The root cannot be changed");
    this.assertWritable(id);
    return n;
  }

  /** A locked disk refuses every change; the Finder's own attributes are still kept, in memory. */
  private assertWritable(id: NodeId): void {
    const volume = this.volumeOf(id);
    if (volume?.locked) throw new FSError("locked", `"${volume.name}" is locked, so nothing on it can be changed.`);
  }

  /** `id` and everything under it, in a store being changed. */
  private collectSubtreeIn(s: CatalogState, id: NodeId): NodeId[] {
    const out: NodeId[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      for (const c of s.childIds[cur] ?? []) stack.push(c);
    }
    return out;
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
