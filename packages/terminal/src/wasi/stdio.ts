/**
 * What a program's fds 0–2 are: the terminal (through the pty, with its
 * modes) when it runs attached, or bytes in and out inside a pipeline.
 */
import { COOKED, type Termios, type Tty } from "../pty";
import type { ProgramStdio } from "./owner";

const encoder = new TextEncoder();

/** cfmakeraw: no line editing, echo, signals or output processing. */
const RAW_MODE: Termios = { canonical: false, echo: false, signals: false, crToNl: false, nlToCrNl: false };

export class TtyStdio implements ProgramStdio {
  readonly terminal = true;
  private pending: Uint8Array = new Uint8Array(0);
  private eof = false;
  private raw = false;
  private vmin = 1;
  private vtime = 0;
  private saved: Termios;

  constructor(private tty: Tty, private signal: AbortSignal) {
    this.saved = tty.getAttr();
  }

  /** Read from the tty into `pending`, waiting at most `timeoutMs` (null: until something arrives). */
  private async fill(timeoutMs: number | null): Promise<void> {
    if (this.pending.length || this.eof) return;
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    this.signal.addEventListener("abort", onAbort, { once: true });
    const timer = timeoutMs === null ? null : setTimeout(() => stop.abort(), timeoutMs);
    try {
      const text = await this.tty.read(stop.signal);
      if (text === null) {
        if (!stop.signal.aborted) this.eof = true;
        return;
      }
      this.pending = encoder.encode(text);
    } finally {
      if (timer !== null) clearTimeout(timer);
      this.signal.removeEventListener("abort", onAbort);
    }
  }

  async read(max: number, timeoutMs: number | null): Promise<Uint8Array | null> {
    // VMIN/VTIME decide how long a raw read waits; a cooked read waits for a line.
    const wait = this.raw && this.vmin === 0 ? this.vtime * 100 : timeoutMs;
    await this.fill(wait);
    if (!this.pending.length) {
      if (this.eof) {
        this.eof = false;
        return null;
      }
      return new Uint8Array(0);
    }
    const out = this.pending.slice(0, max);
    this.pending = this.pending.slice(out.length);
    return out;
  }

  async ready(timeoutMs: number | null): Promise<boolean> {
    await this.fill(timeoutMs);
    return this.pending.length > 0 || this.eof;
  }

  write(_fd: 1 | 2, data: Uint8Array): void {
    this.tty.write(data);
  }

  setMode(raw: boolean, vmin: number, vtime: number): void {
    this.raw = raw;
    this.vmin = vmin;
    this.vtime = vtime;
    this.tty.setAttr(raw ? RAW_MODE : this.saved.canonical ? this.saved : COOKED);
  }

  size(): { cols: number; rows: number } {
    return this.tty.size;
  }

  /** The program ended: the terminal goes back to how the shell left it. */
  restore(): void {
    this.tty.setAttr(this.saved);
  }
}

/** A program inside a pipeline: stdin is bytes, stdout and stderr are collected. */
export class BufferStdio implements ProgramStdio {
  readonly terminal = false;
  private input: Uint8Array;
  private out: Uint8Array[] = [];
  private err: Uint8Array[] = [];

  constructor(stdin: string | Uint8Array) {
    this.input = typeof stdin === "string" ? encoder.encode(stdin) : stdin;
  }

  async read(max: number): Promise<Uint8Array | null> {
    if (!this.input.length) return null;
    const data = this.input.slice(0, max);
    this.input = this.input.slice(data.length);
    return data;
  }

  async ready(): Promise<boolean> {
    return true;
  }

  write(fd: 1 | 2, data: Uint8Array): void {
    (fd === 1 ? this.out : this.err).push(data.slice());
  }

  setMode(): void {}

  size(): { cols: number; rows: number } {
    return { cols: 80, rows: 24 };
  }

  private static text(parts: Uint8Array[]): string {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return new TextDecoder().decode(all);
  }

  get stdout(): string {
    return BufferStdio.text(this.out);
  }

  get stderr(): string {
    return BufferStdio.text(this.err);
  }
}
