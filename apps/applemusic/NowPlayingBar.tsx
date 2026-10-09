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

export interface NowPlayingBarProps {
  top: number;
  width: number;
  loader: ArtworkLoader;
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
  icons: { shuffle?: Sprite; repeat?: Sprite; repeatOne?: Sprite };
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onVolume: (volume: number) => void;
}

/**
 * The bar pinned along the window's foot: what's playing, the transport and
 * its modes, and a position slider that seeks.
 */
export function NowPlayingBar(props: NowPlayingBarProps): JSX.Element {
  // The title and the position slider take whatever the buttons leave;
  // layout reports how much that is.
  const [textW, setTextW] = createSignal(0);
  const [sliderW, setSliderW] = createSignal(0);
  const hasTrack = () => props.duration > 0 && !props.loading;
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
      <box
        flexGrow={1}
        flexDirection="row"
        alignItems="center"
        gap={PAD}
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <Artwork
          loader={props.loader}
          url={props.shown?.artworkUrl ?? null}
          size={ART}
        />
        <box flexGrow={1} flexDirection="column" gap={3}>
          <box flexDirection="row" alignItems="center" gap={PAD}>
            <box
              flexGrow={1}
              flexShrink={1}
              minWidth={0}
              flexDirection="column"
              onLayout={({ width }) => setTextW(width)}
            >
              <text font="body" bold nowrap>
                {fit(
                  props.error || props.shown?.title || "Not Playing",
                  textW(),
                  "body",
                  true,
                )}
              </text>
              <Show
                when={props.loading && !props.error}
                fallback={
                  <text font="body" nowrap>
                    {fit(
                      props.error ? "" : (props.shown?.artist ?? ""),
                      textW(),
                    )}
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
            </box>
            <Button
              name="music-shuffle"
              label=""
              icon={props.icons.shuffle}
              selected={props.shuffle}
              onClick={props.onShuffle}
            />
            <Button label="<<" onClick={props.onPrevious} />
            <Button
              label={props.playing ? "||" : ">"}
              onClick={props.onPlayPause}
            />
            <Button label=">>" onClick={props.onNext} />
            <Button
              name="music-repeat"
              label=""
              icon={
                props.repeat === "one"
                  ? props.icons.repeatOne
                  : props.icons.repeat
              }
              selected={props.repeat !== "none"}
              onClick={props.onRepeat}
            />
          </box>
          <box flexDirection="row" alignItems="center" gap={PAD}>
            <box width={TIME_W}>
              <text font="body" align="right" nowrap>
                {hasTrack() ? formatDuration(props.time * 1000) : ""}
              </text>
            </box>
            <box
              flexGrow={1}
              flexShrink={1}
              minWidth={0}
              onLayout={({ width }) => setSliderW(width)}
            >
              <Slider
                name="music-position"
                width={Math.max(20, sliderW())}
                min={0}
                max={Math.max(1, props.duration)}
                value={hasTrack() ? Math.min(props.time, props.duration) : 0}
                disabled={!hasTrack()}
                onChange={props.onSeek}
              />
            </box>
            <box width={TIME_W}>
              <text font="body" nowrap>
                {hasTrack()
                  ? `-${formatDuration(Math.max(0, props.duration - props.time) * 1000)}`
                  : ""}
              </text>
            </box>
            <Slider
              name="music-volume"
              width={VOLUME_W}
              min={0}
              max={100}
              step={5}
              value={props.volume}
              onChange={props.onVolume}
            />
          </box>
        </box>
      </box>
    </box>
  );
}
