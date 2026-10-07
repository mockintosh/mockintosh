/**
 * The program side of WASI preview 1: the `wasi_snapshot_preview1` imports a
 * WebAssembly program calls, turned into requests to its owner. Each
 * request blocks (the channel waits on shared memory) until the owner
 * answers, which is what a C program expects of read(2).
 *
 * Arguments, environment, clocks, randomness and memory layout are handled
 * here; files, the terminal and directories are the owner's.
 */
import type { WasmMemory } from "./platform";
import { ClockId, Errno, EventType, FileType, Rights, decoder, encoder, parseJson, type DirEntry, type Stat, type SyncChannel } from "./abi";

/** Thrown by `proc_exit` to unwind the program; carries the exit code. */
export class ProgramExit {
  constructor(readonly code: number) {}
}

export interface HostOptions {
  args: string[];
  env: Record<string, string>;
  /** Preopened directories by fd, starting at 3: their names as the program sees them. */
  preopens: string[];
  channel: SyncChannel;
  /** Milliseconds, monotonic. */
  now(): number;
  random(bytes: Uint8Array): void;
  /** Sleep without returning to the event loop (Atomics.wait). */
  sleep(ms: number): void;
}

type Pointer = number;

const ALL_RIGHTS = 0x1fffffffn;
const SEEK = 1n << 2n;
const TELL = 1n << 5n;

export function createWasiImports(memory: () => WasmMemory, options: HostOptions): {
  wasi_snapshot_preview1: Record<string, (...args: never[]) => number | void>;
  mockintosh_tty: Record<string, (...args: never[]) => number>;
} {
  const view = () => new DataView(memory().buffer);
  const bytes = () => new Uint8Array(memory().buffer);
  const { channel } = options;
  const argBytes = options.args.map((a) => encoder.encode(a + "\0"));
  const envBytes = Object.entries(options.env).map(([k, v]) => encoder.encode(`${k}=${v}\0`));
  const preopenNames = options.preopens.map((p) => encoder.encode(p));
  const startedAt = options.now();
  /** Directory listings while a program reads them with cookies. */
  const listings = new Map<number, DirEntry[]>();

  const call = (request: Parameters<SyncChannel["call"]>[0]) => channel.call(request);
  const errno = (result: number) => (result < 0 ? -result : Errno.SUCCESS);

  function readString(ptr: Pointer, len: number): string {
    return decoder.decode(bytes().slice(ptr, ptr + len));
  }

  function writeList(list: Uint8Array[], pointers: Pointer, buffer: Pointer): number {
    const v = view(), b = bytes();
    let at = buffer;
    list.forEach((item, i) => {
      v.setUint32(pointers + i * 4, at, true);
      b.set(item, at);
      at += item.length;
    });
    return Errno.SUCCESS;
  }

  function iovecs(iovs: Pointer, count: number): { ptr: number; len: number }[] {
    const v = view();
    const out = [];
    for (let i = 0; i < count; i++) out.push({ ptr: v.getUint32(iovs + i * 8, true), len: v.getUint32(iovs + i * 8 + 4, true) });
    return out;
  }

  function gather(iovs: Pointer, count: number): Uint8Array {
    const parts = iovecs(iovs, count);
    const total = parts.reduce((n, p) => n + p.len, 0);
    const out = new Uint8Array(total);
    const b = bytes();
    let at = 0;
    for (const p of parts) {
      out.set(b.subarray(p.ptr, p.ptr + p.len), at);
      at += p.len;
    }
    return out;
  }

  function scatter(data: Uint8Array, iovs: Pointer, count: number): number {
    const b = bytes();
    let at = 0;
    for (const p of iovecs(iovs, count)) {
      const n = Math.min(p.len, data.length - at);
      if (n <= 0) break;
      b.set(data.subarray(at, at + n), p.ptr);
      at += n;
    }
    return at;
  }

  function writeStat(ptr: Pointer, stat: Stat): void {
    const v = view();
    const ns = BigInt(Math.round(stat.mtime)) * 1_000_000n;
    v.setBigUint64(ptr, 1n, true);
    v.setBigUint64(ptr + 8, BigInt(stat.ino), true);
    v.setUint8(ptr + 16, stat.filetype);
    v.setBigUint64(ptr + 24, 1n, true);
    v.setBigUint64(ptr + 32, BigInt(stat.size), true);
    v.setBigUint64(ptr + 40, ns, true);
    v.setBigUint64(ptr + 48, ns, true);
    v.setBigUint64(ptr + 56, ns, true);
  }

  function readInto(fd: number, iovs: Pointer, count: number, nread: Pointer, offset?: bigint): number {
    const max = iovecs(iovs, count).reduce((n, p) => n + p.len, 0);
    const answer = offset === undefined
      ? call({ op: "read", fd, max, timeout: null })
      : call({ op: "pread", fd, max, offset: Number(offset) });
    if (answer.result < 0) return -answer.result;
    view().setUint32(nread, scatter(answer.data ?? new Uint8Array(), iovs, count), true);
    return Errno.SUCCESS;
  }

  const wasi: Record<string, (...args: never[]) => number | void> = {
    args_sizes_get(argc: Pointer, size: Pointer) {
      view().setUint32(argc, argBytes.length, true);
      view().setUint32(size, argBytes.reduce((n, a) => n + a.length, 0), true);
      return Errno.SUCCESS;
    },
    args_get(argv: Pointer, buf: Pointer) {
      return writeList(argBytes, argv, buf);
    },
    environ_sizes_get(count: Pointer, size: Pointer) {
      view().setUint32(count, envBytes.length, true);
      view().setUint32(size, envBytes.reduce((n, a) => n + a.length, 0), true);
      return Errno.SUCCESS;
    },
    environ_get(environ: Pointer, buf: Pointer) {
      return writeList(envBytes, environ, buf);
    },
    clock_res_get(_id: number, resolution: Pointer) {
      view().setBigUint64(resolution, 1000n, true);
      return Errno.SUCCESS;
    },
    clock_time_get(id: number, _precision: bigint, time: Pointer) {
      const ms = id === ClockId.REALTIME ? Date.now() : options.now() - (id === ClockId.MONOTONIC ? 0 : startedAt);
      view().setBigUint64(time, BigInt(Math.round(ms * 1_000_000)), true);
      return Errno.SUCCESS;
    },
    fd_advise: () => Errno.SUCCESS,
    fd_allocate: () => Errno.SUCCESS,
    fd_close(fd: number) {
      listings.delete(fd);
      return errno(call({ op: "close", fd }).result);
    },
    fd_datasync(fd: number) {
      return errno(call({ op: "sync", fd }).result);
    },
    fd_sync(fd: number) {
      return errno(call({ op: "sync", fd }).result);
    },
    fd_fdstat_get(fd: number, ptr: Pointer) {
      const answer = call({ op: "fdstat", fd });
      if (answer.result < 0) return -answer.result;
      const { filetype, flags } = parseJson<{ filetype: number; flags: number }>(answer.data);
      const v = view();
      // A terminal can't seek: wasi-libc's isatty() looks for exactly that.
      const rights = filetype === FileType.CHARACTER_DEVICE ? ALL_RIGHTS & ~(SEEK | TELL) : ALL_RIGHTS;
      v.setUint8(ptr, filetype);
      v.setUint16(ptr + 2, flags, true);
      v.setBigUint64(ptr + 8, rights, true);
      v.setBigUint64(ptr + 16, rights, true);
      return Errno.SUCCESS;
    },
    fd_fdstat_set_flags: () => Errno.SUCCESS,
    fd_fdstat_set_rights: () => Errno.SUCCESS,
    fd_filestat_get(fd: number, ptr: Pointer) {
      const answer = call({ op: "filestat", fd });
      if (answer.result < 0) return -answer.result;
      writeStat(ptr, parseJson<Stat>(answer.data));
      return Errno.SUCCESS;
    },
    fd_filestat_set_size(fd: number, size: bigint) {
      return errno(call({ op: "truncate", fd, size: Number(size) }).result);
    },
    fd_filestat_set_times: () => Errno.SUCCESS,
    fd_pread(fd: number, iovs: Pointer, count: number, offset: bigint, nread: Pointer) {
      return readInto(fd, iovs, count, nread, offset);
    },
    fd_pwrite(fd: number, iovs: Pointer, count: number, offset: bigint, nwritten: Pointer) {
      const answer = call({ op: "pwrite", fd, data: gather(iovs, count), offset: Number(offset) });
      if (answer.result < 0) return -answer.result;
      view().setUint32(nwritten, answer.result, true);
      return Errno.SUCCESS;
    },
    fd_prestat_get(fd: number, ptr: Pointer) {
      const name = preopenNames[fd - 3];
      if (!name) return Errno.BADF;
      view().setUint8(ptr, 0);
      view().setUint32(ptr + 4, name.length, true);
      return Errno.SUCCESS;
    },
    fd_prestat_dir_name(fd: number, path: Pointer, len: number) {
      const name = preopenNames[fd - 3];
      if (!name) return Errno.BADF;
      bytes().set(name.subarray(0, len), path);
      return Errno.SUCCESS;
    },
    fd_read(fd: number, iovs: Pointer, count: number, nread: Pointer) {
      return readInto(fd, iovs, count, nread);
    },
    fd_readdir(fd: number, buf: Pointer, len: number, cookie: bigint, used: Pointer) {
      if (cookie === 0n || !listings.has(fd)) {
        const answer = call({ op: "readdir", fd });
        if (answer.result < 0) return -answer.result;
        listings.set(fd, [{ name: ".", filetype: FileType.DIRECTORY }, { name: "..", filetype: FileType.DIRECTORY }, ...parseJson<DirEntry[]>(answer.data)]);
      }
      const entries = listings.get(fd)!;
      const v = view(), b = bytes();
      let at = 0;
      for (let i = Number(cookie); i < entries.length && at < len; i++) {
        const name = encoder.encode(entries[i]!.name);
        const header = new Uint8Array(24);
        const h = new DataView(header.buffer);
        h.setBigUint64(0, BigInt(i + 1), true);
        h.setBigUint64(8, BigInt(i + 1), true);
        h.setUint32(16, name.length, true);
        h.setUint8(20, entries[i]!.filetype);
        const record = new Uint8Array(24 + name.length);
        record.set(header);
        record.set(name, 24);
        // A record that doesn't fit is cut off; the program asks again from its cookie.
        const n = Math.min(record.length, len - at);
        b.set(record.subarray(0, n), buf + at);
        at += n;
      }
      v.setUint32(used, at, true);
      return Errno.SUCCESS;
    },
    fd_renumber(fd: number, to: number) {
      return errno(call({ op: "renumber", fd, to }).result);
    },
    fd_seek(fd: number, offset: bigint, whence: number, newOffset: Pointer) {
      const answer = call({ op: "seek", fd, offset: Number(offset), whence });
      if (answer.result < 0) return -answer.result;
      view().setBigUint64(newOffset, BigInt(answer.result), true);
      return Errno.SUCCESS;
    },
    fd_tell(fd: number, offset: Pointer) {
      const answer = call({ op: "seek", fd, offset: 0, whence: 1 });
      if (answer.result < 0) return -answer.result;
      view().setBigUint64(offset, BigInt(answer.result), true);
      return Errno.SUCCESS;
    },
    fd_write(fd: number, iovs: Pointer, count: number, nwritten: Pointer) {
      const data = gather(iovs, count);
      const answer = call({ op: "write", fd, data });
      if (answer.result < 0) return -answer.result;
      view().setUint32(nwritten, answer.result, true);
      return Errno.SUCCESS;
    },
    path_create_directory(fd: number, path: Pointer, len: number) {
      return errno(call({ op: "mkdir", dirfd: fd, path: readString(path, len) }).result);
    },
    path_filestat_get(fd: number, _flags: number, path: Pointer, len: number, ptr: Pointer) {
      const answer = call({ op: "pathstat", dirfd: fd, path: readString(path, len) });
      if (answer.result < 0) return -answer.result;
      writeStat(ptr, parseJson<Stat>(answer.data));
      return Errno.SUCCESS;
    },
    path_filestat_set_times: () => Errno.SUCCESS,
    path_link: () => Errno.NOTSUP,
    path_open(dirfd: number, _dirflags: number, path: Pointer, len: number, oflags: number, rightsBase: bigint, _rightsInheriting: bigint, fdflags: number, fdOut: Pointer) {
      const answer = call({
        op: "open", dirfd, path: readString(path, len), oflags, fdflags,
        read: (rightsBase & Rights.FD_READ) !== 0n,
        write: (rightsBase & Rights.FD_WRITE) !== 0n,
      });
      if (answer.result < 0) return -answer.result;
      view().setUint32(fdOut, answer.result, true);
      return Errno.SUCCESS;
    },
    path_readlink: () => Errno.INVAL,
    path_remove_directory(fd: number, path: Pointer, len: number) {
      return errno(call({ op: "rmdir", dirfd: fd, path: readString(path, len) }).result);
    },
    path_rename(fd: number, path: Pointer, len: number, newFd: number, newPath: Pointer, newLen: number) {
      return errno(call({ op: "rename", dirfd: fd, path: readString(path, len), newdirfd: newFd, newpath: readString(newPath, newLen) }).result);
    },
    path_symlink: () => Errno.NOTSUP,
    path_unlink_file(fd: number, path: Pointer, len: number) {
      return errno(call({ op: "unlink", dirfd: fd, path: readString(path, len) }).result);
    },
    poll_oneoff(inPtr: Pointer, outPtr: Pointer, count: number, nevents: Pointer) {
      const v = view();
      let soonest: number | null = null;
      const clocks: { userdata: bigint; deadline: number }[] = [];
      const reads: { userdata: bigint; fd: number; type: number }[] = [];
      for (let i = 0; i < count; i++) {
        const sub = inPtr + i * 48;
        const userdata = v.getBigUint64(sub, true);
        const tag = v.getUint8(sub + 8);
        if (tag === EventType.CLOCK) {
          const timeout = Number(v.getBigUint64(sub + 24, true)) / 1_000_000;
          const absolute = (v.getUint16(sub + 40, true) & 1) === 1;
          const deadline = absolute ? timeout - Date.now() : timeout;
          clocks.push({ userdata, deadline: Math.max(0, deadline) });
          soonest = soonest === null ? Math.max(0, deadline) : Math.min(soonest, Math.max(0, deadline));
        } else {
          reads.push({ userdata, fd: v.getUint32(sub + 16, true), type: tag });
        }
      }
      const events: { userdata: bigint; type: number; error: number }[] = [];
      // Writes are always ready; so are reads from anything but the terminal.
      for (const r of reads) if (r.type === EventType.FD_WRITE || r.fd !== 0) events.push({ userdata: r.userdata, type: r.type, error: 0 });
      const stdin = reads.find((r) => r.type === EventType.FD_READ && r.fd === 0);
      if (!events.length && stdin) {
        const ready = call({ op: "poll", timeout: soonest });
        if (ready.result > 0) events.push({ userdata: stdin.userdata, type: EventType.FD_READ, error: 0 });
      } else if (!events.length && soonest !== null) {
        options.sleep(soonest);
      }
      if (!events.length) for (const c of clocks) if (c.deadline <= (soonest ?? 0)) events.push({ userdata: c.userdata, type: EventType.CLOCK, error: 0 });
      events.forEach((e, i) => {
        const at = outPtr + i * 32;
        v.setBigUint64(at, e.userdata, true);
        v.setUint16(at + 8, e.error, true);
        v.setUint8(at + 10, e.type);
        v.setBigUint64(at + 16, e.type === EventType.CLOCK ? 0n : 1n, true);
        v.setUint16(at + 24, 0, true);
      });
      v.setUint32(nevents, events.length, true);
      return Errno.SUCCESS;
    },
    proc_exit(code: number) {
      throw new ProgramExit(code);
    },
    proc_raise: () => Errno.NOSYS,
    sched_yield: () => Errno.SUCCESS,
    random_get(buf: Pointer, len: number) {
      const out = new Uint8Array(len);
      for (let at = 0; at < len; at += 65536) options.random(out.subarray(at, Math.min(len, at + 65536)));
      bytes().set(out, buf);
      return Errno.SUCCESS;
    },
    sock_accept: () => Errno.NOTSUP,
    sock_recv: () => Errno.NOTSUP,
    sock_send: () => Errno.NOTSUP,
    sock_shutdown: () => Errno.NOTSUP,
  };

  /** Terminal control for programs built with Mockintosh's `termios` shim. */
  const tty: Record<string, (...args: never[]) => number> = {
    /** raw: 1 = raw mode with VMIN `vmin` and VTIME `vtime` (tenths of a second); 0 = cooked. */
    set_mode(raw: number, vmin: number, vtime: number) {
      return errno(call({ op: "tty", raw: raw !== 0, vmin, vtime }).result);
    },
    get_size(cols: Pointer, rows: Pointer) {
      const answer = call({ op: "winsize" });
      if (answer.result < 0) return -answer.result;
      const size = parseJson<{ cols: number; rows: number }>(answer.data);
      view().setUint32(cols, size.cols, true);
      view().setUint32(rows, size.rows, true);
      return Errno.SUCCESS;
    },
  };

  return { wasi_snapshot_preview1: wasi, mockintosh_tty: tty };
}
