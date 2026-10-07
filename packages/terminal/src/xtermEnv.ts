/**
 * `@xterm/headless` asks `"requestIdleCallback" in window` as it loads when
 * it isn't in Node; a Web Worker (where apps run) has no `window`. Lend it
 * the global object for that one question; `screen.ts` takes it back once
 * xterm has loaded.
 */
const scope = globalThis as { window?: unknown };
export const lentWindow = typeof scope.window === "undefined";
if (lentWindow) scope.window = globalThis;

export function returnWindow(): void {
  if (lentWindow) delete scope.window;
}
