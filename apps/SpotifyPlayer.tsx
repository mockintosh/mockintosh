import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { BULLET, Button, Progress, Slider, TextInput, fontLineHeight, measureText, useUIServices } from "@mockintosh/ui";
import { useApp, defineApp } from "@mockintosh/sdk";
import {
  SPOTIFY_ACCOUNTS_HOST,
  SpotifyError,
  type DitheredArt,
  type PlayerState,
  type SpotifyPlaylist,
  type SpotifySession,
  type SpotifyTokens,
  type SpotifyTrack,
  ditherImageFromUrl,
  fetchPlaylists,
  fetchPlaylistTracks,
  formatDuration,
  getValidToken,
  isSpotifyTokens,
  loadSpotifySDK,
  playOn,
  signInWithPhone,
  spotifyPost,
  spotifyPut,
} from "./spotify/api";
import { spotifySprites } from "./sprites/spotify";

const SIDEBAR_W = 140;
const NOW_PLAYING_H = 56;
const PLAYLIST_HEADER_H = 64;
const COVER = 48;
const ART = 40;
const ROW_H = fontLineHeight("body") + 4;
const TIME_W = 34;
const MARK_W = 14;
const PAD = 6;
const SCROLLBAR_ROOM = 4;

/** Keys in the app's storage folder (System Folder/Preferences/spotify/). */
const TOKENS_KEY = "tokens.json";
const CLIENT_ID_KEY = "client-id.txt";

const DASHBOARD_URL = "https://developer.spotify.com/dashboard";
/** Spotify client IDs are 32 hex digits. */
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

/** What the Web Playback SDK reports with `player_state_changed`. */
interface SdkState {
  paused: boolean;
  position: number;
  duration: number;
  track_window?: { current_track?: SpotifyTrack & { uri: string } };
  context?: { uri?: string | null };
}

interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  setVolume(v: number): Promise<void>;
  activateElement?(): Promise<void>;
  addListener(event: string, cb: (payload: never) => void): void;
}

/** `text`, cut with an ellipsis to fit `width` pixels in `font`. */
function fit(text: string, width: number, font = "body"): string {
  if (width <= 0) return "";
  if (measureText(text, font) <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureText(`${text.slice(0, mid)}…`, font) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

function artistNames(track: SpotifyTrack): string {
  return track.artists.map((a) => a.name).join(", ");
}

/** A dithered cover, or an empty frame while there is none. */
function Cover(props: { art: DitheredArt | null; size: number }): JSX.Element {
  return (
    <box width={props.size} height={props.size} borderColor={1} borderWidth={1} flexShrink={0}>
      <raster
        width={props.size - 2}
        height={props.size - 2}
        revision={props.art ? props.art.bits.length + props.art.width : 0}
        onPaint={({ fill, blitPixels }) => {
          fill(0);
          const art = props.art;
          if (art) blitPixels(art.bits, art.width, art.height);
        }}
      />
    </box>
  );
}

interface SetupScreenProps {
  width: number;
  height: number;
  redirectUri: string;
  initial: string;
  openDashboard: () => void;
  copy?: (text: string) => Promise<void>;
  onDone: (clientId: string) => void;
}

/** Connects the player to the user's own Spotify app. */
function SetupScreen(props: SetupScreenProps): JSX.Element {
  const [value, setValue] = createSignal(props.initial);
  const [problem, setProblem] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const textW = () => Math.min(420, props.width - 32);

  function submit(): void {
    const id = value().trim();
    if (!CLIENT_ID_PATTERN.test(id)) {
      setProblem("A Client ID is 32 letters and digits, shown under the app's name in the dashboard.");
      return;
    }
    props.onDone(id);
  }

  function Step(p: { n: number; children: JSX.Element }): JSX.Element {
    return (
      <box flexDirection="row" gap={6} width={textW()}>
        <box width={12}><text font="menu">{`${p.n}.`}</text></box>
        <box flexDirection="column" gap={4} width={textW() - 18}>{p.children}</box>
      </box>
    );
  }

  return (
    <box width={props.width} height={props.height} flexDirection="column" alignItems="center" justifyContent="center" gap={10} padding={12}>
      <text font="menu">Connect Spotify Player to Spotify</text>
      <box width={textW()}>
        <text font="body">
          Spotify lets each developer app serve only five listeners, so Spotify Player plays through an app of your own. It's free to make, but playing needs Spotify Premium.
        </text>
      </box>
      <Step n={1}>
        <text font="body">Create an app in Spotify's developer dashboard.</text>
        <Button label="Open Dashboard" onClick={props.openDashboard} />
      </Step>
      <Step n={2}>
        <text font="body">Add this Redirect URI, and tick Web API and Web Playback SDK:</text>
        <box flexDirection="row" gap={6} alignItems="center">
          <box borderColor={1} borderWidth={1} paddingLeft={4} paddingRight={4} height={20} justifyContent="center">
            <text font="body" nowrap>{fit(props.redirectUri, textW() - 100)}</text>
          </box>
          <Show when={props.copy}>
            <Button
              label={copied() ? "Copied" : "Copy"}
              onClick={() => void props.copy!(props.redirectUri).then(() => setCopied(true))}
            />
          </Show>
        </box>
      </Step>
      <Step n={3}>
        <text font="body">Paste the app's Client ID:</text>
        <box flexDirection="row" gap={6} alignItems="center">
          <TextInput
            name="spotify-client-id"
            value={value()}
            onChange={(v) => {
              setValue(v);
              setProblem("");
            }}
            onSubmit={submit}
            placeholder="Client ID"
            width={textW() - 100}
          />
          <Button label="Continue" onClick={submit} />
        </box>
        <Show when={problem()}>
          <text font="body">{problem()}</text>
        </Show>
      </Step>
    </box>
  );
}

function SpotifyPlayer(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { storage } = app;
  // Spotify lets a Development Mode app serve five listeners, so each
  // person signs in through a Spotify app of their own. `undefined` while
  // the stored one loads, "" when there is none.
  const [clientId, setClientId] = createSignal<string | undefined>(undefined, { ownedWrite: true });
  const signIn = app.signIn!; // present: the app requires "sign-in"
  const [tokens, setTokens] = createSignal<SpotifyTokens | null>(null, { ownedWrite: true });
  const signedIn = createMemo(() => !!tokens());
  const [playlists, setPlaylists] = createSignal<SpotifyPlaylist[] | null>(null, { ownedWrite: true });
  const [selected, setSelected] = createSignal<SpotifyPlaylist | null>(null);
  const [tracks, setTracks] = createSignal<SpotifyTrack[] | null>(null, { ownedWrite: true });
  const [tracksNote, setTracksNote] = createSignal("", { ownedWrite: true });
  const [selectedTrack, setSelectedTrack] = createSignal(-1, { ownedWrite: true });
  const [cover, setCover] = createSignal<DitheredArt | null>(null, { ownedWrite: true });
  const [player, setPlayer] = createSignal<PlayerState | null>(null, { ownedWrite: true });
  const [playingUri, setPlayingUri] = createSignal<string | null>(null, { ownedWrite: true });
  const [positionAt, setPositionAt] = createSignal({ position: 0, at: 0 }, { ownedWrite: true });
  const [now, setNow] = createSignal(Date.now(), { ownedWrite: true });
  const [art, setArt] = createSignal<DitheredArt | null>(null, { ownedWrite: true });
  const [volume, setVolume] = createSignal(50);
  const [ready, setReady] = createSignal(false, { ownedWrite: true });
  const [status, setStatus] = createSignal("", { ownedWrite: true });
  const [error, setError] = createSignal("");
  const [signingIn, setSigningIn] = createSignal(false);

  // The API layer reads `session.tokens` and reports refreshes/revocations
  // through `onChange`; we own persistence.
  const session: SpotifySession = {
    tokens: null,
    fetch: app.fetch!, // present: the app requires "network"
    clientId: "",
    redirectUri: signIn.redirectUri,
    crypto: app.crypto,
    images: app.images,
    onChange(next) {
      session.tokens = next;
      setTokens(next);
      void (next ? storage.write(TOKENS_KEY, JSON.stringify(next)) : storage.remove(TOKENS_KEY));
    },
  };

  function signOut(): void {
    sdkPlayer?.disconnect();
    sdkPlayer = null;
    deviceId = null;
    setReady(false);
    setPlayer(null);
    setPlaylists(null);
    setSelected(null);
    setTracks(null);
    setArt(null);
    session.onChange(null);
  }

  /** Use `id` from now on. Tokens belong to the app that issued them, so a new one signs out. */
  function useClientId(id: string): void {
    if (session.clientId && id !== session.clientId && tokens()) signOut();
    session.clientId = id;
    setClientId(id);
    void (id ? storage.write(CLIENT_ID_KEY, id) : storage.remove(CLIENT_ID_KEY));
  }

  // Kept to fill in the setup form when the user changes it.
  let previousClientId = "";
  function changeClientId(): void {
    previousClientId = session.clientId;
    if (tokens()) signOut();
    useClientId("");
  }

  createEffect(
    () => ({ inside: signedIn(), configured: !!clientId() }),
    ({ inside, configured }) => {
      app.setMenus([
        {
          label: "File",
          items: [
            ...(inside ? [{ label: "Sign Out", onClick: signOut }] : []),
            ...(configured ? [{ label: "Change Client ID…", onClick: changeClientId }, { label: "-" }] : inside ? [{ label: "-" }] : []),
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
      ]);
    },
  );

  const storedClientId = createMemo(async () => (await storage.read(CLIENT_ID_KEY))?.trim() ?? "");
  createEffect(
    () => storedClientId(),
    (id) => {
      session.clientId = id;
      setClientId(id);
    },
  );

  const storedTokens = createMemo(async () => {
    const raw = await storage.read(TOKENS_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSpotifyTokens(parsed) ? parsed : null;
    } catch {
      await storage.remove(TOKENS_KEY);
      return null;
    }
  });
  createEffect(
    () => storedTokens(),
    (parsed) => {
      if (parsed) {
        session.tokens = parsed;
        setTokens(parsed);
      }
    },
  );

  let deviceId: string | null = null;
  let sdkPlayer: SdkPlayer | null = null;
  const artCache = new Map<string, Promise<DitheredArt | null>>();

  function dither(url: string, size: number): Promise<DitheredArt | null> {
    const key = `${size}:${url}`;
    let pending = artCache.get(key);
    if (!pending) {
      pending = ditherImageFromUrl(url, size, session);
      artCache.set(key, pending);
    }
    return pending;
  }

  /** The smallest image at least `size` pixels wide; Spotify lists them largest first. */
  function imageFor(images: Array<{ url: string; width?: number | null }>, size: number): string | undefined {
    const fitting = images.filter((i) => (i.width ?? 640) >= size);
    return (fitting[fitting.length - 1] ?? images[0])?.url;
  }

  function onSdkState(state: SdkState | null): void {
    if (!state) {
      setPlayer(null);
      setPlayingUri(null);
      return;
    }
    const track = state.track_window?.current_track;
    setPlayer({
      track: track
        ? { uri: track.uri, name: track.name, artists: track.artists, album: track.album, duration_ms: track.duration_ms }
        : null,
      paused: state.paused,
      position_ms: state.position,
      duration_ms: state.duration,
    });
    setPlayingUri(track?.uri ?? null);
    setPositionAt({ position: state.position, at: Date.now() });
    setNow(Date.now());
    const url = track ? imageFor(track.album.images, ART) : undefined;
    if (!url) setArt(null);
    else void dither(url, ART - 2).then((px) => setArt(px));
  }

  // Once per sign-in, not per token refresh: the SDK asks for fresh tokens itself.
  createEffect(
    () => signedIn(),
    (inside) => {
      if (!inside) return;
      setStatus("Connecting…");
      void (async () => {
        try {
          const Spotify = await loadSpotifySDK(app.browser!);
          if (!Spotify?.Player) throw new Error("Spotify's player didn't load.");
          const created = new Spotify.Player({
            name: "Mockintosh",
            getOAuthToken: (cb: (token: string) => void) => {
              void getValidToken(session).then((tok) => tok && cb(tok));
            },
            volume: 0.5,
          }) as SdkPlayer;
          sdkPlayer = created;
          created.addListener("ready", (({ device_id }: { device_id: string }) => {
            deviceId = device_id;
            setReady(true);
            setStatus("");
          }) as (payload: never) => void);
          created.addListener("not_ready", (() => {
            setReady(false);
            setStatus("Spotify lost this player. Reconnecting…");
          }) as (payload: never) => void);
          created.addListener("player_state_changed", onSdkState as (payload: never) => void);
          created.addListener("account_error", (() =>
            setStatus("Playing here needs Spotify Premium.")) as (payload: never) => void);
          created.addListener("authentication_error", (() =>
            setStatus("Spotify didn't accept the sign-in. Sign out and in again.")) as (payload: never) => void);
          created.addListener("initialization_error", (({ message }: { message: string }) =>
            setStatus(`Can't play here: ${message}`)) as (payload: never) => void);
          created.addListener("playback_error", (({ message }: { message: string }) =>
            setStatus(message)) as (payload: never) => void);
          if (!(await created.connect())) setStatus("Couldn't connect to Spotify.");
        } catch (e) {
          setStatus(e instanceof Error ? e.message : "Couldn't start the player.");
        }
      })();
      void fetchPlaylists(session)
        .then((pls) => setPlaylists(pls))
        .catch(() => {
          setPlaylists([]);
          setStatus("Couldn't load your playlists.");
        });
    },
  );

  // A playlist's songs and cover, whenever the selection changes.
  createEffect(
    () => selected(),
    (pl) => {
      setTracks(null);
      setTracksNote("");
      setSelectedTrack(-1);
      setCover(null);
      if (!pl) return;
      const url = imageFor(pl.images, COVER);
      if (url) void dither(url, COVER - 2).then((px) => selected() === pl && setCover(px));
      fetchPlaylistTracks(pl.id, session)
        .then((list) => {
          if (selected() !== pl) return;
          setTracks(list);
          if (!list.length) setTracksNote("This playlist is empty.");
        })
        .catch((e: unknown) => {
          if (selected() !== pl) return;
          setTracks([]);
          setTracksNote(
            e instanceof SpotifyError && e.status === 403
              ? "Spotify only lists the songs of playlists you made or collaborate on. Play it to listen."
              : "Couldn't load this playlist.",
          );
        });
    },
  );

  // Advance the clock while a song plays.
  createEffect(
    () => player() !== null && !player()!.paused,
    (playing) => {
      if (!playing) return;
      const timer = setInterval(() => setNow(Date.now()), 500);
      return () => clearInterval(timer);
    },
  );

  onCleanup(() => {
    sdkPlayer?.disconnect();
  });

  const position = () => {
    const p = player();
    if (!p) return 0;
    const { position: at, at: since } = positionAt();
    return Math.min(p.duration_ms, p.paused ? at : at + (now() - since));
  };

  async function play(contextUri?: string, trackUri?: string): Promise<void> {
    if (!deviceId) {
      setStatus(status() || "The player isn't ready yet.");
      return;
    }
    await sdkPlayer?.activateElement?.();
    if (!(await playOn(deviceId, session, contextUri, trackUri))) setStatus("Spotify wouldn't play that.");
    else setStatus("");
  }

  function togglePlay(): void {
    const p = player();
    if (p && !p.paused) {
      void spotifyPut(`/me/player/pause?device_id=${encodeURIComponent(deviceId ?? "")}`, null, session);
      return;
    }
    if (p) void play();
    else if (selected()) void play(selected()!.uri);
  }

  async function startSignIn(): Promise<void> {
    setError("");
    setSigningIn(true);
    try {
      const next = await signInWithPhone(session, signIn);
      if (next) session.onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  }

  const logo = app.getSprite("icon/spotify");
  const { clipboard } = useUIServices();
  const sprite = (name: string) => app.getSprite(`spotify/${name}`)!;

  /** Spotify's own count where it gives one; it includes songs this list can't show. */
  const songCount = (pl: SpotifyPlaylist) => {
    const n = pl.total ?? tracks()?.length;
    return n == null ? "" : n === 1 ? "1 song" : `${n} songs`;
  };

  const bodyH = () => win.height() - NOW_PLAYING_H;
  const paneW = () => win.width() - SIDEBAR_W - 1;
  const titleW = () => paneW() - MARK_W - TIME_W - PAD * 2 - SCROLLBAR_ROOM;
  const nameColW = () => Math.floor(titleW() * 0.55);
  const artistColW = () => titleW() - nameColW() - PAD;

  function TransportButton(props: { icon: string; name: string; onClick: () => void }): JSX.Element {
    const s = () => sprite(props.icon);
    return (
      <box
        semantic={{ name: props.name, role: "button" }}
        width={22}
        height={20}
        alignItems="center"
        justifyContent="center"
        onClick={props.onClick}
      >
        <image width={s().width} height={s().height} src={{ width: s().width, height: s().height, data: s().data, mask: s().mask }} />
      </box>
    );
  }

  return (
    <box width={win.width()} height={win.height()} background={0} flexDirection="column">
      <Show when={clientId() === ""}>
        <SetupScreen
          width={win.width()}
          height={win.height()}
          redirectUri={signIn.redirectUri}
          initial={previousClientId}
          openDashboard={() => void app.browser?.openExternal(DASHBOARD_URL)}
          copy={clipboard ? (text) => clipboard.writeText(text) : undefined}
          onDone={useClientId}
        />
      </Show>
      <Show when={clientId() && !tokens()}>
        <box width="100%" height="100%" background={1} flexDirection="column" alignItems="center" justifyContent="center" gap={8} padding={8}>
          {logo && (
            <image
              width={logo.width}
              height={logo.height}
              src={{ width: logo.width, height: logo.height, data: logo.data, mask: logo.mask }}
              mode="inverted"
            />
          )}
          <text font="body" color={0}>Sign in to Spotify with your phone.</text>
          <Button label="Sign In…" disabled={signingIn()} onClick={() => void startSignIn()} />
          <Show when={error()}>
            <text font="body" color={0}>{error()}</text>
          </Show>
        </box>
      </Show>
      <Show when={clientId() && tokens()}>
        <box flexDirection="row" width={win.width()} height={bodyH()}>
          {/* Playlists */}
          <box width={SIDEBAR_W} height={bodyH()} flexDirection="column" flexShrink={0}>
            <box height={ROW_H + 6} paddingLeft={PAD} justifyContent="center">
              <text font="menu">Playlists</text>
            </box>
            <box height={1} background={1} />
            <box semantic={{ name: "spotify-playlists" }} height={bodyH() - ROW_H - 7} overflow="scroll" flexDirection="column">
              <Show when={playlists()} fallback={<box padding={PAD}><text font="body">Loading…</text></box>}>
                {(list) => (
                  <Show when={list().length} fallback={<box padding={PAD}><text font="body">No playlists.</text></box>}>
                    <For each={list()}>
                      {(pl) => {
                        const on = () => selected()?.id === pl.id;
                        return (
                          <box
                            semantic={{ name: `spotify-playlist-${pl.id}`, role: "option" }}
                            height={ROW_H}
                            flexShrink={0}
                            paddingLeft={PAD}
                            justifyContent="center"
                            background={on() ? 1 : 0}
                            onClick={() => setSelected(pl)}
                            onDoubleClick={() => void play(pl.uri)}
                          >
                            <text font="body" color={on() ? 0 : 1} nowrap>
                              {fit(pl.name, SIDEBAR_W - PAD * 2)}
                            </text>
                          </box>
                        );
                      }}
                    </For>
                  </Show>
                )}
              </Show>
            </box>
          </box>
          <box width={1} height={bodyH()} background={1} />

          {/* The selected playlist */}
          <box width={paneW()} height={bodyH()} flexDirection="column">
            <Show
              when={selected()}
              fallback={
                <box width="100%" height="100%" alignItems="center" justifyContent="center">
                  <text font="body">Choose a playlist.</text>
                </box>
              }
            >
              {(pl) => (
                <>
                  <box height={PLAYLIST_HEADER_H} flexDirection="row" alignItems="center" gap={PAD + 2} paddingLeft={PAD + 2} paddingRight={PAD}>
                    <Cover art={cover()} size={COVER} />
                    <box flexDirection="column" gap={2} flexGrow={1}>
                      <text font="menu" nowrap>{fit(pl().name, paneW() - COVER - 90, "menu")}</text>
                      <text font="body" nowrap>
                        {fit(
                          [pl().owner && `by ${pl().owner}`, songCount(pl())]
                            .filter(Boolean)
                            .join(` ${BULLET} `),
                          paneW() - COVER - 90,
                        )}
                      </text>
                    </box>
                    <Button label="Play" disabled={!ready()} onClick={() => void play(pl().uri)} />
                  </box>
                  <box height={1} background={1} />
                  <box height={ROW_H} flexDirection="row" alignItems="center" paddingLeft={PAD} flexShrink={0}>
                    <box width={MARK_W} />
                    <box width={nameColW()}><text font="body" nowrap>Title</text></box>
                    <box width={PAD} />
                    <box width={artistColW()}><text font="body" nowrap>Artist</text></box>
                    <box width={TIME_W}><text font="body" nowrap align="right">Time</text></box>
                  </box>
                  <box height={1} background={1} />
                  <box
                    semantic={{ name: "spotify-tracks" }}
                    height={bodyH() - PLAYLIST_HEADER_H - ROW_H - 2}
                    overflow="scroll"
                    flexDirection="column"
                  >
                    <Show when={tracks()} fallback={<box padding={PAD}><text font="body">Loading…</text></box>}>
                      {(list) => (
                        <>
                          <Show when={tracksNote()}>
                            <box padding={PAD}>
                              <text font="body">{tracksNote()}</text>
                            </box>
                          </Show>
                          <For each={list()}>
                            {(track, i) => {
                              const on = () => selectedTrack() === i();
                              const playing = () => !!track.uri && track.uri === playingUri();
                              return (
                                <box
                                  semantic={{ name: `spotify-track-${i()}`, role: "option" }}
                                  height={ROW_H}
                                  flexShrink={0}
                                  flexDirection="row"
                                  alignItems="center"
                                  paddingLeft={PAD}
                                  background={on() ? 1 : 0}
                                  onClick={() => setSelectedTrack(i())}
                                  onDoubleClick={() => void play(pl().uri, track.uri)}
                                >
                                  <box width={MARK_W}>
                                    <text font="body" color={on() ? 0 : 1}>{playing() ? BULLET : ""}</text>
                                  </box>
                                  <box width={nameColW()}>
                                    <text font="body" color={on() ? 0 : 1} bold={playing()} nowrap>
                                      {fit(track.name, nameColW())}
                                    </text>
                                  </box>
                                  <box width={PAD} />
                                  <box width={artistColW()}>
                                    <text font="body" color={on() ? 0 : 1} nowrap>
                                      {fit(artistNames(track), artistColW())}
                                    </text>
                                  </box>
                                  <box width={TIME_W}>
                                    <text font="body" color={on() ? 0 : 1} nowrap align="right">
                                      {formatDuration(track.duration_ms)}
                                    </text>
                                  </box>
                                </box>
                              );
                            }}
                          </For>
                        </>
                      )}
                    </Show>
                  </box>
                </>
              )}
            </Show>
          </box>
        </box>

        {/* Now playing */}
        <box height={1} background={1} />
        <box
          semantic={{ name: "spotify-now-playing" }}
          height={NOW_PLAYING_H - 1}
          flexDirection="row"
          alignItems="center"
          gap={PAD + 2}
          paddingLeft={PAD + 2}
          paddingRight={PAD + 2}
        >
          <Cover art={art()} size={ART} />
          <box flexDirection="column" gap={2} width={Math.max(60, win.width() - ART - 330)}>
            <text font="menu" nowrap>
              {fit(player()?.track?.name ?? (ready() ? "Not playing" : status() || "Connecting…"), Math.max(60, win.width() - ART - 330), "menu")}
            </text>
            <text font="body" nowrap>
              {fit(
                player()?.track ? artistNames(player()!.track!) : player() ? "" : ready() ? status() || "Double-click a song to play it." : "",
                Math.max(60, win.width() - ART - 330),
              )}
            </text>
          </box>
          <box flexDirection="column" alignItems="center" gap={2} flexGrow={1}>
            <box flexDirection="row" gap={4}>
              <TransportButton icon="prev" name="spotify-previous" onClick={() => void spotifyPost("/me/player/previous", session)} />
              <TransportButton icon={player() && !player()!.paused ? "pause" : "play"} name="spotify-play-pause" onClick={togglePlay} />
              <TransportButton icon="next" name="spotify-next" onClick={() => void spotifyPost("/me/player/next", session)} />
            </box>
            <box flexDirection="row" gap={4} alignItems="center">
              <box width={TIME_W}><text font="body" align="right" nowrap>{formatDuration(position())}</text></box>
              <Progress name="spotify-progress" value={position()} max={player()?.duration_ms ?? 1} width={120} height={8} />
              <box width={TIME_W}><text font="body" nowrap>{formatDuration(player()?.duration_ms ?? 0)}</text></box>
            </box>
          </box>
          <box flexDirection="row" gap={2} alignItems="center">
            <image
              width={sprite("volume").width}
              height={sprite("volume").height}
              src={{ width: sprite("volume").width, height: sprite("volume").height, data: sprite("volume").data, mask: sprite("volume").mask }}
            />
            <Slider
              name="spotify-volume"
              value={volume()}
              min={0}
              max={100}
              width={56}
              showValue={false}
              onChange={(v) => {
                setVolume(v);
                void sdkPlayer?.setVolume(v / 100);
              }}
            />
          </box>
        </box>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "spotify",
  requires: ["network", "browser", "sign-in"],
  signIn: { hosts: [SPOTIFY_ACCOUNTS_HOST] },
  title: "Spotify Player",
  icon: "icon/spotify",
  smallIcon: "icon/spotify-16x16",
  sprites: spotifySprites,
  defaultSize: { width: 540, height: 340 },
  minSize: { width: 440, height: 240 },
  scrollable: false,
  Component: SpotifyPlayer,
});
