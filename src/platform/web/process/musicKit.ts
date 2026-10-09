/**
 * Apple Music as a worker-hosted app sees it. MusicKit stays in the page
 * (a live object, playing through the page's media element); calls go to the
 * host, and the host pushes each new state once the app first listens, so a
 * process that never asks isn't sent the playback clock.
 */
import type { MusicKitError, MusicKitService, MusicKitState } from "@mockintosh/sdk";

type Call = (method: string, args: unknown[]) => Promise<unknown>;

export interface WorkerMusicKit {
  service: MusicKitService;
  /** A `musicKit` push: the player's new state. */
  update(state: MusicKitState): void;
  /** A `musicKitError` push. */
  error(error: MusicKitError): void;
}

export function createWorkerMusicKit(call: Call, notify: (method: string, ...args: unknown[]) => void, initial: MusicKitState): WorkerMusicKit {
  let state = initial;
  let listening = false;
  const changeListeners = new Set<(state: MusicKitState) => void>();
  const errorListeners = new Set<(error: MusicKitError) => void>();

  function listen(): void {
    if (listening) return;
    listening = true;
    notify("musicKit.listen");
  }
  function update(next: MusicKitState): void {
    state = next;
    for (const listener of changeListeners) listener(state);
  }

  const service: MusicKitService = {
    get state() {
      return state;
    },
    onChange(listener) {
      changeListeners.add(listener);
      listen();
      return () => changeListeners.delete(listener);
    },
    onError(listener) {
      errorListeners.add(listener);
      listen();
      return () => errorListeners.delete(listener);
    },
    async configure(options) {
      update((await call("musicKit.configure", [options])) as MusicKitState);
      return state;
    },
    authorize: () => call("musicKit.authorize", []) as Promise<string>,
    unauthorize: () => call("musicKit.unauthorize", []) as Promise<void>,
    openSignUp: () => call("musicKit.openSignUp", []) as Promise<void>,
    openInAppleMusic: (url) => call("musicKit.openInAppleMusic", [url]) as Promise<void>,
    setQueue: (options) => call("musicKit.setQueue", [options]) as Promise<void>,
    play: () => call("musicKit.play", []) as Promise<void>,
    pause: () => call("musicKit.pause", []) as Promise<void>,
    skipToNextItem: () => call("musicKit.skipToNextItem", []) as Promise<void>,
    skipToPreviousItem: () => call("musicKit.skipToPreviousItem", []) as Promise<void>,
    seekToTime: (seconds) => call("musicKit.seekToTime", [seconds]) as Promise<void>,
    setVolume: (volume) => notify("musicKit.setVolume", volume),
    setShuffleMode: (mode) => notify("musicKit.setShuffleMode", mode),
    setRepeatMode: (mode) => notify("musicKit.setRepeatMode", mode),
  };

  return {
    service,
    update,
    error(error) {
      for (const listener of errorListeners) listener(error);
    },
  };
}
