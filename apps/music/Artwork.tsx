import { createEffect, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { ditherArtwork, type AppleMusicSession } from "./api";

/** Downloads at a time; a grid of albums would otherwise ask for a hundred at once. */
const CONCURRENCY = 4;

/**
 * Dithered artwork, fetched once per URL and size and shared by every tile
 * that shows it.
 */
export interface ArtworkLoader {
  load(url: string, size: number): Promise<Uint8Array | null>;
}

export function createArtworkLoader(session: AppleMusicSession): ArtworkLoader {
  const cache = new Map<string, Promise<Uint8Array | null>>();
  const waiting: Array<() => void> = [];
  let running = 0;

  function slot(): Promise<void> {
    if (running < CONCURRENCY) {
      running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  }
  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }

  return {
    load(url, size) {
      const key = `${size}:${url}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = slot().then(() => ditherArtwork(url, size, session).finally(release));
        cache.set(key, pending);
      }
      return pending;
    },
  };
}

/** A square of artwork, with a gray placeholder until it arrives (or when there is none). */
export function Artwork(props: { loader: ArtworkLoader; url: string | null; size: number }): JSX.Element {
  const [bits, setBits] = createSignal<Uint8Array | null>(null);
  createEffect(
    () => [props.url, props.size] as const,
    ([url, size]) => {
      setBits(null);
      if (!url) return;
      void props.loader.load(url, size).then((px) => {
        if (props.url === url && props.size === size) setBits(px);
      });
    },
  );
  return (
    <raster
      width={props.size}
      height={props.size}
      revision={bits() ? 1 : 0}
      onPaint={({ rect, setPixel, blitPixels }) => {
        const px = bits();
        if (px) {
          blitPixels(px, props.size, props.size);
          return;
        }
        const last = rect.width - 1;
        for (let y = 0; y < rect.height; y++) {
          for (let x = 0; x < rect.width; x++) {
            const edge = x === 0 || y === 0 || x === last || y === rect.height - 1;
            setPixel(x, y, edge || (x % 2 === 0 && y % 2 === 0) ? 1 : 0);
          }
        }
      }}
    />
  );
}
