import type { TerminalSize } from "./screen";

/**
 * What sits on the far side of a terminal: bytes in, bytes out, a size.
 * The shape is libfx's terminal adapter reversed, so fx fits without glue,
 * and a pseudo-terminal's master side is one too.
 */
export interface TerminalProcess {
  /** Bytes from the keyboard, already encoded ("\r", "\x1b[A", "\x03", …), and replies to queries. */
  write(data: string): void;
  /** Output for the screen. Returns an unsubscribe. */
  onOutput(handler: (data: Uint8Array | string) => void): () => void;
  /** The terminal changed size; the process redraws if it cares. */
  resize(size: TerminalSize): void;
  /** Resolves with an exit code when the process ends. */
  readonly exited: Promise<number>;
  /** Stop the process and release its resources. */
  close(): void;
}

/** Output handlers with replay of anything written before the first one subscribed. */
export class OutputChannel {
  private handlers = new Set<(data: Uint8Array | string) => void>();
  private backlog: (Uint8Array | string)[] = [];

  emit(data: Uint8Array | string): void {
    if (this.handlers.size === 0) {
      this.backlog.push(data);
      return;
    }
    for (const handler of this.handlers) handler(data);
  }

  subscribe(handler: (data: Uint8Array | string) => void): () => void {
    this.handlers.add(handler);
    if (this.backlog.length) {
      const pending = this.backlog;
      this.backlog = [];
      for (const data of pending) handler(data);
    }
    return () => this.handlers.delete(handler);
  }
}

/** Types back what it is sent, with Return as a new line. For trying a view without a shell. */
export function echoProcess(): TerminalProcess {
  const out = new OutputChannel();
  let finish: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => (finish = resolve));
  return {
    write(data) {
      if (data === "\x04") {
        finish(0);
        return;
      }
      out.emit(data.replace(/\r/g, "\r\n").replace(/\x7f/g, "\b \b"));
    },
    onOutput: (handler) => out.subscribe(handler),
    resize() {},
    exited,
    close: () => finish(0),
  };
}

/** Plays back recorded output, then exits. Input is ignored. */
export function replayProcess(chunks: readonly (Uint8Array | string)[]): TerminalProcess {
  const out = new OutputChannel();
  for (const chunk of chunks) out.emit(chunk);
  return {
    write() {},
    onOutput: (handler) => out.subscribe(handler),
    resize() {},
    exited: Promise.resolve(0),
    close() {},
  };
}
