/**
 * Vector tiles from OpenFreeMap (https://openfreemap.org): OpenStreetMap
 * data in the OpenMapTiles schema, free, with no key, and served with CORS
 * so the app fetches them itself. The tile URL changes with each weekly
 * build, so it is read from the TileJSON first.
 *
 * Tiles are fetched a few at a time, most wanted first, and kept in a small
 * cache. A tile the map stops asking for is never fetched.
 */
import type { FetchFunction } from "@mockintosh/sdk";
import { TileFormatError, decodeTile, type VectorTile } from "./mvt";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";

export interface TileAddress {
  z: number;
  x: number;
  y: number;
}

export const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

export interface TileSourceOptions {
  fetch: FetchFunction;
  /** Monotonic milliseconds, for retrying after a failure. */
  now: () => number;
  /** Called after a tile arrives (or fails), so the map can redraw. */
  onChange: () => void;
  tileJsonUrl?: string;
  /** Tiles kept decoded. */
  capacity?: number;
  /** Requests in flight at once. */
  concurrency?: number;
}

const RETRY_MS = 8000;

interface TileJson {
  tiles?: unknown;
  maxzoom?: unknown;
}

export class TileSource {
  /** The deepest zoom the server has; deeper views draw these tiles larger. */
  maxZoom = 14;
  private template: string | null = null;
  private templateLoading = false;
  private templateFailedAt = -Infinity;
  private readonly cache = new Map<string, VectorTile>();
  private readonly loading = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private wanted: TileAddress[] = [];
  private lastError: string | null = null;

  constructor(private readonly options: TileSourceOptions) {}

  /** A tile that has arrived. */
  get(z: number, x: number, y: number): VectorTile | undefined {
    const key = tileKey(z, x, y);
    const tile = this.cache.get(key);
    if (tile) {
      this.cache.delete(key);
      this.cache.set(key, tile);
    }
    return tile;
  }

  /** Tiles asked for that haven't arrived. */
  get pending(): number {
    return this.wanted.filter(({ z, x, y }) => !this.cache.has(tileKey(z, x, y))).length;
  }

  /** Why the last request failed, until one succeeds. */
  get error(): string | null {
    return this.lastError;
  }

  /** Ask for these tiles, most wanted first. Earlier asks not repeated here are dropped. */
  want(tiles: readonly TileAddress[]): void {
    this.wanted = tiles.filter(({ z, x, y }) => !this.cache.has(tileKey(z, x, y)));
    this.pump();
  }

  private pump(): void {
    if (!this.template) {
      this.loadTemplate();
      return;
    }
    const limit = this.options.concurrency ?? 6;
    const now = this.options.now();
    for (const tile of this.wanted) {
      if (this.loading.size >= limit) return;
      const key = tileKey(tile.z, tile.x, tile.y);
      if (this.cache.has(key) || this.loading.has(key)) continue;
      if (now - (this.failedAt.get(key) ?? -Infinity) < RETRY_MS) continue;
      void this.load(tile, key);
    }
  }

  private loadTemplate(): void {
    if (this.templateLoading || this.options.now() - this.templateFailedAt < RETRY_MS) return;
    this.templateLoading = true;
    void (async () => {
      try {
        const response = await this.options.fetch(this.options.tileJsonUrl ?? TILEJSON_URL);
        if (!response.ok) throw new Error(`The map server answered ${response.status}.`);
        const json = (await response.json()) as TileJson;
        const template = Array.isArray(json.tiles) ? json.tiles[0] : undefined;
        if (typeof template !== "string" || !template.includes("{z}")) throw new Error("The map server sent no tile address.");
        this.template = template;
        if (typeof json.maxzoom === "number") this.maxZoom = json.maxzoom;
        this.lastError = null;
      } catch (err) {
        this.templateFailedAt = this.options.now();
        this.lastError = describe(err);
      } finally {
        this.templateLoading = false;
      }
      this.options.onChange();
      if (this.template) this.pump();
    })();
  }

  private async load(tile: TileAddress, key: string): Promise<void> {
    this.loading.add(key);
    try {
      const url = this.template!.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
      const response = await this.options.fetch(url);
      // The server has nothing at all for some ocean tiles.
      const bytes = response.status === 204 || response.status === 404 ? new Uint8Array(0) : await body(response);
      this.cache.set(key, decodeTile(bytes));
      this.failedAt.delete(key);
      this.lastError = null;
      while (this.cache.size > (this.options.capacity ?? 24)) this.cache.delete(this.cache.keys().next().value!);
    } catch (err) {
      this.failedAt.set(key, this.options.now());
      this.lastError = describe(err);
    } finally {
      this.loading.delete(key);
    }
    this.options.onChange();
    this.pump();
  }
}

async function body(response: Awaited<ReturnType<FetchFunction>>): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`The map server answered ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function describe(err: unknown): string {
  if (err instanceof TileFormatError) return "The map server sent a damaged tile.";
  if (err instanceof Error && /answered|sent/.test(err.message)) return err.message;
  return "Maps can't reach the map server.";
}
