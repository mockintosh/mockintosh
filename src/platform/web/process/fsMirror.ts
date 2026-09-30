/**
 * The worker's view of the file system. `AppFileSystem` reads are
 * synchronous and reactive, so the worker keeps a mirror of the catalog that
 * the host re-sends whenever it changes. Contents and every mutation go to the
 * host's real `FileSystem` as calls.
 */
import { createSignal } from "solid-js";
import type { AppFileSystem } from "@mockintosh/sdk";
import type { FSDirectory, FSFile, FSNode, NodeRole } from "@mockintosh/fs";
import type { FsSnapshot } from "../../../os/process/protocol";

type Call = (method: string, args: unknown[]) => Promise<unknown>;

interface Index {
  rootId: string;
  nodes: Map<string, FSNode>;
  childIds: Map<string, string[]>;
}

function indexSnapshot(snapshot: FsSnapshot): Index {
  const nodes = new Map<string, FSNode>();
  const childIds = new Map<string, string[]>();
  for (const node of snapshot.nodes) {
    nodes.set(node.id, node);
    if (node.parentId === null) continue;
    const siblings = childIds.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else childIds.set(node.parentId, [node.id]);
  }
  return { rootId: snapshot.rootId, nodes, childIds };
}

/** Methods the host runs on its `FileSystem`; they return promises or plain values. */
const REMOTE = ["readBytes", "readText", "readJSON", "mkdir", "writeFile", "writeJSON", "rename", "move", "remove"] as const;

export interface FsMirror {
  fs: AppFileSystem;
  update(snapshot: FsSnapshot): void;
  /** Apply a node the host returned from a write before the next snapshot arrives. */
  upsert(node: FSNode): void;
}

export function createFsMirror(call: Call): FsMirror {
  const [index, setIndex] = createSignal<Index>(indexSnapshot({ rootId: "", nodes: [] }), {
    ownedWrite: true,
    equals: false,
  });

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

  const remote = Object.fromEntries(REMOTE.map((method) => [method, (...args: unknown[]) => call(`fs.${method}`, args)]));

  const fs = {
    ...reads,
    ...remote,
    // Writes inside run one call at a time; the host's catalog batches nothing for us.
    batch: <T>(fn: () => T): T => fn(),
  } as unknown as AppFileSystem;

  return {
    fs,
    update(snapshot) {
      setIndex(indexSnapshot(snapshot));
    },
    upsert(n) {
      const idx = index();
      const previous = idx.nodes.get(n.id);
      idx.nodes.set(n.id, n);
      if (!previous && n.parentId !== null) {
        const siblings = idx.childIds.get(n.parentId);
        if (siblings) siblings.push(n.id);
        else idx.childIds.set(n.parentId, [n.id]);
      }
      setIndex(idx);
    },
  };
}
