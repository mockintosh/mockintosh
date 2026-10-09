import {
  MUSIC_KIT_IDLE,
  type BrowserService,
  type MusicKitError,
  type MusicKitItem,
  type MusicKitRepeatMode,
  type MusicKitService,
  type MusicKitShuffleMode,
  type MusicKitState,
} from "@mockintosh/sdk";

const MUSICKIT_URL = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
/** Apple Music's own page, for signing up before MusicKit has loaded. */
const APPLE_MUSIC_URL = "https://www.apple.com/apple-music/";

/** MusicKit's error reasons for an account that can't play full songs. */
const MEMBERSHIP_REASONS = new Set(["SUBSCRIPTION_ERROR", "STREAM_UPSELL"]);
const MEMBERSHIP_REQUIRED = "Apple Music membership required";

/** MusicKit events after which the state is read again. */
const EVENTS = [
  "authorizationStatusDidChange",
  "playbackStateDidChange",
  "nowPlayingItemDidChange",
  "playbackTimeDidChange",
  "playbackDurationDidChange",
  "playbackVolumeDidChange",
  "shuffleModeDidChange",
  "repeatModeDidChange",
];

/** The slice of a MusicKit instance this drives. */
interface MusicKitInstance {
  readonly isAuthorized: boolean;
  readonly isPlaying: boolean;
  readonly nowPlayingItem: MediaItem | undefined;
  readonly currentPlaybackTime: number;
  readonly currentPlaybackDuration: number;
  musicUserToken?: string;
  volume: number;
  shuffleMode: number;
  repeatMode: number;
  /** Apple Music's sign-up page for this storefront, with its current trial. */
  readonly subscribeURL?: string;
  setQueue(options: Record<string, unknown>): Promise<unknown>;
  play(): Promise<void>;
  pause(): void;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  seekToTime(seconds: number): Promise<void>;
  unauthorize(): Promise<void>;
  addEventListener(name: string, listener: (event: unknown) => void): void;
  removeEventListener(name: string, listener: (event: unknown) => void): void;
}

interface MediaItem {
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

function itemOf(item: MediaItem | undefined): MusicKitItem | null {
  if (!item) return null;
  const a = item.attributes ?? {};
  const ids = [item.id, a.playParams?.id, a.playParams?.catalogId].filter((id): id is string => !!id);
  return {
    id: ids[0] ?? "",
    ids,
    title: item.title ?? a.name ?? "",
    artistName: item.artistName ?? a.artistName ?? "",
    albumName: item.albumName ?? a.albumName ?? "",
    artworkUrl: a.artwork?.url ?? null,
  };
}

/** A MusicKit error (an `MKError`), as the apps are told it. */
function errorOf(error: unknown, fallback: string): MusicKitError {
  const reason = (error as { reason?: unknown; errorCode?: unknown } | null)?.reason ?? (error as { errorCode?: unknown } | null)?.errorCode;
  if (typeof reason === "string" && MEMBERSHIP_REASONS.has(reason)) return { message: MEMBERSHIP_REQUIRED, membershipRequired: true };
  return { message: fallback, membershipRequired: false };
}

function stateOf(music: MusicKitInstance): MusicKitState {
  return {
    ready: true,
    authorized: music.isAuthorized,
    playing: music.isPlaying,
    item: itemOf(music.nowPlayingItem),
    time: music.currentPlaybackTime || 0,
    duration: music.currentPlaybackDuration || 0,
    volume: music.volume,
    shuffleMode: (music.shuffleMode === 1 ? 1 : 0) as MusicKitShuffleMode,
    repeatMode: (music.repeatMode === 1 || music.repeatMode === 2 ? music.repeatMode : 0) as MusicKitRepeatMode,
  };
}

/**
 * MusicKit loaded into the page and driven for the apps. `origin` serves
 * `/api/apple-music/sign-in`, the sign-in window: Apple's own popup reports
 * back through `window.opener`, which the desktop's cross-origin isolation
 * severs, so that page runs MusicKit's sign-in instead and hands the token
 * back through `browser.authorize` (see `api/apple-music/sign-in.ts`).
 */
export function createWebMusicKit(browser: BrowserService, origin: string): MusicKitService {
  let music: MusicKitInstance | null = null;
  let state: MusicKitState = MUSIC_KIT_IDLE;
  const changeListeners = new Set<(state: MusicKitState) => void>();
  const errorListeners = new Set<(error: MusicKitError) => void>();

  function changed(): void {
    if (!music) return;
    state = stateOf(music);
    for (const listener of changeListeners) listener(state);
  }
  function report(error: MusicKitError): void {
    for (const listener of errorListeners) listener(error);
  }
  function failed(error: unknown): void {
    report(errorOf(error, "Apple Music couldn't play that."));
  }
  /**
   * A play MusicKit refused. A missing membership is reported to the
   * listeners too, since a process sees only a rejection's message.
   */
  async function playing<T>(action: Promise<T>): Promise<T> {
    try {
      return await action;
    } catch (e) {
      const error = errorOf(e, "");
      if (!error.membershipRequired) throw e;
      report(error);
      throw new Error(error.message);
    }
  }
  function attach(next: MusicKitInstance): void {
    if (music === next) return;
    if (music) {
      for (const name of EVENTS) music.removeEventListener(name, changed);
      music.removeEventListener("mediaPlaybackError", failed);
    }
    music = next;
    for (const name of EVENTS) next.addEventListener(name, changed);
    next.addEventListener("mediaPlaybackError", failed);
  }
  function player(): MusicKitInstance {
    if (!music) throw new Error("MusicKit isn't configured yet");
    return music;
  }

  return {
    get state() {
      return state;
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onError(listener) {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    async configure({ developerToken, musicUserToken }) {
      const MusicKit = (await browser.loadScript(MUSICKIT_URL, "MusicKit")) as MusicKitGlobal | undefined;
      if (!MusicKit) throw new Error("MusicKit failed to load");
      // Configuring again (after signing in) reads the token the sign-in window stored for this origin.
      const configured = (await MusicKit.configure({ developerToken, app: { name: "Mockintosh", build: "1.0" } })) ?? MusicKit.getInstance();
      if (!configured.isAuthorized && musicUserToken) {
        try {
          configured.musicUserToken = musicUserToken;
        } catch {
          // Read-only in this MusicKit; it plays previews until signed in again.
        }
      }
      attach(configured);
      changed();
      return state;
    },
    async authorize() {
      const params = await browser.authorize(`${origin}/api/apple-music/sign-in`);
      if (!params.code) throw new Error("Apple Music did not send a token");
      return params.code;
    },
    async unauthorize() {
      if (!music) return;
      music.pause();
      await music.unauthorize();
      changed();
    },
    openSignUp: () => browser.openExternal(music?.subscribeURL || APPLE_MUSIC_URL),
    async setQueue(options) {
      await playing(player().setQueue({ ...options }));
    },
    play: () => playing(player().play()),
    async pause() {
      player().pause();
    },
    skipToNextItem: () => playing(player().skipToNextItem()),
    skipToPreviousItem: () => playing(player().skipToPreviousItem()),
    seekToTime: (seconds) => player().seekToTime(seconds),
    setVolume(volume) {
      player().volume = volume;
      changed();
    },
    setShuffleMode(mode) {
      player().shuffleMode = mode;
      changed();
    },
    setRepeatMode(mode) {
      player().repeatMode = mode;
      changed();
    },
  };
}
