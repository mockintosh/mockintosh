/**
 * The owner's side of a WebAssembly program: its file descriptors. Files
 * live in the same file system bash uses (the Mockintosh disk through the
 * kernel, /tmp in memory, read-only mounts); fds 0–2 are the terminal (or,
 * in a pipeline, bytes in and out).
 *
 * A file is read whole when opened and written back when closed or synced:
 * the kernel's file traps are whole-file, and programs here are small.
 */
import type { IFileSystem } from "just-bash/browser";
import { Errno, FdFlags, FileType, OFlags, Whence, json, type DirEntry, type Stat, type Syscall, type SyscallResult } from "./abi";
import { CHANNEL_CAPACITY } from "./channel";
import { normalize, resolvePath } from "../bash/kernelFs";

/** The terminal side of fds 0–2. */
export interface ProgramStdio {
  /** Up to `max` bytes of input; empty on timeout, null at end of input. */
  read(max: number, timeoutMs: number | null): Promise<Uint8Array | null>;
  /** Whether input is ready within `timeoutMs` (null waits). */
  ready(timeoutMs: number | null): Promise<boolean>;
  write(fd: 1 | 2, data: Uint8Array): void;
  /** Raw mode with VMIN/VTIME (tenths of a second), or cooked. */
  setMode(raw: boolean, vmin: number, vtime: number): void;
  size(): { cols: number; rows: number };
  /** fds 0–2 are a terminal (else pipes). */
  readonly terminal: boolean;
}

type Descriptor =
  | { kind: "stdio"; fd: 0 | 1 | 2 }
  | { kind: "dir"; path: string }
  | { kind: "file"; path: string; data: Uint8Array; length: number; pos: number; dirty: boolean; append: boolean; read: boolean; write: boolean };

const ERRNO_PATTERNS: [RegExp, number][] = [
  [/ENOENT|no such file/i, Errno.NOENT],
  [/EEXIST|already exists/i, Errno.EXIST],
  [/ENOTDIR|not a directory/i, Errno.NOTDIR],
  [/EISDIR|is a directory/i, Errno.ISDIR],
  [/ENOTEMPTY|not empty/i, Errno.NOTEMPTY],
  [/EACCES|permission denied/i, Errno.ACCES],
  [/EROFS|read-only/i, Errno.ROFS],
  [/EPERM|not permitted/i, Errno.PERM],
  [/EINVAL|invalid/i, Errno.INVAL],
];

export function errnoFor(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown })?.code;
  for (const [pattern, errno] of ERRNO_PATTERNS) if (pattern.test(String(code ?? "")) || pattern.test(message)) return errno;
  return Errno.IO;
}

let nextIno = 1;
const inodes = new Map<string, number>();
function inoFor(path: string): number {
  let ino = inodes.get(path);
  if (ino === undefined) inodes.set(path, (ino = nextIno++));
  return ino;
}

/**
 * The directories a program starts with, from fd 3: "/", "." (the working
 * directory), and each top-level directory. wasi-libc sends a path to the
 * preopen with the longest matching name, and counts "." as "/" (the later
 * of the two wins), so relative paths go to the working directory while
 * absolute ones reach their top-level directory. Programs built here also
 * chdir to $PWD at startup, which makes relative paths exact.
 */
export async function preopensFor(fs: IFileSystem): Promise<string[]> {
  const top = await fs.readdir("/").catch(() => [] as string[]);
  return ["/", ".", ...top.filter((name) => !name.startsWith(".")).map((name) => `/${name}`)];
}

export class ProgramOwner {
  private fds = new Map<number, Descriptor>();
  private firstFree: number;

  constructor(private fs: IFileSystem, private stdio: ProgramStdio, cwd: string, readonly preopens: string[] = ["/", "."]) {
    this.fds.set(0, { kind: "stdio", fd: 0 });
    this.fds.set(1, { kind: "stdio", fd: 1 });
    this.fds.set(2, { kind: "stdio", fd: 2 });
    preopens.forEach((name, i) => this.fds.set(3 + i, { kind: "dir", path: name === "." ? normalize(cwd) : normalize(name) }));
    this.firstFree = 3 + preopens.length;
  }

  async handle(request: Syscall): Promise<SyscallResult> {
    try {
      return await this.dispatch(request);
    } catch (error) {
      return { result: -errnoFor(error) };
    }
  }

  /** Write back every changed file (the program ended). */
  async closeAll(): Promise<void> {
    for (const [fd, d] of this.fds) if (d.kind === "file") await this.flush(d).catch(() => {});
    for (const fd of [...this.fds.keys()]) if (fd >= this.firstFree) this.fds.delete(fd);
  }

  private descriptor(fd: number): Descriptor {
    const d = this.fds.get(fd);
    if (!d) throw Object.assign(new Error("EBADF"), { code: "EBADF" });
    return d;
  }

  private allocate(d: Descriptor): number {
    let fd = this.firstFree;
    while (this.fds.has(fd)) fd++;
    this.fds.set(fd, d);
    return fd;
  }

  private path(dirfd: number, path: string): string {
    const d = this.descriptor(dirfd);
    if (d.kind !== "dir") throw new Error("ENOTDIR");
    return resolvePath(d.path, path);
  }

  private async flush(d: Extract<Descriptor, { kind: "file" }>): Promise<void> {
    if (!d.dirty) return;
    await this.fs.writeFile(d.path, d.data.slice(0, d.length));
    d.dirty = false;
  }

  private async stat(path: string): Promise<Stat> {
    const s = await this.fs.stat(path);
    return {
      filetype: s.isDirectory ? FileType.DIRECTORY : FileType.REGULAR_FILE,
      size: s.size,
      mtime: s.mtime.getTime(),
      ino: inoFor(path),
    };
  }

  private ensure(d: Extract<Descriptor, { kind: "file" }>, length: number): void {
    if (length <= d.data.length) return;
    const grown = new Uint8Array(Math.max(length, d.data.length * 2, 256));
    grown.set(d.data.subarray(0, d.length));
    d.data = grown;
  }

  private async dispatch(r: Syscall): Promise<SyscallResult> {
    switch (r.op) {
      case "read": {
        const d = this.descriptor(r.fd);
        const max = Math.min(r.max, CHANNEL_CAPACITY);
        if (d.kind === "stdio") {
          if (d.fd !== 0) return { result: -Errno.BADF };
          const data = await this.stdio.read(max, r.timeout);
          if (!data) return { result: 0 };
          return { result: data.length, data };
        }
        if (d.kind !== "file") return { result: -Errno.ISDIR };
        if (!d.read) return { result: -Errno.BADF };
        const data = d.data.slice(d.pos, Math.min(d.length, d.pos + max));
        d.pos += data.length;
        return { result: data.length, data };
      }
      case "pread": {
        const d = this.descriptor(r.fd);
        if (d.kind !== "file") return { result: -Errno.SPIPE };
        const data = d.data.slice(r.offset, Math.min(d.length, r.offset + Math.min(r.max, CHANNEL_CAPACITY)));
        return { result: data.length, data };
      }
      case "write":
      case "pwrite": {
        const d = this.descriptor(r.fd);
        if (d.kind === "stdio") {
          if (d.fd === 0) return { result: -Errno.BADF };
          this.stdio.write(d.fd, r.data);
          return { result: r.data.length };
        }
        if (d.kind !== "file") return { result: -Errno.ISDIR };
        if (!d.write) return { result: -Errno.BADF };
        const at = r.op === "pwrite" ? r.offset : d.append ? d.length : d.pos;
        this.ensure(d, at + r.data.length);
        d.data.set(r.data, at);
        d.length = Math.max(d.length, at + r.data.length);
        if (r.op === "write") d.pos = at + r.data.length;
        d.dirty = true;
        return { result: r.data.length };
      }
      case "seek": {
        const d = this.descriptor(r.fd);
        if (d.kind !== "file") return { result: -Errno.SPIPE };
        const base = r.whence === Whence.SET ? 0 : r.whence === Whence.CUR ? d.pos : d.length;
        const pos = base + r.offset;
        if (pos < 0) return { result: -Errno.INVAL };
        d.pos = pos;
        return { result: pos };
      }
      case "close": {
        const d = this.descriptor(r.fd);
        if (d.kind === "file") await this.flush(d);
        if (r.fd > 2) this.fds.delete(r.fd);
        return { result: 0 };
      }
      case "sync": {
        const d = this.descriptor(r.fd);
        if (d.kind === "file") await this.flush(d);
        return { result: 0 };
      }
      case "fdstat": {
        const d = this.descriptor(r.fd);
        const filetype = d.kind === "stdio"
          ? (this.stdio.terminal ? FileType.CHARACTER_DEVICE : FileType.UNKNOWN)
          : d.kind === "dir" ? FileType.DIRECTORY : FileType.REGULAR_FILE;
        const flags = d.kind === "file" && d.append ? FdFlags.APPEND : 0;
        return { result: 0, data: json({ filetype, flags }) };
      }
      case "filestat": {
        const d = this.descriptor(r.fd);
        if (d.kind === "stdio") return { result: 0, data: json({ filetype: this.stdio.terminal ? FileType.CHARACTER_DEVICE : FileType.UNKNOWN, size: 0, mtime: Date.now(), ino: 0 } satisfies Stat) };
        if (d.kind === "file") return { result: 0, data: json({ filetype: FileType.REGULAR_FILE, size: d.length, mtime: Date.now(), ino: inoFor(d.path) } satisfies Stat) };
        return { result: 0, data: json(await this.stat(d.path)) };
      }
      case "truncate": {
        const d = this.descriptor(r.fd);
        if (d.kind !== "file") return { result: -Errno.INVAL };
        this.ensure(d, r.size);
        if (r.size > d.length) d.data.fill(0, d.length, r.size);
        d.length = r.size;
        d.dirty = true;
        return { result: 0 };
      }
      case "readdir": {
        const d = this.descriptor(r.fd);
        if (d.kind !== "dir") return { result: -Errno.NOTDIR };
        const names = await this.fs.readdir(d.path);
        const entries: DirEntry[] = await Promise.all(names.map(async (name) => {
          const s = await this.fs.stat(resolvePath(d.path, name)).catch(() => null);
          return { name, filetype: s?.isDirectory ? FileType.DIRECTORY : FileType.REGULAR_FILE };
        }));
        return { result: 0, data: json(entries) };
      }
      case "open": {
        const path = this.path(r.dirfd, r.path);
        const existing = await this.fs.stat(path).catch(() => null);
        if (existing && r.oflags & OFlags.EXCL && r.oflags & OFlags.CREAT) return { result: -Errno.EXIST };
        if (!existing && !(r.oflags & OFlags.CREAT)) return { result: -Errno.NOENT };
        if (existing?.isDirectory) {
          if (r.write) return { result: -Errno.ISDIR };
          return { result: this.allocate({ kind: "dir", path }) };
        }
        if (r.oflags & OFlags.DIRECTORY) return { result: -Errno.NOTDIR };
        let data: Uint8Array = new Uint8Array(0);
        if (existing && !(r.oflags & OFlags.TRUNC)) data = await this.fs.readFileBuffer(path);
        const file: Descriptor = {
          kind: "file", path, data, length: data.length, pos: 0, dirty: false,
          append: (r.fdflags & FdFlags.APPEND) !== 0, read: r.read || !r.write, write: r.write,
        };
        if (!existing || r.oflags & OFlags.TRUNC) {
          // Create (or empty) it now, so a missing directory fails here and others see it.
          await this.fs.writeFile(path, new Uint8Array(0));
        }
        return { result: this.allocate(file) };
      }
      case "pathstat":
        return { result: 0, data: json(await this.stat(this.path(r.dirfd, r.path))) };
      case "mkdir":
        await this.fs.mkdir(this.path(r.dirfd, r.path));
        return { result: 0 };
      case "unlink": {
        const path = this.path(r.dirfd, r.path);
        if ((await this.fs.stat(path)).isDirectory) return { result: -Errno.ISDIR };
        await this.fs.rm(path);
        return { result: 0 };
      }
      case "rmdir": {
        const path = this.path(r.dirfd, r.path);
        if (!(await this.fs.stat(path)).isDirectory) return { result: -Errno.NOTDIR };
        await this.fs.rm(path);
        return { result: 0 };
      }
      case "rename": {
        const from = this.path(r.dirfd, r.path), to = this.path(r.newdirfd, r.newpath);
        // A file open for writing goes to its new name with what's been written.
        for (const d of this.fds.values()) if (d.kind === "file" && d.path === from) await this.flush(d);
        await this.fs.mv(from, to);
        for (const d of this.fds.values()) if (d.kind === "file" && d.path === from) d.path = to;
        return { result: 0 };
      }
      case "renumber": {
        const d = this.descriptor(r.fd);
        this.fds.set(r.to, d);
        this.fds.delete(r.fd);
        return { result: 0 };
      }
      case "poll":
        return { result: (await this.stdio.ready(r.timeout)) ? 1 : 0 };
      case "tty":
        if (!this.stdio.terminal) return { result: -Errno.NOTSUP };
        this.stdio.setMode(r.raw, r.vmin, r.vtime);
        return { result: 0 };
      case "winsize":
        if (!this.stdio.terminal) return { result: -Errno.NOTSUP };
        return { result: 0, data: json(this.stdio.size()) };
    }
  }
}
