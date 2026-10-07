/**
 * A program that drives a terminal the way it would drive xterm.js — it
 * writes bytes, listens for typed data, reads `cols`/`rows` and hears
 * resizes — connected to a `TerminalView` as its `TerminalProcess`. fx's
 * own terminal interface talks this shape.
 */
import { OutputChannel, type TerminalProcess } from "./process";
import type { TerminalSize } from "./screen";

/** The program's side: what `xtermAdapter(term)` gives a program. */
export interface XtermLike {
  write(data: Uint8Array | string): void;
  onData(handler: (data: string) => void): () => void;
  readonly cols: number;
  readonly rows: number;
  onResize(handler: (size: TerminalSize) => void): () => void;
}

export class TerminalBridge {
  private out = new OutputChannel();
  private dataHandlers = new Set<(data: string) => void>();
  private resizeHandlers = new Set<(size: TerminalSize) => void>();
  private size: TerminalSize = { cols: 80, rows: 24 };
  private sized: () => void = () => {};
  private finish: (code: number) => void = () => {};
  private onClose: (() => void) | null = null;
  /** Resolves once the view has said how big the terminal is. */
  readonly ready = new Promise<void>((resolve) => (this.sized = resolve));
  readonly exited = new Promise<number>((resolve) => (this.finish = resolve));
  readonly process: TerminalProcess;
  readonly terminal: XtermLike;

  constructor() {
    this.process = {
      write: (data) => {
        for (const handler of this.dataHandlers) handler(data);
      },
      onOutput: (handler) => this.out.subscribe(handler),
      resize: (size) => {
        const changed = size.cols !== this.size.cols || size.rows !== this.size.rows;
        this.size = { ...size };
        this.sized();
        if (changed) for (const handler of this.resizeHandlers) handler({ ...size });
      },
      exited: this.exited,
      close: () => this.onClose?.(),
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const bridge = this;
    this.terminal = {
      write: (data) => this.out.emit(data),
      onData: (handler) => {
        this.dataHandlers.add(handler);
        return () => this.dataHandlers.delete(handler);
      },
      get cols() {
        return bridge.size.cols;
      },
      get rows() {
        return bridge.size.rows;
      },
      onResize: (handler) => {
        this.resizeHandlers.add(handler);
        return () => this.resizeHandlers.delete(handler);
      },
    };
  }

  /** The program ended. */
  exit(code: number): void {
    this.finish(code);
  }

  /** What to do when the view closes the process (the window closed). */
  onClosed(handler: () => void): void {
    this.onClose = handler;
  }
}
