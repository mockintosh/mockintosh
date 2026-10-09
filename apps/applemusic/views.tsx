import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, measureText } from "@mockintosh/ui";
import { Artwork, type ArtworkLoader } from "./Artwork";
import { formatDuration, isPlaying, type Artist, type Collection, type Genre, type NowPlaying, type Track } from "./api";

/** What the content pane shows. */
export type Route =
  | { view: "search" }
  | { view: "home" }
  | { view: "browse" }
  | { view: "radio" }
  | { view: "genre"; genre: Genre }
  | { view: "recent" }
  | { view: "artists" }
  | { view: "albums" }
  | { view: "songs" }
  | { view: "collection"; collection: Collection }
  | { view: "artist"; artist: Artist };

export const SIDEBAR_W = 112;
const PAD = 6;
/** The smallest a grid tile gets; tiles grow from here to fill the row. */
const MIN_TILE = 64;
const TILE_GAP = 8;
const ROW_H = 16;
const HEADER_ART = 72;
const TIME_W = 34;
/** Track rows' highlight reaches this far past the text on each side, into the page's padding. */
const ROW_INSET = 4;
const COLUMN_GAP = 6;

/** `text`, cut with an ellipsis to fit `width` pixels; `bold` measures it as drawn bold, which is wider. */
export function fit(text: string, width: number, font = "body", bold = false): string {
  const style = { bold };
  if (measureText(text, font, style) <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(`${text.slice(0, mid)}…`, font, style) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/**
 * The value of `fetch`, once it arrives: `undefined` while loading. Kept
 * by the app under `key` so returning to a view doesn't fetch it again.
 */
export function useLoaded<T>(key: () => string, fetch: (key: string) => Promise<T>): () => T | undefined {
  const [value, setValue] = createSignal<{ key: string; value: T } | null>(null);
  createEffect(key, (k) => {
    // A failure is reported by the fetcher; the view stays on Loading.
    fetch(k).then((v) => setValue({ key: k, value: v }), () => undefined);
  });
  return () => {
    const v = value();
    return v && v.key === key() ? v.value : undefined;
  };
}

// --- Sidebar ---------------------------------------------------------------

/** Apple Music's own pages; some need the account (Home is yours, stations don't play as previews). */
const CATALOG: Array<{ label: string; route: Route; signedIn?: boolean }> = [
  { label: "Search", route: { view: "search" } },
  { label: "Home", route: { view: "home" }, signedIn: true },
  { label: "Browse", route: { view: "browse" } },
  { label: "Radio", route: { view: "radio" }, signedIn: true },
];

const LIBRARY: Array<{ label: string; route: Route }> = [
  { label: "Recently Added", route: { view: "recent" } },
  { label: "Artists", route: { view: "artists" } },
  { label: "Albums", route: { view: "albums" } },
  { label: "Songs", route: { view: "songs" } },
];

function SidebarRow(props: { label: string; selected: boolean; onClick: () => void }): JSX.Element {
  return (
    <box height={ROW_H} flexDirection="row" alignItems="center" paddingLeft={PAD} paddingRight={4} background={props.selected ? 1 : 0} onClick={props.onClick}>
      <text font="body" color={props.selected ? 0 : 1} nowrap>
        {fit(props.label, SIDEBAR_W - PAD - 8)}
      </text>
    </box>
  );
}

function SidebarHeading(props: { children: string }): JSX.Element {
  return (
    <box height={ROW_H + 4} flexDirection="row" alignItems="flex-end" paddingLeft={4}>
      <text font="body" bold nowrap>{props.children}</text>
    </box>
  );
}

/**
 * The sidebar stays put while the window scrolls the page beside it: it is
 * drawn over the page at the scroll offset, with a rule down its right edge.
 */
export function Sidebar(props: {
  top: number;
  height: number;
  /** The section to highlight: where the current page's Back trail starts. */
  route: Route;
  /** Signed out, the sidebar offers the catalog and a way to sign in instead of a library. */
  signedIn: boolean;
  signingIn: boolean;
  playlists: Collection[];
  onSelect: (route: Route) => void;
  onSignIn: () => void;
}): JSX.Element {
  const isSelected = (route: Route) => {
    const current = props.route;
    if (route.view === "collection") return current.view === "collection" && current.collection.id === route.collection.id;
    return current.view === route.view;
  };
  return (
    <box
      position="absolute"
      left={0}
      top={props.top}
      width={SIDEBAR_W}
      height={props.height}
      flexDirection="row"
      background={0}
      semantic={{ name: "music-sidebar" }}
    >
      <box width={SIDEBAR_W - 1} height={props.height} flexDirection="column" overflow="scroll">
        <SidebarHeading>Apple Music</SidebarHeading>
        <For each={CATALOG.filter((item) => props.signedIn || !item.signedIn)}>
          {(item) => <SidebarRow label={item.label} selected={isSelected(item.route)} onClick={() => props.onSelect(item.route)} />}
        </For>
        <Show
          when={props.signedIn}
          fallback={
            <box flexDirection="column" gap={4} paddingLeft={PAD} paddingRight={PAD} paddingTop={10} semantic={{ name: "music-preview-note" }}>
              <text font="body" wrap>Playing 30-second previews.</text>
              <text font="body" wrap>Sign in to play whole songs and your library.</text>
              <Button label="Sign In…" disabled={props.signingIn} onClick={props.onSignIn} />
            </box>
          }
        >
          <SidebarHeading>Library</SidebarHeading>
          <For each={LIBRARY}>
            {(item) => <SidebarRow label={item.label} selected={isSelected(item.route)} onClick={() => props.onSelect(item.route)} />}
          </For>
          <SidebarHeading>Playlists</SidebarHeading>
          <For each={props.playlists}>
            {(playlist) => {
              const route: Route = { view: "collection", collection: playlist };
              return <SidebarRow label={playlist.name} selected={isSelected(route)} onClick={() => props.onSelect(route)} />;
            }}
          </For>
        </Show>
      </box>
      <box width={1} height={props.height} background={1} />
    </box>
  );
}

// --- Content ---------------------------------------------------------------

export function Loading(): JSX.Element {
  return (
    <box padding={PAD}>
      <text font="body">Loading…</text>
    </box>
  );
}

/** A heading within a page, over a shelf of tiles or a list. */
export function SectionTitle(props: { children: string }): JSX.Element {
  return (
    <box paddingTop={6} paddingBottom={4}>
      <text font="body" bold nowrap>{props.children}</text>
    </box>
  );
}

export function Title(props: { children: string; width: number; onBack?: () => void }): JSX.Element {
  return (
    <box flexDirection="row" alignItems="center" gap={6} paddingBottom={4}>
      <Show when={props.onBack}>{(back) => <Button label="Back" onClick={back()} />}</Show>
      <text font="menu" nowrap>{fit(props.children, props.width - (props.onBack ? 60 : 0), "menu")}</text>
    </box>
  );
}

/** Albums and playlists as rows of artwork tiles. */
export function CollectionGrid(props: {
  items: Collection[];
  width: number;
  /** Show only this many rows: a shelf rather than the whole list. */
  maxRows?: number;
  loader: ArtworkLoader;
  onOpen: (collection: Collection) => void;
}): JSX.Element {
  // As many columns as fit at the smallest tile, then tiles grown to fill the
  // row. Even sizes only, so a window drag doesn't re-dither at every pixel.
  const columns = createMemo(() => Math.max(1, Math.floor((props.width + TILE_GAP) / (MIN_TILE + TILE_GAP))));
  const tile = createMemo(() => {
    const n = columns();
    const size = Math.floor((props.width - (n - 1) * TILE_GAP) / n);
    return Math.max(MIN_TILE, size - (size % 2));
  });
  const rows = createMemo(() => {
    const n = columns();
    const out: Collection[][] = [];
    for (let i = 0; i < props.items.length; i += n) out.push(props.items.slice(i, i + n));
    return props.maxRows ? out.slice(0, props.maxRows) : out;
  });
  return (
    <box flexDirection="column" gap={TILE_GAP}>
      <Show when={props.items.length === 0}>
        <text font="body">Nothing here yet.</text>
      </Show>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={TILE_GAP} flexShrink={0}>
            <For each={row}>
              {(item) => (
                <box width={tile()} flexDirection="column" gap={1} onClick={() => props.onOpen(item)}>
                  <Artwork loader={props.loader} url={item.artwork} size={tile()} />
                  <text font="body" nowrap>{fit(item.name, tile())}</text>
                  <text font="body" nowrap>{fit(item.subtitle, tile())}</text>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

/** Artists or genres: a list of names, each opening its page. */
export function NameList<T extends { id: string; name: string }>(props: { items: T[]; width: number; onOpen: (item: T) => void }): JSX.Element {
  return (
    <box flexDirection="column">
      <For each={props.items}>
        {(item) => (
          <box height={ROW_H} flexDirection="row" alignItems="center" onClick={() => props.onOpen(item)}>
            <text font="body" nowrap>{fit(item.name, props.width)}</text>
          </box>
        )}
      </For>
    </box>
  );
}

/**
 * Tracks as a list: click selects, double-click plays from there, the way
 * a Finder list opens.
 */
export function TrackList(props: {
  tracks: Track[];
  width: number;
  /** Album pages leave out the album column; the album is the page. */
  showAlbum: boolean;
  current: NowPlaying | null;
  onPlay: (index: number) => void;
}): JSX.Element {
  const [selected, setSelected] = createSignal(-1);
  const columns = createMemo(() => {
    const gaps = (props.showAlbum ? 3 : 2) * COLUMN_GAP;
    const text = props.width - TIME_W - gaps;
    return props.showAlbum
      ? { title: Math.floor(text * 0.45), artist: Math.floor(text * 0.28), album: Math.floor(text * 0.27) }
      : { title: Math.floor(text * 0.62), artist: Math.floor(text * 0.38), album: 0 };
  });
  return (
    <box flexDirection="column" semantic={{ name: "music-tracks" }}>
      <For each={props.tracks}>
        {(track, i) => {
          const inverted = () => selected() === i();
          const playing = () => isPlaying(track, props.current);
          const ink = () => (inverted() ? 0 : 1);
          return (
            <box
              height={ROW_H}
              width={props.width + ROW_INSET * 2}
              marginLeft={-ROW_INSET}
              paddingLeft={ROW_INSET}
              paddingRight={ROW_INSET}
              flexDirection="row"
              alignItems="center"
              gap={COLUMN_GAP}
              background={inverted() ? 1 : 0}
              onClick={() => setSelected(i())}
              onDoubleClick={() => props.onPlay(i())}
            >
              <box width={columns().title}>
                <text font="body" color={ink()} bold={playing()} nowrap>{fit(track.name, columns().title, "body", playing())}</text>
              </box>
              <box width={columns().artist}>
                <text font="body" color={ink()} nowrap>{fit(track.artist, columns().artist)}</text>
              </box>
              <Show when={props.showAlbum}>
                <box width={columns().album}>
                  <text font="body" color={ink()} nowrap>{fit(track.album, columns().album)}</text>
                </box>
              </Show>
              <box width={TIME_W}>
                <text font="body" color={ink()} align="right" nowrap>{track.durationMs ? formatDuration(track.durationMs) : ""}</text>
              </box>
            </box>
          );
        }}
      </For>
    </box>
  );
}

/** An album or playlist page: artwork, name, Play, then its tracks. */
export function CollectionHeader(props: {
  collection: Collection;
  trackCount: number | undefined;
  width: number;
  loader: ArtworkLoader;
  onPlay: () => void;
}): JSX.Element {
  const textW = () => props.width - HEADER_ART - 8;
  return (
    <box flexDirection="row" gap={8} paddingBottom={6} flexShrink={0}>
      <Artwork loader={props.loader} url={props.collection.artwork} size={HEADER_ART} />
      <box flexDirection="column" gap={2} justifyContent="flex-end">
        <text font="menu" nowrap>{fit(props.collection.name, textW(), "menu")}</text>
        <text font="body" nowrap>{fit(props.collection.subtitle, textW())}</text>
        <text font="body" nowrap>
          {props.trackCount === undefined ? "" : `${props.trackCount} ${props.trackCount === 1 ? "song" : "songs"}`}
        </text>
        <box paddingTop={2}>
          <Button label="Play" disabled={!props.trackCount} onClick={props.onPlay} />
        </box>
      </box>
    </box>
  );
}
