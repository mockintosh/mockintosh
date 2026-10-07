/**
 * A pseudo-terminal: the Unix tty driver between a terminal and the
 * programs that use it. The terminal side (`master`) is a
 * `TerminalProcess` a `TerminalView` connects to; the program side is a
 * `Tty` with the termios modes that matter:
 *
 * - canonical (ICANON): the driver edits a line (erase, kill, word erase)
 *   and hands it over on Return; ⌃D ends input. Otherwise every byte goes
 *   to the program as it arrives (raw mode, for editors and line editors).
 * - echo (ECHO): the driver types back what it receives.
 * - signals (ISIG): ⌃C, ⌃\ and ⌃Z become SIGINT, SIGQUIT and SIGTSTP for
 *   the foreground job instead of input.
 * - crToNl (ICRNL): Return arrives as "\n".
 * - nlToCrNl (ONLCR): "\n" from the program goes to the screen as "\r\n".
 *
 * A window resize is SIGWINCH for the foreground job.
 */
import { OutputChannel, type TerminalProcess } from "./process";
import type { TerminalSize } from "./screen";
import { charWidth } from "./width";

export interface Termios {
  canonical: boolean;
  echo: boolean;
  signals: boolean;
  crToNl: boolean;
  nlToCrNl: boolean;
}

export type Signal = "SIGINT" | "SIGQUIT" | "SIGTSTP" | "SIGWINCH" | "SIGHUP" | "SIGTERM" | "SIGKILL";

/** Exit status for a program ended by `signal`, as a shell reports it (128 + number). */
export const SIGNAL_NUMBERS: Record<Signal, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15, SIGTSTP: 20, SIGWINCH: 28,
};

export const COOKED: Readonly<Termios> = Object.freeze({ canonical: true, echo: true, signals: true, crToNl: true, nlToCrNl: true });
export const RAW: Readonly<Termios> = Object.freeze({ canonical: false, echo: false, signals: false, crToNl: false, nlToCrNl: true });

/** The program side of a pseudo-terminal. */
export interface Tty {
  /**
   * The next input: a whole line in canonical mode, whatever has arrived
   * otherwise. `null` at end of input (⌃D on an empty line, or hang-up).
   */
  read(signal?: AbortSignal): Promise<string | null>;
  /** Input ready now, without waiting (raw mode); "" when there is none. */
  readAvailable(): string;
  write(data: Uint8Array | string): void;
  readonly size: TerminalSize;
  getAttr(): Termios;
  setAttr(changes: Partial<Termios>): void;
  /** Who gets the driver's signals and SIGWINCH: the foreground job. Returns the previous handler. */
  setForeground(handler: ((signal: Signal) => void) | null): ((signal: Signal) => void) | null;
  /** Throw away input not yet read (what a shell does after ⌃C). */
  flushInput(): void;
  readonly closed: boolean;
}

const encoder = new TextEncoder();
type StreamDecoder = { decode(input: Uint8Array, options: { stream: boolean }): string };

export class Pty {
  private out = new OutputChannel();
  private termios: Termios = { ...COOKED };
  private size: TerminalSize = { cols: 80, rows: 24 };
  /** Bytes ready for the program. */
  private ready = "";
  /** The line being edited in canonical mode. */
  private line: string[] = [];
  /** ⌃D seen: the next read returns what's ready, or end of input. */
  private eof = false;
  private waiter: (() => void) | null = null;
  private foreground: ((signal: Signal) => void) | null = null;
  /** Streaming, so a character split across two writes isn't mangled. */
  private decoder = new TextDecoder() as unknown as StreamDecoder;
  private hungUp = false;
  private finish: (code: number) => void = () => {};
  readonly exited: Promise<number>;
  readonly master: TerminalProcess;
  readonly slave: Tty;

  constructor() {
    this.exited = new Promise((resolve) => (this.finish = resolve));
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const pty = this;
    this.master = {
      write: (data) => this.input(data),
      onOutput: (handler) => this.out.subscribe(handler),
      resize: (size) => this.resize(size),
      exited: this.exited,
      close: () => this.hangUp(),
    };
    this.slave = {
      read: (signal) => this.read(signal),
      readAvailable: () => {
        if (this.termios.canonical) return "";
        const data = this.ready;
        this.ready = "";
        return data;
      },
      write: (data) => this.output(data),
      get size() {
        return { ...pty.size };
      },
      getAttr: () => ({ ...this.termios }),
      setAttr: (changes) => this.setAttr(changes),
      setForeground: (handler) => {
        const previous = this.foreground;
        this.foreground = handler;
        return previous;
      },
      flushInput: () => {
        this.ready = "";
        this.line = [];
        this.eof = false;
      },
      get closed() {
        return pty.hungUp;
      },
    };
  }

  /** The program side is done: the terminal sees the exit. */
  exit(code: number): void {
    this.hungUp = true;
    this.wake();
    this.finish(code);
  }

  /** The terminal went away (its window closed): SIGHUP, and reads end. */
  hangUp(): void {
    if (this.hungUp) return;
    this.hungUp = true;
    this.foreground?.("SIGHUP");
    this.wake();
  }

  private setAttr(changes: Partial<Termios>): void {
    const wasCanonical = this.termios.canonical;
    this.termios = { ...this.termios, ...changes };
    if (wasCanonical && !this.termios.canonical && this.line.length) {
      // Leaving canonical mode releases the line being edited.
      this.ready += this.line.join("");
      this.line = [];
      this.wake();
    }
  }

  private resize(size: TerminalSize): void {
    if (size.cols === this.size.cols && size.rows === this.size.rows) return;
    this.size = { ...size };
    this.foreground?.("SIGWINCH");
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  private output(data: Uint8Array | string): void {
    let text = typeof data === "string" ? data : this.decoder.decode(data, { stream: true });
    if (this.termios.nlToCrNl) text = text.replace(/\r?\n/g, "\r\n");
    this.out.emit(text);
  }

  private echo(text: string): void {
    if (this.termios.echo) this.out.emit(text);
  }

  /** Bytes from the terminal: keys, pastes and replies to the program's queries. */
  private input(data: string): void {
    if (this.hungUp) return;
    const t = this.termios;
    for (const ch of data) {
      if (t.signals) {
        const signal = ch === "\x03" ? "SIGINT" : ch === "\x1c" ? "SIGQUIT" : ch === "\x1a" ? "SIGTSTP" : null;
        if (signal) {
          this.echo(ch === "\x03" ? "^C" : ch === "\x1c" ? "^\\" : "^Z");
          this.ready = "";
          this.line = [];
          this.foreground?.(signal);
          continue;
        }
      }
      let c = ch;
      if (t.crToNl && c === "\r") c = "\n";
      if (!t.canonical) {
        this.ready += c;
        this.echo(c === "\n" ? "\r\n" : c);
        continue;
      }
      this.canonicalKey(c);
    }
    if (this.ready || this.eof) this.wake();
  }

  private canonicalKey(c: string): void {
    switch (c) {
      case "\x7f":
      case "\x08": {
        const removed = this.line.pop();
        if (removed !== undefined) {
          const w = removed === "\t" ? 1 : charWidth(removed.codePointAt(0)!);
          this.echo("\b \b".repeat(w));
        }
        return;
      }
      case "\x15": // ⌃U
        while (this.line.length) {
          const removed = this.line.pop()!;
          this.echo("\b \b".repeat(charWidth(removed.codePointAt(0)!)));
        }
        return;
      case "\x17": { // ⌃W
        while (this.line.length && this.line[this.line.length - 1] === " ") this.echo("\b \b"), this.line.pop();
        while (this.line.length && this.line[this.line.length - 1] !== " ") {
          const removed = this.line.pop()!;
          this.echo("\b \b".repeat(charWidth(removed.codePointAt(0)!)));
        }
        return;
      }
      case "\x04": // ⌃D: what's typed so far, or end of input on an empty line
        this.ready += this.line.join("");
        this.line = [];
        this.eof = true;
        return;
      case "\n":
        this.echo("\r\n");
        this.ready += this.line.join("") + "\n";
        this.line = [];
        return;
    }
    if (c < " " && c !== "\t" && c !== "\x1b") {
      // Other control characters go into the line, echoed as ^X.
      this.echo("^" + String.fromCharCode(c.charCodeAt(0) + 64));
      this.line.push(c);
      return;
    }
    this.line.push(c);
    this.echo(c);
  }

  private async read(signal?: AbortSignal): Promise<string | null> {
    for (;;) {
      if (signal?.aborted) return null;
      if (this.termios.canonical) {
        const nl = this.ready.indexOf("\n");
        if (nl >= 0) {
          const out = this.ready.slice(0, nl + 1);
          this.ready = this.ready.slice(nl + 1);
          return out;
        }
        if (this.eof) {
          this.eof = false;
          const out = this.ready;
          this.ready = "";
          return out === "" ? null : out;
        }
      } else if (this.ready) {
        const out = this.ready;
        this.ready = "";
        return out;
      } else if (this.eof) {
        this.eof = false;
        return null;
      }
      if (this.hungUp) return null;
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  }
}

/** Bytes of `text` as the program sees them. */
export function ttyBytes(text: string): Uint8Array {
  return encoder.encode(text);
}
