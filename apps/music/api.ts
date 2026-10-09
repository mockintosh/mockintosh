import {
  coverFrame,
  toBits,
  type FetchFunction,
  type ImageService,
  type MusicKitItem,
  type MusicKitRepeatMode,
  type MusicKitService,
} from "@mockintosh/sdk";

/**
 * Apple Music: the OS's MusicKit (`useApp().musicKit`) for playback and
 * signing in, and the Apple Music API for the library. Two tokens: the
 * developer token, signed by this deployment (`api/apple-music/token.ts`),
 * and the user's Music User Token, from signing in.
 */

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
    /** A recommendation's heading, the line under it, and what kind of shelf it is. */
    title?: { stringForDisplay?: string };
    reason?: { stringForDisplay?: string };
    kind?: string;
  };
  relationships?: { contents?: { data?: Resource[] } };
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
 * GET from the Apple Music API. The user's own data (`/v1/me/…`) needs their
 * token; the catalog needs only the developer token, so it works signed out.
 */
async function apiGet(path: string, session: AppleMusicSession): Promise<Page | null> {
  const { language } = await store(session);
  // Apple's text (shelf titles, genres) in the app's language; `next` links already carry it.
  const localized = language && !/[?&]l=/.test(path) ? `${path}${path.includes("?") ? "&" : "?"}l=${language}` : path;
  return request(localized, session);
}

/** A GET as it is, without choosing a language: how the store itself is looked up. */
async function request(path: string, session: AppleMusicSession): Promise<Page | null> {
  const personal = path.startsWith("/v1/me/");
  // Throw rather than answer empty: an empty answer would be cached as the library.
  if (!session.developerToken) throw new Error("Apple Music isn't ready yet");
  if (personal && !session.musicUserToken) throw new Error("Not signed in to Apple Music");
  const headers: Record<string, string> = { Authorization: `Bearer ${session.developerToken}` };
  if (session.musicUserToken) headers["Music-User-Token"] = session.musicUserToken;
  const resp = await session.fetch(`${API_BASE}${path}`, { headers });
  if (personal && (resp.status === 401 || resp.status === 403)) {
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

/**
 * Text the 1-bit fonts can draw: emoji (Apple's "New Nordic ❄️") and the
 * selectors and joiners that build them are dropped, then the spaces they
 * leave behind.
 */
export function plainText(text: string | undefined): string {
  return (text ?? "").replace(/[\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/\s{2,}/g, " ").trim();
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
    name: plainText(a.name) || "Untitled",
    subtitle: plainText(a.artistName ?? a.curatorName),
    artwork: a.artwork?.url ?? null,
  };
}

function toTrack(r: Resource): Track | null {
  if (!r.type.endsWith("songs")) return null;
  const a = r.attributes ?? {};
  return {
    id: r.id,
    catalogId: a.playParams?.catalogId ?? null,
    name: plainText(a.name) || "Untitled",
    artist: plainText(a.artistName),
    album: plainText(a.albumName),
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

/** A titled row of albums, playlists and stations on Home. */
export interface Shelf {
  title: string;
  /** The line under the title ("Playlists curated by our experts."). */
  subtitle: string;
  items: Collection[];
}

/** Shelf contents, leaving out any that arrived as bare references without a name. */
function collections(resources: Resource[] | undefined): Collection[] {
  return (resources ?? [])
    .filter((r) => r.attributes?.name)
    .map(toCollection)
    .filter((c): c is Collection => !!c);
}

/** What the user played lately. Apple pages these 10 at a time. */
export function fetchRecentlyPlayed(session: AppleMusicSession): Promise<Collection[]> {
  return fetchAll("/v1/me/recent/played?limit=10", session, toCollection, 30);
}

/**
 * Apple's personal recommendations: each a titled shelf, its contents nested
 * inside. Apple's own recently-played shelf is left out: Home has its own.
 */
export async function fetchRecommendations(session: AppleMusicSession): Promise<Shelf[]> {
  const page = await apiGet("/v1/me/recommendations?limit=10", session);
  const shelves: Shelf[] = [];
  for (const recommendation of page?.data ?? []) {
    const a = recommendation.attributes ?? {};
    if (a.kind === "recently-played") continue;
    const items = collections(recommendation.relationships?.contents?.data);
    const title = plainText(a.title?.stringForDisplay);
    if (title && items.length) shelves.push({ title, subtitle: plainText(a.reason?.stringForDisplay), items });
  }
  return shelves;
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

/** An artist's albums: those in the library for a library artist (`r.…`), the catalog's for one found by search. */
export async function fetchArtistAlbums(artistId: string, session: AppleMusicSession): Promise<Collection[]> {
  const id = encodeURIComponent(artistId);
  const path = isLibraryId(artistId)
    ? `/v1/me/library/artists/${id}/albums?limit=100`
    : `/v1/catalog/${await storefront(session)}/artists/${id}/albums?limit=100`;
  return fetchAll(path, session, toCollection);
}

export interface SearchResults {
  songs: Track[];
  artists: Artist[];
  albums: Collection[];
  playlists: Collection[];
  stations: Collection[];
}

interface SearchResponse {
  results?: { [type: string]: { data?: Resource[] } | undefined };
}

/**
 * Search the catalog. Stations only when signed in: MusicKit can't play
 * them as previews.
 */
export async function searchCatalog(term: string, withStations: boolean, session: AppleMusicSession): Promise<SearchResults> {
  const types = withStations ? "songs,artists,albums,playlists,stations" : "songs,artists,albums,playlists";
  const page = (await apiGet(
    `/v1/catalog/${await storefront(session)}/search?term=${encodeURIComponent(term)}&types=${types}&limit=12`,
    session,
  )) as SearchResponse | null;
  const of = (type: string) => page?.results?.[type]?.data ?? [];
  return {
    songs: of("songs").map(toTrack).filter((t): t is Track => !!t),
    artists: of("artists").map(toArtist).filter((a): a is Artist => !!a),
    albums: of("albums").map(toCollection).filter((c): c is Collection => !!c),
    playlists: of("playlists").map(toCollection).filter((c): c is Collection => !!c),
    stations: of("stations").map(toCollection).filter((c): c is Collection => !!c),
  };
}

export interface Genre {
  id: string;
  name: string;
}

export interface Radio {
  /** The station Apple makes from what you play, when it has one. */
  personal: Collection[];
  live: Collection[];
  genres: Genre[];
}

/** Radio (signed in: stations don't play as previews). */
export async function fetchRadio(session: AppleMusicSession): Promise<Radio> {
  const sf = await storefront(session);
  const [personal, live, genres] = await Promise.all([
    apiGet(`/v1/catalog/${sf}/stations?filter[identity]=personal`, session).catch(() => null),
    apiGet(`/v1/catalog/${sf}/stations?filter[featured]=apple-music-live-radio`, session),
    fetchAll(`/v1/catalog/${sf}/station-genres?limit=100`, session, (r) => ({ id: r.id, name: plainText(r.attributes?.name) }), 200).catch(
      () => [] as Genre[],
    ),
  ]);
  return {
    personal: collections(personal?.data),
    live: collections(live?.data),
    genres: genres.filter((g) => g.name).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function fetchGenreStations(genre: Genre, session: AppleMusicSession): Promise<Collection[]> {
  return fetchAll(`/v1/catalog/${await storefront(session)}/station-genres/${encodeURIComponent(genre.id)}/stations?limit=50`, session, toCollection, 200);
}

const FALLBACK_STOREFRONT = "us";
/** Mockintosh speaks English; Apple's text should too, where the store offers it. */
const APP_LANGUAGE = "en";

/** The country in the browser's locale (`sv-SE` → `se`): the best guess at a signed-out listener's store. */
function localeStorefront(): string {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return /-([A-Z]{2})\b/.exec(locale)?.[1]?.toLowerCase() ?? FALLBACK_STOREFRONT;
}

/** A country's Apple Music store, and the language to ask it for. */
interface Store {
  /** `se`, `us`, …: the catalog requests are made against. */
  id: string;
  /** The store's tag for the app's language (`en-GB` in Sweden), or null to take its default. */
  language: string | null;
}

interface StorefrontResource {
  id: string;
  attributes?: { supportedLanguageTags?: string[] };
}

function toStore(resource: StorefrontResource | undefined): Store | null {
  if (!resource) return null;
  const tags = resource.attributes?.supportedLanguageTags ?? [];
  return { id: resource.id, language: tags.find((tag) => tag.split("-")[0] === APP_LANGUAGE) ?? null };
}

async function lookUpStore(session: AppleMusicSession): Promise<Store> {
  if (session.musicUserToken) {
    const page = await request("/v1/me/storefront", session).catch(() => null);
    const store = toStore(page?.data?.[0] as StorefrontResource | undefined);
    if (store) return store;
  }
  // Signed out, guess from the locale; that country may have no store, so fall back to the US one.
  for (const id of [localeStorefront(), FALLBACK_STOREFRONT]) {
    const page = await request(`/v1/storefronts/${id}`, session).catch(() => null);
    const store = toStore(page?.data?.[0] as StorefrontResource | undefined);
    if (store) return store;
  }
  return { id: FALLBACK_STOREFRONT, language: null };
}

const stores = new WeakMap<AppleMusicSession, { token: string | null; pending: Promise<Store> }>();

/** The listener's store: the account's when signed in, the locale's guess when not. Looked up once per sign-in. */
function store(session: AppleMusicSession): Promise<Store> {
  const known = stores.get(session);
  if (known && known.token === session.musicUserToken) return known.pending;
  const pending = lookUpStore(session);
  stores.set(session, { token: session.musicUserToken, pending });
  return pending;
}

async function storefront(session: AppleMusicSession): Promise<string> {
  return (await store(session)).id;
}

/** Apple's charts for the listener's country: what preview mode browses. */
export interface Charts {
  playlists: Collection[];
  albums: Collection[];
  songs: Track[];
}

interface ChartsResponse {
  results?: { [type: string]: Array<{ data?: Resource[] }> | undefined };
}

export async function fetchCharts(session: AppleMusicSession): Promise<Charts> {
  const page = (await apiGet(`/v1/catalog/${await storefront(session)}/charts?types=playlists,albums,songs&limit=24`, session)) as
    | ChartsResponse
    | null;
  if (!page?.results) throw new Error("Apple Music's charts didn't load");
  const chart = (type: string) => page.results?.[type]?.[0]?.data ?? [];
  return {
    playlists: chart("playlists").map(toCollection).filter((c): c is Collection => !!c),
    albums: chart("albums").map(toCollection).filter((c): c is Collection => !!c),
    songs: chart("songs").map(toTrack).filter((t): t is Track => !!t),
  };
}

/** Library ids start `l.` (albums), `p.` (playlists), `i.` (songs) or `r.` (artists); anything else is in the catalog. */
function isLibraryId(id: string): boolean {
  return /^[lpir]\./.test(id);
}

export async function fetchTracks(collection: Collection, session: AppleMusicSession): Promise<Track[]> {
  const id = encodeURIComponent(collection.id);
  const base = isLibraryId(collection.id) ? "/v1/me/library" : `/v1/catalog/${await storefront(session)}`;
  return fetchAll(`${base}/${collection.kind}s/${id}/tracks?limit=100`, session, toTrack);
}

/** Play a whole collection, from track `startWith`. */
export async function playCollection(musicKit: MusicKitService, collection: Collection, startWith = 0): Promise<void> {
  await musicKit.setQueue({ [collection.kind]: collection.id, startWith, startPlaying: true });
}

/** Play a list of songs, from `startWith`. */
export async function playTracks(musicKit: MusicKitService, tracks: Track[], startWith = 0): Promise<void> {
  await musicKit.setQueue({ songs: tracks.map((t) => t.id), startWith, startPlaying: true });
}

/** What MusicKit is playing, as the app shows it: names cleaned for the 1-bit fonts. */
export function itemAsNowPlaying(item: MusicKitItem): NowPlaying {
  return {
    ids: item.ids,
    title: plainText(item.title),
    artist: plainText(item.artistName),
    album: plainText(item.albumName),
    artworkUrl: item.artworkUrl,
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

/** Repeat as the bar cycles it, like Apple Music: off → all → one → off. */
export type RepeatMode = "none" | "one" | "all";

export function repeatModeOf(mode: MusicKitRepeatMode): RepeatMode {
  return mode === 1 ? "one" : mode === 2 ? "all" : "none";
}

/** The MusicKit mode after `mode`, as the button cycles it. */
export function nextRepeatMode(mode: RepeatMode): MusicKitRepeatMode {
  return mode === "none" ? 2 : mode === "all" ? 1 : 0;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
