/**
 * Blocking calls from a program's worker to its owner over shared memory.
 * The program posts a request and waits (`Atomics.wait`) on a flag; the
 * owner answers asynchronously, writes the result into the shared buffer
 * and wakes it. One request at a time: the program is single-threaded.
 *
 * Layout (Int32 words): [0] state (0 waiting, 1 answered), [1] result,
 * [2] byte length; bytes from offset 16.
 */
import type { Syscall, SyncChannel, SyscallResult } from "./abi";

export const CHANNEL_CAPACITY = 1 << 20;
const HEADER = 16;

export function createChannelBuffer(): SharedArrayBuffer {
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error("this browser can't share memory with a program here, so WebAssembly programs can't run (the page isn't cross-origin isolated)");
  }
  return new SharedArrayBuffer(HEADER + CHANNEL_CAPACITY);
}

/** The program's side. `post` sends the request to the owner. */
export class SharedChannel implements SyncChannel {
  private words: Int32Array;
  private data: Uint8Array;

  constructor(buffer: SharedArrayBuffer, private post: (request: Syscall) => void) {
    this.words = new Int32Array(buffer, 0, 4);
    this.data = new Uint8Array(buffer, HEADER);
  }

  call(request: Syscall): SyscallResult {
    Atomics.store(this.words, 0, 0);
    this.post(request);
    while (Atomics.load(this.words, 0) === 0) Atomics.wait(this.words, 0, 0);
    const result = this.words[1]!;
    const length = this.words[2]!;
    return length > 0 ? { result, data: this.data.slice(0, length) } : { result };
  }
}

/** The owner's side: answer one request into the shared buffer and wake the program. */
export function answer(buffer: SharedArrayBuffer, response: SyscallResult): void {
  const words = new Int32Array(buffer, 0, 4);
  const data = new Uint8Array(buffer, HEADER);
  const bytes = response.data ?? new Uint8Array();
  if (bytes.length > CHANNEL_CAPACITY) throw new Error("Answer too large for the channel");
  data.set(bytes);
  words[1] = response.result;
  words[2] = bytes.length;
  Atomics.store(words, 0, 1);
  Atomics.notify(words, 0);
}
