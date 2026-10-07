import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button } from "@mockintosh/ui";
import { useApp, defineApp } from "@mockintosh/sdk";
import {
  SPOTIFY_ACCOUNTS_HOST,
  type PlayerState,
  type SpotifyPlaylist,
  type SpotifySession,
  type SpotifyTokens,
  ditherImageFromUrl,
  fetchPlaylists,
  isSpotifyTokens,
  loadSpotifySDK,
  signInWithPhone,
  spotifyPost,
  spotifyPut,
} from "./spotify/api";
import { spotifySprites } from "./sprites/spotify";

const SIDEBAR_W = 90;

/** Key in the app's storage folder (System Folder/Preferences/spotify/). */
const TOKENS_KEY = "tokens.json";

function SpotifyPlayer(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const { storage } = app;
  const CLIENT_ID = app.env.config.SPOTIFY_CLIENT_ID ?? "";
  const signIn = app.signIn!; // present: the app requires "sign-in"
  const [tokens, setTokens] = createSignal<SpotifyTokens | null>(null, { ownedWrite: true });
  const [playlists, setPlaylists] = createSignal<SpotifyPlaylist[]>([]);
  const [selected, setSelected] = createSignal(-1);
  const [player, setPlayer] = createSignal<PlayerState | null>(null);
  const [art, setArt] = createSignal<Uint8Array | null>(null);
  const [artSize, setArtSize] = createSignal(64);
  const [volume, setVolume] = createSignal(50);
  const [error, setError] = createSignal("");
  const [signingIn, setSigningIn] = createSignal(false);
  const [sidebarScroll, setSidebarScroll] = createSignal(0);

  // The API layer reads `session.tokens` and reports refreshes/revocations
  // through `onChange`; we own persistence.
  const session: SpotifySession = {
    tokens: null,
    fetch: app.fetch!, // present: the app requires "network"
    clientId: CLIENT_ID,
    redirectUri: signIn.redirectUri,
    crypto: app.crypto,
    images: app.images,
    onChange(next) {
      setTokens(next);
      void (next ? storage.write(TOKENS_KEY, JSON.stringify(next)) : storage.remove(TOKENS_KEY));
    },
  };

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
      if (parsed) setTokens(parsed);
    },
  );

  let deviceId: string | null = null;
  let sdkPlayer: { connect: () => Promise<void>; disconnect: () => void; setVolume: (v: number) => void; addListener: Function } | null = null;

  createEffect(
    () => tokens(),
    (t) => {
      session.tokens = t;
    },
  );

  createEffect(
    () => tokens(),
    (t) => {
    if (!t) return;
    void (async () => {
      try {
        const Spotify = await loadSpotifySDK(app.browser!);
        if (!Spotify?.Player) return;
        sdkPlayer = new Spotify.Player({
          name: "Mockintosh Player",
          getOAuthToken: (cb: (token: string) => void) => {
            const tok = session.tokens?.access_token;
            if (tok) cb(tok);
          },
          volume: volume() / 100,
        }) as NonNullable<typeof sdkPlayer>;
        sdkPlayer.addListener("ready", ({ device_id }: { device_id: string }) => {
          deviceId = device_id;
          void spotifyPut("/me/player", { device_ids: [device_id], play: false }, session);
        });
        sdkPlayer.addListener("player_state_changed", (state: {
          paused: boolean;
          position: number;
          duration: number;
          track_window?: { current_track?: { name: string; artists: Array<{ name: string }>; album: { name: string; images: Array<{ url: string }> }; duration_ms: number } };
        } | null) => {
          if (!state) {
            setPlayer(null);
            return;
          }
          const track = state.track_window?.current_track;
          setPlayer({
            track: track
              ? {
                  name: track.name,
                  artists: track.artists,
                  album: track.album,
                  duration_ms: track.duration_ms,
                }
              : null,
            paused: state.paused,
            position_ms: state.position,
            duration_ms: state.duration,
          });
          const url = track?.album?.images?.[0]?.url;
          if (url) {
            const size = Math.max(32, Math.min(win.width() - SIDEBAR_W - 16, win.height() - 60));
            setArtSize(size);
            void ditherImageFromUrl(url, size, size, session).then((px) => {
              if (px) setArt(px);
            });
          }
        });
        await sdkPlayer.connect();
      } catch (e) {
        setError(e instanceof Error ? e.message : "SDK failed");
      }
    })();
    void fetchPlaylists(session).then((pls) => {
      if (pls.length) setPlaylists(pls);
    });
    },
  );

  onCleanup(() => {
    sdkPlayer?.disconnect();
  });

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

  return (
    <box width={win.width()} height={win.height()} background={0} flexDirection="column">
      <Show when={!CLIENT_ID}>
        <box padding={8} flexDirection="column" gap={4}>
          <text font="body">VITE_SPOTIFY_CLIENT_ID not set.</text>
          <text font="body">Add it to .env.local and restart.</text>
        </box>
      </Show>
      <Show when={CLIENT_ID && !tokens()}>
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
      <Show when={CLIENT_ID && tokens()}>
        <box flexDirection="row" width="100%" height="100%">
          <box
            width={SIDEBAR_W}
            height="100%"
            flexDirection="column"
            background={0}
            borderColor={1}
            borderWidth={1}
            overflow="scroll"
            onScroll={(dy) => setSidebarScroll((s) => Math.max(0, s + dy))}
          >
            <text font="body">PLAYLISTS</text>
            <box height={1} background={1} />
            <For each={playlists()}>
              {(pl, i) => (
                <box
                  padding={2}
                  background={selected() === i() ? 1 : 0}
                  onClick={() => {
                    setSelected(i());
                    if (deviceId) {
                      void spotifyPut("/me/player/play", { context_uri: pl.uri }, session);
                    }
                  }}
                >
                  <text font="body" color={selected() === i() ? 0 : 1}>
                    {pl.name.slice(0, 12)}
                  </text>
                </box>
              )}
            </For>
          </box>
          <box flexGrow={1} flexDirection="column" padding={4} gap={4}>
            <raster
              width={artSize()}
              height={artSize()}
              onPaint={({ rect, setPixel, blitPixels }) => {
                const px = art();
                if (px) {
                  blitPixels(px, artSize(), artSize());
                  return;
                }
                for (let y = 0; y < rect.height; y++) {
                  for (let x = 0; x < rect.width; x++) {
                    setPixel(x, y, (x + y) % 4 === 0 ? 1 : 0);
                  }
                }
              }}
            />
            <text font="body">
              {player()?.track
                ? `${player()!.track!.name} - ${player()!.track!.artists.map((a) => a.name).join(", ")}`
                : "No track playing"}
            </text>
            <box flexDirection="row" gap={6} alignItems="center">
              <Button label="<<" onClick={() => void spotifyPost("/me/player/previous", session)} />
              <Button
                label={player()?.paused ?? true ? ">" : "||"}
                onClick={() => {
                  if (player()?.paused ?? true) {
                    void spotifyPut("/me/player/play", null, session);
                  } else {
                    void spotifyPut("/me/player/pause", null, session);
                  }
                }}
              />
              <Button label=">>" onClick={() => void spotifyPost("/me/player/next", session)} />
              <text font="body">{`Vol ${volume()}`}</text>
              <Button
                label="-"
                onClick={() => {
                  const next = Math.max(0, volume() - 10);
                  setVolume(next);
                  sdkPlayer?.setVolume(next / 100);
                  void spotifyPut(`/me/player/volume?volume_percent=${next}`, null, session);
                }}
              />
              <Button
                label="+"
                onClick={() => {
                  const next = Math.min(100, volume() + 10);
                  setVolume(next);
                  sdkPlayer?.setVolume(next / 100);
                  void spotifyPut(`/me/player/volume?volume_percent=${next}`, null, session);
                }}
              />
            </box>
            <Show when={error()}>
              <text font="body">{error()}</text>
            </Show>
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
  defaultSize: { width: 380, height: 280 },
  scrollable: false,
  Component: SpotifyPlayer,
});
