/**
 * The Mockintosh disk as a POSIX-ish file system for bash: every call is a
 * kernel file trap (`stat`, `list`, `read_bytes`, `write_bytes`, `mkdir`,
 * `remove`, `move`, `copy`), so what bash does the Finder sees, and the
 * other way round. Mounted under a prefix (`/disk`, `/system/source`).
 *
 * Errors carry the errno in their message and `code`, as Node's do, since
 * that's how bash's commands recognise "no such file".
 */
import type { BufferEncoding, CpOptions, FileContent, FsStat, IFileSystem, MkdirOptions, RmOptions } from "just-bash/browser";

type ReadFileOptions = Exclude<Parameters<IFileSystem["readFile"]>[1], string | undefined>;
type WriteFileOptions = Exclude<Parameters<IFileSystem["writeFile"]>[2], string | undefined>;
/** just-bash's latin1 byte string (one char per byte), a branded string. */
export type ByteString = Awaited<ReturnType<NonNullable<IFileSystem["readFileBytes"]>>>;

/** The part of `KernelClient` the file system needs. */
export interface KernelLike {
  invoke(name: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal; stdout?: (bytes: Uint8Array) => void; stderr?: (bytes: Uint8Array) => void }): Promise<unknown>;
}

interface Resource {
  id: string;
  revision: number;
  path: string;
  kind: "file" | "directory";
  contentType: string;
  size?: number;
  modified?: number;
}

type Errno = "ENOENT" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY" | "EACCES" | "EROFS" | "EINVAL" | "EPERM" | "EIO";

const DESCRIPTIONS: Record<Errno, string> = {
  ENOENT: "no such file or directory",
  EEXIST: "file already exists",
  ENOTDIR: "not a directory",
  EISDIR: "illegal operation on a directory",
  ENOTEMPTY: "directory not empty",
  EACCES: "permission denied",
  EROFS: "read-only file system",
  EINVAL: "invalid argument",
  EPERM: "operation not permitted",
  EIO: "i/o error",
};

export class FsError extends Error {
  constructor(readonly code: Errno, syscall: string, path: string) {
    super(`${code}: ${DESCRIPTIONS[code]}, ${syscall} '${path}'`);
  }
}

/** A kernel failure as an errno. */
function errnoOf(error: unknown): Errno {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "missing-resource" || /No resource|no longer on the disk/i.test(message)) return "ENOENT";
  if (code === "conflict" || /exists/i.test(message)) return "EEXIST";
  if (/not a directory/i.test(message)) return "ENOTDIR";
  if (/nonempty|not empty|recursive/i.test(message)) return "ENOTEMPTY";
  if (code === "permission") return "EACCES";
  if (code === "unsupported-operation") return "EROFS";
  if (code === "invalid-argument") return "EINVAL";
  return "EIO";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(content: FileContent): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}

export function resolvePath(base: string, path: string): string {
  return normalize(path.startsWith("/") ? path : `${base}/${path}`);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export class KernelFs implements IFileSystem {
  constructor(
    private kernel: KernelLike,
    /** Kernel path this file system's root is. */
    private root: string,
    private options: { readOnly?: boolean } = {},
  ) {}

  /** The kernel path for a path inside this file system. */
  private real(path: string): string {
    const rel = normalize(path);
    return rel === "/" ? this.root : this.root + rel;
  }

  private async call<T>(syscall: string, path: string, name: string, args: Record<string, unknown>): Promise<T> {
    try {
      return (await this.kernel.invoke(name, args)) as T;
    } catch (error) {
      throw new FsError(errnoOf(error), syscall, path);
    }
  }

  private writable(syscall: string, path: string): void {
    if (this.options.readOnly) throw new FsError("EROFS", syscall, path);
  }

  private async resource(path: string, syscall = "stat"): Promise<Resource> {
    return this.call<Resource>(syscall, path, "stat", { path: this.real(path) });
  }

  async readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> {
    const encoding = typeof options === "string" ? options : options?.encoding;
    if (encoding === "latin1" || encoding === "binary") return (await this.readFileBytes(path)) as unknown as string;
    return decoder.decode(await this.readFileBuffer(path));
  }

  async readFileBytes(path: string): Promise<ByteString> {
    const bytes = await this.readFileBuffer(path);
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return s as unknown as ByteString;
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const r = await this.resource(path, "open");
    if (r.kind === "directory") throw new FsError("EISDIR", "read", path);
    const result = await this.call<{ bytes: number[] }>("open", path, "read_bytes", { path: this.real(path) });
    return new Uint8Array(result.bytes);
  }

  async writeFile(path: string, content: FileContent, _options?: WriteFileOptions | BufferEncoding): Promise<void> {
    this.writable("open", path);
    await this.put(path, toBytes(content));
  }

  private async put(path: string, bytes: Uint8Array): Promise<void> {
    const existing = await this.resource(path).catch(() => null);
    if (existing?.kind === "directory") throw new FsError("EISDIR", "open", path);
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!existing) {
      const dir = await this.resource(parent).catch(() => null);
      if (!dir) throw new FsError("ENOENT", "open", path);
      if (dir.kind !== "directory") throw new FsError("ENOTDIR", "open", path);
    }
    await this.call("open", path, "write_bytes", { path: this.real(path), bytes: Array.from(bytes) });
  }

  async appendFile(path: string, content: FileContent, _options?: WriteFileOptions | BufferEncoding): Promise<void> {
    this.writable("open", path);
    const before = (await this.exists(path)) ? await this.readFileBuffer(path) : new Uint8Array();
    const add = toBytes(content);
    const joined = new Uint8Array(before.length + add.length);
    joined.set(before);
    joined.set(add, before.length);
    await this.put(path, joined);
  }

  async exists(path: string): Promise<boolean> {
    return this.resource(path).then(() => true, () => false);
  }

  async stat(path: string): Promise<FsStat> {
    const r = await this.resource(path);
    return {
      isFile: r.kind === "file",
      isDirectory: r.kind === "directory",
      isSymbolicLink: false,
      mode: r.kind === "directory" ? 0o40755 : 0o100644,
      size: r.size ?? 0,
      mtime: new Date(r.modified ?? 0),
      identity: r.id,
    };
  }

  lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    this.writable("mkdir", path);
    const existing = await this.resource(path).catch(() => null);
    if (existing) {
      if (options?.recursive && existing.kind === "directory") return;
      throw new FsError("EEXIST", "mkdir", path);
    }
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!(await this.exists(parent))) {
      if (!options?.recursive) throw new FsError("ENOENT", "mkdir", path);
      await this.mkdir(parent, options);
    }
    await this.call("mkdir", path, "mkdir", { path: this.real(path) });
  }

  async readdir(path: string): Promise<string[]> {
    return (await this.readdirWithFileTypes(path)).map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }[]> {
    const r = await this.resource(path, "scandir");
    if (r.kind !== "directory") throw new FsError("ENOTDIR", "scandir", path);
    const list = await this.call<Resource[]>("scandir", path, "list", { path: this.real(path) });
    return list
      .map((e) => ({ name: basename(e.path), isFile: e.kind === "file", isDirectory: e.kind === "directory", isSymbolicLink: false }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    this.writable("rm", path);
    const r = await this.resource(path, "rm").catch((error) => {
      if (options?.force) return null;
      throw error;
    });
    if (!r) return;
    if (r.kind === "directory" && !options?.recursive) {
      const children = await this.readdir(path);
      if (children.length) throw new FsError("ENOTEMPTY", "rmdir", path);
    }
    await this.call("rm", path, "remove", { path: this.real(path), recursive: options?.recursive === true });
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    this.writable("cp", dest);
    const r = await this.resource(src, "cp");
    if (r.kind === "directory" && !options?.recursive) throw new FsError("EISDIR", "cp", src);
    if (await this.exists(dest)) await this.rm(dest, { recursive: true });
    await this.call("cp", dest, "copy", { source: this.real(src), destination: this.real(dest) });
  }

  async mv(src: string, dest: string): Promise<void> {
    this.writable("rename", dest);
    await this.resource(src, "rename");
    if (await this.exists(dest)) await this.rm(dest, { recursive: true });
    await this.call("rename", dest, "move", { source: this.real(src), destination: this.real(dest) });
  }

  resolvePath(base: string, path: string): string {
    return resolvePath(base, path);
  }

  /** Every call is asynchronous; bash globs by reading directories instead. */
  getAllPaths(): string[] {
    return [];
  }

  async chmod(path: string, _mode: number): Promise<void> {
    await this.resource(path, "chmod");
  }

  async symlink(_target: string, linkPath: string): Promise<void> {
    throw new FsError("EPERM", "symlink", linkPath);
  }

  async link(_existingPath: string, newPath: string): Promise<void> {
    throw new FsError("EPERM", "link", newPath);
  }

  async readlink(path: string): Promise<string> {
    await this.resource(path, "readlink");
    throw new FsError("EINVAL", "readlink", path);
  }

  async realpath(path: string): Promise<string> {
    await this.resource(path, "realpath");
    return normalize(path);
  }

  async utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
    await this.resource(path, "utime");
  }
}
