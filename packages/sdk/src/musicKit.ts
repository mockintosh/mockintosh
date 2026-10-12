/**
 * Apple Music playback through MusicKit on the Web, held by the OS.
 *
 * MusicKit is a live object in the page, and it plays DRM-protected audio
 * through the page's media element, so neither can move into an app's
 * process. The OS keeps MusicKit; an app drives it through this player and
 * reads its state as plain data, the same on the OS's thread or in a process.
 *
 * MusicKit is one per page: every app that uses this drives the same player.
 */
export interface MusicKitService {
  /** The player as of its last change. Starts not `ready` until `configure` resolves. */
  readonly state: MusicKitState;
  /** Called with the new state whenever it changes: playing, the item, the time, the modes. */
  onChange(listener: (state: MusicKitState) => void): () => void;
  /**
   * Called when MusicKit can't play what was asked: a `mediaPlaybackError`,
   * or a play that the account isn't allowed (`membershipRequired`).
   */
  onError(listener: (error: MusicKitError) => void): () => void;
  /**
   * Load MusicKit and configure it with the app's developer token (a JWT the
   * app's server signs). Signed out it plays 30-second previews. Configure
   * again after `authorize`, so MusicKit picks up the new sign-in;
   * `musicUserToken` hands it one saved from before.
   */
  configure(options: { developerToken: string; musicUserToken?: string | null }): Promise<MusicKitState>;
  /**
   * Sign in to Apple Music in this deployment's sign-in window. Resolves with
   * the Music User Token, for the app to keep and to send to the Apple Music
   * API; rejects when the user closes the window.
   */
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  /**
   * Open Apple Music's sign-up page, with whatever trial Apple is offering,
   * for someone who isn't a member. Call it from a click: it opens a tab.
   */
  openSignUp(): Promise<void>;
  /**
   * Open a page on Apple Music (a `music.apple.com` link, such as the Apple
   * Music API's `url` attributes) in a new tab. Rejects any other link. Call
   * it from a click: it opens a tab.
   */
  openInAppleMusic(url: string): Promise<void>;
  /** MusicKit's `setQueue`: `{ album | playlist | station | song: id }` or `{ songs: ids }`, with `startWith` and `startPlaying`. */
  setQueue(options: MusicKitQueueOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  seekToTime(seconds: number): Promise<void>;
  /** 0–1. */
  setVolume(volume: number): void;
  setShuffleMode(mode: MusicKitShuffleMode): void;
  setRepeatMode(mode: MusicKitRepeatMode): void;
}

export interface MusicKitQueueOptions {
  album?: string;
  playlist?: string;
  station?: string;
  song?: string;
  songs?: string[];
  startWith?: number;
  startPlaying?: boolean;
}

/** 0 off, 1 songs. */
export type MusicKitShuffleMode = 0 | 1;
/** 0 none, 1 the current item, 2 the whole queue. */
export type MusicKitRepeatMode = 0 | 1 | 2;

/** What MusicKit is doing, as plain data. */
export interface MusicKitState {
  /** `configure` has resolved. */
  ready: boolean;
  /** Signed in: whole songs and the library, not previews. */
  authorized: boolean;
  playing: boolean;
  /** The item playing or paused, or `null` when the queue is empty. */
  item: MusicKitItem | null;
  /** Seconds into the item, and its length (0 until it has loaded). */
  time: number;
  duration: number;
  /** 0–1. */
  volume: number;
  shuffleMode: MusicKitShuffleMode;
  repeatMode: MusicKitRepeatMode;
}

/** Why MusicKit couldn't play. */
export interface MusicKitError {
  message: string;
  /** Signed in without an Apple Music membership: offer `openSignUp`. */
  membershipRequired: boolean;
}

/** A queued song as MusicKit describes it. */
export interface MusicKitItem {
  id: string;
  /** The ids it plays under: the library's and the catalog's. */
  ids: string[];
  title: string;
  artistName: string;
  albumName: string;
  /** Apple's artwork URL template, with `{w}` and `{h}`. */
  artworkUrl: string | null;
  /** Its page on Apple Music (`music.apple.com`), for a catalog song. */
  url: string | null;
}

/** A player with nothing configured: what `state` is until `configure` resolves. */
export const MUSIC_KIT_IDLE: MusicKitState = {
  ready: false,
  authorized: false,
  playing: false,
  item: null,
  time: 0,
  duration: 0,
  volume: 1,
  shuffleMode: 0,
  repeatMode: 0,
};
