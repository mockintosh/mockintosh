/**
 * The host globals the OS core assumes beyond ECMAScript itself.
 *
 * Every JavaScript engine we target (browsers and Node) provides
 * these; an engine that lacks one (QuickJS has no timers or text codecs of
 * its own) must polyfill it before `bootOS()`. Anything not listed here
 * must come through the `Platform` interface — this file is the whole
 * allow-list, and `tsconfig.core.json` enforces it.
 */

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

declare function queueMicrotask(callback: () => void): void;
declare function setTimeout(callback: () => void, ms?: number): number;
declare function clearTimeout(id: number | null | undefined): void;
declare function setInterval(callback: () => void, ms?: number): number;
declare function clearInterval(id: number | null | undefined): void;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

interface AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare module "*.json" {
  const value: unknown;
  export default value;
}
