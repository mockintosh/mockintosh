import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, TextInput } from "@mockintosh/ui";
import { useApp, defineApp } from "@mockintosh/sdk";
import {
  type AppleMusicSession,
  type Collection,
  type MusicKitInstance,
  type NowPlaying,
  type RepeatMode,
  type Track,
  collectionAsNowPlaying,
  configureMusicKit,
  fetchAlbums,
  fetchArtistAlbums,
  fetchArtists,
  fetchCharts,
  fetchGenreStations,
  fetchRadio,
  fetchDeveloperToken,
  fetchPlaylists,
  fetchRecentlyPlayed,
  fetchRecommendations,
  fetchRecentlyAdded,
  fetchSongs,
  fetchTracks,
  isStoredUserToken,
  nextRepeatMode,
  nowPlaying,
  playCollection,
  playTracks,
  repeatModeOf,
  searchCatalog,
  setRepeatMode,
  signIn,
  trackAsNowPlaying,
} from "./applemusic/api";
import { createArtworkLoader } from "./applemusic/Artwork";
import { NOW_PLAYING_H, NowPlayingBar } from "./applemusic/NowPlayingBar";
import {
  NameList,
  CollectionGrid,
  CollectionHeader,
  Loading,
  SIDEBAR_W,
  SectionTitle,
  Sidebar,
  Title,
  TrackList,
  useLoaded,
  type Route,
} from "./applemusic/views";
import { sprites } from "./applemusic/icons";

/** Key in the app's storage folder (System Folder/Preferences/applemusic/). */
const TOKEN_KEY = "user-token.json";

const PAD = 6;
/** MusicKit events that move the position slider, and that change shuffle or repeat. */
const TIME_EVENTS = ["playbackTimeDidChange", "playbackDurationDidChange", "nowPlayingItemDidChange"];
const MODE_EVENTS = ["shuffleModeDidChange", "repeatModeDidChange"];

/** How long typing pauses before the search runs. */
const SEARCH_DELAY_MS = 350;

/** How long the position slider waits for the drag to rest before seeking. */
const SEEK_DELAY_MS = 150;

function AppleMusic(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { storage } = app;
  const browser = app.browser!; // present: the app requires "browser"
  const [userToken, setUserToken] = createSignal<string | null>(null, { ownedWrite: true });
  const [ready, setReady] = createSignal(false);
  const [configError, setConfigError] = createSignal("");
  const [route, setRoute] = createSignal<Route>({ view: "browse" });
  /** Pages behind the current one, for Back: artist → album, say. */
  const [history, setHistory] = createSignal<Route[]>([]);
  const [current, setCurrent] = createSignal<NowPlaying | null>(null);
  /** What was asked to play and hasn't started yet: shown at once, so a click is answered. */
  const [pending, setPending] = createSignal<NowPlaying | null>(null);
  const shown = () => pending() ?? current();
  const [playing, setPlaying] = createSignal(false);
  const [volume, setVolume] = createSignal(50);
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  /** Where the position slider is being dragged to; MusicKit's time is ignored until the seek lands. */
  const [scrubTo, setScrubTo] = createSignal<number | null>(null);
  const [shuffle, setShuffle] = createSignal(false);
  const [repeat, setRepeat] = createSignal<RepeatMode>("none");
  const [error, setError] = createSignal("");
  /** What's in the search field, and the term last searched for: kept while you look at the results' pages. */
  const [query, setQuery] = createSignal("");
  const [searchTerm, setSearchTerm] = createSignal("");
  const [signingIn, setSigningIn] = createSignal(false);
  /** Whether a saved sign-in has been looked for: MusicKit waits, so it starts signed in or not, once. */
  const [tokenChecked, setTokenChecked] = createSignal(false);

  let music: MusicKitInstance | null = null;

  const session: AppleMusicSession = {
    fetch: app.fetch!, // present: the app requires "network"
    origin: app.env.origin,
    developerToken: null,
    musicUserToken: null,
    images: app.images,
    onSignedOut: () => void signOut("Apple Music signed you out. Sign in again."),
  };
  const artwork = createArtworkLoader(session);

  /** Library lists, fetched once per sign-in. */
  let cache = new Map<string, Promise<unknown>>();
  function cached<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    let pending = cache.get(key) as Promise<T> | undefined;
    if (!pending) {
      const owner = cache;
      pending = fetch().catch((e: unknown) => {
        owner.delete(key);
        // A request from before a sign-in or sign-out has nothing to report: its page is gone.
        if (owner === cache) setError(e instanceof Error ? e.message : "Apple Music didn't answer");
        throw e;
      });
      cache.set(key, pending);
    }
    return pending;
  }

  function saveUserToken(token: string | null): void {
    session.musicUserToken = token;
    cache = new Map();
    setUserToken(token);
    void (token ? storage.write(TOKEN_KEY, JSON.stringify({ musicUserToken: token })) : storage.remove(TOKEN_KEY));
  }

  async function signOut(message = ""): Promise<void> {
    music?.pause();
    await music?.unauthorize().catch(() => undefined);
    saveUserToken(null);
    setError(message);
  }

  createEffect(() => [!!userToken(), signingIn()] as const, ([signedIn, busy]) => {
    app.setMenus([
      {
        label: "File",
        items: [
          signedIn
            ? { label: "Sign Out", onClick: () => void signOut() }
            : { label: "Sign In…", disabled: busy, onClick: () => void startSignIn() },
          { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
        ],
      },
    ]);
  });

  // Signing in opens the library; signing out goes back to the catalog,
  // since the library's pages can't load without the account.
  let wasSignedIn = false;
  createEffect(() => !!userToken(), (signedIn) => {
    if (signedIn === wasSignedIn) return;
    wasSignedIn = signedIn;
    select(signedIn ? { view: "home" } : { view: "browse" });
  });

  // The developer token first: without one there is nothing to sign in to.
  const developerToken = createMemo(async () => {
    try {
      const token = await fetchDeveloperToken(session);
      session.developerToken = token;
      return token;
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Apple Music is not configured");
      return null;
    }
  });

  const storedToken = createMemo(async () => {
    const raw = await storage.read(TOKEN_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredUserToken(parsed) ? parsed.musicUserToken : null;
    } catch {
      await storage.remove(TOKEN_KEY);
      return null;
    }
  });
  createEffect(
    () => storedToken(),
    (token) => {
      if (token) {
        session.musicUserToken = token;
        setUserToken(token);
      }
      setTokenChecked(true);
    },
  );
  createEffect(
    () => developerToken(),
    (token) => {
      if (token) setReady(true);
    },
  );

  const showNowPlaying = () => setCurrent(music ? nowPlaying(music) : null);
  const onPlaybackState = () => {
    const isPlaying = !!music?.isPlaying;
    setPlaying(isPlaying);
    if (isPlaying) setPending(null);
  };
  const onTime = () => {
    if (!music) return;
    setTime(music.currentPlaybackTime || 0);
    setDuration(music.currentPlaybackDuration || 0);
  };
  const onModes = () => {
    if (!music) return;
    setShuffle(music.shuffleMode === 1);
    setRepeat(repeatModeOf(music));
  };
  const onPlaybackError = () => {
    setPending(null);
    setError("Apple Music couldn't play that.");
  };

  function listen(m: MusicKitInstance, on: boolean): void {
    const method = on ? "addEventListener" : "removeEventListener";
    m[method]("nowPlayingItemDidChange", showNowPlaying);
    m[method]("playbackStateDidChange", onPlaybackState);
    m[method]("mediaPlaybackError", onPlaybackError);
    for (const name of TIME_EVENTS) m[method](name, onTime);
    for (const name of MODE_EVENTS) m[method](name, onModes);
  }

  /**
   * (Re)configure MusicKit for the current sign-in. Signed out it plays
   * previews; signing in configures it again, and it picks up the token the
   * sign-in page left in this origin's storage.
   */
  async function connectMusicKit(): Promise<void> {
    try {
      const previous = music;
      if (previous) listen(previous, false);
      const next = await configureMusicKit(session, browser);
      music = next;
      next.volume = volume() / 100;
      listen(next, true);
      showNowPlaying();
      onPlaybackState();
      onTime();
      onModes();
    } catch (e) {
      setError(e instanceof Error ? e.message : "MusicKit failed");
    }
  }

  let connectedAs: string | null | undefined;
  createEffect(
    () => [ready(), tokenChecked(), userToken()] as const,
    ([isReady, checked, token]) => {
      if (!isReady || !checked || connectedAs === token) return;
      const signingOut = connectedAs !== undefined && token === null;
      connectedAs = token;
      // Signing out already told MusicKit (unauthorize); it carries on with previews.
      if (!signingOut) void connectMusicKit();
    },
  );

  onCleanup(() => {
    if (!music) return;
    listen(music, false);
    clearTimeout(seekTimer);
    music.pause();
  });

  async function startSignIn(): Promise<void> {
    setError("");
    setSigningIn(true);
    try {
      saveUserToken(await signIn(session, browser));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  }

  /** Run a MusicKit call, showing what went wrong instead of failing silently. */
  function withMusic(action: (m: MusicKitInstance) => Promise<unknown> | void): void {
    if (!music) {
      setError("MusicKit isn't ready yet.");
      return;
    }
    setError("");
    void Promise.resolve(action(music)).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Couldn't play that");
    });
  }

  /** Start `play`, showing `what` in the bar until the music actually starts. */
  function startPlaying(what: NowPlaying, play: (m: MusicKitInstance) => Promise<unknown>): void {
    if (music) setPending(what);
    withMusic((m) =>
      play(m).catch((e: unknown) => {
        setPending(null);
        throw e;
      }),
    );
  }

  function changeVolume(next: number): void {
    setVolume(next);
    if (music) music.volume = next / 100;
  }

  // The slider reports every pixel of a drag; seek once it comes to rest.
  let seekTimer: ReturnType<typeof setTimeout> | undefined;
  function seek(seconds: number): void {
    setScrubTo(seconds);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => {
      withMusic((m) => m.seekToTime(seconds).finally(() => setScrubTo(null)));
    }, SEEK_DELAY_MS);
  }

  function toggleShuffle(): void {
    withMusic((m) => {
      m.shuffleMode = m.shuffleMode === 1 ? 0 : 1;
      onModes();
    });
  }

  function cycleRepeat(): void {
    withMusic((m) => {
      setRepeatMode(m, nextRepeatMode(repeatModeOf(m)));
      onModes();
    });
  }

  /** A sidebar choice starts a fresh trail; opening something from a page adds to it. */
  function show(next: Route): void {
    setRoute(next);
    win.scrollTo(0);
  }
  function select(next: Route): void {
    setHistory([]);
    show(next);
  }
  function open(next: Route): void {
    setHistory((h) => [...h, route()]);
    show(next);
  }
  function back(): void {
    const h = history();
    if (!h.length) return;
    setHistory(h.slice(0, -1));
    show(h[h.length - 1]!);
  }
  const onBack = () => (history().length ? back : undefined);

  // Keyed on both tokens: a fetch before the developer token arrives has nothing to sign with.
  const playlists = useLoaded(
    () => (ready() && userToken() ? "playlists" : ""),
    (key) => (key ? cached(key, () => fetchPlaylists(session)) : Promise.resolve([] as Collection[])),
  );

  const contentW = () => win.width() - SIDEBAR_W - PAD * 2;
  /** A tile opens its page; a station has no tracks to list, so it just plays, as in Apple Music. */
  function openCollection(collection: Collection): void {
    if (collection.kind === "station") {
      startPlaying(collectionAsNowPlaying(collection), (m) => playCollection(m, collection));
      return;
    }
    open({ view: "collection", collection });
  }

  function GridPage(props: { title: string; load: () => Promise<Collection[]>; cacheKey: string }): JSX.Element {
    const items = useLoaded(() => props.cacheKey, (key) => cached(key, props.load));
    return (
      <>
        <Title width={contentW()} onBack={onBack()}>{props.title}</Title>
        <Show when={items()} fallback={<Loading />}>
          {(list) => <CollectionGrid items={list()} width={contentW()} loader={artwork} onOpen={openCollection} />}
        </Show>
      </>
    );
  }

  function SongsPage(): JSX.Element {
    const [songs, setSongs] = createSignal<Track[] | null>(null);
    const [next, setNext] = createSignal<string | null>(null);
    const [loadingMore, setLoadingMore] = createSignal(false);
    async function more(): Promise<void> {
      setLoadingMore(true);
      try {
        const page = await fetchSongs(session, next() ?? undefined);
        setSongs((s) => [...(s ?? []), ...page.items]);
        setNext(page.next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load your songs");
      } finally {
        setLoadingMore(false);
      }
    }
    // From an effect: Solid refuses writes made while the component is being created.
    createEffect(() => true, () => void more());
    return (
      <>
        <Title width={contentW()}>Songs</Title>
        <Show when={songs()} fallback={<Loading />}>
          {(list) => (
            <>
              <TrackList
                tracks={list()}
                width={contentW()}
                showAlbum
                current={shown()}
                onPlay={(i) => startPlaying(trackAsNowPlaying(list()[i]!), (m) => playTracks(m, list(), i))}
              />
              <Show when={next()}>
                <box paddingTop={4}>
                  <Button label={loadingMore() ? "Loading…" : "Show More"} disabled={loadingMore()} onClick={() => void more()} />
                </box>
              </Show>
            </>
          )}
        </Show>
      </>
    );
  }

  /** An album or playlist. Stations have no page: their tiles just play (see `openCollection`). */
  function CollectionPage(props: { collection: Collection }): JSX.Element {
    const tracks = useLoaded(
      () => `tracks:${props.collection.id}`,
      (key) => cached(key, () => fetchTracks(props.collection, session)),
    );
    return (
      <>
        <Show when={onBack()}>{(goBack) => <box paddingBottom={4}><Button label="Back" onClick={goBack()} /></box>}</Show>
        <CollectionHeader
          collection={props.collection}
          trackCount={tracks()?.length}
          width={contentW()}
          loader={artwork}
          onPlay={() => startPlaying(collectionAsNowPlaying(props.collection), (m) => playCollection(m, props.collection))}
        />
        <Show when={tracks()} fallback={<Loading />}>
          {(list) => (
            <TrackList
              tracks={list()}
              width={contentW()}
              showAlbum={props.collection.kind === "playlist"}
              current={shown()}
              onPlay={(i) => startPlaying(trackAsNowPlaying(list()[i]!), (m) => playCollection(m, props.collection, i))}
            />
          )}
        </Show>
      </>
    );
  }

  function ArtistsPage(): JSX.Element {
    const artists = useLoaded(() => "artists", (key) => cached(key, () => fetchArtists(session)));
    return (
      <>
        <Title width={contentW()}>Artists</Title>
        <Show when={artists()} fallback={<Loading />}>
          {(list) => <NameList items={list()} width={contentW()} onOpen={(artist) => open({ view: "artist", artist })} />}
        </Show>
      </>
    );
  }

  /** Apple's charts: what there is to play signed out, and a way into the catalog signed in. */
  function BrowsePage(): JSX.Element {
    const charts = useLoaded(() => "charts", (key) => cached(key, () => fetchCharts(session)));
    return (
      <>
        <Title width={contentW()}>Browse</Title>
        <Show when={charts()} fallback={<Loading />}>
          {(c) => (
            <>
              <SectionTitle>Top Playlists</SectionTitle>
              <CollectionGrid items={c().playlists} width={contentW()} maxRows={2} loader={artwork} onOpen={openCollection} />
              <SectionTitle>Top Albums</SectionTitle>
              <CollectionGrid items={c().albums} width={contentW()} maxRows={2} loader={artwork} onOpen={openCollection} />
              <SectionTitle>Top Songs</SectionTitle>
              <TrackList
                tracks={c().songs}
                width={contentW()}
                showAlbum
                current={shown()}
                onPlay={(i) => startPlaying(trackAsNowPlaying(c().songs[i]!), (m) => playTracks(m, c().songs, i))}
              />
            </>
          )}
        </Show>
      </>
    );
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function typeQuery(value: string): void {
    setQuery(value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setSearchTerm(value.trim()), SEARCH_DELAY_MS);
  }
  function submitQuery(value: string): void {
    clearTimeout(searchTimer);
    setSearchTerm(value.trim());
  }

  function SearchPage(): JSX.Element {
    const signedIn = () => !!userToken();
    const results = useLoaded(
      () => `search:${signedIn() ? "full" : "preview"}:${searchTerm()}`,
      (key) => {
        const term = searchTerm();
        return term ? cached(key, () => searchCatalog(term, signedIn(), session)) : Promise.resolve(null);
      },
    );
    const empty = () => {
      const r = results();
      return !!r && !r.songs.length && !r.artists.length && !r.albums.length && !r.playlists.length && !r.stations.length;
    };
    return (
      <>
        <Title width={contentW()}>Search</Title>
        <TextInput
          name="music-search"
          value={query()}
          onChange={typeQuery}
          onSubmit={submitQuery}
          placeholder="Artists, songs, albums…"
          icon={searchIcon}
          width={contentW()}
          autoFocus
        />
        <Show when={searchTerm()} fallback={<box paddingTop={8}><text font="body">Search Apple Music's catalog.</text></box>}>
          <Show when={results()} fallback={<Loading />}>
            {(r) => (
              <>
                <Show when={empty()}>
                  <box paddingTop={8}><text font="body">{`Nothing found for "${searchTerm()}".`}</text></box>
                </Show>
                <Show when={r().songs.length}>
                  <SectionTitle>Songs</SectionTitle>
                  <TrackList
                    tracks={r().songs}
                    width={contentW()}
                    showAlbum
                    current={shown()}
                    onPlay={(i) => startPlaying(trackAsNowPlaying(r().songs[i]!), (m) => playTracks(m, r().songs, i))}
                  />
                </Show>
                <Show when={r().artists.length}>
                  <SectionTitle>Artists</SectionTitle>
                  <NameList items={r().artists} width={contentW()} onOpen={(artist) => open({ view: "artist", artist })} />
                </Show>
                <Show when={r().albums.length}>
                  <SectionTitle>Albums</SectionTitle>
                  <CollectionGrid items={r().albums} width={contentW()} maxRows={2} loader={artwork} onOpen={openCollection} />
                </Show>
                <Show when={r().playlists.length}>
                  <SectionTitle>Playlists</SectionTitle>
                  <CollectionGrid items={r().playlists} width={contentW()} maxRows={2} loader={artwork} onOpen={openCollection} />
                </Show>
                <Show when={r().stations.length}>
                  <SectionTitle>Stations</SectionTitle>
                  <CollectionGrid items={r().stations} width={contentW()} maxRows={1} loader={artwork} onOpen={openCollection} />
                </Show>
              </>
            )}
          </Show>
        </Show>
      </>
    );
  }

  /** Stations: yours, Apple's live radio, and the genres' (signed in; they don't play as previews). */
  function RadioPage(): JSX.Element {
    const radio = useLoaded(() => "radio", (key) => cached(key, () => fetchRadio(session)));
    return (
      <>
        <Title width={contentW()}>Radio</Title>
        <Show when={radio()} fallback={<Loading />}>
          {(r) => (
            <>
              <Show when={r().personal.length}>
                <SectionTitle>Your Station</SectionTitle>
                <CollectionGrid items={r().personal} width={contentW()} maxRows={1} loader={artwork} onOpen={openCollection} />
              </Show>
              <SectionTitle>Live Radio</SectionTitle>
              <CollectionGrid items={r().live} width={contentW()} loader={artwork} onOpen={openCollection} />
              <Show when={r().genres.length}>
                <SectionTitle>Stations by Genre</SectionTitle>
                <NameList items={r().genres} width={contentW()} onOpen={(genre) => open({ view: "genre", genre })} />
              </Show>
            </>
          )}
        </Show>
      </>
    );
  }

  /** Signed in: what you played lately, then Apple's recommendations, a shelf each. */
  function HomePage(): JSX.Element {
    const recent = useLoaded(() => "recently-played", (key) => cached(key, () => fetchRecentlyPlayed(session)));
    // Recommendations are a nicety: if Apple has none, Home is just what you played.
    const shelves = useLoaded(
      () => "recommendations",
      (key) => cached(key, () => fetchRecommendations(session).catch(() => [])),
    );
    // Apple's recommendations include their own recently-played shelf (in the
    // store's language): hide any shelf that mostly repeats ours.
    const freshShelves = () => {
      const played = new Set((recent() ?? []).map((c) => c.id));
      return (shelves() ?? []).filter((shelf) => shelf.items.filter((c) => played.has(c.id)).length * 2 < shelf.items.length);
    };
    return (
      <>
        <Title width={contentW()}>Home</Title>
        <Show when={recent()} fallback={<Loading />}>
          {(items) => (
            <Show when={items().length}>
              <SectionTitle>Recently Played</SectionTitle>
              <CollectionGrid items={items()} width={contentW()} maxRows={1} loader={artwork} onOpen={openCollection} />
            </Show>
          )}
        </Show>
        <Show when={recent()?.length === 0 && shelves()?.length === 0}>
          <text font="body">Play something, and it will show up here.</text>
        </Show>
        <For each={freshShelves()}>
          {(shelf) => (
            <>
              <SectionTitle>{shelf.title}</SectionTitle>
              <CollectionGrid items={shelf.items} width={contentW()} maxRows={1} loader={artwork} onOpen={openCollection} />
            </>
          )}
        </For>
      </>
    );
  }

  function Page(props: { route: Route }): JSX.Element {
    const r = props.route;
    switch (r.view) {
      case "home":
        return <HomePage />;
      case "search":
        return <SearchPage />;
      case "radio":
        return <RadioPage />;
      case "genre":
        return <GridPage title={r.genre.name} cacheKey={`genre:${r.genre.id}`} load={() => fetchGenreStations(r.genre, session)} />;
      case "browse":
        return <BrowsePage />;
      case "recent":
        return <GridPage title="Recently Added" cacheKey="recent" load={() => fetchRecentlyAdded(session)} />;
      case "albums":
        return <GridPage title="Albums" cacheKey="albums" load={() => fetchAlbums(session)} />;
      case "artists":
        return <ArtistsPage />;
      case "songs":
        return <SongsPage />;
      case "artist":
        return <GridPage title={r.artist.name} cacheKey={`artist:${r.artist.id}`} load={() => fetchArtistAlbums(r.artist.id, session)} />;
      case "collection":
        return <CollectionPage collection={r.collection} />;
    }
  }

  const searchIcon = app.getSprite("applemusic/search");
  const icons = {
    shuffle: app.getSprite("applemusic/shuffle"),
    repeat: app.getSprite("applemusic/repeat"),
    repeatOne: app.getSprite("applemusic/repeat-one"),
  };

  return (
    <>
      <Show when={configError()}>
        <box width={win.width()} height={win.height()} padding={8} flexDirection="column" gap={4} background={0}>
          <text font="body">Apple Music isn't set up on this server.</text>
          <text font="body">{configError()}</text>
        </box>
      </Show>
      <Show when={ready()}>
        {/*
          The page scrolls with the window's own scroll bar, which runs the
          window's full height. The sidebar and the now-playing bar are drawn
          over the page at the scroll offset, so they stay put; the page leaves
          room at its foot so its last row can scroll clear of the bar.
        */}
        <box
          width={win.width()}
          minHeight={win.height()}
          background={0}
          onLayout={({ height }) => win.setContentSize(win.width(), height)}
        >
          <box
            marginLeft={SIDEBAR_W}
            width={win.width() - SIDEBAR_W}
            padding={PAD}
            paddingBottom={NOW_PLAYING_H + PAD}
            flexDirection="column"
            semantic={{ name: "music-content" }}
          >
            {/* One element per route, so each page mounts fresh. */}
            <For each={[route()]}>{(r) => <Page route={r} />}</For>
          </box>
          <Sidebar
            top={win.scrollY()}
            height={win.height() - NOW_PLAYING_H}
            route={history()[0] ?? route()}
            signedIn={!!userToken()}
            signingIn={signingIn()}
            playlists={playlists() ?? []}
            onSelect={select}
            onSignIn={() => void startSignIn()}
          />
          <NowPlayingBar
            top={win.scrollY() + win.height() - NOW_PLAYING_H}
            width={win.width()}
            loader={artwork}
            shown={shown()}
            loading={!!pending()}
            error={error()}
            playing={playing()}
            time={scrubTo() ?? time()}
            duration={duration()}
            shuffle={shuffle()}
            repeat={repeat()}
            volume={volume()}
            icons={icons}
            onPrevious={() => withMusic((m) => m.skipToPreviousItem())}
            onPlayPause={() => withMusic((m) => (playing() ? m.pause() : m.play()))}
            onNext={() => withMusic((m) => m.skipToNextItem())}
            onSeek={seek}
            onShuffle={toggleShuffle}
            onRepeat={cycleRepeat}
            onVolume={changeVolume}
          />
        </box>
      </Show>
    </>
  );
}

export default defineApp({
  id: "applemusic",
  // MusicKit plays in the page, as a live object a process can't hold.
  requires: ["network", "browser"],
  title: "Apple Music",
  icon: "applemusic/icon",
  smallIcon: "applemusic/icon-16x16",
  sprites,
  defaultSize: { width: 480, height: 300 },
  resizable: true,
  minSize: { width: 380, height: 220 },
  scrollable: true,
  Component: AppleMusic,
});
