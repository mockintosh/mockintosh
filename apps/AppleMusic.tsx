import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button } from "@mockintosh/ui";
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
  fetchDeveloperToken,
  fetchPlaylists,
  fetchRecentlyAdded,
  fetchSongs,
  fetchTracks,
  isStoredUserToken,
  nextRepeatMode,
  nowPlaying,
  playCollection,
  playTracks,
  repeatModeOf,
  setRepeatMode,
  signIn,
  trackAsNowPlaying,
} from "./applemusic/api";
import { createArtworkLoader } from "./applemusic/Artwork";
import { NOW_PLAYING_H, NowPlayingBar } from "./applemusic/NowPlayingBar";
import {
  ArtistList,
  CollectionGrid,
  CollectionHeader,
  Loading,
  SIDEBAR_W,
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
  const [route, setRoute] = createSignal<Route>({ view: "recent" });
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
  const [signingIn, setSigningIn] = createSignal(false);

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
      pending = fetch().catch((e: unknown) => {
        cache.delete(key);
        setError(e instanceof Error ? e.message : "Apple Music didn't answer");
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
    setCurrent(null);
    setRoute({ view: "recent" });
    setHistory([]);
    setError(message);
  }

  createEffect(() => !!userToken(), (signedIn) => {
    app.setMenus([
      {
        label: "File",
        items: [
          { label: "Sign Out", disabled: !signedIn, onClick: () => void signOut() },
          { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
        ],
      },
    ]);
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

  createEffect(
    () => [ready(), userToken()] as const,
    ([isReady, token]) => {
      if (!isReady || !token || music) return;
      void (async () => {
        try {
          music = await configureMusicKit(session, browser);
          music.volume = volume() / 100;
          music.addEventListener("nowPlayingItemDidChange", showNowPlaying);
          music.addEventListener("playbackStateDidChange", onPlaybackState);
          music.addEventListener("mediaPlaybackError", onPlaybackError);
          for (const name of TIME_EVENTS) music.addEventListener(name, onTime);
          for (const name of MODE_EVENTS) music.addEventListener(name, onModes);
          showNowPlaying();
          onPlaybackState();
          onTime();
          onModes();
        } catch (e) {
          setError(e instanceof Error ? e.message : "MusicKit failed");
        }
      })();
    },
  );

  onCleanup(() => {
    if (!music) return;
    music.removeEventListener("nowPlayingItemDidChange", showNowPlaying);
    music.removeEventListener("playbackStateDidChange", onPlaybackState);
    music.removeEventListener("mediaPlaybackError", onPlaybackError);
    for (const name of TIME_EVENTS) music.removeEventListener(name, onTime);
    for (const name of MODE_EVENTS) music.removeEventListener(name, onModes);
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
  const openCollection = (collection: Collection) => open({ view: "collection", collection });

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

  function CollectionPage(props: { collection: Collection }): JSX.Element {
    const isStation = props.collection.kind === "station";
    const tracks = useLoaded(
      () => `tracks:${props.collection.id}`,
      (key) => (isStation ? Promise.resolve([] as Track[]) : cached(key, () => fetchTracks(props.collection, session))),
    );
    return (
      <>
        <Show when={onBack()}>{(goBack) => <box paddingBottom={4}><Button label="Back" onClick={goBack()} /></box>}</Show>
        <CollectionHeader
          collection={props.collection}
          trackCount={isStation ? 1 : tracks()?.length}
          width={contentW()}
          loader={artwork}
          onPlay={() => startPlaying(collectionAsNowPlaying(props.collection), (m) => playCollection(m, props.collection))}
        />
        <Show when={!isStation}>
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
          {(list) => <ArtistList artists={list()} width={contentW()} onOpen={(artist) => open({ view: "artist", artist })} />}
        </Show>
      </>
    );
  }

  function Page(props: { route: Route }): JSX.Element {
    const r = props.route;
    switch (r.view) {
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

  const logo = app.getSprite("applemusic/icon");

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
      <Show when={ready() && !userToken()}>
        <box width={win.width()} height={win.height()} background={1} flexDirection="column" alignItems="center" justifyContent="center" gap={8} padding={8}>
          {logo && (
            <image
              width={logo.width}
              height={logo.height}
              src={{ width: logo.width, height: logo.height, data: logo.data, mask: logo.mask }}
              mode="inverted"
            />
          )}
          <text font="body" color={0}>Sign in to play your Apple Music library.</text>
          <Button label="Sign In…" disabled={signingIn()} onClick={() => void startSignIn()} />
          <Show when={error()}>
            <text font="body" color={0}>{error()}</text>
          </Show>
        </box>
      </Show>
      <Show when={ready() && userToken()}>
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
          <Sidebar top={win.scrollY()} height={win.height() - NOW_PLAYING_H} route={route()} playlists={playlists() ?? []} onSelect={select} />
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
