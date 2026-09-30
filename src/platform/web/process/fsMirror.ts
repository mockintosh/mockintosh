/**
 * The worker's view of the file system. `AppFileSystem` reads are
 * synchronous and reactive, so the worker keeps a mirror of the catalog that
 * the host re-sends whenever it changes. Contents and asynchronous mutations
 * go to the host's real `FileSystem` as calls. The synchronous mutations
 * (`mkdir`, `rename`, `move`) are checked and applied to the mirror at once,
 * as the real file system would, then sent to the host; its next snapshot is
 * the truth either way.
 */
import { createSignal } from "solid-js";
import type { AppFileSystem } from "@mockintosh/sdk";
import { FSError, ROOT_ID, type FSDirectory, type FSFile, type FSNode, type MkdirOptions, type NodeRole } from "@mockintosh/fs";
import type { FsSnapshot } from "../../../os/process/protocol";

type Call = (method: string, args: unknown[]) => Promise<unknown>;
type Notify = (method: string, ...args: unknown[]) => void;

interface Index {
  rootId: string;
  nodes: Map<string, FSNode>;
  childIds: Map<string, string[]>;
}

function indexNodes(rootId: string, list: Iterable<FSNode>): Index {
  const nodes = new Map<string, FSNode>();
  const childIds = new Map<string, string[]>();
  for (const node of list) {
    nodes.set(node.id, node);
    if (node.parentId === null) continue;
    const siblings = childIds.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else childIds.set(node.parentId, [node.id]);
  }
  return { rootId, nodes, childIds };
}

/** Methods the host runs on its `FileSystem`; they all return promises. */
const REMOTE = ["readBytes", "readText", "readJSON", "writeFile", "writeJSON", "remove"] as const;

function assertValidName(name: string): void {
  if (!name || name.includes("/") || name === "." || name === "..") {
    throw new FSError("invalid-name", `Invalid file name: "${name}"`);
  }
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface FsMirror {
  fs: AppFileSystem;
  update(snapshot: FsSnapshot): void;
  /** Apply a node the host returned from a write before the next snapshot arrives. */
  upsert(node: FSNode): void;
}

export function createFsMirror(call: Call, notify: Notify): FsMirror {
  const [index, setIndex] = createSignal<Index>(indexNodes("", []), { ownedWrite: true, equals: false });

  const node = (id: string): FSNode | undefined => index().nodes.get(id);
  const directory = (id: string): FSDirectory | undefined => {
    const n = node(id);
    return n?.kind === "directory" ? n : undefined;
  };
  const children = (dirId: string): FSNode[] => {
    const idx = index();
    const out: FSNode[] = [];
    for (const id of idx.childIds.get(dirId) ?? []) {
      const n = idx.nodes.get(id);
      if (n) out.push(n);
    }
    return out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  };
  const child = (dirId: string, name: string): FSNode | undefined => children(dirId).find((n) => n.name === name);
  const volumes = (): FSDirectory[] => children(index().rootId).filter((n): n is FSDirectory => n.kind === "directory");
  const volumeOf = (id: string): FSDirectory | undefined => {
    const idx = index();
    let current = idx.nodes.get(id);
    while (current && current.parentId !== null) {
      if (current.parentId === idx.rootId) return current.kind === "directory" ? current : undefined;
      current = idx.nodes.get(current.parentId);
    }
    return undefined;
  };
  const isWithin = (id: string, ancestorId: string): boolean => {
    for (let n = node(id); n; n = n.parentId === null ? undefined : node(n.parentId)) if (n.id === ancestorId) return true;
    return false;
  };

  /** Replace nodes in the mirror and re-index. */
  function apply(changed: FSNode[]): void {
    const idx = index();
    const nodes = new Map(idx.nodes);
    for (const n of changed) nodes.set(n.id, n);
    setIndex(indexNodes(idx.rootId, nodes.values()));
  }

  function requireDirectory(id: string): FSDirectory {
    const dir = directory(id);
    if (!dir) throw new FSError("not-found", `No folder ${id}`);
    return dir;
  }

  function requireMutable(id: string): FSNode {
    const n = node(id);
    if (!n) throw new FSError("not-found", `No node ${id}`);
    if (n.parentId === null || n.id === ROOT_ID) throw new FSError("invalid-move", "The root can't be changed");
    return n;
  }

  const reads = {
    node,
    file: (id: string): FSFile | undefined => {
      const n = node(id);
      return n?.kind === "file" ? n : undefined;
    },
    directory,
    exists: (id: string) => node(id) !== undefined,
    children,
    childCount: (dirId: string) => index().childIds.get(dirId)?.length ?? 0,
    child,
    resolve(path: string): FSNode | undefined {
      let current = node(index().rootId);
      for (const part of path.split("/").filter(Boolean)) {
        if (!current || current.kind !== "directory") return undefined;
        current = child(current.id, part);
      }
      return current;
    },
    pathOf(id: string): string {
      const parts: string[] = [];
      let current = node(id);
      while (current && current.parentId !== null) {
        parts.unshift(current.name);
        current = node(current.parentId);
      }
      return "/" + parts.join("/");
    },
    locate(role: NodeRole, volumeId?: string): FSDirectory | undefined {
      if (role === "root") return directory(index().rootId);
      if (role === "volume") return volumeId ? directory(volumeId) : volumes()[0];
      const scope = volumeId ? [volumeId] : volumes().map((v) => v.id);
      for (const vid of scope) {
        for (const n of index().nodes.values()) {
          if (n.kind === "directory" && n.role === role && volumeOf(n.id)?.id === vid) return n;
        }
      }
      return undefined;
    },
    volumes,
    volumeOf,
  };

  const mutations = {
    mkdir(parentId: string, name: string, options: MkdirOptions = {}): FSDirectory {
      assertValidName(name);
      const parent = requireDirectory(parentId);
      const existing = child(parent.id, name);
      if (existing) {
        if (existing.kind === "directory") {
          if (options.role) notify("fs.mkdir", parentId, name, options);
          return existing;
        }
        throw new FSError("exists", `A file named "${name}" already exists`);
      }
      const now = Date.now();
      const dir: FSDirectory = { id: options.id ?? newId(), name, kind: "directory", parentId: parent.id, createdAt: now, modifiedAt: now, revision: 1 };
      if (options.role) dir.role = options.role;
      apply([dir]);
      notify("fs.mkdir", parentId, name, { ...options, id: dir.id });
      return dir;
    },
    rename(id: string, name: string): void {
      assertValidName(name);
      const n = requireMutable(id);
      if (n.name === name) return;
      const clash = child(n.parentId!, name);
      if (clash && clash.id !== id) throw new FSError("exists", `"${name}" already exists in this folder`);
      apply([{ ...n, name, modifiedAt: Date.now(), revision: n.revision + 1 }]);
      notify("fs.rename", id, name);
    },
    move(id: string, newParentId: string): void {
      const n = requireMutable(id);
      const target = requireDirectory(newParentId);
      if (n.parentId === target.id) return;
      if (isWithin(target.id, id)) throw new FSError("invalid-move", "Cannot move a folder into itself");
      if (child(target.id, n.name)) throw new FSError("exists", `"${n.name}" already exists in the destination`);
      if (n.role === "volume" || target.id === index().rootId) {
        throw new FSError("invalid-move", "Volumes cannot be moved and only volumes live at the root");
      }
      apply([{ ...n, parentId: target.id, modifiedAt: Date.now(), revision: n.revision + 1 }]);
      notify("fs.move", id, newParentId);
    },
  };

  const remote = Object.fromEntries(REMOTE.map((method) => [method, (...args: unknown[]) => call(`fs.${method}`, args)]));

  const fs = {
    ...reads,
    ...mutations,
    ...remote,
    // Writes inside run one call at a time; the host's catalog batches nothing for us.
    batch: <T>(fn: () => T): T => fn(),
  } as unknown as AppFileSystem;

  return {
    fs,
    update(snapshot) {
      setIndex(indexNodes(snapshot.rootId, snapshot.nodes));
    },
    upsert(n) {
      apply([n]);
    },
  };
}
