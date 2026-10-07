/**
 * The host APIs WebAssembly programs need — WebAssembly itself, fetch,
 * workers, inflating — reached through the global object with only the
 * types used here. The OS core compiles without DOM types, and Terminal is
 * part of what it compiles.
 */

/** A compiled program. Opaque; workers can be sent one. */
export type WasmModule = { readonly __wasmModule: unique symbol };
export interface WasmMemory {
  readonly buffer: ArrayBuffer;
}
interface WasmInstance {
  readonly exports: Record<string, unknown>;
}

interface WebAssemblyApi {
  compile(bytes: Uint8Array): Promise<WasmModule>;
  Instance: new (module: WasmModule, imports: object) => WasmInstance;
  RuntimeError: new (...args: never[]) => Error;
}

interface HostGlobals {
  WebAssembly: WebAssemblyApi;
  fetch(url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  performance: { now(): number };
  crypto: { getRandomValues(bytes: Uint8Array): Uint8Array };
  Blob: new (parts: Uint8Array[]) => { stream(): { pipeThrough(transform: unknown): unknown } };
  DecompressionStream: new (format: "deflate-raw") => unknown;
  Response: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
}

const host = globalThis as unknown as HostGlobals;

export function compileWasm(bytes: Uint8Array): Promise<WasmModule> {
  return host.WebAssembly.compile(bytes);
}

export function instantiateWasm(module: WasmModule, imports: object): WasmInstance {
  return new host.WebAssembly.Instance(module, imports);
}

export function isWasmTrap(error: unknown): boolean {
  return error instanceof host.WebAssembly.RuntimeError;
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await host.fetch(url);
  if (!response.ok) throw new Error(`couldn't load ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export function monotonicNow(): number {
  return host.performance.now();
}

export function randomFill(bytes: Uint8Array): void {
  host.crypto.getRandomValues(bytes);
}

/** Raw DEFLATE, as in a zip entry. */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new host.Blob([bytes]).stream().pipeThrough(new host.DecompressionStream("deflate-raw"));
  return new Uint8Array(await new host.Response(stream).arrayBuffer());
}
