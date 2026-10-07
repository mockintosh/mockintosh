import type { FetchFunction } from "@mockintosh/sdk";

/**
 * The browser's `fetch` as the SDK's `FetchFunction`. The SDK takes any
 * `Uint8Array` body; the DOM types only take one over a plain `ArrayBuffer`,
 * and `fetch` rejects a shared one when it runs.
 */
export const webFetch: FetchFunction = (url, options) => globalThis.fetch(url, options as RequestInit);
