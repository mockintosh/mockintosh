import { describe, expect, it } from "vitest";
import type { FetchFunction } from "@mockintosh/sdk";
import { SpotifyError, fetchPlaylistTracks, fetchPlaylists, formatDuration, type SpotifySession } from "./api";

function sessionWith(routes: Record<string, { status?: number; body?: unknown }>): { session: SpotifySession; urls: string[] } {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    const route = routes[url];
    const status = route?.status ?? (route ? 200 : 404);
    return { ok: status >= 200 && status < 300, status, json: async () => route?.body ?? {} };
  }) as unknown as FetchFunction;
  const session: SpotifySession = {
    tokens: { access_token: "a", refresh_token: "r", expires_at: Date.now() + 3_600_000 },
    onChange: () => {},
    fetch,
    clientId: "client",
    redirectUri: "https://example.test/callback",
    crypto: { randomBytes: (n) => new Uint8Array(n), sha256: async () => new Uint8Array(32) },
  };
  return { session, urls };
}

const API = "https://api.spotify.com/v1";
const track = (n: number) => ({
  type: "track",
  uri: `spotify:track:${n}`,
  name: `Song ${n}`,
  artists: [{ name: "Band" }],
  album: { name: "Album", images: [] },
  duration_ms: 183_000,
});

describe("fetchPlaylistTracks", () => {
  it("reads the renamed items endpoint across pages and skips episodes and removed tracks", async () => {
    const first = `${API}/playlists/p1/items?limit=100&additional_types=track`;
    const second = `${API}/playlists/p1/items?offset=100&limit=100`;
    const { session, urls } = sessionWith({
      [first]: { body: { items: [{ item: track(1) }, { item: null }, { item: { ...track(2), type: "episode" } }], next: second } },
      [second]: { body: { items: [{ track: track(3) }], next: null } },
    });
    const tracks = await fetchPlaylistTracks("p1", session);
    expect(tracks.map((t) => t.name)).toEqual(["Song 1", "Song 3"]);
    expect(urls).toEqual([first, second]);
  });

  it("rejects with the status when Spotify won't list a playlist", async () => {
    const { session } = sessionWith({ [`${API}/playlists/p2/items?limit=100&additional_types=track`]: { status: 403 } });
    await expect(fetchPlaylistTracks("p2", session)).rejects.toEqual(new SpotifyError(403));
  });
});

describe("fetchPlaylists", () => {
  it("keeps the owner and song count under either field name", async () => {
    const { session } = sessionWith({
      [`${API}/me/playlists?limit=50`]: {
        body: {
          items: [
            { id: "a", name: "Mine", uri: "spotify:playlist:a", images: null, owner: { display_name: "Gus" }, items: { total: 4 } },
            null,
            { id: "b", name: "Old", uri: "spotify:playlist:b", owner: { id: "x" }, tracks: { total: 7 } },
          ],
          next: null,
        },
      },
    });
    expect(await fetchPlaylists(session)).toEqual([
      { id: "a", name: "Mine", uri: "spotify:playlist:a", images: [], owner: "Gus", total: 4 },
      { id: "b", name: "Old", uri: "spotify:playlist:b", images: [], owner: "x", total: 7 },
    ]);
  });
});

it("formats durations as m:ss", () => {
  expect(formatDuration(183_000)).toBe("3:03");
  expect(formatDuration(59_999)).toBe("0:59");
});
