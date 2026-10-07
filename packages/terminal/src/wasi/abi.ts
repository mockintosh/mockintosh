/** WASI preview 1 numbers (wasi_snapshot_preview1). */

export const Errno = {
  SUCCESS: 0, TOOBIG: 1, ACCES: 2, AGAIN: 6, BADF: 8, EXIST: 20, FAULT: 21, INVAL: 28, IO: 29, ISDIR: 31,
  NAMETOOLONG: 37, NOENT: 44, NOSYS: 52, NOTDIR: 54, NOTEMPTY: 55, NOTSUP: 58, PERM: 63, ROFS: 69, SPIPE: 70, NOTCAPABLE: 76,
} as const;

export const FileType = {
  UNKNOWN: 0, BLOCK_DEVICE: 1, CHARACTER_DEVICE: 2, DIRECTORY: 3, REGULAR_FILE: 4, SOCKET_DGRAM: 5, SOCKET_STREAM: 6, SYMBOLIC_LINK: 7,
} as const;

export const OFlags = { CREAT: 1, DIRECTORY: 2, EXCL: 4, TRUNC: 8 } as const;
export const FdFlags = { APPEND: 1, DSYNC: 2, NONBLOCK: 4, RSYNC: 8, SYNC: 16 } as const;
export const Whence = { SET: 0, CUR: 1, END: 2 } as const;
export const Rights = { FD_READ: 1n << 1n, FD_WRITE: 1n << 6n } as const;
export const EventType = { CLOCK: 0, FD_READ: 1, FD_WRITE: 2 } as const;
export const ClockId = { REALTIME: 0, MONOTONIC: 1, PROCESS_CPUTIME: 2, THREAD_CPUTIME: 3 } as const;

/** What a stat answers, as the owner sends it. */
export interface Stat {
  filetype: number;
  size: number;
  /** Milliseconds since the epoch. */
  mtime: number;
  ino: number;
}

/** A directory entry, as the owner sends it. */
export interface DirEntry {
  name: string;
  filetype: number;
}

/**
 * A request from a program to its owner. The owner answers with a number
 * (a count, an fd, or a negated errno) and optional bytes.
 */
export type Syscall =
  | { op: "read"; fd: number; max: number; /** ms; null blocks */ timeout: number | null }
  | { op: "pread"; fd: number; max: number; offset: number }
  | { op: "write"; fd: number; data: Uint8Array }
  | { op: "pwrite"; fd: number; data: Uint8Array; offset: number }
  | { op: "seek"; fd: number; offset: number; whence: number }
  | { op: "close"; fd: number }
  | { op: "sync"; fd: number }
  | { op: "fdstat"; fd: number }
  | { op: "filestat"; fd: number }
  | { op: "truncate"; fd: number; size: number }
  | { op: "readdir"; fd: number }
  | { op: "open"; dirfd: number; path: string; oflags: number; fdflags: number; read: boolean; write: boolean }
  | { op: "pathstat"; dirfd: number; path: string }
  | { op: "mkdir"; dirfd: number; path: string }
  | { op: "unlink"; dirfd: number; path: string }
  | { op: "rmdir"; dirfd: number; path: string }
  | { op: "rename"; dirfd: number; path: string; newdirfd: number; newpath: string }
  | { op: "renumber"; fd: number; to: number }
  /** Wait until fd 0 has input or `timeout` ms pass; answers 1 when ready. */
  | { op: "poll"; timeout: number | null }
  /** Terminal control: raw mode with VMIN/VTIME, or back to cooked. */
  | { op: "tty"; raw: boolean; vmin: number; vtime: number }
  | { op: "winsize" };

export interface SyscallResult {
  result: number;
  data?: Uint8Array;
}

/** How the program side asks its owner, blocking until the answer. */
export interface SyncChannel {
  call(request: Syscall): SyscallResult;
}

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

export function parseJson<T>(data: Uint8Array | undefined): T {
  return JSON.parse(decoder.decode(data ?? new Uint8Array())) as T;
}
