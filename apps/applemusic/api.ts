import { coverFrame, toBits, type BrowserService, type FetchFunction, type ImageService } from "@mockintosh/sdk";

/**
 * Apple Music, through MusicKit on the Web for playback and the Apple Music
 * API for the library. Two tokens: the developer token, signed by this
 * deployment (`api/apple-music/token.ts`), and the user's Music User Token,
 * from signing in (`api/apple-music/sign-in.ts`).
 */

const MUSICKIT_URL = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const API_BASE = "https://api.music.apple.com";

export interface AppleMusicSession {
  /** Network access from `useApp().fetch`; the API layer never reaches for a global. */
  fetch: FetchFunction;
  /** Where this deployment serves `/api/apple-music/*`. */
  origin: string;
  developerToken: string | null;
  musicUserToken: string | null;
  images?: ImageService;
  /** Called when Apple refuses the user token (expired or revoked). */
  onSignedOut(): void;
}

/** Something MusicKit can queue whole: `setQueue({ [kind]: id })`. */
export type CollectionKind = "album" | "playlist" | "station";

/** An album, playlist or station, as a tile in a grid. */
export interface Collection {
  kind: CollectionKind;
  id: string;
  name: string;
  /** The artist, or the playlist's curator. */
  subtitle: string;
  artwork: string | null;
}

export interface Track {
  id: string;
  /** The same song in the catalog, which MusicKit may report it as while it plays. */
  catalogId: string | null;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
  artwork: string | null;
}

export interface Artist {
  id: string;
  name: string;
}

export interface NowPlaying {
  /** Every id MusicKit knows the item by: library and catalog. */
  ids: string[];
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
}

/** The slice of a MusicKit instance the app uses. */
export interface MusicKitInstance {
  readonly isAuthorized: boolean;
  readonly isPlaying: boolean;
  readonly nowPlayingItem: MusicKitMediaItem | undefined;
  musicUserToken?: string;
  volume: number;
  setQueue(options: Record<string, unknown>): Promise<unknown>;
  play(): Promise<void>;
  pause(): void;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  unauthorize(): Promise<void>;
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
}

interface MusicKitMediaItem {
  id?: string;
  title?: string;
  artistName?: string;
  albumName?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    artwork?: { url?: string };
    playParams?: { id?: string; catalogId?: string };
  };
}

interface MusicKitGlobal {
  configure(options: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstance> | MusicKitInstance;
  getInstance(): MusicKitInstance;
}

/** A resource as the Apple Music API returns it. */
interface Resource {
  id: string;
  type: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    curatorName?: string;
    durationInMillis?: number;
    artwork?: { url?: string };
    playParams?: { id?: string; catalogId?: string };
  };
}

interface Page {
  data?: Resource[];
  next?: string;
}

export function isStoredUserToken(v: unknown): v is { musicUserToken: string } {
  return !!v && typeof (v as { musicUserToken?: unknown }).musicUserToken === "string";
}

/** The developer token from this deployment, or an error naming what's missing. */
export async function fetchDeveloperToken(session: AppleMusicSession): Promise<string> {
  const resp = await session.fetch(`${session.origin}/api/apple-music/token`);
  const data = (await resp.json().catch(() => ({}))) as { developerToken?: string; error?: string };
  if (!data.developerToken) throw new Error(data.error ?? `Apple Music token unavailable (${resp.status})`);
  return data.developerToken;
}

/**
 * Sign in through the deployment's sign-in popup. Resolves with the Music
 * User Token, or rejects when the user closes it or Apple refuses.
 */
export async function signIn(session: AppleMusicSession, browser: BrowserService): Promise<string> {
  const params = await browser.authorize(`${session.origin}/api/apple-music/sign-in`);
  if (!params.code) throw new Error("Apple Music did not send a token");
  return params.code;
}

/**
 * Configure MusicKit for playback. It finds the user token the sign-in popup
 * left in this origin's storage; where it doesn't, it is handed ours.
 */
export async function configureMusicKit(session: AppleMusicSession, browser: BrowserService): Promise<MusicKitInstance> {
  if (!session.developerToken) throw new Error("No developer token");
  const MusicKit = (await browser.loadScript(MUSICKIT_URL, "MusicKit")) as MusicKitGlobal | undefined;
  if (!MusicKit) throw new Error("MusicKit failed to load");
  const music = (await MusicKit.configure({
    developerToken: session.developerToken,
    app: { name: "Mockintosh", build: "1.0" },
  })) ?? MusicKit.getInstance();
  if (!music.isAuthorized && session.musicUserToken) {
    try {
      music.musicUserToken = session.musicUserToken;
    } catch {
      // Read-only in this MusicKit; playback will report it.
    }
  }
  return music;
}

async function apiGet(path: string, session: AppleMusicSession): Promise<Page | null> {
  // Throw rather than answer empty: an empty answer would be cached as the library.
  if (!session.developerToken || !session.musicUserToken) throw new Error("Not signed in to Apple Music yet");
  const resp = await session.fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${session.developerToken}`,
      "Music-User-Token": session.musicUserToken,
    },
  });
  if (resp.status === 401 || resp.status === 403) {
    session.onSignedOut();
    return null;
  }
  if (!resp.ok) return null;
  return (await resp.json()) as Page;
}

/** One page of a list, and the path of the next when there is one. */
export interface Paged<T> {
  items: T[];
  next: string | null;
}

async function fetchPage<T>(path: string, session: AppleMusicSession, map: (r: Resource) => T | null): Promise<Paged<T>> {
  const page = await apiGet(path, session);
  const items: T[] = [];
  for (const resource of page?.data ?? []) {
    const item = map(resource);
    if (item) items.push(item);
  }
  return { items, next: page?.next ?? null };
}

/** Every page of a list, up to `max` items. */
async function fetchAll<T>(path: string, session: AppleMusicSession, map: (r: Resource) => T | null, max = 1000): Promise<T[]> {
  const all: T[] = [];
  let next: string | null = path;
  while (next && all.length < max) {
    const page: Paged<T> = await fetchPage(next, session, map);
    all.push(...page.items);
    next = page.next;
  }
  return all;
}

function toCollection(r: Resource): Collection | null {
  const a = r.attributes ?? {};
  const kind: CollectionKind | null = r.type.endsWith("albums")
    ? "album"
    : r.type.endsWith("playlists")
      ? "playlist"
      : r.type === "stations"
        ? "station"
        : null;
  if (!kind) return null;
  return {
    kind,
    id: r.id,
    name: a.name ?? "Untitled",
    subtitle: a.artistName ?? a.curatorName ?? "",
    artwork: a.artwork?.url ?? null,
  };
}

function toTrack(r: Resource): Track | null {
  if (!r.type.endsWith("songs")) return null;
  const a = r.attributes ?? {};
  return {
    id: r.id,
    catalogId: a.playParams?.catalogId ?? null,
    name: a.name ?? "Untitled",
    artist: a.artistName ?? "",
    album: a.albumName ?? "",
    durationMs: a.durationInMillis ?? 0,
    artwork: a.artwork?.url ?? null,
  };
}

function toArtist(r: Resource): Artist | null {
  return { id: r.id, name: r.attributes?.name ?? "Unknown Artist" };
}

export function fetchPlaylists(session: AppleMusicSession): Promise<Collection[]> {
  return fetchAll("/v1/me/library/playlists?limit=100", session, toCollection, 500);
}

/** Recently added albums, playlists and stations. Apple pages these 25 at a time. */
export function fetchRecentlyAdded(session: AppleMusicSession): Promise<Collection[]> {
  return fetchAll("/v1/me/library/recently-added?limit=25", session, toCollection, 100);
}

export function fetchAlbums(session: AppleMusicSession): Promise<Collection[]> {
  return fetchAll("/v1/me/library/albums?limit=100", session, toCollection);
}

export async function fetchArtists(session: AppleMusicSession): Promise<Artist[]> {
  const artists = await fetchAll("/v1/me/library/artists?limit=100", session, toArtist, 2000);
  return artists.sort((a, b) => a.name.localeCompare(b.name));
}

/** Songs are the one list too long to fetch whole; the view asks for more. */
export function fetchSongs(session: AppleMusicSession, next?: string): Promise<Paged<Track>> {
  return fetchPage(next ?? "/v1/me/library/songs?limit=100", session, toTrack);
}

export function fetchArtistAlbums(artistId: string, session: AppleMusicSession): Promise<Collection[]> {
  return fetchAll(`/v1/me/library/artists/${encodeURIComponent(artistId)}/albums?limit=100`, session, toCollection);
}

const storefronts = new WeakMap<AppleMusicSession, Promise<string>>();

/** The user's country catalog (`se`, `us`, …), which catalog requests are made against. */
function storefront(session: AppleMusicSession): Promise<string> {
  let pending = storefronts.get(session);
  if (!pending) {
    pending = apiGet("/v1/me/storefront", session).then((page) => page?.data?.[0]?.id ?? "us");
    storefronts.set(session, pending);
  }
  return pending;
}

/** Library ids start `l.` (albums), `p.` (playlists) or `i.` (songs); anything else is in the catalog. */
function isLibraryId(id: string): boolean {
  return /^[lpi]\./.test(id);
}

export async function fetchTracks(collection: Collection, session: AppleMusicSession): Promise<Track[]> {
  const id = encodeURIComponent(collection.id);
  const base = isLibraryId(collection.id) ? "/v1/me/library" : `/v1/catalog/${await storefront(session)}`;
  return fetchAll(`${base}/${collection.kind}s/${id}/tracks?limit=100`, session, toTrack);
}

/** Play a whole collection, from track `startWith`. */
export async function playCollection(music: MusicKitInstance, collection: Collection, startWith = 0): Promise<void> {
  await music.setQueue({ [collection.kind]: collection.id, startWith, startPlaying: true });
}

/** Play a list of songs, from `startWith`. */
export async function playTracks(music: MusicKitInstance, tracks: Track[], startWith = 0): Promise<void> {
  await music.setQueue({ songs: tracks.map((t) => t.id), startWith, startPlaying: true });
}

/** What's playing, read from MusicKit's media item, whichever shape it takes. */
export function nowPlaying(music: MusicKitInstance): NowPlaying | null {
  const item = music.nowPlayingItem;
  if (!item) return null;
  const a = item.attributes ?? {};
  const ids = [item.id, a.playParams?.id, a.playParams?.catalogId].filter((id): id is string => !!id);
  return {
    ids,
    title: item.title ?? a.name ?? "",
    artist: item.artistName ?? a.artistName ?? "",
    album: item.albumName ?? a.albumName ?? "",
    artworkUrl: a.artwork?.url ?? null,
  };
}

/** What the now-playing bar shows for `track` while MusicKit is still fetching it. */
export function trackAsNowPlaying(track: Track): NowPlaying {
  return {
    ids: track.catalogId ? [track.id, track.catalogId] : [track.id],
    title: track.name,
    artist: track.artist,
    album: track.album,
    artworkUrl: track.artwork,
  };
}

/** The same for a whole album or playlist: its name, until its first track starts. */
export function collectionAsNowPlaying(collection: Collection): NowPlaying {
  return { ids: [], title: collection.name, artist: collection.subtitle, album: "", artworkUrl: collection.artwork };
}

export function isPlaying(track: Track, current: NowPlaying | null): boolean {
  if (!current) return false;
  return current.ids.includes(track.id) || (!!track.catalogId && current.ids.includes(track.catalogId));
}

/** Apple's artwork URLs are templates with `{w}` and `{h}`. */
export function artworkUrl(template: string, size: number): string {
  return template.replace("{w}", String(size)).replace("{h}", String(size)).replace("{f}", "jpg");
}

export async function ditherArtwork(url: string, size: number, session: AppleMusicSession): Promise<Uint8Array | null> {
  try {
    if (!session.images) return null;
    const resp = await session.fetch(artworkUrl(url, size * 2));
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const frame = await session.images.decode(bytes, undefined, { maxWidth: size * 2, maxHeight: size * 2 });
    // Apple's artwork is nearly always square, but not always exactly: crop to fill.
    const square = { width: size, height: size, rgba: new Uint8ClampedArray(size * size * 4) };
    coverFrame(frame, square);
    return toBits(square, "atkinson");
  } catch {
    return null;
  }
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
