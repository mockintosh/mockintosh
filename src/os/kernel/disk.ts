import { FSError, assertNewNameFits, type FileSystem, type FSNode } from "@mockintosh/fs";
import { ServiceError, normalizePath } from "./errors";
import type { SourceProvider } from "../../platform/types";

/** A File Manager node as a trap result. Paths are the `/disk` shell alias. */
export interface FileResource {
  readonly id: string;
  readonly revision: number;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly contentType: string;
}

/**
 * Path-resolving face of the boot FileSystem for traps and the shell.
 * `/disk` is a prefix for the volume root, not a mount. Finder still uses ids.
 */
const SOURCE_ROOT = "/system/source";

export class Disk {
  constructor(private fs: FileSystem, private source?: SourceProvider) {}

  private isSource(path: string): boolean {
    const normalized = normalizePath(path);
    return normalized === SOURCE_ROOT || normalized.startsWith(SOURCE_ROOT + "/");
  }

  private sourceRel(path: string): string {
    const normalized = normalizePath(path);
    return normalized === SOURCE_ROOT ? "" : normalized.slice(SOURCE_ROOT.length + 1);
  }

  private sourceResource(rel: string, kind: "file" | "directory"): FileResource {
    return {
      id: `source:${rel}`,
      revision: 0,
      path: rel ? `${SOURCE_ROOT}/${rel}` : SOURCE_ROOT,
      kind,
      contentType: kind === "file" ? "text/plain" : "inode/directory",
    };
  }

  volume() {
    const volume = this.fs.locate("volume");
    if (!volume) throw new ServiceError("missing-resource", "No persistent volume");
    return volume;
  }

  pathOf(id: string): string {
    const volume = this.volume();
    if (id === volume.id) return "/disk";
    const names: string[] = [];
    let node = this.fs.node(id);
    while (node && node.id !== volume.id) {
      names.unshift(node.name);
      node = node.parentId ? this.fs.node(node.parentId) : undefined;
    }
    if (!node) throw new ServiceError("missing-resource", "Resource is no longer on the disk");
    return "/disk/" + names.join("/");
  }

  node(path: string): FSNode {
    if (this.isSource(path)) throw new ServiceError("unsupported-operation", "Source volume has no file-system node");
    const normalized = normalizePath(path);
    const volume = this.volume();
    if (normalized === "/disk" || normalized.startsWith("/disk/")) {
      let node: FSNode | undefined = volume;
      for (const part of normalized.slice("/disk".length).split("/").filter(Boolean)) {
        node = node.kind === "directory" ? this.fs.child(node.id, part) : undefined;
        if (!node) throw new ServiceError("missing-resource", `No resource at ${path}`);
      }
      return node;
    }
    const resolved = this.fs.resolve(normalized);
    if (!resolved) throw new ServiceError("missing-resource", `No resource at ${path}`);
    return resolved;
  }

  resource(node: FSNode): FileResource {
    return {
      id: node.id,
      revision: node.revision,
      path: this.pathOf(node.id),
      kind: node.kind,
      contentType: node.kind === "file" ? node.type : "inode/directory",
    };
  }

  private parent(path: string) {
    path = normalizePath(path);
    if (path === "/disk") throw new ServiceError("permission", "Cannot replace the volume root");
    const split = path.lastIndexOf("/");
    const parent = this.node(path.slice(0, split) || "/disk");
    if (parent.kind !== "directory") throw new ServiceError("invalid-argument", "Parent is not a directory");
    return { parent, name: path.slice(split + 1) };
  }

  private async mutate<T>(action: () => T | Promise<T>): Promise<T> {
    try {
      const result = await action();
      await this.fs.flush();
      return result;
    } catch (error) {
      if (error instanceof FSError) {
        throw new ServiceError(
          error.code === "conflict" || error.code === "exists" ? "conflict"
            : error.code === "not-found" ? "missing-resource"
            : "invalid-argument",
          error.message,
        );
      }
      throw error;
    }
  }

  async stat(path: string) {
    if (this.isSource(path)) return this.sourceStat(path);
    return this.resource(this.node(path));
  }

  async list(path: string, recursive = false) {
    if (this.isSource(path)) return this.sourceList(path, recursive);
    const node = this.node(path);
    if (node.kind !== "directory") throw new ServiceError("unsupported-operation", "Resource is not a directory");
    const children = this.fs.children(node.id).map(n => this.resource(n));
    if (!recursive) return children;
    const all = [...children];
    for (const child of children) {
      if (child.kind === "directory") all.push(...await this.list(child.path, true));
    }
    return all;
  }

  async read(path: string) {
    if (this.isSource(path)) {
      const rel = this.sourceRel(path);
      if (!this.source) throw new ServiceError("missing-resource", "No source volume");
      const text = await this.source.read(rel);
      return new TextEncoder().encode(text);
    }
    const node = this.node(path);
    if (node.kind !== "file") throw new ServiceError("unsupported-operation", "Resource is not a file");
    const bytes = await this.fs.readBytes(node.id);
    if (!bytes) throw new ServiceError("missing-resource", "Missing file body");
    return bytes;
  }

  async readLines(path: string, from?: number, to?: number) {
    const bytes = await this.read(path);
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\n");
    const start = from ?? 1;
    const end = to ?? lines.length;
    if (start < 1 || end < start) throw new ServiceError("invalid-argument", "Invalid line range");
    const slice = lines.slice(start - 1, end).join("\n");
    const revision = this.isSource(path) ? 0 : this.node(path).revision;
    return { text: slice, from: start, to: Math.min(end, lines.length), total: lines.length, revision };
  }

  async write(path: string, body: Uint8Array, expectedRevision?: number) {
    if (this.isSource(path)) throw new ServiceError("permission", "Source volume is read-only");
    const { parent, name } = this.parent(path);
    return this.mutate(async () => this.resource(await this.fs.writeFile(parent.id, name, body, { expectedRevision })));
  }

  async edit(path: string, oldText: string, newText: string, expectedRevision: number, replaceAll = false) {
    if (this.isSource(path)) throw new ServiceError("permission", "Source volume is read-only");
    if (!oldText) throw new ServiceError("invalid-argument", "oldText must not be empty");
    const node = this.node(path);
    if (node.kind !== "file") throw new ServiceError("unsupported-operation", "Resource is not a file");
    if (node.revision !== expectedRevision) throw new ServiceError("conflict", "Revision does not match");
    const text = new TextDecoder().decode(await this.read(path));
    const count = countOccurrences(text, oldText);
    if (count === 0) throw new ServiceError("conflict", "oldText not found");
    if (count > 1 && !replaceAll) throw new ServiceError("conflict", "oldText matches more than one place");
    const next = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, newText);
    return this.write(path, new TextEncoder().encode(next), expectedRevision);
  }

  async search(path: string, pattern: string, maxResults = 50) {
    let regex: RegExp;
    try { regex = new RegExp(pattern); }
    catch { throw new ServiceError("invalid-argument", "Invalid search pattern"); }
    const files = await this.filesUnder(path);
    const hits: { path: string; line: number; text: string }[] = [];
    for (const file of files) {
      const text = new TextDecoder().decode(await this.read(file.path));
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i])) continue;
        hits.push({ path: file.path, line: i + 1, text: lines[i] });
        if (hits.length >= maxResults) return hits;
        regex.lastIndex = 0;
      }
      regex.lastIndex = 0;
    }
    return hits;
  }

  private async filesUnder(path: string): Promise<FileResource[]> {
    const info = await this.stat(path);
    if (info.kind === "file") return [info];
    return (await this.list(path, true)).filter(item => item.kind === "file");
  }

  private async sourceStat(path: string): Promise<FileResource> {
    if (!this.source) throw new ServiceError("missing-resource", "No source volume");
    const rel = this.sourceRel(path);
    const manifest = await this.source.manifest();
    if (!rel) return this.sourceResource("", "directory");
    if (manifest.files.some(file => file.path === rel)) return this.sourceResource(rel, "file");
    const prefix = rel + "/";
    if (manifest.files.some(file => file.path.startsWith(prefix))) return this.sourceResource(rel, "directory");
    throw new ServiceError("missing-resource", `No resource at ${path}`);
  }

  private async sourceList(path: string, recursive: boolean): Promise<FileResource[]> {
    if (!this.source) throw new ServiceError("missing-resource", "No source volume");
    const rel = this.sourceRel(path);
    const manifest = await this.source.manifest();
    const prefix = rel ? rel + "/" : "";
    if (recursive) {
      return manifest.files
        .filter(file => !prefix || file.path.startsWith(prefix))
        .map(file => this.sourceResource(file.path, "file"));
    }
    const names = new Map<string, "file" | "directory">();
    for (const file of manifest.files) {
      if (prefix && !file.path.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length);
      if (!rest) continue;
      const name = rest.split("/")[0];
      names.set(name, rest === name ? "file" : "directory");
    }
    return [...names.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, kind]) => this.sourceResource(prefix + name, kind));
  }

  async mkdir(path: string) {
    if (this.isSource(path)) throw new ServiceError("permission", "Source volume is read-only");
    const { parent, name } = this.parent(path);
    return this.mutate(() => this.resource(this.fs.mkdir(parent.id, name)));
  }

  async remove(path: string, recursive: boolean) {
    if (this.isSource(path)) throw new ServiceError("permission", "Source volume is read-only");
    const node = this.node(path);
    if (node.id === this.volume().id) throw new ServiceError("permission", "Cannot remove the volume root");
    if (node.kind === "directory" && this.fs.childCount(node.id) && !recursive) {
      throw new ServiceError("invalid-argument", "Nonempty directory requires recursive removal");
    }
    await this.mutate(() => this.fs.remove(node.id));
  }

  async move(source: string, destination: string) {
    if (this.isSource(source) || this.isSource(destination)) throw new ServiceError("permission", "Source volume is read-only");
    const node = this.node(source);
    const { parent, name } = this.parent(destination);
    if (node.id === this.volume().id) throw new ServiceError("permission", "Cannot move the volume root");
    if (this.fs.child(parent.id, name)) throw new ServiceError("conflict", "Destination exists");
    if (this.fs.child(parent.id, node.name) && parent.id !== node.parentId) {
      throw new ServiceError("conflict", "Destination contains source name");
    }
    return this.mutate(() => {
      // Check before moving: the batch isn't a transaction, so a rename that
      // throws would leave the node moved under its old name.
      if (name !== node.name) assertNewNameFits(name);
      this.fs.batch(() => {
        this.fs.move(node.id, parent.id);
        this.fs.rename(node.id, name);
      });
      return this.resource(this.node(destination));
    });
  }

  async copy(source: string, destination: string): Promise<FileResource> {
    if (this.isSource(destination)) throw new ServiceError("permission", "Source volume is read-only");
    if (this.isSource(source)) {
      const info = await this.stat(source);
      if (info.kind === "file") {
        return this.write(destination, await this.read(source), 0);
      }
      await this.mkdir(destination);
      for (const child of await this.list(source)) {
        await this.copy(child.path, normalizePath(destination) + "/" + child.path.slice(normalizePath(source).length + 1));
      }
      return this.stat(destination);
    }
    const node = this.node(source);
    const { parent, name } = this.parent(destination);
    if (this.fs.child(parent.id, name)) throw new ServiceError("conflict", "Destination exists");
    if (this.fs.isWithin(parent.id, node.id)) throw new ServiceError("invalid-argument", "Cannot copy into source subtree");
    if (node.kind === "file") {
      return this.mutate(async () => this.resource(await this.fs.writeFile(parent.id, name, await this.read(source), {
        type: node.type,
        expectedRevision: 0,
      })));
    }
    await this.mkdir(destination);
    for (const child of await this.list(source)) {
      await this.copy(child.path, normalizePath(destination) + "/" + this.node(child.path).name);
    }
    return this.stat(destination);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}
