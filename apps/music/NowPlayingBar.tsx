import { Show, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, Slider, Spinner } from "@mockintosh/ui";
import type { Sprite } from "@mockintosh/sdk";
import { Artwork, type ArtworkLoader } from "./Artwork";
import { formatDuration, type NowPlaying, type RepeatMode } from "./api";
import { fit } from "./views";

export const NOW_PLAYING_H = 52;
const ART = 36;
const PAD = 4;
const TIME_W = 34;
const VOLUME_W = 56;

/** What's playing and the controls over it: shared by the bar and the Now Playing screen. */
export interface Player {
  /** The track playing, or the one asked for and still loading. */
  shown: NowPlaying | null;
  loading: boolean;
  error: string;
  playing: boolean;
  /** Seconds. */
  time: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  /** The OS's `transport/*` glyphs, and the app's own shuffle and repeat. */
  icons: {
    play?: Sprite;
    pause?: Sprite;
    previous?: Sprite;
    next?: Sprite;
    shuffle?: Sprite;
    repeat?: Sprite;
    repeatOne?: Sprite;
  };
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onVolume: (volume: number) => void;
}

/** Shuffle, back, play or pause, forward, repeat. */
export function Transport(props: { player: Player }): JSX.Element {
  const p = () => props.player;
  return (
    <box flexDirection="row" alignItems="center" gap={PAD} flexShrink={0}>
      <Button name="music-shuffle" label="" icon={p().icons.shuffle} selected={p().shuffle} onClick={p().onShuffle} />
      <Button name="music-previous" label="" icon={p().icons.previous} onClick={p().onPrevious} />
      <Button
        name={p().playing ? "music-pause" : "music-play"}
        label=""
        icon={p().playing ? p().icons.pause : p().icons.play}
        onClick={p().onPlayPause}
      />
      <Button name="music-next" label="" icon={p().icons.next} onClick={p().onNext} />
      <Button
        name="music-repeat"
        label=""
        icon={p().repeat === "one" ? p().icons.repeatOne : p().icons.repeat}
        selected={p().repeat !== "none"}
        onClick={p().onRepeat}
      />
    </box>
  );
}

/**
 * Elapsed time, the position slider (which seeks) and the time left. It
 * takes the width its row leaves it; layout reports how much.
 */
export function Position(props: { player: Player }): JSX.Element {
  const [sliderW, setSliderW] = createSignal(0);
  const p = () => props.player;
  const hasTrack = () => p().duration > 0 && !p().loading;
  return (
    <box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" gap={PAD}>
      <box width={TIME_W}>
        <text font="body" align="right" nowrap>
          {hasTrack() ? formatDuration(p().time * 1000) : ""}
        </text>
      </box>
      <box flexGrow={1} flexShrink={1} minWidth={0} onLayout={({ width }) => setSliderW(width)}>
        <Slider
          name="music-position"
          width={Math.max(20, sliderW())}
          min={0}
          max={Math.max(1, p().duration)}
          value={hasTrack() ? Math.min(p().time, p().duration) : 0}
          disabled={!hasTrack()}
          onChange={p().onSeek}
        />
      </box>
      <box width={TIME_W}>
        <text font="body" nowrap>
          {hasTrack() ? `-${formatDuration(Math.max(0, p().duration - p().time) * 1000)}` : ""}
        </text>
      </box>
    </box>
  );
}

export function Volume(props: { player: Player; width?: number }): JSX.Element {
  return (
    <Slider
      name="music-volume"
      width={props.width ?? VOLUME_W}
      min={0}
      max={100}
      step={5}
      value={props.player.volume}
      onChange={props.player.onVolume}
    />
  );
}

/**
 * The track's title, then a second line: its artist (or `detail`), a
 * spinner while it loads, or nothing under an error.
 */
export function TrackTitle(props: { player: Player; width: number; font?: string; detail?: string }): JSX.Element {
  const p = () => props.player;
  const font = () => props.font ?? "body";
  // The body face is bold here; a larger face is already a heading.
  const bold = () => font() === "body";
  return (
    <>
      <text font={font()} bold={bold()} nowrap>
        {fit(p().error || p().shown?.title || "Not Playing", props.width, font(), bold())}
      </text>
      <Show
        when={p().loading && !p().error}
        fallback={
          <text font="body" nowrap>
            {fit(p().error ? "" : (props.detail ?? p().shown?.artist ?? ""), props.width)}
          </text>
        }
      >
        <box flexDirection="row" alignItems="center" gap={4}>
          <Spinner name="music-loading" />
          <text font="body" nowrap>
            Loading…
          </text>
        </box>
      </Show>
    </>
  );
}

/**
 * The bar pinned along the window's foot: what's playing, the transport and
 * its modes, and a position slider that seeks. Its artwork opens the Now
 * Playing screen.
 */
export function NowPlayingBar(props: {
  top: number;
  width: number;
  loader: ArtworkLoader;
  player: Player;
  onOpen: () => void;
}): JSX.Element {
  // The title takes whatever the buttons leave; layout reports how much.
  const [textW, setTextW] = createSignal(0);
  return (
    <box
      position="absolute"
      left={0}
      top={props.top}
      width={props.width}
      height={NOW_PLAYING_H}
      flexDirection="column"
      background={0}
      semantic={{ name: "music-now-playing" }}
    >
      <box width={props.width} height={1} background={1} />
      <box flexGrow={1} flexDirection="row" alignItems="center" gap={PAD} paddingLeft={PAD} paddingRight={PAD}>
        <box semantic={{ name: "music-open-now-playing", role: "button" }} onClick={props.onOpen}>
          <Artwork loader={props.loader} url={props.player.shown?.artworkUrl ?? null} size={ART} />
        </box>
        <box flexGrow={1} flexDirection="column" gap={3}>
          <box flexDirection="row" alignItems="center" gap={PAD}>
            <box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="column" onLayout={({ width }) => setTextW(width)}>
              <TrackTitle player={props.player} width={textW()} />
            </box>
            <Transport player={props.player} />
          </box>
          <box flexDirection="row" alignItems="center" gap={PAD}>
            <Position player={props.player} />
            <Volume player={props.player} />
          </box>
        </box>
      </box>
    </box>
  );
}
